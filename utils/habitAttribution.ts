/**
 * Per-member habit points — stage 1 (the silent attribution data layer).
 *
 * This module is the SINGLE source of truth for everything derived from
 * `Habit.completedBy` (per-date, per-member completion counts). It is purely
 * additive: nothing here feeds the household-level scoring in `habitLogic.ts`,
 * which keeps computing `points.daily/weekly/total` from `completedDates` alone
 * exactly as it did before this feature existed.
 *
 * The two layers and how they relate
 * ----------------------------------
 *   household(date) = Σ_members memberPoints(m, date) + unattributed(date)
 *
 * `unattributed` is the grandfathering term: every completion recorded before
 * this feature shipped has no `completedBy` entry, so it contributes to the
 * household number and to NOBODY's member score. On transition day the whole
 * household total IS the remainder and every member score is 0 — which is what
 * makes stage 1 provably invisible (see `decomposeDayPoints` and the parity
 * tests in habitAttribution.test.ts).
 *
 * Per-member streaks reuse the existing period-aware primitives verbatim: a
 * member's completion-date set (the dates where their count > 0) is fed to the
 * same `calculateStreak`/`calculateWeeklyStreak` walk the habit-level streak
 * uses, with the habit's `frozenDates` (and any planned-pause bridge) applied
 * unchanged — so a habit-level freeze bridges EVERY member's chain, exactly as
 * it bridges the habit's own. Per-member freeze banks are a later stage.
 *
 * 🛡️ WRITE DISCIPLINE — `completedBy` is only ever written through
 * `completedByPath()` / `completedByDatePath()` dot paths. Never write the whole
 * map (habit-history-clobber hazard). Per-MEMBER writes are unconditional
 * `increment()`s in both directions: choosing `deleteField()` at zero would have
 * to read a client-cached prior count, and a stale offline cache would then
 * delete a node another device had just incremented — the same clobber class,
 * one level down. `deleteField()` is reserved for a whole-DATE clear
 * (`completedByDatePath()`), which is absolute by design and mirrors the
 * `completedDates` arrayRemove committed in the same batch.
 *
 * The cost of that discipline is zero/negative residue nodes. Every reader here
 * treats `count <= 0` as ABSENT, and `habitConverter` drops such nodes on read,
 * so residue is invisible bookkeeping — never worth a cleanup write.
 */
import {
  Habit,
  HabitCompletedBy,
  HouseholdMember,
} from '@/types/schema';
import {
  calculatePointsForDate,
  calculatePointsForDateRange,
  calculateStreak,
  calculateWeeklyStreak,
  effectiveFrozenDates,
  getMultiplier,
  habitPeriodStart,
  habitPointsMagnitude,
  habitSign,
  pointsForHabitOnDate,
  streakEndingOn,
  streakEndingOnWeek,
  type SubmissionTotalsByHabitDate,
} from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { format, parseISO, startOfWeek } from 'date-fns';

// ---------------------------------------------------------------------------
// Field paths (the ONLY sanctioned way to write attribution)
// ---------------------------------------------------------------------------

/**
 * Firestore field path for one member's count on one date.
 *
 * Both segments are safe to interpolate into a dotted string path: dates are
 * `yyyy-MM-dd` and member ids are Firebase Auth uids (alphanumeric) or the
 * synthetic `kid_<uuid>` — neither can contain a `.`, which is the only
 * character the path parser treats specially.
 */
export const completedByPath = (date: string, memberId: string): string =>
  `completedBy.${date}.${memberId}`;

/** Firestore field path for a whole day's attribution (used to clear a day). */
export const completedByDatePath = (date: string): string => `completedBy.${date}`;

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Attribution shape a reader needs — narrower than a full `Habit`. */
type AttributedHabit = Pick<Habit, 'completedBy'>;

/**
 * How many completions `memberId` logged for `habit` on `date` (0 when none).
 *
 * 🛡️ Clamped at zero: decrements are written as unconditional dot-path
 * `increment(-1)`s (never a delete-at-zero decided from a client-cached prior
 * count, which a stale device would use to wipe a concurrent increment), so a
 * node can legitimately rest at 0 — or dip below it when two devices decrement
 * the same unit. `count <= 0` means ABSENT everywhere in this module; the
 * residue is harmless bookkeeping and is dropped on read by `habitConverter`.
 */
