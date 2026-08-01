import { parseISO, isSameWeek, format, startOfWeek } from 'date-fns';
import { FreezeMode, Habit } from '@/types/schema';
import { memberFrozenDates, streakEndingOnForMemberDates } from '@/utils/habitAttribution';
import { DEFAULT_FREEZE_MODE, isPerMemberFreeze } from '@/utils/freezeSettings';
import {
  processToggleHabit,
  isHabitStale,
  isHabitCompletedInCurrentPeriod,
  getMultiplier,
  habitPeriodStart,
  pointsForHabitOnDate,
  signedHabitPoints,
  streakEndingOnForHabit,
  streakForHabit,
} from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { isWithinBackdateWindow } from '@/utils/transactionHabitFiring';

/**
 * Habit Automations (PRD #1065) — translating an automated trigger (a linked
 * to-do completing/restoring, a transaction chip, a geo confirm) into the field
 * deltas needed to fire the habit EXACTLY like one manual tap.
 *
 * "Fires like one manual tap" is the invariant: this reuses the same
 * `processToggleHabit` scoring/streak/multiplier logic the interactive toggle
 * uses (see hooks/useHabitActions.tsx `toggleHabit`), including the lazy-reset
 * of a STALE habit (a habit whose counter belongs to a previous period is
 * treated as count 0 before an 'up' fire, matching the toggle path).
 *
 * The returned shape is plain data — no Firestore `FieldValue`s — so the caller
 * writes the `completedDates` change as a server-side `arrayUnion`/`arrayRemove`
 * DELTA (`addedDate`/`removedDate`), never the whole array, matching the
 * project's "never wholesale-overwrite completion history" rule. Pure and
 * unit-testable; no Firestore, no side effects.
 */
export interface HabitFireDelta {
  /** New live-period counter (absolute — write only in the `resetCount` case). */
  count: number;
  /** New lifetime counter (absolute; prefer the `totalCountDelta` increment). */
  totalCount: number;
  /**
   * Signed change to the live-period counter, to be written as a Firestore
   * `increment()` delta so a stale-cache device can't clobber a concurrent
   * writer (mirrors habitDeltaUpdate). IGNORE this and write `count` ABSOLUTELY
   * when `resetCount` is true — see that field.
   */
  countDelta: number;
  /** Signed change to the lifetime counter, to be written as `increment()`. */
  totalCountDelta: number;
  /**
   * True only on a stale-habit lazy-reset ('up' fire on a habit whose counter
   * belongs to a previous period): the reset-then-increment collapses to an
   * ABSOLUTE write of `count` (= 0 + delta), which must NOT go through
   * `increment()` because the stored counter is prior-period garbage the reset
   * discards outright. In every other case write `increment(countDelta)`.
   */
  resetCount: boolean;
  /** Recomputed period-aware streak. */
  streakDays: number;
  /** Date newly added to completedDates (write as arrayUnion), if any. */
  addedDate?: string;
  /** Date newly removed from completedDates (write as arrayRemove), if any. */
  removedDate?: string;
  /** Signed points delta to apply to the points target (may be 0). */
  pointsChange: number;
  /** The streak multiplier that produced pointsChange (1.0 / 1.5 / 2.0). */
  multiplier: number;
}

/**
 * The delta for a BACK-DATED fire (`computeBackdatedHabitFire`). Distinct from
 * `HabitFireDelta` in three ways that matter at the write site:
 *   - the live counter may legitimately not move at all (a past-period fire);
 *   - points are split per BUCKET rather than a single scalar, because a past
 *     fire credits `total` but not today's `daily`;
 *   - it can require un-freezing a date.
 * Plain data — no Firestore `FieldValue`s — so the caller writes
 * `completedDates` / `frozenDates` as arrayUnion/arrayRemove DELTAS, never whole
 * arrays (2026-07-15 habit-history clobber incident).
 */
