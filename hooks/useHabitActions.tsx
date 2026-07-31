import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  increment,
  writeBatch,
  serverTimestamp,
  deleteField,
  arrayUnion,
  arrayRemove,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import {
  Habit,
  HabitSubmission,
  HouseholdMember,
  Household,
  RewardItem
} from '@/types/schema';
import {
  processToggleHabit,
  processStaleDownToggle,
  calculateResetPoints,
  streakForHabit,
  streakEndingOnForHabit,
  isHabitStale,
  habitPeriodStart,
  getMultiplier,
  normalizeHabitTitle,
  signedHabitPoints,
  pointsForHabitOnDate
} from '@/utils/habitLogic';
import {
  attributedUnitsOnDate,
  attributionReversalForDates,
  completedByPath,
  habitFeedsMemberAttribution,
  householdPeriodPointsDelta,
  isHouseholdCreditHabit,
  legacyPeriodPoints,
  memberCompletionCount,
  memberPeriodPointsDelta,
  periodPointsMove,
  prospectiveMultiplierForMember,
  resolveReversalSources,
  wholePeriodClearDates,
  withAttributionDelta,
  type PointsBuckets,
} from '@/utils/habitAttribution';
import { crossedMilestone, rewardMilestoneSatisfied } from '@/utils/habitMilestones';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { CalendarDays, RotateCcw, Star, TrendingDown, PartyPopper, Gift } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { track } from '@/services/analytics';
import { shouldTrackFirstTime, FIRST_HABIT_FLAG } from '@/utils/firstTimeFlags';
import { appendActivityLog, composeSummary } from '@/utils/activityLog';
import { attributionString, TriggerSource } from '@/utils/habitTriggers';
import { accumulate, ToastAccumulatorState } from '@/utils/toastAccumulator';
import { softDeleteDoc } from '@/contexts/household/mutations/trashMutations';

/**
 * Window for folding rapid same-habit toggles into a single cumulative toast
 * instead of stacking one per tap. Matches the toast's own `duration: 5000`
 * below so the accumulation window and the toast's visible lifetime agree.
 * 5s (up from 1.5s) so the toast's Undo action is actually reachable — a
 * habit row is a full-surface tap target, and an accidental tap mutates
 * points silently without it (2026-07 round-3 critique).
 */
const POINTS_TOAST_WINDOW_MS = 5000;

/** One member's points document. */
const memberPointsRef = (householdId: string, memberId: string) =>
  doc(db, `households/${householdId}/members`, memberId);

/** The document(s) a habit's points are written to. */
interface HabitPointsTargets {
  /**
   * Plan 080c: the doc that receives the habit's OWN (household-level) points.
   * An assigned (per-member / kid chore) habit credits the assignee's own
   * `members/{uid}.points`; an unassigned/shared habit credits the shared
   * household doc. This figure is unchanged by the per-member points feature —
   * it is still derived from `completedDates` alone.
   *
   * 🛡️ `null` when that doc is a GHOST: an assigned chore whose assignee has
   * since been removed from the household. `removeMember()` never clears
   * `Habit.assignedTo`, so the ref stays pointing at a deleted doc — and a
   * `batch.update()` on a deleted doc rejects NOT_FOUND, poisoning the whole
   * all-or-nothing batch. A null pool means "skip the points write"; it is
   * deliberately NOT rerouted to the household pool, because crediting the
   * shared reward pool for a departed member's chore is a different (wrong)
   * answer. The habit itself still toggles.
   */
  poolRef: DocumentReference | null;
  /**
   * Per-member points (stage 1): the doc for ONE member's attributed share, on
   * top of the pool credit above.
   *
   * `null` for an ASSIGNED chore — `poolRef` already IS a member doc there, so
   * crediting again would double-count the assignee (matching
   * `habitFeedsMemberAttribution`, which keeps assigned habits out of the
   * attribution scorer for the same reason) — and `null` for a ghost uid, for
   * the NOT_FOUND reason above.
   *
   * It takes the uid rather than closing over "the acting member" because a
   * REVERSAL is bounded by stored attribution (`resolveReversalSources`) and so
   * may legitimately target someone other than whoever is tapping.
   */
  memberRef: (memberId: string) => DocumentReference | null;
}

/**
 * The single routing function every points-writing path (toggle, reset,
 * submission add/edit/delete, credit/un-credit) goes through, so an assigned
 * chore's points can never leak into the shared pool, a shared habit's
 * per-member credit can never be written twice, and no path can address a
 * removed member's deleted doc.
 */
const habitPointsTargets = (
  householdId: string,
  assignedTo: string | undefined,
  isLive: (memberId: string) => boolean,
): HabitPointsTargets => ({
  poolRef: assignedTo
    ? (isLive(assignedTo) ? memberPointsRef(householdId, assignedTo) : null)
    : doc(db, `households/${householdId}`),
  memberRef: (memberId: string) =>
    !assignedTo && memberId && isLive(memberId) ? memberPointsRef(householdId, memberId) : null,
});

/**
 * WHO a completion belongs to — i.e. who gets CREDITED, going FORWARD — or
 * `null` when the completion credits the HOUSEHOLD and nobody individually.
 *
 * `completedBy` records the person a completion is FOR, never the device
 * operator. A managed kid has no auth session of their own, so every Kid-Mode
 * chore is physically tapped by a parent — attributing to the signed-in uid
 * recorded the ADULT as the completer of every assigned chore. An assigned
 * habit therefore attributes to its assignee, mirroring how
 * `habitPointsTargets` already routes that habit's points.
 *
 * 🏁 HOUSEHOLD CREDIT (`Habit.creditMode === 'household'`) yields NO actor. That
 * is the whole mechanism: a completion with no `completedBy` entry scores
 * through the existing unattributed path — one award at the habit's own flame,
 * to the pool, to nobody — so "we cooked dinner together" pays the household
 * ONCE instead of paying it the sum of two personal awards. A caller that names
 * members explicitly (the picker's per-completion override) overrides this; it
 * never reaches here.
 *
 * 🛡️ This is NEVER the authority for what to REVERSE. It reads the habit's
 * CURRENT `assignedTo`/`creditMode`, which can change after the fact; the stored
 * `Habit.completedBy` map is the only record of who was actually credited. Every
 * reversal path runs its preferred uid through `resolveReversalSources` first.
 */
const attributionActor = (
  habit: Pick<Habit, 'assignedTo' | 'creditMode'>,
  actorUid: string,
): string | null => (isHouseholdCreditHabit(habit) ? null : habit.assignedTo ?? actorUid);

/** One member's attribution move on a single date: `delta` units, signed. */
interface AttributionMove {
  memberId: string;
  delta: number;
}

/**
 * The habit-doc update fragment that applies `delta` to one member's
 * attribution count on one date.
 *
 * 🛡️ ALWAYS an unconditional dot-path `increment()`, in both directions. The
 * obvious refinement — `deleteField()` once the count would reach zero — has to
 * read the CLIENT-CACHED prior count to decide, and an offline PWA's cache can
 * be arbitrarily stale: the delete would then wipe a node another device had
 * just incremented (the 2026-07-15 clobber class, one level down). The cost is
 * a possible `0`/negative residue node, which every reader in
 * `utils/habitAttribution.ts` treats as ABSENT and `habitConverter` drops on
 * read. Whole-DATE clears still use `deleteField()` on the `completedBy.<date>`
 * node — that is absolute by design, mirroring the `completedDates` arrayRemove
 * committed in the same batch.
 */
const attributionUpdate = (
  date: string,
  memberId: string,
  delta: number,
): Record<string, unknown> =>
  delta === 0 ? {} : { [completedByPath(date, memberId)]: increment(delta) };

/**
 * Turn a set of attribution moves into the habit-doc update fragment that
 * applies them all (each an individual dot-path increment — see
 * `attributionUpdate`).
 */
const attributionUpdates = (
  date: string,
  moves: AttributionMove[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const { memberId, delta } of moves) {
    Object.assign(out, attributionUpdate(date, memberId, delta));
  }
  return out;
};

/**
 * The attribution moves a REVERSAL of `units` units on `date` should make,
 * bounded by what `Habit.completedBy` actually records (`resolveReversalSources`).
 * Empty when the completion predates member attribution — nothing to reverse,
 * which is the correct answer for grandfathered history rather than debiting
 * points that were never credited.
 */
const reversalMoves = (
  habit: Habit,
  preferredMemberId: string,
  date: string,
  units: number,
): AttributionMove[] =>
  resolveReversalSources(habit, preferredMemberId, date, units).map(source => ({
    memberId: source.memberId,
    delta: -source.units,
  }));

/**
 * The Firestore payload that moves one points document by a bucket triple.
 * Zero buckets are omitted entirely, so a delta that belongs to a closed week
 * writes `points.total` alone (the shape every caller's tests pin).
 */
const pointsIncrements = (buckets: PointsBuckets): Record<string, unknown> => ({
  ...(buckets.total !== 0 ? { 'points.total': increment(buckets.total) } : {}),
  ...(buckets.daily !== 0 ? { 'points.daily': increment(buckets.daily) } : {}),
  ...(buckets.weekly !== 0 ? { 'points.weekly': increment(buckets.weekly) } : {}),
});

/**
 * Bucket-gate ONE flat delta by the date it belongs to — the grandfathered /
 * assigned-chore path, where there is a single habit-level figure and no
 * per-member decomposition to gate per date. Same rule as the attributed path
 * (`applyGatedDelta` in habitAttribution.ts): total always, weekly inside the
 * current Monday-anchored week, daily only for today.
 */
const gateDelta = (delta: number, date: string, today: string): PointsBuckets => {
  const weekStart = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  return {
    total: delta,
    daily: date === today ? delta : 0,
    weekly: date >= weekStart && date <= today ? delta : 0,
  };
};

/**
 * 🏁 STAGE 1.5 — THE POINTS RULE. One function, every points-writing path that
 * moves a habit forward or back (the whole-period CLEAR paths go through
 * `attributionReversalForDates` + `queueAttributionReversal`, which is the same
 * rule expressed as a reversal).
 *
 * Queues BOTH the pool delta and every affected member's delta into `batch`,
 * and returns the pool's signed lifetime total (the figure a caller's toast
 * reports).
 *
 * 🛡️ POOL AND MEMBERS COME OUT OF ONE DECOMPOSITION. `periodPointsMove` scores
 * the period's every date once and hands back `household` plus `perMember`,
 * each bucket-gated by the date its award actually moved on. Deriving them
 * separately — or gating the members by the caller's triggering date, as this
 * used to — makes `household ≠ Σ members + unattributed` in the daily/weekly
 * buckets, and a weekly threshold period's side-effect award lands on a day the
 * member never acted on. Neither drift self-heals: `points.total` is a lifetime
 * counter no recompute rebuilds and a closed week's `points.weekly` is never
 * revisited.
 *
 * 🛡️ THE MEMBER SET IS THE PERIOD'S, NOT THE CALLER'S. A threshold period
 * spanning several days (a weekly habit) flips an EARLIER member's award from 0
 * to a full one as a SIDE EFFECT of a different member's later-day credit
 * completing the period — a doc the caller never named. `periodPointsMove`
 * returns exactly the members whose own award moved, on either side, so the two
 * halves of the batch are equal by construction. A member whose award did not
 * move is absent from the map, so the ordinary single-member, single-day write
 * is unchanged: exactly one member doc.
 *
 * **Shared habits** are scored by the locked competition model: the pool figure
 * is `Σ member awards + the unattributed remainder`, so a completion pays the
 * pool the SUM of what the credited members earned at THEIR OWN prospective
 * streak multipliers — never the habit-level multiplier that
 * `processToggleHabit`/`calculateResetPoints` compute.
 *
 * **Assigned chores** (Plan 080c) are deliberately untouched: their "pool" IS a
 * member doc, they are excluded from attribution scoring
 * (`habitFeedsMemberAttribution`), and they keep the legacy habit-level figure
 * with no second per-member write.
 *
 * **Household credit** (`Habit.creditMode === 'household'`) passes
 * `attributionMoved: true` with an EMPTY set of attribution moves. The
 * decomposition then hands back `perMember` empty and `household` equal to the
 * unattributed remainder's own move — which IS the invariant, stated as code:
 * `household = Σ perMember (nothing) + unattributed`. Passing `false` here
 * instead would pay the pool the path's habit-level `legacyDelta` while
 * `move.perMember` still wrote any SIDE-EFFECT member award a newly-completed
 * threshold period flipped on, and `points.total` never self-heals.
 *
 * **Grandfathered work** (`attributionMoved === false` — a down-toggle or
 * submission delete on a completion that predates attribution, so
 * `resolveReversalSources` found nothing to take back) also keeps the path's own
 * `legacyDelta` for the POOL. That is what makes pre-feature history reverse at
 * EXACTLY the points it was credited — a stored `submission.pointsEarned`, or
 * `calculateResetPoints`' pre/post-threshold multiplier split — rather than at a
 * re-derived approximation of it. The member half is unaffected: a
 * grandfathered completion holds no attribution, so nobody's award moves.
 *
 * `targets.poolRef` / `targets.memberRef` return null for a ghost uid (see
 * `HabitPointsTargets`), which is what keeps a since-removed member's deleted
 * doc out of the all-or-nothing batch.
 */