export const memberCompletionCount = (
  habit: AttributedHabit,
  memberId: string,
  date: string,
): number => Math.max(0, habit.completedBy?.[date]?.[memberId] ?? 0);

/** Total attributed completions on `date`, across every member. */
export const attributedUnitsOnDate = (habit: AttributedHabit, date: string): number => {
  const day = habit.completedBy?.[date];
  if (!day) return 0;
  let sum = 0;
  for (const count of Object.values(day)) sum += count > 0 ? count : 0;
  return sum;
};

/** The member uids credited on `date` (count > 0), in insertion order. */
export const memberIdsOnDate = (habit: AttributedHabit, date: string): string[] => {
  const day = habit.completedBy?.[date];
  if (!day) return [];
  return Object.keys(day).filter(uid => (day[uid] ?? 0) > 0);
};

/** Every member uid with at least one attributed completion on this habit. */
export const attributedMemberIds = (habit: AttributedHabit): string[] => {
  const out = new Set<string>();
  for (const day of Object.values(habit.completedBy ?? {})) {
    for (const [uid, count] of Object.entries(day)) if (count > 0) out.add(uid);
  }
  return [...out];
};

/**
 * A member's own completion-date set: the dates where their count > 0, sorted
 * newest-first to match `Habit.completedDates`' ordering convention. This is
 * what every per-member streak walk is fed.
 */
export const memberCompletionDates = (habit: AttributedHabit, memberId: string): string[] => {
  const out: string[] = [];
  for (const [date, day] of Object.entries(habit.completedBy ?? {})) {
    if ((day[memberId] ?? 0) > 0) out.push(date);
  }
  return out.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
};

/**
 * One member's share of a bounded reversal: take `units` attributed completions
 * off `memberId`. `units` is always > 0.
 */
export interface ReversalSource {
  memberId: string;
  units: number;
}

/**
 * 🛡️ THE REVERSAL RULE — which member(s) may a reversal of `units` units on
 * `date` actually come out of?
 *
 * Only ever the ones `habit.completedBy` records. The "who is credited going
 * forward" question (`attributionActor` in useHabitActions — the habit's
 * CURRENT `assignedTo`, or the acting/logging uid) is a different question, and
 * answering the reversal question with it is how a member who was never
 * credited gets debited:
 *
 *   - reassign a chore between a submission's add and its delete, and the NEW
 *     assignee is debited while the member who actually earned the points keeps
 *     them forever;
 *   - down-toggle a completion someone else was credited for, and the reversal
 *     computes a 0 delta against the wrong uid while the original credit
 *     survives;
 *   - delete a PRE-STAGE-1 submission and there is no member attribution at
 *     all, so debiting anyone invents a loss.
 *
 * So: clamp to what the preferred uid actually holds. When they hold nothing,
 * fall back to the uid(s) that DO hold attribution on that date, largest count
 * first (uid-ascending to break ties, so the choice is deterministic). When
 * nobody holds any, return `[]` — the caller then writes NO member-points
 * reversal at all, which is exactly right for grandfathered history: the credit
 * predates member scoring, so there is nothing member-level to reverse. The
 * household/pool reversal is a separate, unchanged computation.
 */
export const resolveReversalSources = (
  habit: AttributedHabit,
  preferredMemberId: string,
  date: string,
  units: number,
): ReversalSource[] => {
  if (units <= 0) return [];

  // Preferred uid holds attribution → clamp to what they hold and stop. We
  // deliberately do NOT spill the shortfall onto other members: taking units
  // off someone the caller never named is only justified when the preferred
  // uid holds nothing at all.
  const preferred = memberCompletionCount(habit, preferredMemberId, date);
  if (preferred > 0) {
    return [{ memberId: preferredMemberId, units: Math.min(preferred, units) }];
  }

  const day = habit.completedBy?.[date];
  if (!day) return [];
  const holders = Object.entries(day)
    .filter(([, count]) => count > 0)
    .sort(([aUid, aCount], [bUid, bCount]) =>
      bCount - aCount || (aUid < bUid ? -1 : aUid > bUid ? 1 : 0),
    );

  const sources: ReversalSource[] = [];
  let remaining = units;
  for (const [memberId, count] of holders) {
    if (remaining <= 0) break;
    const take = Math.min(count, remaining);
    sources.push({ memberId, units: take });
    remaining -= take;
  }
  return sources;
};