export interface BackdatedHabitFireDelta {
  /** True when `fireDate` falls in the habit's CURRENT period. */
  inCurrentPeriod: boolean;
  /** Live-counter change, to write as `increment()`. 0 for a past-period fire. */
  countDelta: number;
  /**
   * True only on a current-period stale lazy-reset: write `count` ABSOLUTELY
   * (the stored counter is prior-period garbage the reset discards) and ignore
   * `countDelta`. See `HabitFireDelta.resetCount`.
   */
  resetCount: boolean;
  /** Absolute live counter — write only when `resetCount` is true. */
  count: number;
  /** Lifetime-counter change, to write as `increment()`. Always 1. */
  totalCountDelta: number;
  /** Date to arrayUnion into `completedDates`, when this fire newly completes it. */
  addedDate?: string;
  /**
   * Date to arrayRemove from `frozenDates` — set when the fire completes a day a
   * freeze token had been spent protecting. The caller must ALSO refund the
   * token (from the SHARED household bank), in the same batch.
   *
   * Only ever set in the shared freeze modes. See `unfrozenDateFor`.
   */
  unfrozenDate?: string;
  /**
   * The PER-MEMBER un-freeze (`freezeMode: 'per_member'`): arrayRemove
   * `memberId` from the `frozenDatesBy.<date>` DOT PATH, and refund the token to
   * THAT member's own bank (`freezeBanksByMember.<uid>`), in the same batch.
   *
   * Deliberately a DISTINCT field rather than a re-used `unfrozenDate`: the two
   * are written to different paths and refunded from different banks, so a
   * caller that only knows about `unfrozenDate` writes NOTHING here rather than
   * silently writing the wrong shape. The two are mutually exclusive by
   * construction — the freeze mode picks exactly one.
   */
  unfrozenDateFor?: { date: string; memberId: string };
  /**
   * Recomputed period-aware streak for the habit doc — the HABIT-LEVEL flame,
   * in every freeze mode. A per-member token deliberately does not bridge it
   * (the same reason `autoApplyFreezes`' `applyPerMember` never writes it).
   */
  streakDays: number;
  /** Signed points this fire credits (may be 0). Stored on the submission doc. */
  pointsEarned: number;
  /** `pointsEarned` split by bucket — see the DATE gating in the implementation. */
  pointsDelta: { daily: number; weekly: number; total: number };
  /** The multiplier that produced `pointsEarned` (1.0 / 1.5 / 2.0). */
  multiplier: number;
  /** Streak ending on `fireDate`, snapshotted onto the submission doc. */
  streakAtFireDate: number;
}

/**
 * Compute the fire (`'up'`) or reverse (`'down'`) delta for firing `habit` from
 * an automated trigger. Returns `null` when the toggle is a no-op (e.g. a
 * `'down'` reverse of a habit already at count 0), mirroring
 * `processToggleHabit`.
 */
export function computeHabitTriggerFire(
  habit: Habit,
  direction: 'up' | 'down',
): HabitFireDelta | null {
  // An ARCHIVED habit must never fire: the automation is a no-op and the to-do
  // completes normally (a reverse is still allowed so an already-credited fire
  // can be undone). Guarded here AND in fireLinkedHabitInBatch (defense in
  // depth) so no caller can accidentally re-animate a retired habit.
  if (direction === 'up' && habit.archivedAt) return null;

  // Lazy-reset parity with toggleHabit: an 'up' fire on a stale habit acts as
  // if the counter were 0 (the overnight auto-reset never ran). A 'down'
  // reverse leaves the counter untouched — processToggleHabit handles the
  // decrement and its count-0 guard.
  const didReset = direction === 'up' && isHabitStale(habit);
  const effectiveHabit: Habit = didReset
    ? { ...habit, count: 0, lastUpdated: new Date().toISOString() }
    : habit;

  const result = processToggleHabit(effectiveHabit, direction);
  if (!result) return null;

  const prevDates = effectiveHabit.completedDates;
  const nextDates = result.updatedHabit.completedDates ?? prevDates;
  const addedDate = nextDates.find(d => !prevDates.includes(d));
  const removedDate = prevDates.find(d => !nextDates.includes(d));

  const count = result.updatedHabit.count ?? effectiveHabit.count;
  const totalCount = result.updatedHabit.totalCount ?? effectiveHabit.totalCount;

  return {
    count,
    totalCount,
    // Deltas are measured against the REAL stored habit (not the zeroed
    // effectiveHabit) so a non-reset fire increments the actual counter. In the
    // reset case the caller writes `count` absolutely and ignores countDelta.
    countDelta: count - habit.count,
    totalCountDelta: totalCount - habit.totalCount,
    resetCount: didReset,
    streakDays: result.updatedHabit.streakDays ?? effectiveHabit.streakDays,
    ...(addedDate !== undefined ? { addedDate } : {}),
    ...(removedDate !== undefined ? { removedDate } : {}),
    pointsChange: result.pointsChange,
    multiplier: result.multiplier,
  };
}

/**
 * Per-member freeze awareness for `computeBackdatedHabitFire`. Every field is
 * optional and an omitted `options` argument is exactly today's behaviour.
 */