const queueHabitPointsMove = (args: {
  batch: ReturnType<typeof writeBatch>;
  habit: Habit;
  before: Habit;
  after: Habit;
  date: string;
  today: string;
  targets: HabitPointsTargets;
  attributionMoved: boolean;
  legacyDelta: number;
}): number => {
  const move = habitFeedsMemberAttribution(args.habit)
    ? periodPointsMove(args.before, args.after, args.date, args.today)
    : null;

  const pool =
    args.attributionMoved && move
      ? move.household
      : gateDelta(args.legacyDelta, args.date, args.today);

  if (args.targets.poolRef) {
    const poolUpdates = pointsIncrements(pool);
    if (Object.keys(poolUpdates).length > 0) args.batch.update(args.targets.poolRef, poolUpdates);
  }

  for (const [memberId, buckets] of move?.perMember ?? []) {
    const ref = args.targets.memberRef(memberId);
    if (!ref) continue;
    args.batch.update(ref, pointsIncrements(buckets));
  }

  return pool.total;
};

/**
 * Queue the per-member points reversals produced by clearing attribution for a
 * set of dates (reset / clear-day / stale-deselect). Each member's deltas are
 * already bucket-gated by the date they were earned on.
 *
 * `isLiveMember` gates every write: a member removed via `removeMember()` leaves
 * their attribution behind on the habit doc, and `batch.update()` on a deleted
 * doc rejects NOT_FOUND — which, batches being all-or-nothing, would break the
 * WHOLE reset/clear for that habit forever. Skipping the dead member's points
 * reversal loses nothing (their score no longer exists) while the habit-doc
 * `clearPaths` still strip their stale attribution, so the state self-heals.
 */
const queueAttributionReversal = (
  batch: ReturnType<typeof writeBatch>,
  householdId: string,
  perMember: Map<string, { daily: number; weekly: number; total: number }>,
  isLiveMember: (memberId: string) => boolean,
): void => {
  for (const [memberId, delta] of perMember) {
    if (delta.daily === 0 && delta.weekly === 0 && delta.total === 0) continue;
    if (!isLiveMember(memberId)) continue;
    batch.update(memberPointsRef(householdId, memberId), {
      ...(delta.daily !== 0 ? { 'points.daily': increment(delta.daily) } : {}),
      ...(delta.weekly !== 0 ? { 'points.weekly': increment(delta.weekly) } : {}),
      ...(delta.total !== 0 ? { 'points.total': increment(delta.total) } : {}),
    });
  }
};