/**
 * Apply a delta to one member's count on one date, returning a NEW habit object.
 *
 * Used to build the "after" view a write path scores against (see
 * `memberPeriodPointsDelta`). Purely local — the Firestore write is always the
 * dot-path increment, never this object.
 */
export const withAttributionDelta = <T extends Habit>(
  habit: T,
  date: string,
  memberId: string,
  delta: number,
): T => {
  const day = { ...(habit.completedBy?.[date] ?? {}) };
  // Clamp the base at 0 for the same reason `memberCompletionCount` does: a
  // zero/negative residue node means "absent", so applying a delta to it must
  // start from 0 rather than compounding the residue.
  const next = Math.max(0, day[memberId] ?? 0) + delta;
  if (next > 0) day[memberId] = next;
  else delete day[memberId];

  const completedBy: HabitCompletedBy = { ...(habit.completedBy ?? {}) };
  if (Object.keys(day).length > 0) completedBy[date] = day;
  else delete completedBy[date];

  return { ...habit, completedBy };
};

/** Drop ALL attribution for the given dates, returning a NEW habit object. */
export const withDatesUnattributed = <T extends Habit>(habit: T, dates: string[]): T => {
  if (dates.length === 0) return habit;
  const completedBy: HabitCompletedBy = { ...(habit.completedBy ?? {}) };
  for (const date of dates) delete completedBy[date];
  return { ...habit, completedBy };
};

// ---------------------------------------------------------------------------
// Per-member streaks (period-aware, frozen/pause-bridged)
// ---------------------------------------------------------------------------

/** The bridging dates a member's streak walk uses: the HABIT's freezes + pause. */
const bridgeFor = (habit: Habit, dates: string[], today: string): string[] =>
  effectiveFrozenDates(
    { completedDates: dates, frozenDates: habit.frozenDates, pausedUntil: habit.pausedUntil },
    today,
  );

/**
 * Current streak for `memberId` on `habit`, in the habit's own cadence (days for
 * a daily habit, ISO weeks for a weekly one).
 *
 * @param today - injectable "today" (yyyy-MM-dd, caller-local) for determinism
 */
export const streakForMember = (
  habit: Habit,
  memberId: string,
  today: string = getLocalDateString(),
): number => streakForMemberDates(habit, memberCompletionDates(habit, memberId), today);

/** `streakForMember` against an explicit (e.g. prospective) date set. */
export const streakForMemberDates = (
  habit: Habit,
  dates: string[],
  today: string = getLocalDateString(),
): number => {
  const bridged = bridgeFor(habit, dates, today);
  return habit.period === 'weekly'
    ? calculateWeeklyStreak(dates, today, bridged)
    : calculateStreak(dates, today, bridged);
};

/**
 * The streak `memberId` had ENDING ON `date` — the historical multiplier source,
 * so reversing an old completion undoes exactly what it earned rather than what
 * today's streak would earn.
 */
export const streakEndingOnForMember = (
  habit: Habit,
  memberId: string,
  date: string,
  today: string = getLocalDateString(),
): number => {
  const dates = memberCompletionDates(habit, memberId);
  const bridged = bridgeFor(habit, dates, today);
  return habit.period === 'weekly'
    ? streakEndingOnWeek(dates, date, bridged)
    : streakEndingOn(dates, date, bridged);
};

/**
 * The multiplier a member's NEXT completion on `date` would earn — their own
 * PROSPECTIVE streak (the streak that exists once `date` is counted), matching
 * how `processToggleHabit` computes the habit-level multiplier.
 */
export const prospectiveMultiplierForMember = (
  habit: Habit,
  memberId: string,
  date: string,
  today: string = getLocalDateString(),
): number => {
  const dates = memberCompletionDates(habit, memberId);
  const prospective = dates.includes(date) ? dates : [...dates, date];
  return getMultiplier(
    streakForMemberDates(habit, prospective, today),
    habit.type === 'positive',
    habit.period,
  );
};

// ---------------------------------------------------------------------------
// Per-member scoring
// ---------------------------------------------------------------------------

/**
 * Is the period containing `date` completed for this habit?
 *
 * Mirrors the household scorer's gating exactly: a PAST period's presence in
 * `completedDates` already proves its target was met, while the CURRENT period
 * additionally requires the live counter to still be at target (a toggle back
 * below target strips only today from `completedDates`, not earlier week days).
 */