export interface BackdatedFireOptions {
  /**
   * The ACTING member's uid — the person entering or approving the transaction.
   * Well-founded as the credit target because this path only ever fires on a
   * `verified` row, i.e. one a human hand-entered or approved.
   *
   * Consulted ONLY under `freezeMode: 'per_member'`; ignored otherwise.
   */
  memberId?: string;
  /**
   * The household's RESOLVED freeze mode — always via
   * `resolveFreezeMode(householdSettings)`, never the raw stored field. Absent
   * means `DEFAULT_FREEZE_MODE` ('shared'), i.e. today's behaviour.
   */
  freezeMode?: FreezeMode;
}

/**
 * The delta for firing a habit on a date that is NOT necessarily today — the
 * transaction-keyword path (PRD #1065).
 *
 * Why this exists rather than reusing `computeHabitTriggerFire`: that helper
 * bottoms out in `processToggleHabit`, which hard-codes `getLocalDateString()`
 * and has no date parameter. A transaction row is dated to when the money
 * actually moved, and the nightly `bankEmailSync` delivers it the following
 * morning, so firing "today" credited the wrong day on every automated import.
 *
 * This mirrors `addHabitSubmission`'s back-dated semantics exactly (see
 * hooks/useHabitActions.tsx): the multiplier comes from the streak ending ON
 * `fireDate`, the live counter only moves when `fireDate` is in the current
 * period, and the points buckets are gated by date so a past fire can't inflate
 * today's daily or this week's weekly total.
 *
 * @param habit    The habit to fire
 * @param fireDate yyyy-MM-dd the completion belongs to (the transaction's date)
 * @param today    caller-local yyyy-MM-dd; injectable for deterministic tests
 * @param priorPeriodCount Units ALREADY recorded for `fireDate`'s period when
 *   that period is in the past — the sum of its stored submissions, since the
 *   live counter says nothing about a past day/week. Ignored for a
 *   current-period fire (the live counter is authoritative) and for incremental
 *   habits (scoring is per-action), so callers may pass 0 in those cases.
 * @param options   Per-member freeze awareness (see `BackdatedFireOptions`).
 *   OMIT IT and every field returned is bit-for-bit the pre-stage-6 value.
 * @returns the delta, or `null` when the fire is a no-op: an archived habit, or
 *   a date outside the back-date window. The window is re-checked here as
 *   defense in depth — writing a FUTURE completion would corrupt the streak
 *   chain rather than merely misdate it, so no caller may bypass it.
 *
 * ── THE PER-MEMBER BRANCH (`freezeMode: 'per_member'`) ──────────────────────
 *
 * Under that mode the shared `Habit.frozenDates` / `Household.freezeBank` are
 * not in use: each adult holds their own token bank and their own frozen dates
 * (`Habit.frozenDatesBy`, date → uid[]). A fire that is blind to that is wrong
 * twice — it never un-freezes or refunds the acting member's token, and it
 * scores the multiplier off a streak that ignores their own frozen bridge, so
 * the fire credits fewer points than were earned.
 *
 * Passing `{ memberId, freezeMode: 'per_member' }` switches exactly two things
 * and nothing else:
 *
 *   1. the un-freeze decision reads `frozenDatesBy[fireDate]` for THAT uid, and
 *      is reported as `unfrozenDateFor` (never as `unfrozenDate`, which means
 *      the shared bank);
 *   2. `streakAtFireDate` — and therefore `multiplier` and `pointsEarned` —
 *      walks with that member's own freeze dates added to the bridge.
 *
 * `streakDays` is deliberately NOT member-bridged: it is the habit-level flame,
 * household-wide, and a personal token must not inflate it (the same rule
 * `autoApplyFreezes`' `applyPerMember` follows by never writing it).
 *
 * KNOWN NARROWING: a household that ran in a shared mode before switching can
 * still carry legacy dates in `Habit.frozenDates`. Under `'per_member'` those
 * are not un-frozen here (the mode says the shared bank is not in use, and
 * refunding a shared token would credit a bank nobody can see). They keep
 * bridging every member's chain, and a stale entry on a now-completed date is
 * inert for points and streaks alike — `calculateStreak` counts a date that is
 * both completed and frozen exactly once, and every points path scores from
 * `completedDates` only.
 */