export const useHabitActions = (
  householdId: string | null,
  currentUser: HouseholdMember | null,
  habits: Habit[],
  householdSettings: Household | null,
  rewardsInventory: RewardItem[] = [],
  /**
   * The household's CURRENTLY-LIVE members. Attribution outlives membership —
   * a removed member's uid stays in `Habit.completedBy` — so every per-member
   * points write is filtered against this roster before it is queued (see
   * `isLiveMember`).
   */
  members: Pick<HouseholdMember, 'uid'>[] = []
) => {
  // Keep mutable refs so callbacks can read the latest habits/settings without
  // including them in dep arrays.  This prevents every habit write from
  // recreating all callbacks and cascading re-renders to all consumers.
  const habitsRef = useRef<Habit[]>(habits);
  useEffect(() => { habitsRef.current = habits; }, [habits]);

  // Same ref-backed pattern for the member roster: it is rewritten on every
  // points delta, so keying the callbacks on it would recreate all of them on
  // every toggle.
  const membersRef = useRef<Pick<HouseholdMember, 'uid'>[]>(members);
  useEffect(() => { membersRef.current = members; }, [members]);

  const householdSettingsRef = useRef<Household | null>(householdSettings);
  useEffect(() => { householdSettingsRef.current = householdSettings; }, [householdSettings]);

  const rewardsInventoryRef = useRef<RewardItem[]>(rewardsInventory);
  useEffect(() => { rewardsInventoryRef.current = rewardsInventory; }, [rewardsInventory]);

  // Per-habit running total for the points toast (keyed by habit id). Lives
  // in a ref (not module scope, which would leak across tests/users, and not
  // component state, which would re-render on every toggle) — see
  // toastAccumulator.ts for the pure math this drives.
  const pointsToastAccumulatorRef = useRef<ToastAccumulatorState>(new Map());

  // Self-reference so the points toast's Undo action can fire the reverse
  // toggle — a useCallback can't appear in its own dependency array, so the
  // toast closure reads the latest callback through this ref instead.
  const toggleHabitSelfRef = useRef<(id: string, direction: 'up' | 'down', source?: TriggerSource) => Promise<void>>(async () => {});

  /**
   * Does `memberId` still have a member doc we may `batch.update()`?
   *
   * A `batch.update()` against a deleted doc rejects NOT_FOUND, and a Firestore
   * batch is all-or-nothing — so ONE stale uid left behind in `completedBy` by
   * `removeMember()` would permanently break every reset / clear-day /
   * stale-deselect touching that habit+date. Filtering the per-member writes is
   * the fix; `set(..., {merge:true})` is NOT, because `firestore.rules`
   * evaluates a merge-set on a nonexistent doc as a CREATE and the member
   * create rule denies that for non-admins (NOT_FOUND → PERMISSION_DENIED).
   *
   * An EMPTY roster means "not loaded yet / unknown", not "nobody is a member"
   * (a household always has at least one), so it fails OPEN — dropping every
   * member credit during a load race would silently lose points.
   *
   * Stable (`[]` deps, reads the ref), so it never churns callback identities.
   */
  const isLiveMember = useCallback((memberId: string): boolean => {
    const roster = membersRef.current;
    if (roster.length === 0) return true;
    return roster.some(m => m.uid === memberId);
  }, []);

  const addHabit = useCallback(async (habit: Habit): Promise<string> => {
    if (!householdId || !currentUser) throw new Error("Not authenticated");
    try {
      // Use currentUser.uid as creator since that's what we have available here
      // The original code used `user.uid` from useAuth() but currentUser.uid should match
      const docRef = await addDoc(collection(db, `households/${householdId}/habits`), {
        ...habit,
        titleLower: normalizeHabitTitle(habit.title),
        createdBy: currentUser.uid,
        isShared: habit.isShared ?? true,
        ownerId: habit.isShared ? null : currentUser.uid,
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit created');
      return docRef.id;
    } catch (error) {
      console.error('[addHabit] Failed to create habit:', error);
      toast.error(describeError(error, 'create the habit'));
      throw error;
    }
  }, [householdId, currentUser]);

  const updateHabit = useCallback(async (habit: Habit) => {
    if (!householdId) return;
    try {
      // Build update object, filtering out undefined values (Firestore rejects undefined)
      const updateData = Object.fromEntries(
        Object.entries({
          title: habit.title,
          titleLower: normalizeHabitTitle(habit.title),
          category: habit.category,
          type: habit.type,
          basePoints: habit.basePoints,
          scoringType: habit.scoringType,
          period: habit.period,
          targetCount: habit.targetCount,
          totalCount: habit.totalCount,
          isShared: habit.isShared,
          ownerId: habit.ownerId,
          isCustom: habit.isCustom,
          effortLevel: habit.effortLevel,
          presetId: habit.presetId,
          // Plan 080c: persist the chore assignee so a re-assignment sticks. The
          // .filter below drops it when undefined, so an unassigned habit (every
          // existing one) writes nothing new here — this stays dormant.
          assignedTo: habit.assignedTo,
          // Household credit mode. The .filter below drops it when undefined, so
          // a habit that has never carried the field (every existing one) writes
          // nothing new here — but an explicit `'members'` from the editor DOES
          // write, which is what makes flipping back off 'household' stick.
          creditMode: habit.creditMode,
        }).filter(([, value]) => value !== undefined)
      );

      // Habit Automations (PRD #1065): persist trigger config (keywords +
      // saved locations) edited in the habit's Automations section. Handled
      // OUTSIDE the generic filter above because clearing the last saved
      // trigger must remove the field from Firestore (deleteField), not
      // merely omit it from this update — or a stale keyword/location would
      // linger forever.
      //
      // The caller's INTENT is distinguished by whether `triggers` is an own
      // property on the passed-in `habit` object at all, not by its value:
      //   - key absent (HabitFormModal always attaches `triggers` in edit
      //     mode — see baseHabitData — so an absent key means the call came
      //     from a different caller entirely) => an ordinary edit that didn't
      //     touch Automations => leave the stored field untouched.
      //   - key present but the value is empty/undefined (the Automations
      //     editor explicitly clearing the last keyword/location) => remove
      //     the field via deleteField().
      //   - key present with a non-empty value => write it.
      // A plain `habit.triggers !== undefined` check can't tell these apart:
      // both "not touched" and "explicitly cleared" often produce the same
      // `undefined` value, so it would either wipe triggers on every
      // unrelated edit or make clearing impossible.
      const hasTriggersKey = Object.prototype.hasOwnProperty.call(habit, 'triggers');
      const triggersValue = habit.triggers;
      const triggersIsEmpty =
        !triggersValue ||
        (!triggersValue.keywords?.length && !triggersValue.locations?.length);

      await updateDoc(doc(db, `households/${householdId}/habits`, habit.id), {
        ...updateData,
        ...(hasTriggersKey
          ? { triggers: triggersIsEmpty ? deleteField() : triggersValue }
          : {}),
        lastUpdated: serverTimestamp(),
      });
    } catch (error) {
      console.error('[updateHabit] Failed to update habit:', error);
      throw error;
    }
  }, [householdId]);

  const deleteHabit = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      // F-XCUT-03: soft-delete into the unified trash (recoverable for 30 days).
      // Points already credited are NOT reversed on delete, so restoring the
      // habit doc verbatim never double-counts.
      await softDeleteDoc({ db, householdId, deletedBy: currentUser?.uid ?? null }, 'habit', id);
    } catch (error) {
      console.error('[deleteHabit] Failed to delete habit:', error);
      throw error;
    }
  }, [householdId, currentUser]);

  const archiveHabit = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        archivedAt: getLocalDateString(),
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit archived');
    } catch (error) {
      console.error('[archiveHabit] Failed to archive habit:', error);
      toast.error(describeError(error, 'archive the habit'));
      throw error;
    }
  }, [householdId]);

  const unarchiveHabit = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        archivedAt: null,
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit restored');
    } catch (error) {
      console.error('[unarchiveHabit] Failed to unarchive habit:', error);
      toast.error(describeError(error, 'restore the habit'));
      throw error;
    }
  }, [householdId]);

  const reorderHabits = useCallback(async (updates: { id: string; order: number; category?: string }[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      updates.forEach(({ id, order, category }) => {
        const habitRef = doc(db, `households/${householdId}/habits`, id);
        const updateData: { order: number; category?: string } = { order };

        // Ensure category is a valid non-empty string if present
        if (category && typeof category === 'string' && category.trim().length > 0) {
          updateData.category = category.trim();
        }

        batch.update(habitRef, updateData);
      });
      await batch.commit();
      toast.success('Habits reordered');
    } catch (error) {
      console.error('[reorderHabits] Failed:', error);
      toast.error(describeError(error, 'reorder the habits'));
      throw error;
    }
  }, [householdId]);

  const toggleHabit = useCallback(async (id: string, direction: 'up' | 'down', source?: TriggerSource) => {
    if (!householdId || !currentUser || !householdSettingsRef.current) return;

    const habit = habitsRef.current.find(h => h.id === id);
    if (!habit) return;

    // An ARCHIVED habit must never fire forward (PRD #1065): a manual or geo-
    // confirm 'up' tap is a no-op, matching the to-do/transaction automation
    // paths (utils/habitTriggerFire.ts:computeHabitTriggerFire). A 'down'
    // reverse is still allowed so a fire credited before archiving can be undone.
    if (direction === 'up' && habit.archivedAt) return;

    // LAZY RESET CHECK
    const isStale = isHabitStale(habit);
    let effectiveHabit = habit;

    if (isStale) {
      // Down-toggle on a stale habit = "undo the previous period's completion"
      // (the overnight auto-reset never ran, so the card still showed selected).
      // Remove that prior period's completion date(s) AND reverse the points it
      // earned with date-aware gating (processStaleDownToggle): total always,
      // weekly only when the reversed date is still in the current Monday-
      // anchored week, daily never (the date is by definition not today) — so
      // deselecting yesterday's leftover can't drive today's daily negative.
      // Habit + points commit in ONE writeBatch (project atomicity rule).
      if (direction === 'down') {
        const staleResult = processStaleDownToggle(habit);
        const staleBatch = writeBatch(db);

        // Per-member points (stage 1): the prior period's completion dates are
        // being erased, so their attribution goes with them — keeping
        // `completedBy` and `completedDates` mutually consistent in the SAME
        // batch — and every member credited on those dates has exactly what
        // they earned there reversed.
        // `count: 0` is written below, so that is the counter the reversal must
        // score its "after" state against (only observable on a threshold habit
        // whose cleared period keeps a completion date).
        const staleReversal = habitFeedsMemberAttribution(habit)
          ? attributionReversalForDates(
              habit, staleResult.datesToRemove, getLocalDateString(), 0,
            )
          : null;
        const staleClearPaths = staleReversal?.clearPaths ?? [];
        const stalePerMember = staleReversal?.perMember ?? new Map<string, PointsBuckets>();
        // Stage 1.5: when the erased dates carried attribution the pool loses
        // exactly what those dates contributed under the competition model
        // (Σ member awards + remainder); an entirely grandfathered stale
        // deselect keeps `processStaleDownToggle`'s own date-gated figure.
        const stalePoolDelta: PointsBuckets =
          staleClearPaths.length > 0 && staleReversal
            ? staleReversal.household
            : staleResult.pointsDelta;

        staleBatch.update(doc(db, `households/${householdId}/habits`, id), {
          ...Object.fromEntries(staleClearPaths.map(path => [path, deleteField()])),
          count: 0,
          // Reversing the prior period's completion also disavows its counted
          // actions from the lifetime counter (mirrors resetHabitDay).
          totalCount: staleResult.datesToRemove.length > 0
            ? Math.max(0, habit.totalCount - habit.count)
            : habit.totalCount,
          // Server-side delta, never the locally-computed array (a stale
          // offline cache would wholesale-overwrite completion history).
          ...(staleResult.datesToRemove.length > 0
            ? { completedDates: arrayRemove(...staleResult.datesToRemove) }
            : {}),
          streakDays: staleResult.streakDays,
          lastUpdated: serverTimestamp(),
        });

        const { daily, weekly, total } = stalePoolDelta;
        const stalePoolRef = habitPointsTargets(householdId, habit.assignedTo, isLiveMember).poolRef;
        if (stalePoolRef && (daily !== 0 || weekly !== 0 || total !== 0)) {
          staleBatch.update(stalePoolRef, {
            ...(daily !== 0 ? { 'points.daily': increment(daily) } : {}),
            ...(weekly !== 0 ? { 'points.weekly': increment(weekly) } : {}),
            ...(total !== 0 ? { 'points.total': increment(total) } : {}),
          });
        }
        queueAttributionReversal(staleBatch, householdId, stalePerMember, isLiveMember);

        // A failed commit here used to surface as an unhandled rejection — the
        // user saw the "undone" toast for a write that never landed. Degrade
        // visibly instead (project error-toast convention).
        try {
          await staleBatch.commit();
        } catch (error) {
          console.error('[toggleHabit] Stale deselect failed:', error);
          toast.error(describeError(error, 'undo the previous completion'));
          return;
        }

        toast(
          staleResult.datesToRemove.length > 0
            ? "Previous period's completion undone."
            : 'Habit reset to 0 for today.',
          { icon: toastIcon(CalendarDays) }
        );
        return;
      }

      // If toggling up, proceed as if count was 0.
      effectiveHabit = {
        ...habit,
        count: 0,
        // Use current time string for local logic consistency
        lastUpdated: new Date().toISOString(),
      };
    }

    // Use extracted business logic
    const result = processToggleHabit(effectiveHabit, direction);
    if (!result) return;

    // Atomically commit habit state + points in a single batch so both writes
    // succeed together or neither does (prevents points/habit desync on crash).
    const batch = writeBatch(db);

    // completedDates is written as a server-side arrayUnion/arrayRemove delta,
    // NEVER as the locally-computed array processToggleHabit returns — a device
    // with a stale offline cache would otherwise wholesale-overwrite (wipe) the
    // habit's completion history (2026-07-15 incident). Diff old vs new at the
    // write site: a toggle changes at most one date. Scalars (count/streak)
    // are self-correcting, so local computation stays safe.
    const prevDates = effectiveHabit.completedDates;
    const nextDates = result.updatedHabit.completedDates ?? prevDates;
    const addedDate = nextDates.find(d => !prevDates.includes(d));
    const removedDate = prevDates.find(d => !nextDates.includes(d));

    // Counters are written as Firestore increment() DELTAS (not the absolute
    // client-computed values) so a stale offline cache can't clobber another
    // device's concurrent toggle of the same counter (same class of bug as the
    // 2026-07-15 completedDates clobber). The deltas are measured against the
    // REAL stored habit.count/totalCount.
    // EXCEPTION — the stale lazy-reset ('up'): effectiveHabit.count was zeroed
    // above, so result.updatedHabit.count is already `0 + delta`. That reset
    // deliberately DISCARDS the prior-period stored counter, so it's written
    // ABSOLUTELY here (a reset-then-increment expressed as an absolute write);
    // routing it through increment() would add to the stale value we mean to
    // throw away. totalCount is a lifetime counter (never reset), so it stays a
    // plain increment even on the stale path.
    const nextCount = result.updatedHabit.count ?? effectiveHabit.count;
    const nextTotalCount = result.updatedHabit.totalCount ?? effectiveHabit.totalCount;
    const countDelta = nextCount - habit.count;
    const totalCountDelta = nextTotalCount - habit.totalCount;

    // --- Per-member points (stage 1) -------------------------------------
    // A tap credits the member the completion BELONGS to: the signed-in member
    // normally, the ASSIGNEE for an assigned chore (a managed kid never taps
    // for themselves — see `attributionActor`). Attribution mirrors `count`:
    // +1 unit per 'up', −1 per 'down' — clamped at zero, so a legacy completion
    // nobody is credited for stays unattributed rather than going negative.
    //
    // The member's own points delta is derived by scoring the habit's PERIOD
    // before and after the write with the very function the corrective
    // recompute uses (`memberPeriodPoints`), so the two can never disagree.
    // That also means the multiplier comes from the member's OWN prospective
    // streak, not the habit's — the locked product decision — and a
    // grandfathered habit (no `completedBy`) starts every member at streak 0.
    //
    // 🛡️ Forward and reverse are ASYMMETRIC on purpose. An 'up' credits the
    // attributed member; a 'down' reverses whoever STORED attribution says holds
    // the unit (`reversalMoves`), because `attributedTo` reads the habit's
    // CURRENT `assignedTo` — reassign a chore between the up-tap and the
    // down-tap and the naive reversal computes a 0 delta against the new
    // assignee while the original credit survives forever.
    //
    // 🏁 HOUSEHOLD CREDIT yields NO actor, and therefore NO moves in EITHER
    // direction. Forward: the completion is deliberately unattributed, so it
    // pays the pool once at the habit's own flame and credits nobody. Backward:
    // the unit being taken back is the unattributed one, so `reversalMoves`
    // must NOT run — its holder fallback would debit a member who holds a
    // (per-completion override) unit this tap never touched.
    const today = getLocalDateString();
    const attributedTo = attributionActor(habit, currentUser.uid);
    const householdCredit = attributedTo === null;
    const attributionMoves: AttributionMove[] =
      attributedTo === null
        ? []
        : direction === 'up'
          ? [{ memberId: attributedTo, delta: 1 }]
          : reversalMoves(effectiveHabit, attributedTo, today, 1);
    let habitAfter: Habit = { ...effectiveHabit, ...result.updatedHabit } as Habit;
    for (const move of attributionMoves) {
      habitAfter = withAttributionDelta(habitAfter, today, move.memberId, move.delta);
    }
    const targets = habitPointsTargets(householdId, habit.assignedTo, isLiveMember);

    batch.update(doc(db, `households/${householdId}/habits`, id), {
      ...attributionUpdates(today, attributionMoves),
      ...(isStale
        ? { count: nextCount }
        : countDelta !== 0
          ? { count: increment(countDelta) }
          : {}),
      ...(totalCountDelta !== 0 ? { totalCount: increment(totalCountDelta) } : {}),
      ...(addedDate !== undefined ? { completedDates: arrayUnion(addedDate) } : {}),
      ...(removedDate !== undefined ? { completedDates: arrayRemove(removedDate) } : {}),
      streakDays: result.updatedHabit.streakDays,
      lastUpdated: serverTimestamp(),
    });

    // Stage 1.5: the pool figure for a SHARED habit is now the competition model
    // (Σ member awards + the unattributed remainder), not `result.pointsChange`'s
    // habit-level multiplier. `result.pointsChange` survives as the pool figure
    // for assigned chores and for a grandfathered down-toggle that took no
    // attribution back.
    //
    // 🛡️ The member writes go through the SAME `queueHabitPointsMove` every
    // other path uses, so they cover the PERIOD's holders rather than just the
    // tapper. A weekly threshold habit at `targetCount: 2` completed by a second
    // member on a later day pays BOTH members — the pool delta always did, and
    // this path used to write only the tapper's half, permanently shorting the
    // earlier member's lifetime `points.total`.
    // Plan 080c: an assigned (per-member/kid chore) habit credits the assignee's
    // OWN member.points — their personal balance for rewards/allowance — instead
    // of the shared household pool, and takes no second per-member write.
    // 🛡️ A null poolRef means the habit is assigned to a GHOST — a member removed
    // from the household while `habit.assignedTo` still names them. Their member
    // doc is gone, so an update would reject NOT_FOUND and, batches being
    // all-or-nothing, poison EVERY subsequent tap of this habit permanently. The
    // points write is skipped rather than rerouted to the household pool: the
    // shared reward pool must not absorb a departed member's chore points. (This
    // hazard predates the per-member feature — the pool has always routed
    // `assignedTo` straight at a member doc.)
    // Date-awareness invariant: on this NON-STALE path `processToggleHabit` only
    // ever adds/removes TODAY from completedDates (a stale habit — whose counter
    // could reference a prior period — was either lazily zeroed above for 'up'
    // or diverted to the processStaleDownToggle branch for 'down'), so the tap's
    // OWN award always lands on today's daily bucket; only a side-effect award
    // on an earlier day of the same week is gated away from it.
    const poolDelta = queueHabitPointsMove({
      batch,
      habit,
      before: effectiveHabit,
      after: habitAfter,
      date: today,
      today,
      targets,
      // Household credit moves no member, but the DECOMPOSITION is still the
      // right pool figure (see queueHabitPointsMove): it is the unattributed
      // remainder's own move, which is by construction what the corrective
      // recompute derives.
      attributionMoved: attributionMoves.length > 0 || householdCredit,
      legacyDelta: result.pointsChange,
    });
    // The multiplier the points toast reports. An 'up' on a shared habit earns
    // the ACTING member's own prospective streak multiplier (the locked model),
    // so on flip day a long-standing 2.0x habit correctly reads 1.0x until that
    // member's personal chain rebuilds. Everything else keeps the habit-level
    // figure `processToggleHabit` computed.
    // A HOUSEHOLD credit earns the HABIT's own flame (nobody's personal chain
    // moves), which is exactly `result.multiplier`.
    const toastMultiplier =
      direction === 'up' && attributedTo !== null && habitFeedsMemberAttribution(habit)
        ? prospectiveMultiplierForMember(effectiveHabit, attributedTo, today, today)
        : result.multiplier;

    // F-HABITS-02 (streak milestone celebrations): a 'down' toggle can't cross
    // a milestone (streak only grows on 'up'), so this only fires forward.
    // Presentation-only per the feature spec — no bonus points are awarded
    // here, just a distinct toast plus (optionally) unlocking gated rewards.
    const nextStreakDays = result.updatedHabit.streakDays ?? effectiveHabit.streakDays;
    const milestone = direction === 'up'
      ? crossedMilestone(effectiveHabit.streakDays, nextStreakDays)
      : null;

    const newlyUnlockedRewards: RewardItem[] = [];
    if (milestone !== null) {
      const alreadyUnlocked = householdSettingsRef.current?.unlockedRewardIds ?? [];
      newlyUnlockedRewards.push(
        ...rewardsInventoryRef.current.filter(
          (reward) =>
            !alreadyUnlocked.includes(reward.id) &&
            reward.unlockRequirement &&
            rewardMilestoneSatisfied(reward, id, nextStreakDays)
        )
      );
      if (newlyUnlockedRewards.length > 0) {
        batch.update(doc(db, `households/${householdId}`), {
          unlockedRewardIds: arrayUnion(...newlyUnlockedRewards.map((r) => r.id)),
        });
      }
    }

    // Read BEFORE the commit so latency-compensated listeners can't already
    // reflect this write when we derive "was this the first completion ever".
    const wasFirstCompletion = direction === 'up' && !habitsRef.current.some(h => h.totalCount > 0);

    // F-XCUT-01: append a cross-domain activity-log entry INSIDE the same batch
    // so it co-commits atomically with the habit/points writes. Only an 'up'
    // toggle (a completion) is logged — a 'down' correction would clutter the
    // feed. AI/quota events are deliberately excluded from the log.
    // Habit Automations (PRD #1065): an automated fire (source present) appends
    // its attribution ("via location: Target") to the same activity-log entry
    // a manual tap would have written — one event, one log line either way.
    const attribution = source ? attributionString(source) : null;
    if (direction === 'up') {
      appendActivityLog(batch, db, householdId, { uid: currentUser.uid, name: currentUser.displayName }, {
        domain: 'habit',
        action: 'habit_completed',
        summary: attribution
          ? `${composeSummary(currentUser.displayName, 'completed', habit.title)} (${attribution})`
          : composeSummary(currentUser.displayName, 'completed', habit.title),
      });
    }

    // Degrade visibly rather than as an unhandled rejection (project error-toast
    // convention, matching the stale-deselect and reset paths). Everything below
    // — milestone celebration, analytics, the points toast with its Undo — is
    // presentation for a write that landed, so a failure must return before it.
    try {
      await batch.commit();
    } catch (error) {
      console.error('[toggleHabit] Failed:', error);
      toast.error(describeError(error, 'update the habit'));
      return;
    }

    if (milestone !== null) {
      track('habit_milestone_reached', { habitId: id, milestone });
      toast(
        <div className="flex items-center gap-2">
          <span className="font-bold">{milestone}-day streak!</span>
          <span className="text-sm opacity-80">{habit.title}</span>
        </div>,
        {
          duration: 3500,
          icon: toastIcon(PartyPopper, 'text-habit-streak dark:text-habit-streak'),
          className: 'bg-habit-streak/10 text-habit-streak border border-habit-streak/25 font-medium rounded-btn shadow-raised',
        }
      );
      newlyUnlockedRewards.forEach((reward) => {
        track('habit_milestone_reward_unlocked', { habitId: id, milestone, rewardId: reward.id });
        toast(
          <div className="flex items-center gap-2">
            <span className="font-bold">Reward unlocked!</span>
            <span className="text-sm opacity-80">{reward.title}</span>
          </div>,
          {
            duration: 3500,
            icon: toastIcon(Gift, 'text-warm-600 dark:text-warm-300'),
            className: 'bg-warm-100 text-warm-700 border border-warm-300/50 dark:bg-warm-900/30 dark:text-warm-200 dark:border-warm-700/40 font-medium rounded-btn shadow-raised',
          }
        );
      });
    }

    track('habit_toggled', { positive: habit.type === 'positive', direction });
    if (shouldTrackFirstTime(FIRST_HABIT_FLAG, wasFirstCompletion)) track('first_habit_completed');

    // Toast feedback after the batch commits successfully. Rapid toggles of
    // the SAME habit fold into one running total (accumulate()) so the toast
    // updates in place — via the stable `habit-points-${id}` id, react-hot-toast
    // upserts rather than stacks — instead of piling up a toast per tap.
    //
    // Stage 1.5: the toast reports `poolDelta` and the MEMBER's multiplier, not
    // `result.pointsChange`/`result.multiplier` — the habit-level figures are no
    // longer what a shared habit credits, and showing "+20 pts (2.0x)" while 10
    // points land would be a lie. (An assigned chore and a grandfathered
    // down-toggle still credit the legacy figure, and `queueHabitPointsMove`
    // hands exactly that back, so their toast is unchanged.)
    if (poolDelta !== 0) {
      const { net, count } = accumulate(
        pointsToastAccumulatorRef.current,
        id,
        poolDelta,
        Date.now(),
        POINTS_TOAST_WINDOW_MS
      );
      const toastId = `habit-points-${id}`;

      if (net === 0) {
        // Up-then-down (or vice versa) within the window cancelled out —
        // nothing left to show, so drop the in-flight toast entirely. Also
        // clear the accumulator entry so the next toggle starts a fresh
        // story ("+10 pts (1.5x)") instead of inheriting the cancelled
        // sequence's count ("(3 changes)").
        toast.dismiss(toastId);
        pointsToastAccumulatorRef.current.delete(id);
      } else {
        const sign = net > 0 ? '+' : '';
        toast(
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-bold">{sign}{net} pts</span>
            <span className="text-sm opacity-80">
              {count === 1 ? `(${toastMultiplier}x)` : `(${count} changes)`}
            </span>
            {/* Habit Automations (PRD #1065): an automated fire's attribution
                ("via location: Target") rides along on the same toast a manual
                tap would have shown, so "why did my points change?" is always
                answerable without opening the activity log. */}
            {attribution && count === 1 && (
              <span className="text-xs opacity-70 truncate">{attribution}</span>
            )}
            {/* Undo = the reverse toggle. It feeds the same accumulator, so a
                single-tap undo nets to 0 and the branch above dismisses this
                toast; after multiple taps it walks the total back one tap at
                a time. -my-3 overhangs the toast padding for a 44px target. */}
            <button
              type="button"
              onClick={() => void toggleHabitSelfRef.current(id, direction === 'up' ? 'down' : 'up')}
              className="-my-3 ml-1 min-h-[44px] shrink-0 px-2 text-sm font-semibold underline underline-offset-2 focus:outline-hidden focus-visible:opacity-70"
            >
              Undo
            </button>
          </div>,
          {
            id: toastId,
            duration: POINTS_TOAST_WINDOW_MS,
            icon: net > 0
              ? toastIcon(Star, 'text-money-pos dark:text-money-posDark')
              : toastIcon(TrendingDown, 'text-money-neg dark:text-money-negDark'),
            // Per-toast className replaces the global Toaster one (dark
            // brand-800 surface), so restate shape/shadow alongside the
            // money-token surface. A className (not inline style) is used
            // so the .dark variants actually apply.
            className: net > 0
              ? 'bg-money-bgPos text-money-pos border border-money-pos/25 dark:bg-money-posDark/15 dark:text-money-posDark dark:border-money-posDark/30 font-medium rounded-btn shadow-raised'
              : 'bg-money-bgNeg text-money-neg border border-money-neg/25 dark:bg-money-negDark/15 dark:text-money-negDark dark:border-money-negDark/30 font-medium rounded-btn shadow-raised',
          }
        );
      }
    }
  }, [householdId, currentUser, isLiveMember]);
  // Keep the undo self-reference pointing at the latest callback (same
  // effect-sync pattern as habitsRef above). The effect commits long before
  // any toast's Undo can be clicked.
  useEffect(() => { toggleHabitSelfRef.current = toggleHabit; }, [toggleHabit]);

  const resetHabit = useCallback(async (id: string) => {
    if (!householdId || !householdSettingsRef.current) return;

    const habit = habitsRef.current.find(h => h.id === id);
    if (!habit) return;

    // Check if habit is stale (from yesterday)
    const isStale = isHabitStale(habit);

    // Optimization: If habit count is 0 and it's not stale, there's nothing to reset.
    if (habit.count === 0 && !isStale) return;

    // If it's stale, we shouldn't subtract points because we didn't earn them today
    const pointsToRemove = isStale ? 0 : calculateResetPoints(habit);

    // If it's stale and already 0, we just need to update the timestamp to prevent further "stale" checks today
    if (isStale && habit.count === 0) {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        lastUpdated: serverTimestamp(),
      });
      toast('Reset', { icon: toastIcon(RotateCcw) });
      return;
    }

    // Which completion dates does this reset undo? Daily: only today. Weekly:
    // the live counter accumulates across the WHOLE current ISO week and every
    // completion day entered completedDates, so removing only today would leave
    // earlier-in-week dates behind for calculatePointsForDateRange (which scores
    // weekly habits once per ISO week from completedDates) to re-credit points
    // this reset just reversed — desyncing daily vs weekly/total on the next
    // corrective recompute. calculateResetPoints already reverses the whole
    // week's credit (it deducts from the full live counter), so dates-removed
    // and points-reversed agree.
    const today = getLocalDateString();
    const weekStartOf = (d: string): string =>
      format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const currentWeekStart = weekStartOf(today);
    const datesToRemove = habit.period === 'weekly'
      ? habit.completedDates.filter(d => weekStartOf(d) === currentWeekStart)
      : habit.completedDates.filter(d => d === today);
    const removeSet = new Set(datesToRemove);
    const newCompletedDates = habit.completedDates.filter(d => !removeSet.has(d));

    // Atomically commit habit state + points in a single batch so both writes
    // succeed together or neither does (prevents points/habit desync on crash).
    const resetBatch = writeBatch(db);

    // Per-member points (stage 1): the reset clears the whole period for
    // EVERYONE (that is what the card's × has always meant), so every date it
    // strips from `completedDates` also loses its attribution — in the same
    // batch — and each credited member has exactly their own earned points
    // reversed at the multiplier that applied on the date they earned them.
    // `count: 0` below is the counter the reversal scores its "after" state
    // against. A THRESHOLD habit's reversal is period-scoped: the week's
    // progress days (a 3×/week target logs Mon/Wed before Friday's completion)
    // never entered `completedDates`, so `datesToRemove` alone would strip
    // neither their attribution nor the award that hangs off them.
    //
    // A threshold period can also carry attribution with NO completion date at
    // all — that same 3×/week habit sitting at 2/3 has logged Mon and Wed and
    // entered `completedDates` never. `count: 0` wipes that progress, so its
    // attribution has to go with it; anchor the reversal on today when there is
    // no completion date to anchor it on. Empty `datesToRemove` PROVES the
    // period is below target (it is exactly this period's completion dates), so
    // nothing was ever awarded and the points delta is 0 — this is purely an
    // orphan sweep, and it never needs an `arrayRemove` the batch omits.
    //
    // An INCREMENTAL habit with `targetCount > 1` has the same shape for a
    // different reason: it credits points on EVERY tap but only completes at
    // target, so a 2/3 day carries member points and attribution while
    // `datesToRemove` is empty. Reversing only `datesToRemove` debited the pool
    // (via `calculateResetPoints`) and NOT the member — a permanent divergence.
    // `wholePeriodClearDates` unions the completion dates with the period's
    // orphaned attributed days, completion dates first (its ordering rule is
    // load-bearing — see the helper).
    const reversalDates = wholePeriodClearDates(habit, datesToRemove, today);
    const resetReversal = habitFeedsMemberAttribution(habit)
      ? attributionReversalForDates(habit, reversalDates, today, 0)
      : null;
    const resetClearPaths = resetReversal?.clearPaths ?? [];
    const resetPerMember = resetReversal?.perMember ?? new Map<string, PointsBuckets>();
    // Stage 1.5: once the cleared dates carry attribution the pool loses the
    // competition figure those dates contributed (Σ member awards + remainder),
    // bucket-gated by each date — so resetting a weekly habit can no longer
    // drive TODAY's daily bucket down by points earned earlier in the week. A
    // fully grandfathered reset keeps `calculateResetPoints`' figure verbatim,
    // including its pre/post-threshold multiplier split.
    const resetPoolDelta: PointsBuckets =
      resetClearPaths.length > 0 && resetReversal
        ? resetReversal.household
        : { daily: -pointsToRemove, weekly: -pointsToRemove, total: -pointsToRemove };

    resetBatch.update(doc(db, `households/${householdId}/habits`, id), {
      count: 0,
      ...Object.fromEntries(resetClearPaths.map(path => [path, deleteField()])),
      // Server-side delta: remove ONLY this period's dates. Writing the
      // locally-computed array here lets a device with a stale offline cache
      // wholesale-overwrite (wipe) the habit's completion history. streakDays
      // is a self-correcting scalar, so local computation is safe. Only
      // included when there is actually something to remove (arrayRemove
      // requires at least one value).
      ...(datesToRemove.length > 0 ? { completedDates: arrayRemove(...datesToRemove) } : {}),
      streakDays: streakForHabit({ period: habit.period, completedDates: newCompletedDates, frozenDates: habit.frozenDates }),
      lastUpdated: serverTimestamp(),
    });

    // A null poolRef = assigned to a since-removed member (see HabitPointsTargets):
    // skip their points reversal rather than fail the whole batch with NOT_FOUND.
    const resetPoolRef = habitPointsTargets(householdId, habit.assignedTo, isLiveMember).poolRef;
    if (resetPoolRef) {
      const { daily, weekly, total } = resetPoolDelta;
      if (daily !== 0 || weekly !== 0 || total !== 0) {
        resetBatch.update(resetPoolRef, {
          ...(daily !== 0 ? { 'points.daily': increment(daily) } : {}),
          ...(weekly !== 0 ? { 'points.weekly': increment(weekly) } : {}),
          ...(total !== 0 ? { 'points.total': increment(total) } : {}),
        });
      }
    }
    queueAttributionReversal(resetBatch, householdId, resetPerMember, isLiveMember);

    // Degrade visibly rather than as an unhandled rejection (project
    // error-toast convention) — the reset toast must not claim a write landed.
    try {
      await resetBatch.commit();
    } catch (error) {
      console.error('[resetHabit] Failed:', error);
      toast.error(describeError(error, 'reset the habit'));
      return;
    }

    toast('Reset', { icon: toastIcon(RotateCcw) });
    // `currentUser` is no longer read here: the pool target is derived from the
    // habit's own `assignedTo` plus the live roster, never from who tapped.
  }, [householdId, isLiveMember]);

  const addHabitSubmission = useCallback(async (
    habitId: string,
    count: number,
    timestamp?: string,
    note?: string,
    mood?: HabitSubmission['mood'],
    /**
     * Member uids this log is FOR. ONE submission doc of `count` units per uid
     * (never one doc of `count × N` with several owners — `attributedTo` is a
     * scalar, and both reversal paths assume one doc = one member's unit
     * bundle), so a two-person log adds `count × uids.length` units.
     *
     * An EMPTY array is meaningful: it means HOUSEHOLD credit — one unattributed
     * bundle of `count` units, credited to the pool and to nobody.
     *
     * Omit for the legacy behaviour: a single doc attributed via
     * `attributionActor` (the assignee, else the signed-in member — or nobody
     * at all on a `creditMode: 'household'` habit).
     */
    attributeTo?: readonly string[],
  ) => {
    if (!householdId || !currentUser) return;

    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) {
      toast.error('Habit not found');
      return;
    }

    // WHO this log credits. An explicit set comes from the past-day picker
    // ("Me" / "Jen" / "Both of us" / "Household"); with none, `attributionActor`
    // keeps every pre-existing caller bit-for-bit unchanged.
    //
    // 🏁 An EMPTY actor set — passed explicitly as `[]` (the picker's Household
    // row), or produced by `attributionActor` on a `creditMode: 'household'`
    // habit — is HOUSEHOLD CREDIT: one unattributed bundle, one submission doc
    // carrying no `attributedTo`, and NO `completedBy` write at all.
    const explicitActors = attributeTo !== undefined;
    const defaultActor = attributionActor(habit, currentUser.uid);
    const actors = explicitActors
      ? [...new Set(attributeTo)]
      : defaultActor === null
        ? []
        : [defaultActor];
    const householdCredit = actors.length === 0;
    // `count` means "units per member"; `addedUnits` is the habit's total move.
    // They are equal on every legacy call (one actor) and on a household credit
    // (one unattributed bundle), so nothing changes there.
    const addedUnits = count * (householdCredit ? 1 : actors.length);

    // Use provided timestamp or current time
    const submissionTimestamp = timestamp || new Date().toISOString();
    const submissionDate = format(parseISO(submissionTimestamp), 'yyyy-MM-dd');

    try {
      const today = getLocalDateString();

      // The submission's own period: the day itself for daily habits, the
      // Monday-anchored week for weekly ones. A back-dated submission must only
      // affect ITS period — never today's / this week's live counter.
      const periodStartOf = (date: string): string =>
        habit.period === 'weekly'
          ? format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
          : date;
      const isCurrentPeriod = periodStartOf(submissionDate) === periodStartOf(today);

      // Lazy-reset parity with toggleHabit: a stale habit's count belongs to a
      // previous period, so its live period counter is effectively 0.
      const liveCount = isHabitStale(habit) ? 0 : habit.count;

      // Count already recorded for the submission's own period. Current period:
      // the live counter. Past period: the sum of that period's stored
      // submissions — today's counter says nothing about a past day/week. Only
      // threshold habits need this (incremental scoring is per-action).
      let priorPeriodCount = liveCount;
      if (!isCurrentPeriod && habit.scoringType !== 'incremental') {
        const periodStart = periodStartOf(submissionDate);
        const periodEnd = habit.period === 'weekly'
          ? format(addDays(parseISO(periodStart), 6), 'yyyy-MM-dd')
          : submissionDate;
        const priorSnap = await getDocs(query(
          collection(db, `households/${householdId}/habits/${habitId}/submissions`),
          where('date', '>=', periodStart),
          where('date', '<=', periodEnd),
        ));
        priorPeriodCount = priorSnap.docs.reduce(
          (sum, d) => sum + (d.data() as HabitSubmission).count,
          0
        );
      }
      const newPeriodCount = priorPeriodCount + addedUnits;

      // Threshold habits only mark the date complete once the submission's own
      // period reaches the target — the rest of the subsystem (streaks, point
      // recomputes) relies on the invariant "date in completedDates ⟹ target
      // met that day". Incremental habits complete on any action (toggle parity).
      const marksDateComplete =
        habit.scoringType === 'incremental' || newPeriodCount >= habit.targetCount;

      // Build the post-submission completion history so the multiplier can be
      // driven by the PROSPECTIVE streak (the streak that exists once this day is
      // counted), matching client toggle semantics rather than the pre-submission
      // streak. For "today" this equals streakForHabit(updatedCompletedDates); for
      // a back-dated submission it's the streak ending on that day.
      const updatedCompletedDates = [...habit.completedDates];
      const dateNewlyCompleted = marksDateComplete && !updatedCompletedDates.includes(submissionDate);
      if (dateNewlyCompleted) {
        updatedCompletedDates.push(submissionDate);
        updatedCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      }

      const prospectiveStreak = streakEndingOnForHabit(
        { period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates },
        submissionDate
      );
      const multiplier = getMultiplier(prospectiveStreak, habit.type === 'positive', habit.period);

      // A period completed via the toggle path (whose counter has since been
      // reset) leaves no submissions behind — the completedDates check stops a
      // back-dated submission from awarding that period a second time.
      const alreadyCompletedInPeriod = habit.completedDates.some(
        d => periodStartOf(d) === periodStartOf(submissionDate)
      );

      // Signed via habit.type (see signedHabitPoints): a negative habit's
      // submission must DEBIT points. Reading basePoints raw awarded positive
      // points for every negative habit stored with a positive magnitude.
      let pointsEarned = 0;
      if (habit.scoringType === 'incremental') {
        pointsEarned = addedUnits * signedHabitPoints(habit, multiplier);
      } else if (
        newPeriodCount >= habit.targetCount &&
        priorPeriodCount < habit.targetCount &&
        !alreadyCompletedInPeriod
      ) {
        // Threshold: this submission pushes its OWN period over the target.
        pointsEarned = signedHabitPoints(habit, multiplier);
      }

      // Atomically commit the submission docs, habit state, and points in a
      // single batch so they all succeed together or none do (prevents
      // points/habit desync on crash) — and so a two-member log can never
      // credit one member and drop the other.
      const addBatch = writeBatch(db);

      let submissionAfter: Habit = {
        ...habit,
        count: isCurrentPeriod ? liveCount + addedUnits : liveCount,
        totalCount: habit.totalCount + addedUnits,
        completedDates: updatedCompletedDates,
      };
      for (const actor of actors) {
        submissionAfter = withAttributionDelta(submissionAfter, submissionDate, actor, count);
      }

      /** One member's own award for this move, at THEIR streak multiplier. */
      const memberAward = (uid: string): number =>
        habitFeedsMemberAttribution(habit)
          ? memberPeriodPointsDelta(habit, submissionAfter, uid, submissionDate, today)
          : 0;

      // 🛡️ `pointsEarned` SEMANTICS FORK, stated deliberately:
      //
      // With an EXPLICIT `attributeTo` there is no single habit-level figure to
      // split across the credited members — the competition model gives each of
      // them a full award at their OWN streak — so each doc stores its own
      // member's award. `Σ docs.pointsEarned` then equals the household figure
      // `householdPointsForHabitOnDate` reports for that date, and the calendar
      // cell reconciles to exactly what the pool received.
      //
      // With `attributeTo` omitted the existing habit-level `pointsEarned` is
      // stored on the single doc, unchanged, so every legacy caller (and the
      // grandfathered-reversal path that reads it back) is untouched.
      //
      // 🏁 A HOUSEHOLD doc stores the POOL's own move (`householdAward` below),
      // which is what it was actually credited — so `resetHabitDay`'s
      // `Σ pointsEarned` reversal and any other stored-figure path undo exactly
      // that, rather than a habit-level approximation of it.
      const householdAward =
        householdCredit && habitFeedsMemberAttribution(habit)
          ? householdPeriodPointsDelta(habit, submissionAfter, submissionDate, today)
          : pointsEarned;
      const docPoints = (uid: string | null, index: number): number =>
        uid === null
          ? (index === 0 ? householdAward : 0)
          : explicitActors && habitFeedsMemberAttribution(habit)
            ? memberAward(uid)
            : (index === 0 ? pointsEarned : 0);

      // Create submission documents — ONE per credited member, or exactly one
      // unattributed doc for a household credit. note/mood are only included
      // when provided; Firestore rejects an explicit `undefined`.
      const docActors: (string | null)[] = householdCredit ? [null] : actors;
      docActors.forEach((actor, index) => {
        const submission: Omit<HabitSubmission, 'id'> = {
          habitId,
          habitTitle: habit.title,
          timestamp: submissionTimestamp,
          date: submissionDate,
          count,
          pointsEarned: docPoints(actor, index),
          streakDaysAtTime: prospectiveStreak,
          multiplierApplied: multiplier,
          // The OPERATOR, always — that is the audit trail. `attributedTo` is
          // the credit, and the two legitimately differ when one member logs a
          // past day on another's behalf.
          createdBy: currentUser.uid,
          // 🛡️ SNAPSHOT the credited uid so a later delete/edit reverses the member
          // who actually earned these points — `habit.assignedTo` may have been
          // reassigned by then, and re-deriving would debit the wrong person.
          // A household credit records NO uid and marks itself instead, so the
          // reversal paths can tell it apart from a pre-attribution doc (which
          // also has no `attributedTo` but must reverse its stored figure).
          ...(actor !== null ? { attributedTo: actor } : { creditsHousehold: true }),
          createdAt: new Date().toISOString(),
          ...(note && note.trim() ? { note: note.trim().slice(0, 280) } : {}),
          ...(mood ? { mood } : {}),
        };
        const submissionRef = doc(collection(db, `households/${householdId}/habits/${habitId}/submissions`));
        addBatch.set(submissionRef, submission);
      });

      addBatch.update(doc(db, `households/${householdId}/habits`, habitId), {
        ...attributionUpdates(
          submissionDate,
          actors.map(uid => ({ memberId: uid, delta: count })),
        ),
        // Only a current-period submission bumps the live counter (a stale
        // counter is lazily reset first, so it must then be written ABSOLUTELY
        // — incrementing would add to the value we mean to throw away).
        //
        // 🛡️ A PAST-period submission omits the key ENTIRELY rather than
        // re-writing `liveCount`. That value comes from the client-cached
        // habit, so writing it back would silently clobber a concurrent
        // `creditHabitCompletion` from another device — and the past-day
        // surface is exactly where that race lives. Same discipline as
        // `resetHabitDay` / `uncreditHabitCompletion` / `deleteHabitSubmission`.
        ...(isCurrentPeriod
          ? { count: isHabitStale(habit) ? liveCount + addedUnits : increment(addedUnits) }
          : {}),
        totalCount: habit.totalCount + addedUnits,
        // Server-side arrayUnion delta, only when this submission newly
        // completes the date — never the locally-computed array (a stale
        // offline cache would wholesale-overwrite the habit's completion
        // history; 2026-07-15 incident).
        ...(dateNewlyCompleted ? { completedDates: arrayUnion(submissionDate) } : {}),
        streakDays: streakForHabit({
          period: habit.period,
          completedDates: updatedCompletedDates,
          frozenDates: habit.frozenDates,
          // Parity with creditHabitCompletion/uncreditHabitCompletion: a planned
          // break must bridge the chain here too, or the same habit computes two
          // different streaks depending on which path wrote it.
          pausedUntil: habit.pausedUntil,
        }),
        hasSubmissionTracking: true,
        lastUpdated: serverTimestamp(),
      });

      // Stage 1.5: a submission credits the pool the SUM of what its credited
      // member earned (their own multiplier), not `pointsEarned`'s habit-level
      // figure — and every affected member's own share rides the same batch,
      // each gated by the date its award actually landed on so a PAST-dated
      // submission can't inflate today's daily / this week's weekly totals.
      // `count === 0` is a note/mood-only reflection: it attributes nothing and
      // earns nothing either way.
      const submissionTargets = habitPointsTargets(householdId, habit.assignedTo, isLiveMember);
      queueHabitPointsMove({
        batch: addBatch,
        habit,
        before: habit,
        after: submissionAfter,
        date: submissionDate,
        today,
        targets: submissionTargets,
        // A household credit moves no member but still takes the decomposition
        // (see queueHabitPointsMove) — and `householdAward`, stored on the doc,
        // is that same figure (`periodPointsMove().household.total ===
        // householdPeriodPointsDelta(...)`), so add and reversal agree.
        attributionMoved: addedUnits !== 0,
        legacyDelta: pointsEarned,
      });

      await addBatch.commit();

      // A count of 0 means this call only attached a note/mood (the one-tap
      // reflection drawer) rather than logging a new completion — say so.
      toast.success(addedUnits > 0 ? `Logged +${addedUnits} submission(s)` : 'Reflection saved');
    } catch (error) {
      console.error('[addHabitSubmission] Failed:', error);
      toast.error(describeError(error, 'add the submission'));
    }
  }, [householdId, currentUser, isLiveMember]);

  const getHabitSubmissions = useCallback(async (
    habitId: string,
    startDate?: string,
    endDate?: string
  ): Promise<HabitSubmission[]> => {
    if (!householdId) return [];

    try {
      let submissionsQuery = query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        orderBy('timestamp', 'desc')
      );

      // Add date range filters if provided
      if (startDate) {
        submissionsQuery = query(submissionsQuery, where('date', '>=', startDate));
      }
      if (endDate) {
        submissionsQuery = query(submissionsQuery, where('date', '<=', endDate));
      }

      const snapshot = await getDocs(submissionsQuery);
      return snapshot.docs.map(d => ({
        ...d.data(),
        id: d.id,
      } as HabitSubmission));
    } catch (error) {
      console.error('[getHabitSubmissions] Failed:', error);
      return [];
    }
  }, [householdId]);

  const deleteHabitSubmission = useCallback(async (habitId: string, submissionId: string) => {
    if (!householdId) return;

    try {
      // Step 1: Get submission to calculate point reversal
      const submissionRef = doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId);
      const submissionSnap = await getDoc(submissionRef);

      if (!submissionSnap.exists()) {
        toast.error('Submission not found');
        return;
      }

      const submission = submissionSnap.data() as HabitSubmission;
      const habit = habitsRef.current.find(h => h.id === habitId);
      if (!habit) return;

      // Step 2: Check if this is the last submission for this date
      const submissionsQuery = query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        where('date', '==', submission.date)
      );
      const submissionsSnap = await getDocs(submissionsQuery);
      const isLastForDate = submissionsSnap.size === 1;

      // Steps 3–5: Build a single batch so the submission delete, habit update,
      // and points reversal all commit atomically.  A runTransaction cannot be
      // used here because the isLastForDate check requires a collection query,
      // and Firestore transactions only accept DocumentReference reads — not
      // arbitrary queries.  Using a writeBatch still gives us atomicity for the
      // writes; the query-then-batch pattern is the standard Firestore approach
      // when the condition relies on an aggregation query.
      const deleteBatch = writeBatch(db);

      const today = getLocalDateString();

      // Habit aggregate update (step 3)
      const updatedCompletedDates = isLastForDate
        ? habit.completedDates.filter(d => d !== submission.date)
        : habit.completedDates;

      // 🛡️ Only a submission inside the habit's LIVE period may shrink the live
      // counter — a back-dated one belongs to a period whose counter has long
      // since reset, so subtracting from today's would silently un-do a
      // completion the user can still see. `resetHabitDay` and
      // `uncreditHabitCompletion` already gate the same write this way; this
      // path did not, and the past-day undo puts it on a routine surface.
      const inLivePeriod =
        habitPeriodStart(habit.period, submission.date) === habitPeriodStart(habit.period, today) &&
        !isHabitStale(habit);
      const nextCount = inLivePeriod ? Math.max(0, habit.count - submission.count) : habit.count;

      const habitUpdates: Record<string, unknown> = {
        ...(inLivePeriod ? { count: nextCount } : {}),
        totalCount: Math.max(0, habit.totalCount - submission.count),
        lastUpdated: serverTimestamp(),
      };

      if (isLastForDate) {
        // Server-side delta (never the locally-computed array — a stale local
        // cache would wholesale-overwrite the habit's completion history).
        habitUpdates['completedDates'] = arrayRemove(submission.date);
        habitUpdates['streakDays'] = streakForHabit({ period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates });
      }

      // Per-member points (stage 1): withdraw exactly the units this submission
      // attributed, from the member who was ACTUALLY credited.
      //
      // 🛡️ Two guards, both about not debiting the wrong person:
      //   1. The credited uid is the one SNAPSHOTTED at add time
      //      (`submission.attributedTo`), falling back to `createdBy` for
      //      submissions written before that field existed. Re-deriving it with
      //      `attributionActor` against the habit's CURRENT `assignedTo` debits
      //      whoever holds the chore TODAY — reassign between add and delete and
      //      a never-credited member goes negative while the member who really
      //      earned the points keeps them forever.
      //   2. The reversal is then BOUNDED by stored attribution
      //      (`reversalMoves`): we may only take back units `completedBy` really
      //      records. A pre-stage-1 submission records none, so it reverses the
      //      household pool only and debits no member at all.
      //   3. A HOUSEHOLD submission (`creditsHousehold`) credited nobody, so it
      //      takes NOTHING back from any member — `reversalMoves`' holder
      //      fallback would otherwise debit whoever happens to hold a
      //      per-completion override on that date. It still reverses through the
      //      decomposition (below), which is how a threshold period's
      //      side-effect member awards move with it.
      const isHouseholdSubmission = submission.creditsHousehold === true;
      const creditedUid = submission.attributedTo ?? submission.createdBy;
      const deleteMoves = isHouseholdSubmission
        ? []
        : reversalMoves(habit, creditedUid, submission.date, submission.count);
      // 🛡️ THE REVERSAL MODE IS DECIDED BY THE DOC, NOT BY THE MOVES.
      //
      // An ATTRIBUTED submission reverses through the attribution-bounded path
      // EXCLUSIVELY — including when `resolveReversalSources` finds nothing
      // left to take back, in which case the correct answer is to reverse
      // NOTHING. The tempting `deleteMoves.length > 0` test double-debits a
      // real sequence with no race in it: credit Jen for a past day from the
      // picker (doc + `completedBy` + pool), un-credit her from the Habits-page
      // picker (which zeroes `completedBy` and debits the pool but never touches
      // the doc), then delete the now-orphaned doc — `legacyDelta` would debit
      // the pool a SECOND time, and `computeHouseholdPointsSync` only ever
      // RAISES the stored total, so that drift is permanent.
      //
      // `legacyDelta` therefore stays reserved for genuinely UNATTRIBUTED
      // (pre-feature) submissions, whose stored `pointsEarned` is the only
      // record of what they were credited — plus the case where one of those
      // lands on a date that has since gained attribution, which stays on the
      // bounded path exactly as before.
      const submissionIsAttributed = submission.attributedTo != null;
      let deleteAfter: Habit = {
        ...habit,
        count: nextCount,
        totalCount: Math.max(0, habit.totalCount - submission.count),
        completedDates: updatedCompletedDates,
      };
      for (const move of deleteMoves) {
        deleteAfter = withAttributionDelta(deleteAfter, submission.date, move.memberId, move.delta);
      }
      Object.assign(habitUpdates, attributionUpdates(submission.date, deleteMoves));

      deleteBatch.update(doc(db, `households/${householdId}/habits`, habitId), habitUpdates);

      // Submission delete (step 4)
      deleteBatch.delete(submissionRef);

      // Points reversal (step 5)
      //
      // Stage 1.5: an ATTRIBUTED submission's deletion debits the pool the sum
      // of the member awards it is taking back; a PRE-attribution one still
      // reverses its stored `pointsEarned` exactly, which is the only record of
      // what it was actually credited.
      //
      // The member scope is the PERIOD's holders, not just `deleteMoves`:
      // un-completing a multi-day threshold period strips the award from every
      // member who held one in it, not only the member this doc credited. Those
      // uids are HISTORICAL (snapshotted on the submission or read off the
      // stored attribution map), so they may name a since-removed member —
      // `memberRef` returns null for those; updating their deleted doc would
      // fail the whole batch with NOT_FOUND.
      const deleteTargets = habitPointsTargets(householdId, habit.assignedTo, isLiveMember);
      queueHabitPointsMove({
        batch: deleteBatch,
        habit,
        before: habit,
        after: deleteAfter,
        date: submission.date,
        today,
        targets: deleteTargets,
        attributionMoved:
          isHouseholdSubmission || submissionIsAttributed || deleteMoves.length > 0,
        legacyDelta: -submission.pointsEarned,
      });

      await deleteBatch.commit();

      toast.success('Submission deleted');
    } catch (error) {
      console.error('[deleteHabitSubmission] Failed:', error);
      toast.error(describeError(error, 'delete the submission'));
    }
  }, [householdId, isLiveMember]);

  /**
   * Reset a habit's log for ONE calendar day back to zero — the day-editor
   * twin of `resetHabit` (which only understands the live period). Used by the
   * habit calendars' × control.
   *
   * Deletes every submission stored for that date, reversing EXACTLY the
   * points each one earned (the stored `pointsEarned`, so a reversal always
   * undoes what was actually credited — even entries written before the
   * negative-habit sign fix). Days completed via the toggle path leave no
   * submission docs; for those the reversal is derived with the same per-date
   * attribution the corrective recompute uses (`pointsForHabitOnDate`), or —
   * for today — the tested `calculateResetPoints` math. Submission deletes,
   * habit state, and points reversal commit in a single atomic batch.
   */
  const resetHabitDay = useCallback(async (habitId: string, date: string) => {
    if (!householdId) return;

    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) return;

    try {
      const today = getLocalDateString();

      const subsSnap = await getDocs(query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        where('date', '==', date),
      ));

      const wasCompleted = habit.completedDates.includes(date);
      if (subsSnap.empty && !wasCompleted) return; // nothing logged that day

      let pointsToReverse = 0;
      let unitsRemoved = 0;
      const batch = writeBatch(db);

      subsSnap.docs.forEach(d => {
        const s = d.data() as HabitSubmission;
        pointsToReverse += s.pointsEarned;
        unitsRemoved += s.count;
        batch.delete(d.ref);
      });

      if (subsSnap.empty) {
        if (date === today && !isHabitStale(habit)) {
          // Live completion (toggle path): reuse the tested reset math,
          // including the pre/post-threshold multiplier split for incrementals.
          pointsToReverse = calculateResetPoints(habit);
          unitsRemoved = habit.count;
        } else {
          // Historical toggle-path day: reverse the same per-date attribution
          // calculatePointsForDate assigns it (past incremental days = 1).
          pointsToReverse = pointsForHabitOnDate(habit, date, today);
          unitsRemoved = habit.scoringType === 'threshold' ? Math.max(1, habit.targetCount) : 1;
        }
      }

      // Does the cleared date fall in the habit's LIVE period? Only then does
      // the live counter shrink (a stale counter belongs to an older period).
      const periodStartOf = (d: string): string =>
        habit.period === 'weekly'
          ? format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd')
          : d;
      const inLivePeriod =
        periodStartOf(date) === periodStartOf(today) && !isHabitStale(habit);

      const updatedCompletedDates = habit.completedDates.filter(d => d !== date);
      const habitUpdates: Record<string, unknown> = {
        // Server-side delta (never the locally-computed array — a stale local
        // cache would wholesale-overwrite the habit's completion history).
        completedDates: arrayRemove(date),
        streakDays: streakForHabit({ period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates }),
        totalCount: Math.max(0, habit.totalCount - unitsRemoved),
        lastUpdated: serverTimestamp(),
      };
      const countAfter = inLivePeriod
        ? Math.max(0, habit.count - unitsRemoved)
        : habit.count;
      if (inLivePeriod) {
        habitUpdates['count'] = countAfter;
      }

      // Per-member points (stage 1): clearing a day clears it for EVERYONE, so
      // the day's whole attribution map goes with it and each credited member
      // has exactly what they earned that day reversed. On a THRESHOLD habit
      // the clear is period-scoped — the cleared day was the period's
      // completion, so the progress days behind it (a 3×/week target logs
      // Mon/Wed before Friday's completion) are part of what's being undone and
      // would otherwise be stranded, attributed to a completion that no longer
      // exists. `countAfter` is the counter written above, so the reversal
      // scores the state this batch actually leaves behind.
      const dayReversal = habitFeedsMemberAttribution(habit)
        ? attributionReversalForDates(habit, [date], today, countAfter)
        : null;
      const dayClearPaths = dayReversal?.clearPaths ?? [];
      const dayPerMember = dayReversal?.perMember ?? new Map<string, PointsBuckets>();
      for (const path of dayClearPaths) habitUpdates[path] = deleteField();

      batch.update(doc(db, `households/${householdId}/habits`, habitId), habitUpdates);
      queueAttributionReversal(batch, householdId, dayPerMember, isLiveMember);

      // Reverse points with the same period gating as deleteHabitSubmission:
      // total always, daily only for today, weekly only inside the current week.
      //
      // Stage 1.5: an ATTRIBUTED day loses the competition figure it contributed
      // (Σ member awards + remainder, already bucket-gated by the cleared date);
      // an un-attributed day still reverses `pointsToReverse` — the exact stored
      // `pointsEarned` of that day's submissions, or `calculateResetPoints`.
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const dayPoolDelta: PointsBuckets =
        dayClearPaths.length > 0 && dayReversal
          ? dayReversal.household
          : {
              total: -pointsToReverse,
              daily: date === today ? -pointsToReverse : 0,
              weekly: date >= weekStart && date <= today ? -pointsToReverse : 0,
            };
      // A null poolRef = assigned to a since-removed member (see
      // HabitPointsTargets) — skip rather than fail the batch with NOT_FOUND.
      const dayPoolRef = habitPointsTargets(householdId, habit.assignedTo, isLiveMember).poolRef;
      if (dayPoolRef) {
        const pointUpdates: Record<string, unknown> = {
          ...(dayPoolDelta.total !== 0 ? { 'points.total': increment(dayPoolDelta.total) } : {}),
          ...(dayPoolDelta.daily !== 0 ? { 'points.daily': increment(dayPoolDelta.daily) } : {}),
          ...(dayPoolDelta.weekly !== 0 ? { 'points.weekly': increment(dayPoolDelta.weekly) } : {}),
        };
        if (Object.keys(pointUpdates).length > 0) batch.update(dayPoolRef, pointUpdates);
      }

      await batch.commit();

      toast('Day cleared', { icon: toastIcon(RotateCcw) });
    } catch (error) {
      console.error('[resetHabitDay] Failed:', error);
      toast.error(describeError(error, 'clear the day'));
    }
    // `currentUser` is no longer read here — see resetHabit's note above.
  }, [householdId, isLiveMember]);

  const updateHabitSubmission = useCallback(async (
    habitId: string,
    submissionId: string,
    updates: Partial<HabitSubmission>
  ) => {
    if (!householdId) return;

    try {
      // Step 1: Get original submission to calculate point difference
      const submissionRef = doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId);
      const submissionSnap = await getDoc(submissionRef);

      if (!submissionSnap.exists()) {
        toast.error('Submission not found');
        return;
      }

      const originalSubmission = submissionSnap.data() as HabitSubmission;
      const habit = habitsRef.current.find(h => h.id === habitId);
      if (!habit) return;

      // Step 2: Calculate new points if count changed
      let pointsDelta = 0;
      if (updates.count !== undefined && updates.count !== originalSubmission.count) {
        const countDelta = updates.count - originalSubmission.count;

        if (habit.scoringType === 'incremental') {
          // Signed via habit.type — mirrors addHabitSubmission.
          pointsDelta = countDelta * signedHabitPoints(habit, originalSubmission.multiplierApplied);
        } else {
          // For threshold, disallow count edits (too complex to recalculate)
          toast.error('Cannot edit count for threshold habits. Delete and re-add instead.');
          return;
        }
      }

      // Steps 3–5: Atomically commit the submission update, habit aggregate
      // update, and points adjustment in a single batch so all writes succeed
      // together or none do (prevents points/habit desync on crash).
      const updateBatch = writeBatch(db);

      // Step 3: Update submission document
      updateBatch.update(submissionRef, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });

      // Per-member points (stage 1): a count edit moves the credited member's
      // attributed units on the submission's own date by the same delta the
      // habit counters move by, and their points follow at their OWN historical
      // multiplier.
      //
      // 🛡️ Same two guards as deleteHabitSubmission: the credited uid is the one
      // SNAPSHOTTED at add time (`attributedTo`, legacy fallback `createdBy`) —
      // NOT re-derived from the habit's current `assignedTo`, which a
      // reassignment would have changed — and a DOWNWARD edit is bounded by what
      // `completedBy` actually records. An upward edit is a forward credit, so it
      // simply lands on the credited member.
      const submissionDate = updates.date || originalSubmission.date;
      const today = getLocalDateString();
      const countDelta = updates.count !== undefined ? updates.count - originalSubmission.count : 0;
      //
      // A HOUSEHOLD submission credited nobody, so neither direction touches a
      // member: an upward edit must not credit `createdBy` (the OPERATOR, which
      // is what `attributedTo ?? createdBy` would fall back to), and a downward
      // one must not debit whoever holds an override on that date.
      const isHouseholdSubmission = originalSubmission.creditsHousehold === true;
      const creditedUid = originalSubmission.attributedTo ?? originalSubmission.createdBy;
      const editMoves: AttributionMove[] =
        isHouseholdSubmission
          ? []
          : countDelta > 0
            ? [{ memberId: creditedUid, delta: countDelta }]
            : countDelta < 0
              ? reversalMoves(habit, creditedUid, submissionDate, -countDelta)
              : [];
      let editAfter: Habit = {
        ...habit,
        count: habit.count + countDelta,
        totalCount: habit.totalCount + countDelta,
      };
      for (const move of editMoves) {
        editAfter = withAttributionDelta(editAfter, submissionDate, move.memberId, move.delta);
      }

      // Step 4: Update habit aggregate counts
      if (updates.count !== undefined) {
        updateBatch.update(doc(db, `households/${householdId}/habits`, habitId), {
          ...attributionUpdates(submissionDate, editMoves),
          count: habit.count + countDelta,
          totalCount: habit.totalCount + countDelta,
          lastUpdated: serverTimestamp(),
        });
      }

      // Step 5: Update the pool's and the author's points
      //
      // Stage 1.5: a count edit moves the pool by the credited member's own
      // award delta; an edit that touched no attribution keeps the legacy
      // habit-level figure. Period-wide on the member side, exactly like the
      // add/delete twins: an edit that pushes a multi-day threshold period over
      // (or back under) its target moves the award for EVERY member holding
      // attribution in it, not just the uids this doc records. Those uids are
      // historical, so each may name a since-removed member whose doc no longer
      // exists — `memberRef` returns null for those (see `isLiveMember`).
      const editTargets = habitPointsTargets(householdId, habit.assignedTo, isLiveMember);
      queueHabitPointsMove({
        batch: updateBatch,
        habit,
        before: habit,
        after: editAfter,
        date: submissionDate,
        today,
        targets: editTargets,
        // Same rule as deleteHabitSubmission: an ATTRIBUTED doc reverses
        // through the attribution-bounded path exclusively, so a downward edit
        // whose attribution someone else already took back reverses NOTHING
        // rather than debiting the pool a second time via `legacyDelta`.
        attributionMoved:
          isHouseholdSubmission ||
          originalSubmission.attributedTo != null ||
          editMoves.length > 0,
        legacyDelta: pointsDelta,
      });

      await updateBatch.commit();

      toast.success('Submission updated');
    } catch (error) {
      console.error('[updateHabitSubmission] Failed:', error);
      toast.error(describeError(error, 'update the submission'));
    }
  }, [householdId, isLiveMember]);

  /**
   * Per-member points (stage 1) — credit ONE completion of `habitId` to each of
   * `memberIds` on `date` (default: today), or — with an EMPTY `memberIds` — one
   * completion to the HOUSEHOLD and nobody individually.
   *
   * This is the member-set-based primitive the long-press picker drives ("Me" /
   * "Jen" / "Both of us" are just different member sets). Every selected member
   * is credited a FULL completion at their OWN streak multiplier, and the
   * habit's counters move by one unit per member — so a two-person credit reads
   * as a count of 2 in the pie counter.
   *
   * 🏁 The HOUSEHOLD case adds ONE unit and writes NO `completedBy` entry, so it
   * scores through the unattributed path: one award at the habit's own flame, to
   * the pool, to nobody. Reached through `creditHouseholdCompletion` below —
   * `creditHabitCompletion` keeps its "empty set is a no-op" guard so no
   * existing caller can log a completion by handing it an empty array.
   */
  const creditCompletion = useCallback(async (
    habitId: string,
    memberIds: string[],
    date?: string,
  ) => {
    if (!householdId || !currentUser) return;
    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) return;
    // Archived-habit guard, matching toggleHabit: an archived habit never fires
    // forward (un-crediting one stays allowed).
    if (habit.archivedAt) return;

    try {
      const today = getLocalDateString();
      const targetDate = date ?? today;
      const isStale = isHabitStale(habit);
      const inLivePeriod =
        habitPeriodStart(habit.period, targetDate) === habitPeriodStart(habit.period, today);

      // Lazy-reset parity with toggleHabit: a stale counter belongs to a
      // previous period, so the live period effectively starts from 0 — and the
      // counter is then written ABSOLUTELY (a reset-then-add), because routing
      // it through increment() would add to the value we mean to throw away.
      const liveCount = isStale ? 0 : habit.count;
      // One unit per credited member — or a single unattributed unit for a
      // household credit, which names nobody.
      const addedUnits = Math.max(memberIds.length, 1);
      const target = Math.max(habit.targetCount, 1);

      // Does this credit complete the date? Incremental habits complete on any
      // action; threshold habits need the period's counter at target. For a
      // PAST period there is no live counter, so the attribution itself is the
      // evidence (mirrors addHabitSubmission's back-dated branch).
      const periodUnits = inLivePeriod
        ? liveCount
        : habit.completedDates
            .filter(d => habitPeriodStart(habit.period, d) === habitPeriodStart(habit.period, targetDate))
            .reduce((sum, d) => sum + attributedUnitsOnDate(habit, d), 0);
      const marksComplete =
        habit.scoringType === 'incremental' || periodUnits + addedUnits >= target;
      const dateNewlyCompleted = marksComplete && !habit.completedDates.includes(targetDate);

      const nextCompletedDates = dateNewlyCompleted
        ? [...habit.completedDates, targetDate]
        : habit.completedDates;

      let after: Habit = {
        ...habit,
        count: inLivePeriod ? liveCount + addedUnits : liveCount,
        totalCount: habit.totalCount + addedUnits,
        completedDates: nextCompletedDates,
      };
      for (const memberId of memberIds) {
        after = withAttributionDelta(after, targetDate, memberId, 1);
      }

      const batch = writeBatch(db);

      // 🛡️ Attribution rides dot-path increments and completedDates an
      // arrayUnion delta — both server-side, in ONE batch, so they stay
      // mutually consistent and no stale cache can clobber either.
      batch.update(doc(db, `households/${householdId}/habits`, habitId), {
        ...Object.fromEntries(
          memberIds.map(memberId => [completedByPath(targetDate, memberId), increment(1)]),
        ),
        ...(inLivePeriod
          ? { count: isStale ? liveCount + addedUnits : increment(addedUnits) }
          : {}),
        totalCount: increment(addedUnits),
        ...(dateNewlyCompleted ? { completedDates: arrayUnion(targetDate) } : {}),
        streakDays: streakForHabit({
          period: habit.period,
          completedDates: nextCompletedDates,
          frozenDates: habit.frozenDates,
          pausedUntil: habit.pausedUntil,
        }),
        lastUpdated: serverTimestamp(),
      });

      // The pool delta is a before/after difference of the household scorer, so
      // it is exactly what the corrective recompute will derive. Stage 1.5: for
      // a shared habit that scorer is now Σ member awards + remainder, so a
      // "Both of us" credit pays the pool BOTH awards.
      //
      // Period-wide on the member side, not just `memberIds`: crediting the
      // person who COMPLETES a multi-day threshold period also hands an award to
      // whoever else already held attribution in it — and that award is gated by
      // THEIR OWN day, not by `targetDate`.
      const creditTargets = habitPointsTargets(householdId, habit.assignedTo, isLiveMember);
      queueHabitPointsMove({
        batch,
        habit,
        before: habit,
        after,
        date: targetDate,
        today,
        targets: creditTargets,
        attributionMoved: true,
        legacyDelta:
          legacyPeriodPoints(after, targetDate, today) -
          legacyPeriodPoints(habit, targetDate, today),
      });

      await batch.commit();
    } catch (error) {
      console.error('[creditHabitCompletion] Failed:', error);
      toast.error(describeError(error, 'credit the completion'));
      throw error;
    }
  }, [householdId, currentUser, isLiveMember]);

  const creditHabitCompletion = useCallback(async (
    habitId: string,
    memberIds: string[],
    date?: string,
  ) => {
    // An empty set here is a caller mistake, not a household credit — that is
    // what `creditHouseholdCompletion` is for. Guarding keeps every existing
    // call site's meaning intact.
    if (memberIds.length === 0) return;
    await creditCompletion(habitId, memberIds, date);
  }, [creditCompletion]);

  /**
   * Household credit mode — credit ONE completion of `habitId` on `date`
   * (default: today) to the HOUSEHOLD and to nobody individually.
   *
   * Writes no `completedBy` entry, so the completion scores through the existing
   * unattributed path: one award at the habit's OWN flame, paid to the pool.
   */
  const creditHouseholdCompletion = useCallback(async (habitId: string, date?: string) => {
    await creditCompletion(habitId, [], date);
  }, [creditCompletion]);

  /**
   * Per-member points (stage 1) — un-credit ONE of `memberId`'s completions of
   * `habitId` on `date` (default: today).
   *
   * Decrements their count, drops the date from their completion set once it
   * reaches zero (a targeted `deleteField()`, never a map rewrite), and reverses
   * EXACTLY the points that completion earned — recomputed from that member's
   * own streak ending on `date`, so an old completion is undone at the
   * multiplier that applied then, not today's.
   *
   * A date nobody is attributed for (a grandfathered completion) is a no-op:
   * there is nothing to un-credit and nobody to debit.
   */
  const uncreditCompletion = useCallback(async (
    habitId: string,
    memberId: string | null,
    date?: string,
  ) => {
    if (!householdId) return;
    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) return;

    try {
      const today = getLocalDateString();
      const targetDate = date ?? today;
      if (memberId !== null && memberCompletionCount(habit, memberId, targetDate) <= 0) return;
      // 🏁 HOUSEHOLD un-credit: there is no attribution to take back, so the
      // date must at least carry a recorded completion for a unit to exist. The
      // points side is safe either way — `unattributedUnitsOnDate` floors at
      // zero, so a date whose units are all attributed yields a 0 pool delta —
      // but the COUNTERS are not, and this stops them drifting.
      if (memberId === null && !habit.completedDates.includes(targetDate)) return;

      // A stale counter belongs to a previous period, so it must not shrink here
      // (mirrors resetHabitDay's `inLivePeriod`).
      const inLivePeriod =
        habitPeriodStart(habit.period, targetDate) === habitPeriodStart(habit.period, today) &&
        !isHabitStale(habit);
      const target = Math.max(habit.targetCount, 1);

      // Household: nothing to strip — the unit being removed belongs to nobody,
      // so `completedBy` is untouched and any per-completion member override on
      // this date keeps its credit (which is also what keeps the date in
      // `completedDates` below).
      const stripped = memberId === null
        ? habit
        : withAttributionDelta(habit, targetDate, memberId, -1);
      const nextCount = inLivePeriod ? Math.max(0, habit.count - 1) : habit.count;
      // Does the date stay completed? In the live period the counter decides
      // (exactly as a 'down' toggle does). For a past date the attribution is
      // the only evidence available, so the date leaves `completedDates` once
      // its last attributed unit is gone.
      const stillCompleted = inLivePeriod
        ? habit.scoringType === 'incremental'
          ? nextCount >= 1
          : nextCount >= target
        : attributedUnitsOnDate(stripped, targetDate) > 0;
      const dateRemoved = habit.completedDates.includes(targetDate) && !stillCompleted;
      const nextCompletedDates = dateRemoved
        ? habit.completedDates.filter(d => d !== targetDate)
        : habit.completedDates;

      const after: Habit = {
        ...stripped,
        count: nextCount,
        totalCount: Math.max(0, habit.totalCount - 1),
        completedDates: nextCompletedDates,
      };

      const batch = writeBatch(db);
      batch.update(doc(db, `households/${householdId}/habits`, habitId), {
        ...(memberId === null ? {} : attributionUpdate(targetDate, memberId, -1)),
        ...(inLivePeriod && habit.count > 0 ? { count: increment(-1) } : {}),
        ...(habit.totalCount > 0 ? { totalCount: increment(-1) } : {}),
        ...(dateRemoved ? { completedDates: arrayRemove(targetDate) } : {}),
        streakDays: streakForHabit({
          period: habit.period,
          completedDates: nextCompletedDates,
          frozenDates: habit.frozenDates,
          pausedUntil: habit.pausedUntil,
        }),
        lastUpdated: serverTimestamp(),
      });

      // Stage 1.5: un-crediting reverses exactly the member award this
      // completion originally granted (recomputed at that member's streak
      // ending on the day they earned it), and the pool loses the same amount.
      //
      // A removed member can still hold attribution on the habit doc, so the
      // un-credit must strip it (the habit write above always runs) while
      // skipping the points reversal on their deleted doc (`memberRef` → null).
      //
      // Period-wide, not just `memberId`: un-crediting the unit that was holding
      // a multi-day threshold period at target takes the award back off EVERY
      // member who held one in it — each debited on the day their own award had
      // landed, which for a side-effect holder is not `targetDate`.
      const uncreditTargets = habitPointsTargets(householdId, habit.assignedTo, isLiveMember);
      queueHabitPointsMove({
        batch,
        habit,
        before: habit,
        after,
        date: targetDate,
        today,
        targets: uncreditTargets,
        attributionMoved: true,
        legacyDelta:
          legacyPeriodPoints(after, targetDate, today) -
          legacyPeriodPoints(habit, targetDate, today),
      });

      await batch.commit();
    } catch (error) {
      console.error('[uncreditHabitCompletion] Failed:', error);
      toast.error(describeError(error, 'un-credit the completion'));
      throw error;
    }
  }, [householdId, isLiveMember]);

  const uncreditHabitCompletion = useCallback(async (
    habitId: string,
    memberId: string,
    date?: string,
  ) => {
    await uncreditCompletion(habitId, memberId, date);
  }, [uncreditCompletion]);

  /**
   * Household credit mode — take back ONE unattributed completion of `habitId`
   * on `date` (default: today). The twin of `creditHouseholdCompletion`: no
   * member is debited (none was credited), and the pool loses exactly what the
   * unattributed remainder contributed.
   */
  const uncreditHouseholdCompletion = useCallback(async (habitId: string, date?: string) => {
    await uncreditCompletion(habitId, null, date);
  }, [uncreditCompletion]);

  // F-HABITS-01: set or clear a habit's planned-break end date. Passing a date
  // pauses the habit until that day (inclusive); passing null resumes it (the
  // field is removed via deleteField so isHabitPaused reads false immediately).
  const setHabitPause = useCallback(async (id: string, pausedUntil: string | null) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        pausedUntil: pausedUntil ?? deleteField(),
        lastUpdated: serverTimestamp(),
      });
      toast.success(pausedUntil ? 'Habit paused' : 'Habit resumed');
    } catch (error) {
      console.error('[setHabitPause] Failed to update pause:', error);
      toast.error(describeError(error, 'update the pause'));
      throw error;
    }
  }, [householdId]);

  return useMemo(() => ({
    addHabit,
    updateHabit,
    deleteHabit,
    archiveHabit,
    unarchiveHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    setHabitPause,
    addHabitSubmission,
    updateHabitSubmission,
    deleteHabitSubmission,
    getHabitSubmissions,
    resetHabitDay,
    creditHabitCompletion,
    uncreditHabitCompletion,
    creditHouseholdCompletion,
    uncreditHouseholdCompletion
  }), [
    addHabit,
    updateHabit,
    deleteHabit,
    archiveHabit,
    unarchiveHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    setHabitPause,
    addHabitSubmission,
    updateHabitSubmission,
    deleteHabitSubmission,
    getHabitSubmissions,
    resetHabitDay,
    creditHabitCompletion,
    uncreditHabitCompletion,
    creditHouseholdCompletion,
    uncreditHouseholdCompletion
  ]);
};