const periodCompleted = (habit: Habit, date: string, today: string): boolean => {
  const periodStart = habitPeriodStart(habit.period, date);
  const completed = habit.completedDates.some(
    d => habitPeriodStart(habit.period, d) === periodStart,
  );
  if (!completed) return false;
  if (periodStart !== habitPeriodStart(habit.period, today)) return true;
  return habit.count >= Math.max(habit.targetCount, 1);
};

/**
 * Signed points ONE member earned from ONE habit on ONE date, derived purely
 * from attribution + that member's own streak.
 *
 * - **incremental** — points per attributed action, exactly like the habit-level
 *   contract ("points on every action"), at the member's historical multiplier.
 * - **threshold** — ONE award per period, credited to the member's FIRST
 *   attributed day in that period, and only once the period is actually
 *   completed. Both members completing the same threshold habit therefore each
 *   earn a full award (the locked product decision), while a member tapping an
 *   already-credited day earns nothing extra.
 *
 * Returns 0 for a habit with no attribution — which is every pre-feature habit.
 */
export const memberPointsForHabitOnDate = (
  habit: Habit,
  memberId: string,
  date: string,
  today: string = getLocalDateString(),
): number => {
  const units = memberCompletionCount(habit, memberId, date);
  if (units <= 0) return 0;

  const streak = streakEndingOnForMember(habit, memberId, date, today);
  const multiplier = getMultiplier(streak, habit.type === 'positive', habit.period);
  const perUnit = habitSign(habit) * Math.floor(habitPointsMagnitude(habit) * multiplier);

  if (habit.scoringType === 'incremental') return units * perUnit;

  if (!periodCompleted(habit, date, today)) return 0;
  const periodStart = habitPeriodStart(habit.period, date);
  const samePeriod = memberCompletionDates(habit, memberId).filter(
    d => habitPeriodStart(habit.period, d) === periodStart,
  );
  const firstInPeriod = samePeriod.reduce((a, b) => (a < b ? a : b));
  return date === firstInPeriod ? perUnit : 0;
};

/**
 * Signed points one member has earned from one habit across the WHOLE period
 * containing `date` (the day itself for a daily habit, the Monday-anchored week
 * for a weekly one).
 *
 * Every write path scores a before/after pair of this rather than deriving its
 * own delta, so the per-toggle credit and the corrective recompute can never
 * disagree — they are literally the same function.
 */
export const memberPeriodPoints = (
  habit: Habit,
  memberId: string,
  date: string,
  today: string = getLocalDateString(),
): number => {
  const periodStart = habitPeriodStart(habit.period, date);
  let total = 0;
  for (const d of memberCompletionDates(habit, memberId)) {
    if (habitPeriodStart(habit.period, d) !== periodStart) continue;
    total += memberPointsForHabitOnDate(habit, memberId, d, today);
  }
  return total;
};

/**
 * Signed HOUSEHOLD points a habit contributes across the whole period
 * containing `date`, scored by the unchanged household attribution
 * (`pointsForHabitOnDate`).
 *
 * The credit/un-credit mutations take a before/after difference of this for the
 * pool write, so the pool delta is by construction whatever the corrective
 * recompute would derive — no login-time correction jump.
 */
export const householdPeriodPoints = (
  habit: Habit,
  date: string,
  today: string = getLocalDateString(),
): number => {
  const periodStart = habitPeriodStart(habit.period, date);
  let total = 0;
  for (const d of new Set(habit.completedDates)) {
    if (habitPeriodStart(habit.period, d) !== periodStart) continue;
    total += pointsForHabitOnDate(habit, d, today);
  }
  return total;
};

/**
 * The signed points delta a member should be credited when a habit goes from
 * `before` to `after` around `date`. Positive = credit, negative = reversal.
 */
export const memberPeriodPointsDelta = (
  before: Habit,
  after: Habit,
  memberId: string,
  date: string,
  today: string = getLocalDateString(),
): number =>
  memberPeriodPoints(after, memberId, date, today) -
  memberPeriodPoints(before, memberId, date, today);

/**
 * Should this habit's completions feed the per-member attribution layer?
 *
 * An ASSIGNED habit (a kid chore, Plan 080c) already credits its assignee's own
 * `members/{uid}.points` through `habitPointsTargets().poolRef` and is already
 * excluded from the household pool — so scoring it again here would double-count
 * that member. Attribution is still RECORDED on assigned habits (the stage-2 pie
 * counter wants it); it just doesn't drive points. This mirrors
 * `calculatePointsForDate`'s default scope filter.
 */
