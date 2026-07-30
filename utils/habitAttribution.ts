/**
 * Per-member habit points — the attribution layer AND the household scorer it
 * now drives (stages 1 and 1.5).
 *
 * This module is the SINGLE source of truth for everything derived from
 * `Habit.completedBy` (per-date, per-member completion counts).
 *
 * The two layers and how they relate
 * ----------------------------------
 *   household(date) = Σ_members memberPoints(m, date) + unattributed(date)
 *
 * Stage 1 shipped the right-hand side while the household figure was still the
 * unchanged habit-level scorer, so `unattributed` was a mere bookkeeping
 * remainder. **Stage 1.5 makes that equation the definition**: the household
 * daily/weekly figures — and the pool delta every mutation writes — are now
 * PRODUCED by summing the member awards and adding the unattributed remainder,
 * rather than by applying the habit-level streak multiplier. That is the locked
 * competition model (handoff §1): each credited member earns a full award at
 * THEIR OWN prospective streak multiplier, and the household receives the sum,
 * so a habit both members complete pays the household twice.
 *
 * `unattributed` is the grandfathering term: every completion recorded before
 * this feature shipped has no `completedBy` entry, so it contributes to the
 * household number at the LEGACY habit-level multiplier and to NOBODY's member
 * score. Pre-feature history therefore keeps counting for the household exactly
 * as it always did, while every new completion is scored per member.
 *
 * The habit-level streak (`Habit.streakDays`, the flame) is untouched — only
 * points CREDITING moved to member multipliers.
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
  streakEndingOnForHabit,
  streakEndingOnWeek,
  type DaySubmissionTotals,
  type HouseholdPoints,
  type PointsSyncResult,
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
 * Signed points a habit contributes across the whole period containing `date`
 * under the LEGACY (pre-competition) household scorer — the habit-level streak
 * multiplier applied to `completedDates`, with no member awareness at all.
 *
 * Still the correct figure for an ASSIGNED chore (Plan 080c), whose points route
 * to the assignee's own member doc and are deliberately untouched by the
 * competition flip. Shared habits use `householdPeriodPoints` below.
 */