export function computeBackdatedHabitFire(
  habit: Habit,
  fireDate: string,
  today: string = getLocalDateString(),
  priorPeriodCount = 0,
  options: BackdatedFireOptions = {},
): BackdatedHabitFireDelta | null {
  if (habit.archivedAt) return null;
  if (!isWithinBackdateWindow(fireDate, today)) return null;

  // The acting member, but ONLY under per-member freeze mode — `undefined` in
  // every shared mode and for every caller that passes no options, which is
  // what collapses each branch below onto the pre-stage-6 code path.
  const freezeMemberId = isPerMemberFreeze(options.freezeMode ?? DEFAULT_FREEZE_MODE)
    ? options.memberId
    : undefined;

  const inCurrentPeriod =
    habitPeriodStart(habit.period, fireDate) === habitPeriodStart(habit.period, today);

  // Lazy-reset parity with toggleHabit: a stale habit's counter belongs to a
  // previous period, so its live period counter is effectively 0.
  const stale = isHabitStale(habit);
  const liveCount = stale ? 0 : habit.count;

  // A past-period fire must leave the live counter completely alone — it
  // describes a LATER period than the one being credited.
  const basePeriodCount = inCurrentPeriod ? liveCount : priorPeriodCount;
  const newPeriodCount = basePeriodCount + 1;

  // Threshold habits only mark the date complete once the fire's OWN period
  // reaches the target, preserving the subsystem-wide invariant "date in
  // completedDates ⟹ target met that period". Incremental habits complete on
  // any action (toggle parity).
  const marksDateComplete =
    habit.scoringType === 'incremental' || newPeriodCount >= habit.targetCount;
  const dateNewlyCompleted = marksDateComplete && !habit.completedDates.includes(fireDate);

  const nextCompletedDates = dateNewlyCompleted
    ? [...habit.completedDates, fireDate].sort((a, b) => (a < b ? 1 : -1))
    : habit.completedDates;

  // A day that turns out to have been completed must not stay frozen: the
  // schema's invariant is that a frozen date NEVER appears in completedDates,
  // and the token it cost was spent protecting a miss that didn't happen. The
  // caller arrayRemoves this date and refunds the token in the same batch.
  //
  // SHARED modes only — `freezeMemberId` is undefined there, so this is the
  // unchanged pre-stage-6 decision.
  const unfrozenDate =
    freezeMemberId === undefined &&
    dateNewlyCompleted &&
    (habit.frozenDates ?? []).includes(fireDate)
      ? fireDate
      : undefined;
  const nextFrozenDates = (habit.frozenDates ?? []).filter(d => d !== unfrozenDate);

  // PER-MEMBER mode: the same decision, one level down — was THIS member's own
  // token spent on `fireDate`? `frozenDatesBy[date]` is `string[] | undefined`.
  const unfrozenDateFor =
    freezeMemberId !== undefined &&
    dateNewlyCompleted &&
    (habit.frozenDatesBy?.[fireDate] ?? []).includes(freezeMemberId)
      ? { date: fireDate, memberId: freezeMemberId }
      : undefined;

  // The member's own freeze bridge, with the date this fire just un-froze
  // dropped (mirroring `nextFrozenDates` on the shared side). Empty — and
  // therefore inert — in every shared mode.
  const memberFrozen =
    freezeMemberId === undefined
      ? []
      : memberFrozenDates(habit, freezeMemberId).filter(d => d !== unfrozenDateFor?.date);

  // Multiplier from the streak ending ON fireDate — never the habit's CURRENT
  // streak, which would retro-apply today's multiplier to a past day. In
  // per-member mode the walk additionally bridges this member's OWN frozen
  // dates; without that the streak comes out shorter than it really was and the
  // fire underpays.
  const streakAtFireDate =
    freezeMemberId === undefined
      ? streakEndingOnForHabit(
          {
            period: habit.period,
            completedDates: nextCompletedDates,
            frozenDates: nextFrozenDates,
            pausedUntil: habit.pausedUntil,
          },
          fireDate,
        )
      : streakEndingOnForMemberDates(habit, nextCompletedDates, fireDate, today, memberFrozen);
  const multiplier = getMultiplier(streakAtFireDate, habit.type === 'positive', habit.period);

  // Mirrors addHabitSubmission: incremental scores every action; threshold
  // scores only the unit that pushes its own period over the target, and never
  // when that period was already credited (a period completed via the toggle
  // path leaves no submissions behind, so completedDates is the guard).
  let pointsEarned = 0;
  if (habit.scoringType === 'incremental') {
    pointsEarned = signedHabitPoints(habit, multiplier);
  } else if (
    newPeriodCount >= habit.targetCount &&
    basePeriodCount < habit.targetCount &&
    !isHabitCompletedInCurrentPeriod(habit, fireDate)
  ) {
    pointsEarned = signedHabitPoints(habit, multiplier);
  }

  // Bucket gating by DATE (mirrors addHabitSubmission): `total` is lifetime so
  // it always absorbs the points; `daily` only when the fire lands on today;
  // `weekly` only when it lands in the current Monday-anchored week. Without
  // this a Monday fire approved on Tuesday would inflate Tuesday's daily total.
  const weekStart = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const pointsDelta = {
    daily: fireDate === today ? pointsEarned : 0,
    weekly: fireDate >= weekStart && fireDate <= today ? pointsEarned : 0,
    total: pointsEarned,
  };

  return {
    inCurrentPeriod,
    countDelta: inCurrentPeriod ? 1 : 0,
    resetCount: inCurrentPeriod && stale,
    count: liveCount + 1,
    totalCountDelta: 1,
    ...(dateNewlyCompleted ? { addedDate: fireDate } : {}),
    ...(unfrozenDate !== undefined ? { unfrozenDate } : {}),
    ...(unfrozenDateFor !== undefined ? { unfrozenDateFor } : {}),
    // HABIT-LEVEL in every mode (see the field's docblock): a personal freeze
    // token bridges its owner's chain, never the household flame.
    streakDays: streakForHabit({
      period: habit.period,
      completedDates: nextCompletedDates,
      frozenDates: nextFrozenDates,
      pausedUntil: habit.pausedUntil,
    }),
    pointsEarned,
    pointsDelta,
    multiplier,
    streakAtFireDate,
  };
}