export const habitFeedsMemberAttribution = (habit: Pick<Habit, 'assignedTo'>): boolean =>
  !habit.assignedTo;

/** Signed points `memberId` earned from ALL habits' attribution on one date. */
export const calculateMemberPointsForDate = (
  habits: Habit[],
  memberId: string,
  date: string,
  today: string = getLocalDateString(),
): number => {
  let total = 0;
  for (const habit of habits) {
    if (!habitFeedsMemberAttribution(habit)) continue;
    total += memberPointsForHabitOnDate(habit, memberId, date, today);
  }
  return total;
};

/** Signed points `memberId` earned from attribution across an inclusive range. */
export const calculateMemberPointsForDateRange = (
  habits: Habit[],
  memberId: string,
  startDate: string,
  endDate: string,
  today: string = getLocalDateString(),
): number => {
  let total = 0;
  for (const habit of habits) {
    if (!habitFeedsMemberAttribution(habit)) continue;
    for (const date of memberCompletionDates(habit, memberId)) {
      if (date < startDate || date > endDate) continue;
      total += memberPointsForHabitOnDate(habit, memberId, date, today);
    }
  }
  return total;
};

// ---------------------------------------------------------------------------
// Household ↔ member decomposition (the grandfathering invariant)
// ---------------------------------------------------------------------------

/** How one date's household points split across members plus the legacy remainder. */
export interface PointsDecomposition {
  /** The household figure — computed by the UNCHANGED household scorer. */
  household: number;
  /** Per-member attributed points, keyed by member uid. */
  byMember: Record<string, number>;
  /**
   * The grandfathering remainder: `household − Σ byMember`. Pre-feature
   * completions land here and are attributed to nobody. It can go negative once
   * several members are credited on the same threshold day (each earns a full
   * award while the household formula still scores one) — that is the intended
   * signal, not a bug.
   */
  unattributed: number;
}

/**
 * Decompose one date's household points into per-member shares plus the
 * unattributed remainder.
 *
 * `household` is produced by `calculatePointsForDate` — byte-for-byte the same
 * call the app already made — so **adding attribution data can never move a
 * household number**. That is the stage-1 invisibility guarantee, and it is what
 * habitAttribution.test.ts pins.
 *
 * NOTE: `today` parameterises the MEMBER half only; `calculatePointsForDate`
 * reads the local date itself (it takes no `today`). In the app the two are the
 * same value; in a test, inject a `today` that matches the date under test.
 */
export const decomposeDayPoints = (
  habits: Habit[],
  memberIds: string[],
  date: string,
  submissionTotals?: SubmissionTotalsByHabitDate,
  today: string = getLocalDateString(),
): PointsDecomposition => {
  const household = calculatePointsForDate(habits, date, undefined, submissionTotals);
  const byMember: Record<string, number> = {};
  let attributed = 0;
  for (const memberId of memberIds) {
    const points = calculateMemberPointsForDate(habits, memberId, date, today);
    byMember[memberId] = points;
    attributed += points;
  }
  return { household, byMember, unattributed: household - attributed };
};

// ---------------------------------------------------------------------------
// Corrective / rollover recompute
// ---------------------------------------------------------------------------

/** One member's recomputed daily/weekly points. */
export interface MemberPointsReset {
  memberUid: string;
  daily: number;
  weekly: number;
}

/**
 * Recompute every member's daily/weekly points from BOTH per-member sources:
 *
 *   1. the chores assigned to them (Plan 080c — unchanged, `assignedTo`-scoped),
 *   2. their attributed share of shared habits (this feature).
 *
 * Supersedes `computeManagedMemberPointsReset`, which only knew source (1) and
 * only for managed kids. A member with neither source is omitted entirely, so a
 * household with no attribution and no chores produces ZERO member writes — the
 * transition-day no-op.
 *
 * `total` is deliberately omitted: it is a lifetime counter and never rolls over.
 *
 * @param members - the household members to score
 * @param habits - all habits
 * @param weekStartStr - Monday of the current week (yyyy-MM-dd)
 * @param today - today (yyyy-MM-dd), caller's local timezone
 * @param submissionTotals - optional stored submissions covering `weekStart..today`
 *   (applies to the assigned-chore half, which is scored by the household scorer)
 */