export const legacyPeriodPoints = (
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

// ---------------------------------------------------------------------------
// The unattributed (grandfathering) remainder
// ---------------------------------------------------------------------------

/** Does ANY member hold attribution anywhere in the period containing `date`? */
export const periodHasAttribution = (habit: Habit, date: string): boolean => {
  const periodStart = habitPeriodStart(habit.period, date);
  for (const [d, day] of Object.entries(habit.completedBy ?? {})) {
    if (habitPeriodStart(habit.period, d) !== periodStart) continue;
    for (const count of Object.values(day)) if (count > 0) return true;
  }
  return false;
};

/** Every member uid holding attribution in the period containing `date`. */
const periodMemberIds = (habit: Habit, date: string): string[] => {
  const periodStart = habitPeriodStart(habit.period, date);
  const out = new Set<string>();
  for (const [d, day] of Object.entries(habit.completedBy ?? {})) {
    if (habitPeriodStart(habit.period, d) !== periodStart) continue;
    for (const [uid, count] of Object.entries(day)) if (count > 0) out.add(uid);
  }
  return [...out];
};

/** Attributed units summed across the whole period containing `date`. */
const attributedUnitsInPeriod = (habit: Habit, date: string): number => {
  const periodStart = habitPeriodStart(habit.period, date);
  let units = 0;
  for (const d of Object.keys(habit.completedBy ?? {})) {
    if (habitPeriodStart(habit.period, d) !== periodStart) continue;
    units += attributedUnitsOnDate(habit, d);
  }
  return units;
};

/**
 * The SIGNED points-per-unit the legacy habit-level scorer applies on `date` —
 * `pointsForHabitOnDate`'s own `sign × floor(magnitude × multiplier)`, computed
 * from the habit's streak ENDING ON that date (never today's streak).
 */
const legacyPerUnitPoints = (habit: Habit, date: string): number =>
  habitSign(habit) *
  Math.floor(
    habitPointsMagnitude(habit) *
      getMultiplier(streakEndingOnForHabit(habit, date), habit.type === 'positive', habit.period),
  );

/**
 * How many of the units the LEGACY scorer counted on `date` belong to nobody.
 *
 * Daily habits compare per date, because that IS the period. Weekly habits
 * compare at WEEK level and park the whole remainder on the same day the legacy
 * scorer parks its own remainder (the week's latest completed day): a weekly
 * habit's `count` accumulates across the week and `pointsForHabitOnDate` splits
 * it "one per completed day, the rest on the latest", which a naive per-day
 * comparison would both over- and under-shoot on the same week (the per-day
 * errors do NOT cancel once the max(…, 0) floor bites). Comparing per week makes
 * the days sum to the week's truth.
 */
const unattributedUnitsOnDate = (habit: Habit, date: string, today: string): number => {
  if (habit.period === 'weekly') {
    const periodStart = habitPeriodStart('weekly', date);
    const sameWeek = habit.completedDates.filter(
      d => habitPeriodStart('weekly', d) === periodStart,
    );
    if (sameWeek.length === 0) return 0;
    const latest = sameWeek.reduce((a, b) => (a > b ? a : b));
    if (date !== latest) return 0;
    // Current week: the live counter covers every completion made this week.
    // Past weeks: no per-week counters are stored, so one completion (matching
    // `pointsForHabitOnDate` / `calculatePointsForDateRange`).
    const weekUnits = periodStart === habitPeriodStart('weekly', today) ? habit.count : 1;
    return Math.max(weekUnits - attributedUnitsInPeriod(habit, date), 0);
  }
  const dayUnits = date === today ? habit.count : 1;
  return Math.max(dayUnits - attributedUnitsOnDate(habit, date), 0);
};

/**
 * Signed household points on `date` that belong to NOBODY — the grandfathering
 * term of `household = Σ members + unattributed`.
 *
 * Three cases, in order:
 *
 *  1. **Nothing in the period is attributed** → the legacy figure stands
 *     VERBATIM, submissions reconciliation and all. This is the case that
 *     matters: every completion recorded before this feature shipped keeps
 *     counting for the household at exactly the points it always earned.
 *  2. **Threshold with attribution in the period** → 0. The period earns ONE
 *     award and the credited member(s) now carry it (each at their own
 *     multiplier — which is how two members on the same threshold day pay the
 *     household twice).
 *  3. **Incremental with attribution** → the units nobody holds, at the legacy
 *     per-unit rate. That is what keeps a TRANSITION day whole: two pre-feature
 *     increments plus one freshly attributed tap scores two legacy units plus
 *     one member award, and the running pool and the recompute agree.
 *
 * KNOWN NARROWING (case 3 only): once a date carries attribution, its stored
 * submissions are scored by units rather than by their recorded `pointsEarned`.
 * A submission written AFTER this feature carries attribution itself and is
 * covered by the member award; the narrowing therefore only reaches a
 * pre-feature submission on a date that later gained a tap.
 */
export const unattributedPointsForHabitOnDate = (
  habit: Habit,
  date: string,
  today: string = getLocalDateString(),
  storedByDate?: Map<string, DaySubmissionTotals>,
): number => {
  const legacy = pointsForHabitOnDate(habit, date, today, storedByDate);
  if (!periodHasAttribution(habit, date)) return legacy;
  if (legacy === 0) return 0;
  if (habit.scoringType === 'threshold') return 0;
  const perUnit = legacyPerUnitPoints(habit, date);
  if (perUnit === 0) return 0;
  return unattributedUnitsOnDate(habit, date, today) * perUnit;
};

/** Unattributed points across the whole period containing `date`. */
export const unattributedPeriodPoints = (
  habit: Habit,
  date: string,
  today: string = getLocalDateString(),
): number => {
  const periodStart = habitPeriodStart(habit.period, date);
  let total = 0;
  for (const d of new Set(habit.completedDates)) {
    if (habitPeriodStart(habit.period, d) !== periodStart) continue;
    total += unattributedPointsForHabitOnDate(habit, d, today);
  }
  return total;
};

// ---------------------------------------------------------------------------
// The household figure — Σ member awards + the unattributed remainder
// ---------------------------------------------------------------------------

/**
 * Signed HOUSEHOLD points one habit contributed on ONE date, under the locked
 * competition model: every member credited on that date earns a full award at
 * their OWN streak multiplier, and whatever the legacy scorer counted that
 * nobody holds is added on top.
 *
 * Only members attributed ON `date` are summed — `memberPointsForHabitOnDate`
 * is zero for anyone else, and a threshold period's award lands on the member's
 * own first attributed day, so no award is missed and none is counted twice.
 */
export const householdPointsForHabitOnDate = (
  habit: Habit,
  date: string,
  today: string = getLocalDateString(),
  storedByDate?: Map<string, DaySubmissionTotals>,
): number => {
  let total = unattributedPointsForHabitOnDate(habit, date, today, storedByDate);
  for (const memberId of memberIdsOnDate(habit, date)) {
    total += memberPointsForHabitOnDate(habit, memberId, date, today);
  }
  return total;
};

/**
 * Signed HOUSEHOLD points a habit contributes across the whole period
 * containing `date` — `Σ_m memberPeriodPoints(m) + unattributedPeriodPoints`.
 *
 * Every pool-writing mutation takes a before/after difference of this, so the
 * pool delta is by construction whatever the corrective recompute would derive:
 * no login-time correction jump. Assigned chores do NOT come through here (see
 * `legacyPeriodPoints`).
 */
export const householdPeriodPoints = (
  habit: Habit,
  date: string,
  today: string = getLocalDateString(),
): number => {
  let total = unattributedPeriodPoints(habit, date, today);
  for (const memberId of periodMemberIds(habit, date)) {
    total += memberPeriodPoints(habit, memberId, date, today);
  }
  return total;
};

/**
 * The signed pool delta a habit going from `before` to `after` around `date`
 * should write — the household twin of `memberPeriodPointsDelta`.
 */
export const householdPeriodPointsDelta = (
  before: Habit,
  after: Habit,
  date: string,
  today: string = getLocalDateString(),
): number =>
  householdPeriodPoints(after, date, today) - householdPeriodPoints(before, date, today);

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
// Household recompute (the corrective / rollover scorers)
// ---------------------------------------------------------------------------

/**
 * Every date inside `[startDate, endDate]` on which `habit` could contribute.
 *
 * The union of its completion dates, its ATTRIBUTED dates (a threshold period
 * below target carries attribution without entering `completedDates`, and its
 * award lands on the member's first attributed day once the period completes)
 * and any dates carrying stored submissions (which can outlive a completion).
 */
const scoredDatesInRange = (
  habit: Habit,
  startDate: string,
  endDate: string,
  storedByDate?: Map<string, DaySubmissionTotals>,
): string[] => {
  const dates = new Set<string>();
  for (const d of habit.completedDates) if (d >= startDate && d <= endDate) dates.add(d);
  for (const d of Object.keys(habit.completedBy ?? {})) {
    if (d >= startDate && d <= endDate && attributedUnitsOnDate(habit, d) > 0) dates.add(d);
  }
  if (storedByDate) {
    for (const d of storedByDate.keys()) if (d >= startDate && d <= endDate) dates.add(d);
  }
  return [...dates];
};

/**
 * Household points for ONE date under the competition model — the replacement
 * for `calculatePointsForDate` on the shared pool.
 *
 * Assigned chores are skipped for the same reason `calculatePointsForDate`
 * skips them by default: their points belong to the assignee's own balance and
 * counting them here would double-credit.
 */
export const calculateHouseholdPointsForDate = (
  habits: Habit[],
  date: string,
  today: string = getLocalDateString(),
  submissionTotals?: SubmissionTotalsByHabitDate,
): number => {
  let total = 0;
  for (const habit of habits) {
    if (habit.assignedTo) continue;
    total += householdPointsForHabitOnDate(habit, date, today, submissionTotals?.get(habit.id));
  }
  return total;
};

/**
 * Household points across an inclusive date range under the competition model —
 * the replacement for `calculatePointsForDateRange` on the shared pool.
 *
 * Scored one date at a time rather than by the legacy per-ISO-week collapse.
 * The two agree for un-attributed data (`pointsForHabitOnDate` already spreads a
 * weekly habit's single award across the week so the per-date figures sum to the
 * week's total — the invariant `calculatePointsForDateRange`'s own
 * submission-aware branch relies on), and per-date is the only granularity at
 * which attribution can be read. Callers pass Monday-anchored `weekStart..today`
 * windows, so no ISO week is ever clipped.
 */
export const calculateHouseholdPointsForDateRange = (
  habits: Habit[],
  startDate: string,
  endDate: string,
  today: string = getLocalDateString(),
  submissionTotals?: SubmissionTotalsByHabitDate,
): number => {
  let total = 0;
  for (const habit of habits) {
    if (habit.assignedTo) continue;
    const storedByDate = submissionTotals?.get(habit.id);
    for (const date of scoredDatesInRange(habit, startDate, endDate, storedByDate)) {
      total += householdPointsForHabitOnDate(habit, date, today, storedByDate);
    }
  }
  return total;
};

/**
 * Pure recompute of the corrective household-points sync.
 *
 * Derives the canonical daily and weekly totals from actual habit completions —
 * now as `Σ member awards + unattributed remainder` — then decides the
 * cumulative total:
 *   - if every completion falls within the current week (and at least one
 *     completion exists), the total equals the weekly total;
 *   - otherwise the total is the larger of the stored total and the weekly
 *     total, so an existing cumulative total is never clamped downward.
 *
 * Lives here rather than in habitLogic.ts because the competition model is
 * defined by attribution: there is deliberately ONE household sync function, so
 * no call site can accidentally keep the pre-flip habit-level scorer.
 *
 * @param habits - All habits to score
 * @param currentPoints - The points currently stored on the household doc
 * @param now - "Now" (injected for deterministic tests)
 * @param submissionTotals - Optional stored submissions covering `weekStart..today`
 * @returns The corrected points plus whether they differ from `currentPoints`
 */
export const computeHouseholdPointsSync = (
  habits: Habit[],
  currentPoints: HouseholdPoints,
  now: Date,
  submissionTotals?: SubmissionTotalsByHabitDate,
): PointsSyncResult => {
  const today = format(now, 'yyyy-MM-dd');
  const weekStartStr = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const correctDaily = calculateHouseholdPointsForDate(habits, today, today, submissionTotals);
  const correctWeekly = calculateHouseholdPointsForDateRange(
    habits,
    weekStartStr,
    today,
    today,
    submissionTotals,
  );

  // If every completion is within the current week, the cumulative total equals
  // the weekly total; otherwise keep the stored total (don't clamp it down).
  const allDatesThisWeek = habits.every(habit =>
    habit.completedDates.every(date => date >= weekStartStr),
  );
  const correctTotal =
    allDatesThisWeek && habits.some(h => h.completedDates.length > 0)
      ? correctWeekly
      : Math.max(currentPoints.total, correctWeekly);

  const points: HouseholdPoints = {
    daily: correctDaily,
    weekly: correctWeekly,
    total: correctTotal,
  };

  const needsUpdate =
    currentPoints.daily !== correctDaily ||
    currentPoints.weekly !== correctWeekly ||
    currentPoints.total !== correctTotal;

  return { points, needsUpdate };
};

// ---------------------------------------------------------------------------
// Household ↔ member decomposition (the grandfathering invariant)
// ---------------------------------------------------------------------------

/** How one date's household points split across members plus the legacy remainder. */
export interface PointsDecomposition {
  /** The household figure: `Σ byMember + unattributed`, by construction. */
  household: number;
  /** Per-member attributed points, keyed by member uid. */
  byMember: Record<string, number>;
  /**
   * The grandfathering remainder — what the LEGACY habit-level scorer counted
   * that no member holds. Pre-feature completions land here and are attributed
   * to nobody; on the day this feature shipped the whole household figure IS the
   * remainder and every member score is 0.
   */
  unattributed: number;
  /**
   * What the pre-competition household scorer would have produced for this date.
   * Kept for parity assertions and diagnostics — it equals `household` for
   * fully-grandfathered data and diverges the moment attribution exists (which
   * is the visible consequence of the flip, not a bug).
   */
  legacy: number;
}

/**
 * Decompose one date's household points into per-member shares plus the
 * unattributed remainder.
 *
 * `household = Σ byMember + unattributed` holds whenever `memberIds` covers
 * every member with attribution on `date` — pass the full roster.
 *
 * NOTE: `today` parameterises everything except `legacy`;
 * `calculatePointsForDate` reads the local date itself (it takes no `today`).
 * In the app the two are the same value; in a test, inject a `today` that
 * matches the date under test.
 */
export const decomposeDayPoints = (
  habits: Habit[],
  memberIds: string[],
  date: string,
  submissionTotals?: SubmissionTotalsByHabitDate,
  today: string = getLocalDateString(),
): PointsDecomposition => {
  const byMember: Record<string, number> = {};
  for (const memberId of memberIds) {
    byMember[memberId] = calculateMemberPointsForDate(habits, memberId, date, today);
  }
  let unattributed = 0;
  for (const habit of habits) {
    if (habit.assignedTo) continue;
    unattributed += unattributedPointsForHabitOnDate(
      habit,
      date,
      today,
      submissionTotals?.get(habit.id),
    );
  }
  return {
    household: calculateHouseholdPointsForDate(habits, date, today, submissionTotals),
    byMember,
    unattributed,
    legacy: calculatePointsForDate(habits, date, undefined, submissionTotals),
  };
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

/** The daily/weekly/total triple a points write moves. */
export interface PointsBuckets {
  daily: number;
  weekly: number;
  total: number;
}

/** Signed points buckets to APPLY (already negated) plus the paths to clear. */
export interface AttributionReversal {
  /** memberUid → the deltas to apply to that member's points. */
  perMember: Map<string, PointsBuckets>;
  /**
   * The POOL debit for the same clear: `Σ reversed member awards + the
   * unattributed remainder those dates carried`, bucket-gated per date.
   *
   * Covers EVERY date passed in, not just the attributed ones — a
   * fully-grandfathered date still has to leave the household figure, and it
   * leaves at exactly the legacy points the recompute credited it.
   */
  household: PointsBuckets;
  /** Dot paths to `deleteField()` — one per cleared date. */
  clearPaths: string[];
}

/**
 * Reverse ALL attribution on the given dates: what each credited member loses
 * and what the pool loses, bucket-gated by the DATE being cleared (total always,
 * weekly only inside the current Monday-anchored week, daily only for today) —
 * the same gating `deleteHabitSubmission` / `resetHabitDay` already use.
 *
 * The caller strips the same dates from `completedDates` in the SAME batch, so
 * each date's whole household contribution — member awards and remainder alike —
 * goes away: `household` is the negated `householdPointsForHabitOnDate` of every
 * date. Callers that must preserve a legacy figure exactly (an untouched,
 * fully-grandfathered reset) check `clearPaths.length === 0` and keep their own.
 */
export const attributionReversalForDates = (
  habit: Habit,
  dates: string[],
  today: string = getLocalDateString(),
): AttributionReversal => {
  const perMember = new Map<string, PointsBuckets>();
  const clearPaths: string[] = [];
  const household: PointsBuckets = { daily: 0, weekly: 0, total: 0 };
  // Deduplicated (order-preserving): a repeated date would otherwise debit the
  // pool twice for one clear.
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 0) return { perMember, household, clearPaths };

  const weekStart = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  // Clear one date at a time and score the delta each removal actually causes,
  // so every reversal is bucket-gated by ITS OWN date. (Scoring all dates at
  // once would have to pick a single date to gate the whole reversal by, which
  // is wrong the moment a cleared range straddles today or a week boundary.)
  let current = habit;
  for (const date of uniqueDates) {
    const earned = householdPointsForHabitOnDate(current, date, today);
    if (earned !== 0) {
      household.total -= earned;
      if (date >= weekStart && date <= today) household.weekly -= earned;
      if (date === today) household.daily -= earned;
    }

    if (current.completedBy?.[date] === undefined) continue;
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

  return { perMember, household, clearPaths };
};