/**
 * Compute the REVERSE delta for restoring a to-do that previously fired `habit`.
 *
 * Unlike a plain `computeHabitTriggerFire(habit, 'down')` — which keys on TODAY
 * and only ever strips today's completion — this reverses the EXACT date the
 * fire added (`completionDate`, derived from the to-do's `completedAt`). So
 * restoring a to-do completed on a PRIOR day removes that day's completion
 * (`arrayRemove`) and debits the points credited THEN (historical multiplier via
 * `pointsForHabitOnDate`/`streakEndingOnForHabit`, matching how the fire scored
 * them) instead of corrupting the current period's counter, streak, and points.
 *
 * @param completionDate yyyy-MM-dd the fire added (the local date of the to-do's
 *                       `completedAt`). When it falls in the current period the
 *                       reversal is identical to the manual same-day down toggle.
 * @param today          caller-local yyyy-MM-dd; injectable for deterministic
 *                       boundary tests.
 * @returns the reverse delta, or `null` when there is nothing to reverse (the
 *          habit is already at count 0 for a same-period restore, or the date is
 *          no longer a completion — e.g. it was already restored).
 */
export function computeHabitTriggerReverse(
  habit: Habit,
  completionDate: string,
  today: string = getLocalDateString(),
): HabitFireDelta | null {
  const inCurrentPeriod =
    habit.period === 'weekly'
      ? isSameWeek(parseISO(completionDate), parseISO(today), { weekStartsOn: 1 })
      : completionDate === today;

  // Same-period restore: the fire's effect is still described by the live
  // counter, so the manual same-day 'down' toggle is its exact inverse (it keys
  // on today, which equals completionDate here — count/points/date all match).
  if (inCurrentPeriod) {
    return computeHabitTriggerFire(habit, 'down');
  }

  // Prior-period restore: the current counter belongs to a LATER period and
  // must be left untouched (mirrors processStaleDownToggle, but keyed to the
  // to-do's exact completion date instead of "the most recent prior day").
  // Nothing to reverse if that day is no longer a completion.
  if (!habit.completedDates.includes(completionDate)) return null;

  // Reverse exactly what the fire credited on that date: the historical,
  // streak-multiplied points for that completion (0 for a no-points fire).
  const earned = pointsForHabitOnDate(habit, completionDate, today);
  const nextDates = habit.completedDates.filter(d => d !== completionDate);
  const streakDays = streakForHabit({ ...habit, completedDates: nextDates });

  return {
    // Untouched — the live counter belongs to the current period, not the
    // prior period this reversal is undoing.
    count: habit.count,
    countDelta: 0,
    // The fire incremented the lifetime counter; disavow that one completion.
    totalCount: Math.max(0, habit.totalCount - 1),
    // -1, but floored so a lifetime counter already at 0 isn't driven negative.
    totalCountDelta: Math.max(0, habit.totalCount - 1) - habit.totalCount,
    resetCount: false,
    streakDays,
    removedDate: completionDate,
    pointsChange: -earned,
    multiplier: 1.0,
  };
}