export const computeMemberPointsReset = (
  members: Pick<HouseholdMember, 'uid'>[],
  habits: Habit[],
  weekStartStr: string,
  today: string,
  submissionTotals?: SubmissionTotalsByHabitDate,
): MemberPointsReset[] => {
  const out: MemberPointsReset[] = [];
  for (const member of members) {
    const hasChores = habits.some(h => h.assignedTo === member.uid);
    const hasAttribution = habits.some(
      h => habitFeedsMemberAttribution(h) && memberCompletionDates(h, member.uid).length > 0,
    );
    if (!hasChores && !hasAttribution) continue;

    const choreDaily = hasChores
      ? calculatePointsForDate(habits, today, member.uid, submissionTotals)
      : 0;
    const choreWeekly = hasChores
      ? calculatePointsForDateRange(habits, weekStartStr, today, member.uid, submissionTotals)
      : 0;

    out.push({
      memberUid: member.uid,
      daily: choreDaily + calculateMemberPointsForDate(habits, member.uid, today, today),
      weekly:
        choreWeekly +
        calculateMemberPointsForDateRange(habits, member.uid, weekStartStr, today, today),
    });
  }
  return out;
};

/** A member whose stored daily/weekly drifted from the recomputed truth. */
export interface MemberPointsSyncUpdate extends MemberPointsReset {
  /** Today (yyyy-MM-dd) for stamping this member's reset markers. */
  today: string;
}

/**
 * Corrective per-member points sync — the member twin of
 * `computeHouseholdPointsSync`. Returns ONLY the members whose stored
 * daily/weekly differ from the recompute, so an idle tick writes nothing.
 */
export const computeMemberPointsSync = (
  members: Pick<HouseholdMember, 'uid' | 'points'>[],
  habits: Habit[],
  now: Date,
  submissionTotals?: SubmissionTotalsByHabitDate,
): MemberPointsSyncUpdate[] => {
  const today = format(now, 'yyyy-MM-dd');
  const weekStartStr = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const recomputed = computeMemberPointsReset(members, habits, weekStartStr, today, submissionTotals);

  const stored = new Map(members.map(m => [m.uid, m.points]));
  return recomputed
    .filter(r => {
      const current = stored.get(r.memberUid);
      return !current || current.daily !== r.daily || current.weekly !== r.weekly;
    })
    .map(r => ({ ...r, today }));
};

// ---------------------------------------------------------------------------
// Reversal helper (reset / clear-day paths)
// ---------------------------------------------------------------------------

/** Signed points buckets to APPLY (already negated) plus the paths to clear. */
export interface AttributionReversal {
  /** memberUid → the deltas to apply to that member's points. */
  perMember: Map<string, { daily: number; weekly: number; total: number }>;
  /** Dot paths to `deleteField()` — one per cleared date. */
  clearPaths: string[];
}

/**
 * Reverse ALL attribution on the given dates: what each credited member loses,
 * bucket-gated by the DATE being cleared (total always, weekly only inside the
 * current Monday-anchored week, daily only for today) — the same gating
 * `deleteHabitSubmission` / `resetHabitDay` already use for the household.
 */
export const attributionReversalForDates = (
  habit: Habit,
  dates: string[],
  today: string = getLocalDateString(),
): AttributionReversal => {
  const perMember = new Map<string, { daily: number; weekly: number; total: number }>();
  const clearPaths: string[] = [];
  if (dates.length === 0 || !habit.completedBy) return { perMember, clearPaths };

  const weekStart = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const clearable = dates.filter(date => habit.completedBy?.[date] !== undefined);
  if (clearable.length === 0) return { perMember, clearPaths };

  // Clear one date at a time and score the delta each removal actually causes,
  // so every reversal is bucket-gated by ITS OWN date. (Scoring all dates at
  // once would have to pick a single date to gate the whole reversal by, which
  // is wrong the moment a cleared range straddles today or a week boundary.)
  let current = habit;
  for (const date of clearable) {
    clearPaths.push(completedByDatePath(date));
    const next = withDatesUnattributed(current, [date]);
    for (const memberId of memberIdsOnDate(current, date)) {
      const delta = memberPeriodPointsDelta(current, next, memberId, date, today);
      if (delta !== 0) {
        const bucket = perMember.get(memberId) ?? { daily: 0, weekly: 0, total: 0 };
        bucket.total += delta;
        if (date >= weekStart && date <= today) bucket.weekly += delta;
        if (date === today) bucket.daily += delta;
        perMember.set(memberId, bucket);
      }
    }
    current = next;
  }

  return { perMember, clearPaths };
};
