/**
 * Weekly-recap numeric assembly — the CLIENT-canonical copy (CORE-1).
 *
 * Pure, Firestore-free, React-free assembly of every numeric field on a
 * `WeeklyRecap`: the money half (spend totals, category deltas, upcoming bills),
 * the habit half (completions, streaks at risk) and the ceremony half
 * (per-member facts, the Monday-first day series, the household totals).
 *
 * 🛡️ TWO COPIES, PINNED BY A TEST. `functions/` is a separate pnpm package and
 * its `tsconfig` sets `rootDir: "src"`, so server SOURCE structurally cannot
 * import `@/…`. The server therefore keeps its own copy in
 * `functions/src/recap/dataAssembly.ts` + `functions/src/recap/memberFacts.ts`,
 * and this module is a faithful port of it — same inputs, same field names, same
 * output values, bug-for-bug. What keeps them honest is not a comment but
 * `functions/src/recap/parity.test.ts`, which imports BOTH (functions TESTS run
 * under the root vitest config, where the `@/` alias resolves) and asserts they
 * agree across a shared fixture table. Change one side and that test fails
 * instead of a household's ceremony quietly disagreeing with its own recap doc.
 *
 * The streak/multiplier primitives themselves ARE shared here — this module
 * composes `utils/habitLogic.ts` (whose bodies `functions/src/quickAdd/
 * streakLogic.ts` mirrors verbatim), and sums money through `utils/money.ts`
 * rather than re-implementing cent arithmetic.
 *
 * 🛡️ CLOSED PERIODS ONLY. Every date scored here is strictly in the past
 * relative to generation (the recap week ended before the run), so the live
 * `Habit.count` — which only ever describes the CURRENT period and is zeroed by
 * each reset — is deliberately never consulted. A past period's presence in
 * `completedDates` already proves its target was met. Do not reuse these helpers
 * to score today; `utils/habitAttribution.ts` is the scorer for live periods.
 *
 * The scoring rules mirror `utils/habitAttribution.ts`:
 *
 *     household(date) = Σ_members memberSharedPoints(m, date) + unattributed(date)
 *
 * where `unattributed` is the grandfathering term — completions recorded before
 * the attribution layer shipped belong to nobody but still happened, so they stay
 * visible as their own series rather than deleting a household's history from its
 * own recap.
 *
 * 🛡️ ASSIGNED CHORES ARE PERSONAL, NEVER HOUSEHOLD. An `assignedTo` habit
 * credits the assignee's OWN member doc and is excluded from the household pool
 * everywhere else in this codebase, so:
 *
 *   - `buildDailyPoints` (the household series, `totalPoints`, `priorWeekPoints`,
 *     the deck's "together" figure) sums only SHARED-habit attribution plus the
 *     unattributed remainder — `memberSharedPointsOnDate`;
 *   - a member's OWN `RecapMemberFacts.points` is their full personal figure,
 *     chores included — `memberPointsOnDate`.
 *
 * So `Σ memberFacts[].points ≠ totalPoints` in a household with chores, and that
 * is deliberate.
 *
 * 🛡️ TWO DECOMPOSITIONS, BOTH ADDITIVE (RECAP-MATH). `totalSpend` and
 * `unattributed` each kept their exact meaning and gained a sibling breakdown:
 *
 *   - `billsSpend + dayToDaySpend === totalSpend` — bills (the calendar-bill
 *     sentinel) split out from discretionary spending, because a heavy bill week
 *     otherwise reads as a 3x day-to-day blowout. `totalSpend` itself is now
 *     correct too: the `Credit Card` ACCOUNT-ROUTING sentinel is excluded, as it
 *     always has been in `utils/bucketSpentCalculator.ts`.
 *   - `unattributedSplit.householdCredit + .unclaimed === unattributed` —
 *     deliberate `creditMode: 'household'` credit split from genuinely unheld
 *     points, because "the household earned this together on purpose" and "we
 *     don't know who did this" were being reported as one number.
 *
 * Neither is computed by subtracting one displayed figure from another: each is
 * its own filter/partition over the same walk the parent figure came from.
 *
 * 🛡️ NO `points.weekly` ANYWHERE. Generation runs Monday morning, after the
 * client's midnight weekly rollover, so `HouseholdMember.points.weekly` describes
 * the BRAND-NEW week and structurally cannot describe the week being recapped.
 * `RecapMember` therefore carries no `points` field at all — there is no fallback
 * to fall back to.
 */
import {
  CREDIT_CARD_CATEGORY,
  INCOME_CATEGORY,
  type Habit,
  type HabitCompletedBy,
  type HabitFrozenDatesBy,
  type RecapDayPoints,
  type RecapMemberFacts,
  type RecapUnattributedSplit,
  type WeeklyRecap,
} from '@/types/schema';
import { isCalendarBudgetedCategory } from '@/utils/categories';
import { isHouseholdCreditHabit } from '@/utils/habitAttribution';
import {
  calculateStreak,
  calculateWeeklyStreak,
  effectiveFrozenDates,
  getMultiplier,
  habitPeriodStart,
  streakEndingOn,
  streakEndingOnWeek,
} from '@/utils/habitLogic';
import { subtractMoney, sumMoney } from '@/utils/money';

/** Convenience alias so callers don't need to reach into the schema type. */
type HabitPeriod = Habit['period'];

// ---------------------------------------------------------------------------
// Input shapes (deliberately narrower than the full schema types)
// ---------------------------------------------------------------------------

/**
 * The habit fields the ceremony scorer reads. Everything past `title` /
 * `completedDates` is OPTIONAL so the money-only assembly (and any partially
 * written habit doc) keeps working — each falls back to the value that makes the
 * habit score exactly as it did before attribution existed.
 */
export interface RecapScoringHabit {
  title: string;
  completedDates: string[];
  period?: HabitPeriod;
  type?: 'positive' | 'negative';
  basePoints?: number;
  scoringType?: 'incremental' | 'threshold';
  targetCount?: number;
  /** A permanently assigned chore credits its assignee, never the pool. */
  assignedTo?: string;
  /** date → memberId → completion count (see `Habit.completedBy`). */
  completedBy?: HabitCompletedBy;
  frozenDates?: string[];
  /** date → uids a per-member freeze was spent for (`freezeMode: 'per_member'`). */
  frozenDatesBy?: HabitFrozenDatesBy;
  pausedUntil?: string;
  /**
   * `'household'` ⇒ a completion deliberately credits the household and writes
   * NO `completedBy` entry. Absent reads as `'members'` (see `Habit.creditMode`),
   * which is why the unattributed split has no third "legacy" bucket.
   */
  creditMode?: Habit['creditMode'];
}

/** Minimal member shape the ceremony needs. */
export interface CeremonyMember {
  uid: string;
  displayName: string;
  /** A login-less managed kid profile — excluded from standings/podium. */
  isManaged?: boolean;
}

export interface CeremonyInput {
  habits: RecapScoringHabit[];
  members: CeremonyMember[];
  /** yyyy-MM-dd — the recap week's Monday (inclusive). */
  weekStart: string;
  /** yyyy-MM-dd — the recap week's Sunday (inclusive). */
  weekEnd: string;
}

export interface AssembledCeremony {
  memberFacts: RecapMemberFacts[];
  dailyPoints: RecapDayPoints[];
  totalPoints: number;
  /** Week totals of `dailyPoints[].unattributedSplit` (RECAP-MATH). */
  unattributedSplit: RecapUnattributedSplit;
}

/** Minimal transaction shape this module needs (subset of `Transaction`). */
export interface RecapTransaction {
  amount: number;
  category: string;
  date: string; // yyyy-MM-dd, local
  status: 'verified' | 'pending_review';
}

/**
 * Minimal habit shape the full assembly needs (subset of `Habit`).
 *
 * The scoring half is inherited from `RecapScoringHabit` and is entirely
 * OPTIONAL: the money/streak sections only ever read `title` / `completedDates` /
 * `streakDays`, so a habit carrying none of the ceremony fields assembles exactly
 * as it did before the ceremony shipped.
 */
export interface RecapHabit extends RecapScoringHabit {
  streakDays: number;
}

/**
 * Minimal member shape this module needs (subset of `HouseholdMember`).
 *
 * 🛡️ NO `points` FIELD, ON PURPOSE — see the module header.
 */
export interface RecapMember {
  uid: string;
  displayName: string;
  /** A login-less managed kid profile — excluded from standings/podium. */
  isManaged?: boolean;
}

/** Minimal calendar item shape this module needs (subset of `CalendarItem`). */
export interface RecapCalendarItem {
  title: string;
  amount: number;
  date: string; // yyyy-MM-dd
  type: 'income' | 'expense';
}

export interface DataAssemblyInput {
  /** All transactions covering at least the two weeks ending at `weekEnd`. */
  transactions: RecapTransaction[];
  habits: RecapHabit[];
  members: RecapMember[];
  /** Calendar items covering (at least) the 7 days following `weekEnd`. */
  calendarItems: RecapCalendarItem[];
  /** yyyy-MM-dd, local — the first day of the recap week (a Monday, inclusive). */
  weekStart: string;
  /** yyyy-MM-dd, local — the last day of the recap week (a Sunday, inclusive). */
  weekEnd: string;
}

export type AssembledRecap = Pick<
  WeeklyRecap,
  | 'totalSpend'
  | 'priorWeekSpend'
  | 'topCategoryDeltas'
  | 'habitCompletions'
  | 'streaksAtRisk'
  | 'pointsByMember'
  | 'upcomingBills'
> &
  Required<
    Pick<
      WeeklyRecap,
      | 'memberFacts'
      | 'dailyPoints'
      | 'totalPoints'
      | 'priorWeekPoints'
      | 'billsSpend'
      | 'priorWeekBillsSpend'
      | 'dayToDaySpend'
      | 'priorWeekDayToDaySpend'
      | 'unattributedSplit'
    >
  >;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Adds/subtracts whole days from a yyyy-MM-dd date string.
 *
 * Arithmetic is done in UTC so it can never be nudged by a DST transition in the
 * runtime's local zone — the strings are calendar days, not instants.
 */
export function shiftDay(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** The 7 yyyy-MM-dd dates of a recap week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(weekStart, i));
}

// ---------------------------------------------------------------------------
// Small habit accessors (each defaults to the pre-attribution behaviour)
// ---------------------------------------------------------------------------

const periodOf = (habit: RecapScoringHabit): HabitPeriod => habit.period ?? 'daily';
const isPositive = (habit: RecapScoringHabit): boolean => (habit.type ?? 'positive') === 'positive';
const signOf = (habit: RecapScoringHabit): 1 | -1 => (habit.type === 'negative' ? -1 : 1);
const magnitudeOf = (habit: RecapScoringHabit): number => Math.abs(habit.basePoints ?? 0);
const isIncremental = (habit: RecapScoringHabit): boolean => habit.scoringType === 'incremental';

/** Period-aware dispatch for the historical streak ending on `date`. */
const streakEndingOnForPeriod = (
  completedDates: string[],
  period: HabitPeriod,
  date: string,
  frozenDates: string[],
): number =>
  period === 'weekly'
    ? streakEndingOnWeek(completedDates, date, frozenDates)
    : streakEndingOn(completedDates, date, frozenDates);

/** Period-aware dispatch for the live streak as of `today`. */
const streakForPeriod = (
  dates: string[],
  period: HabitPeriod,
  today: string,
  frozenDates: string[],
): number =>
  period === 'weekly'
    ? calculateWeeklyStreak(dates, today, frozenDates)
    : calculateStreak(dates, today, frozenDates);

// ---------------------------------------------------------------------------
// Attribution readers (mirrors utils/habitAttribution.ts)
// ---------------------------------------------------------------------------

/**
 * How many completions `memberId` logged on `date`. Clamped at zero for the same
 * reason the client clamps: attribution is written as unconditional dot-path
 * increments in both directions, so a node can rest at (or dip below) zero and
 * `count <= 0` means ABSENT everywhere.
 */
export function memberUnitsOnDate(
  habit: RecapScoringHabit,
  memberId: string,
  date: string,
): number {
  return Math.max(0, habit.completedBy?.[date]?.[memberId] ?? 0);
}

/** Total attributed units on `date`, across every member. */
function attributedUnitsOnDate(habit: RecapScoringHabit, date: string): number {
  const day = habit.completedBy?.[date];
  if (!day) return 0;
  let sum = 0;
  for (const count of Object.values(day)) sum += count > 0 ? count : 0;
  return sum;
}

/** Attributed units summed across the whole period containing `date`. */
function attributedUnitsInPeriod(habit: RecapScoringHabit, date: string): number {
  const period = periodOf(habit);
  const start = habitPeriodStart(period, date);
  let units = 0;
  for (const d of Object.keys(habit.completedBy ?? {})) {
    if (habitPeriodStart(period, d) !== start) continue;
    units += attributedUnitsOnDate(habit, d);
  }
  return units;
}

/** Does ANY member hold attribution in the period containing `date`? */
function periodHasAttribution(habit: RecapScoringHabit, date: string): boolean {
  return attributedUnitsInPeriod(habit, date) > 0;
}

/**
 * The completion-date set a member's own streak walks over: their attributed
 * dates for a shared habit, or the habit's own dates for a chore assigned to them
 * (whose completions are theirs by definition, with no attribution needed).
 */
export function memberDatesFor(habit: RecapScoringHabit, memberId: string): string[] {
  if (habit.assignedTo) return habit.assignedTo === memberId ? [...habit.completedDates] : [];
  const out: string[] = [];
  for (const [date, day] of Object.entries(habit.completedBy ?? {})) {
    if ((day[memberId] ?? 0) > 0) out.push(date);
  }
  return out.sort();
}

/** The dates a PER-MEMBER freeze token was spent on for `memberId`. */
function memberFrozenDates(habit: RecapScoringHabit, memberId: string): string[] {
  const out: string[] = [];
  for (const [date, uids] of Object.entries(habit.frozenDatesBy ?? {})) {
    if (Array.isArray(uids) && uids.includes(memberId)) out.push(date);
  }
  return out;
}

/**
 * The bridging dates a streak walk uses — the habit's own freezes and planned
 * pause, plus (for a member walk) that member's own per-member freezes.
 */
function bridgeFor(
  habit: RecapScoringHabit,
  dates: string[],
  anchor: string,
  extraFrozen: string[] = [],
): string[] {
  return effectiveFrozenDates(
    {
      completedDates: dates,
      frozenDates: [...(habit.frozenDates ?? []), ...extraFrozen],
      pausedUntil: habit.pausedUntil,
    },
    anchor,
  );
}

// ---------------------------------------------------------------------------
// Per-unit rates
// ---------------------------------------------------------------------------

/** `sign × floor(|basePoints| × multiplier)` for a given streak. */
function perUnitAt(habit: RecapScoringHabit, streak: number): number {
  return (
    signOf(habit) *
    Math.floor(magnitudeOf(habit) * getMultiplier(streak, isPositive(habit), periodOf(habit)))
  );
}

/** The LEGACY (habit-level, member-blind) per-unit rate on `date`. */
function legacyPerUnit(habit: RecapScoringHabit, date: string, anchor: string): number {
  const streak = streakEndingOnForPeriod(
    habit.completedDates,
    periodOf(habit),
    date,
    bridgeFor(habit, habit.completedDates, anchor),
  );
  return perUnitAt(habit, streak);
}

/**
 * How many units the LEGACY scorer counts on `date` — always 0 or 1, because only
 * CLOSED periods are ever scored here (see the module header):
 *
 *  - daily: one unit per completed day;
 *  - weekly: the week's single unit, parked on the same day the client's
 *    `pointsForHabitOnDate` parks it — the week's LATEST completed day for an
 *    incremental habit, its FIRST for a threshold one — so summing the week's
 *    days reproduces the week's total exactly once.
 */
function legacyUnitsOnDate(habit: RecapScoringHabit, date: string): number {
  if (!habit.completedDates.includes(date)) return 0;
  if (periodOf(habit) !== 'weekly') return 1;

  const start = habitPeriodStart('weekly', date);
  const sameWeek = habit.completedDates.filter(d => habitPeriodStart('weekly', d) === start);
  if (sameWeek.length === 0) return 0;
  const anchorDay = isIncremental(habit)
    ? sameWeek.reduce((a, b) => (a > b ? a : b))
    : sameWeek.reduce((a, b) => (a < b ? a : b));
  return date === anchorDay ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Per-member points
// ---------------------------------------------------------------------------

/**
 * Signed points ONE member earned from ONE habit on ONE (closed) date.
 *
 * - **incremental** — points per attributed action, at the member's own
 *   historical multiplier.
 * - **threshold** — ONE award per period, credited to the member's FIRST
 *   attributed day in that period, and only when the period actually completed.
 *   Both members completing the same threshold habit each earn a full award — the
 *   locked competition model.
 */
export function memberAttributedPointsOnDate(
  habit: RecapScoringHabit,
  memberId: string,
  date: string,
  anchor: string,
): number {
  const units = memberUnitsOnDate(habit, memberId, date);
  if (units <= 0) return 0;

  const dates = memberDatesFor(habit, memberId);
  const streak = streakEndingOnForPeriod(
    dates,
    periodOf(habit),
    date,
    bridgeFor(habit, dates, anchor, memberFrozenDates(habit, memberId)),
  );
  const perUnit = perUnitAt(habit, streak);

  if (isIncremental(habit)) return units * perUnit;

  // Threshold: the period must actually have completed. Every date scored here is
  // in a CLOSED period, so its presence in `completedDates` is proof.
  const period = periodOf(habit);
  const start = habitPeriodStart(period, date);
  if (!habit.completedDates.some(d => habitPeriodStart(period, d) === start)) return 0;

  const samePeriod = dates.filter(d => habitPeriodStart(period, d) === start);
  if (samePeriod.length === 0) return 0;
  const firstInPeriod = samePeriod.reduce((a, b) => (a < b ? a : b));
  return date === firstInPeriod ? perUnit : 0;
}

/** Signed points a chore ASSIGNED to a member earned on one (closed) date. */
export function assignedChorePointsOnDate(
  habit: RecapScoringHabit,
  date: string,
  anchor: string,
): number {
  return legacyUnitsOnDate(habit, date) * legacyPerUnit(habit, date, anchor);
}

/**
 * Signed points that belong to NOBODY on `date` — the grandfathering term.
 *
 *  1. No attribution anywhere in the period → the legacy figure stands verbatim
 *     (pre-feature history keeps counting exactly as it always did).
 *  2. Threshold with attribution → 0: the period's one award now sits with the
 *     credited member(s).
 *  3. Incremental with attribution → the units nobody holds, at the legacy rate.
 */
export function unattributedPointsOnDate(
  habit: RecapScoringHabit,
  date: string,
  anchor: string,
): number {
  const baseUnits = legacyUnitsOnDate(habit, date);
  if (baseUnits === 0) return 0;
  const perUnit = legacyPerUnit(habit, date, anchor);
  if (perUnit === 0) return 0;
  if (!periodHasAttribution(habit, date)) return baseUnits * perUnit;
  if (!isIncremental(habit)) return 0;

  const held =
    periodOf(habit) === 'weekly'
      ? attributedUnitsInPeriod(habit, date)
      : attributedUnitsOnDate(habit, date);
  return Math.max(baseUnits - held, 0) * perUnit;
}

/**
 * Signed points `memberId` earned from SHARED (non-assigned) habits on one
 * (closed) date — the HOUSEHOLD-contributing half of their score.
 *
 * This is what the day series stacks, so `total = Σ byMember + unattributed`
 * describes the same pool `calculateHouseholdPointsForDate` does.
 */
export function memberSharedPointsOnDate(
  habits: RecapScoringHabit[],
  memberId: string,
  date: string,
  anchor: string,
): number {
  let total = 0;
  for (const habit of habits) {
    if (habit.assignedTo) continue;
    total += memberAttributedPointsOnDate(habit, memberId, date, anchor);
  }
  return total;
}

/** Signed points the chores ASSIGNED to `memberId` earned on one (closed) date. */
export function memberChorePointsOnDate(
  habits: RecapScoringHabit[],
  memberId: string,
  date: string,
  anchor: string,
): number {
  let total = 0;
  for (const habit of habits) {
    if (habit.assignedTo === memberId) total += assignedChorePointsOnDate(habit, date, anchor);
  }
  return total;
}

/**
 * A member's OWN signed score for one (closed) date: their shared-habit
 * attribution PLUS the chores assigned to them.
 *
 * The personal figure, never the household one — see the module header's
 * assigned-chore rule.
 */
export function memberPointsOnDate(
  habits: RecapScoringHabit[],
  memberId: string,
  date: string,
  anchor: string,
): number {
  return (
    memberSharedPointsOnDate(habits, memberId, date, anchor) +
    memberChorePointsOnDate(habits, memberId, date, anchor)
  );
}

/**
 * WHY one date's unattributed points belong to nobody (RECAP-MATH).
 *
 * 🛡️ ONE WALK, PARTITIONED — not two scorers and not a subtraction. Every
 * habit's `unattributedPointsOnDate` lands in exactly one bucket, so
 * `householdCredit + unclaimed` reproduces `unattributedPointsForDate` exactly,
 * and the split can never disagree with the figure it explains.
 *
 * `isHouseholdCreditHabit` is the SAME predicate the client's attribution layer
 * uses (`utils/habitAttribution.ts`) — household credit is not a second scoring
 * path, just a reason the existing unattributed path was taken on purpose.
 */
export function unattributedSplitForDate(
  habits: RecapScoringHabit[],
  date: string,
  anchor: string,
): RecapUnattributedSplit {
  let householdCredit = 0;
  let unclaimed = 0;
  for (const habit of habits) {
    if (habit.assignedTo) continue;
    const points = unattributedPointsOnDate(habit, date, anchor);
    if (points === 0) continue;
    if (isHouseholdCreditHabit(habit)) householdCredit += points;
    else unclaimed += points;
  }
  return { householdCredit, unclaimed };
}

/** Σ of a week's per-day splits — the `AssembledCeremony` week total. */
function sumUnattributedSplits(days: RecapDayPoints[]): RecapUnattributedSplit {
  let householdCredit = 0;
  let unclaimed = 0;
  for (const day of days) {
    householdCredit += day.unattributedSplit?.householdCredit ?? 0;
    unclaimed += day.unattributedSplit?.unclaimed ?? 0;
  }
  return { householdCredit, unclaimed };
}

// ---------------------------------------------------------------------------
// The 7-day series
// ---------------------------------------------------------------------------

/**
 * The Monday-first, member-stacked day series for a closed week.
 *
 * `total = Σ byMember + unattributed` by construction, and that total IS the
 * household figure — so `byMember` carries each member's SHARED-habit share only.
 * A chore assigned to someone credits their own member doc, never the household
 * pool, and so appears in neither this map nor the day's total (it still lands in
 * that member's `RecapMemberFacts.points`). Members who scored nothing on a day
 * are omitted from that day's map, so an untouched week produces seven all-zero
 * rows rather than a dense matrix of zeroes.
 */
export function buildDailyPoints(
  habits: RecapScoringHabit[],
  members: CeremonyMember[],
  weekStart: string,
  anchor: string,
): RecapDayPoints[] {
  return weekDates(weekStart).map(date => {
    const byMember: Record<string, number> = {};
    let memberSum = 0;
    for (const member of members) {
      const points = memberSharedPointsOnDate(habits, member.uid, date, anchor);
      if (points !== 0) {
        byMember[member.uid] = points;
        memberSum += points;
      }
    }
    // ONE walk: the split IS the source of the day's `unattributed` figure, so
    // the two cannot drift apart (RECAP-MATH).
    const unattributedSplit = unattributedSplitForDate(habits, date, anchor);
    const unattributed = unattributedSplit.householdCredit + unattributedSplit.unclaimed;
    return { date, byMember, unattributed, total: memberSum + unattributed, unattributedSplit };
  });
}

/** Signed household points across a closed week — `Σ dailyPoints[].total`. */
export function weekPointsTotal(
  habits: RecapScoringHabit[],
  members: CeremonyMember[],
  weekStart: string,
  anchor: string,
): number {
  return buildDailyPoints(habits, members, weekStart, anchor).reduce((sum, d) => sum + d.total, 0);
}

// ---------------------------------------------------------------------------
// Per-member facts
// ---------------------------------------------------------------------------

/** Attributed completion UNITS a member logged over the week. */
function memberCompletionsInWeek(
  habits: RecapScoringHabit[],
  memberId: string,
  dates: string[],
): number {
  let units = 0;
  for (const habit of habits) {
    for (const date of dates) {
      if (habit.assignedTo) {
        if (habit.assignedTo === memberId && habit.completedDates.includes(date)) units += 1;
        continue;
      }
      units += memberUnitsOnDate(habit, memberId, date);
    }
  }
  return units;
}

/**
 * The member's longest LIVE streak as of the week's last day, in the owning
 * habit's own cadence. `null` when they have no live streak at all.
 */
function memberTopStreak(
  habits: RecapScoringHabit[],
  memberId: string,
  weekEnd: string,
): RecapMemberFacts['topStreak'] {
  let best: RecapMemberFacts['topStreak'] = null;
  for (const habit of habits) {
    const dates = memberDatesFor(habit, memberId);
    if (dates.length === 0) continue;
    const period = periodOf(habit);
    const days = streakForPeriod(
      dates,
      period,
      weekEnd,
      bridgeFor(habit, dates, weekEnd, memberFrozenDates(habit, memberId)),
    );
    if (days <= 0) continue;
    // Ties keep the FIRST habit in roster order, so the fact is stable across
    // regenerations rather than depending on object iteration luck.
    if (!best || days > best.days) best = { habitTitle: habit.title, days, period };
  }
  return best;
}

/**
 * Titles of DAILY habits the member completed on all 7 days of the week.
 *
 * Daily-only on purpose: this app has no per-habit day schedule, so "every
 * scheduled day" means every day for a daily habit — and a weekly habit is
 * trivially "perfect" the moment it is done once, which is not an achievement
 * worth a tile.
 */
function memberPerfectHabits(
  habits: RecapScoringHabit[],
  memberId: string,
  dates: string[],
): string[] {
  const out: string[] = [];
  for (const habit of habits) {
    if (periodOf(habit) !== 'daily') continue;
    const owned = new Set(memberDatesFor(habit, memberId));
    if (owned.size === 0) continue;
    if (dates.every(d => owned.has(d))) out.push(habit.title);
  }
  return out;
}

/**
 * Assemble every ceremony field for one closed week.
 *
 * The week's last day (`weekEnd`) is the anchor for every streak walk and pause
 * bridge, so the result depends only on the week being described — regenerating
 * the same week on a later day produces the same document.
 *
 * 🛡️ NO PER-MEMBER DATA ⇒ NO CEREMONY. When not one member holds a completion of
 * their own during the week — a household whose whole history predates the
 * attribution layer, or a genuinely idle week — `memberFacts` comes back EMPTY
 * rather than as a row of confident zeroes. `hasCeremonyData` then reads false and
 * the client renders its pre-deck layout, which is the honest answer: there is no
 * personal card and no head-to-head to draw. The household series (`dailyPoints` /
 * `totalPoints`) is still emitted in full — a grandfathered week's points live in
 * the `unattributed` series and are perfectly real.
 */
export function assembleCeremony(input: CeremonyInput): AssembledCeremony {
  const { habits, members, weekStart, weekEnd } = input;
  const dates = weekDates(weekStart);
  const dailyPoints = buildDailyPoints(habits, members, weekStart, weekEnd);

  const facts: RecapMemberFacts[] = members.map(member => {
    let points = 0;
    let bestDay: RecapMemberFacts['bestDay'] = null;
    for (const date of dates) {
      // The member's OWN score — deliberately NOT `dailyPoints[].byMember`, which
      // carries only the household-contributing (shared-habit) half. Chores
      // assigned to them count here and nowhere else.
      const dayPoints = memberPointsOnDate(habits, member.uid, date, weekEnd);
      points += dayPoints;
      if (dayPoints > 0 && (!bestDay || dayPoints > bestDay.points)) {
        bestDay = { date, points: dayPoints };
      }
    }
    return {
      memberId: member.uid,
      name: member.displayName,
      points,
      completions: memberCompletionsInWeek(habits, member.uid, dates),
      bestDay,
      topStreak: memberTopStreak(habits, member.uid, weekEnd),
      perfectHabits: memberPerfectHabits(habits, member.uid, dates),
      // Written only when true: Firestore rejects `undefined` field values, and an
      // absent flag already means "adult" to every consumer.
      ...(member.isManaged ? { isManaged: true } : {}),
    };
  });

  // "Completions" is the honest signal — attributed units plus assigned-chore
  // completions, i.e. every per-member source there is. Points alone would read a
  // member whose week netted exactly zero as having no data.
  const hasMemberData = facts.some(f => f.completions > 0);

  return {
    memberFacts: hasMemberData ? facts : [],
    dailyPoints,
    totalPoints: dailyPoints.reduce((sum, d) => sum + d.total, 0),
    unattributedSplit: sumUnattributedSplits(dailyPoints),
  };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Does this transaction count as spend at all?
 *
 * TWO sentinels are excluded, not one:
 *  - `INCOME_CATEGORY` — money in, obviously not spend;
 *  - `CREDIT_CARD_CATEGORY` — an ACCOUNT-ROUTING tag, not real spending. A
 *    transaction tagged to a credit account carries it instead of a bucket
 *    name, and `utils/bucketSpentCalculator.ts` has always excluded it from
 *    spend math. The recap did not, so a household's card activity inflated its
 *    weekly headline (RECAP-MATH: $220.89 of a real $2,649.89 week).
 *
 * Both matches are case-insensitive, matching the income check this function
 * already did — a hand-typed "credit card" is the same sentinel.
 */
function isCountedSpend(t: RecapTransaction, start: string, end: string): boolean {
  const category = t.category.toLowerCase();
  return (
    t.status === 'verified' &&
    category !== INCOME_CATEGORY.toLowerCase() &&
    category !== CREDIT_CARD_CATEGORY.toLowerCase() &&
    t.date >= start &&
    t.date <= end
  );
}

/**
 * Which slice of counted spend a sum covers (RECAP-MATH).
 *
 * `'bills'` and `'dayToDay'` PARTITION `'all'`: every counted transaction is in
 * exactly one of them, so `billsSpend + dayToDaySpend === totalSpend` holds by
 * construction rather than by a subtraction that could absorb drift.
 */
type SpendSlice = 'all' | 'bills' | 'dayToDay';

/**
 * Is this a paid calendar bill rather than day-to-day spending?
 *
 * Delegates to `utils/categories.ts`'s shared classifier, so it recognises both
 * the `Budgeted in Calendar` sentinel `payCalendarItem` files paid bills under
 * AND the legacy `Bills` tag older paid bills still carry.
 */
const inSlice = (t: RecapTransaction, slice: SpendSlice): boolean => {
  if (slice === 'all') return true;
  const isBill = isCalendarBudgetedCategory(t.category);
  return slice === 'bills' ? isBill : !isBill;
};

/**
 * Sums counted transaction amounts within [start, end] inclusive, restricted to
 * one spend slice. Summed in integer cents via `sumMoney`, returned as decimal
 * dollars.
 */
function sumSpend(
  transactions: RecapTransaction[],
  start: string,
  end: string,
  slice: SpendSlice,
): number {
  return sumMoney(
    transactions.filter(t => isCountedSpend(t, start, end) && inSlice(t, slice)).map(t => t.amount),
  );
}

/**
 * DAY-TO-DAY counted spend within [start, end], grouped by LOWERCASED category
 * so mixed casing ("Groceries" vs "groceries") can't split one category into two;
 * the first-seen casing is kept for display. Amounts are decimal dollars.
 *
 * Bills are excluded on purpose: `Budgeted in Calendar` is a routing sentinel,
 * not a category, and it out-swings every real category on any week carrying
 * rent — which made it the recap's #1 "category insight" (RECAP-MATH).
 */
function sumVerifiedSpendByCategory(
  transactions: RecapTransaction[],
  start: string,
  end: string,
): Map<string, { display: string; amount: number }> {
  const amountsByCategory = new Map<string, { display: string; amounts: number[] }>();
  for (const t of transactions) {
    if (!isCountedSpend(t, start, end) || !inSlice(t, 'dayToDay')) continue;
    const key = t.category.toLowerCase();
    const existing = amountsByCategory.get(key);
    if (existing) {
      existing.amounts.push(t.amount);
    } else {
      amountsByCategory.set(key, { display: t.category, amounts: [t.amount] });
    }
  }

  const out = new Map<string, { display: string; amount: number }>();
  for (const [key, { display, amounts }] of amountsByCategory) {
    out.set(key, { display, amount: sumMoney(amounts) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The full assembly
// ---------------------------------------------------------------------------

/**
 * Pure assembly of the numeric WeeklyRecap fields from plain arrays. No Firestore
 * access — callers fetch the data and add the
 * narrative/narrativeSource/premium/generatedAt/isoWeek fields.
 */
export function assembleWeeklyRecap(input: DataAssemblyInput): AssembledRecap {
  const { transactions, habits, members, calendarItems, weekStart, weekEnd } = input;

  const priorWeekStart = shiftDay(weekStart, -7);
  const priorWeekEnd = shiftDay(weekEnd, -7);

  const totalSpend = sumSpend(transactions, weekStart, weekEnd, 'all');
  const priorWeekSpend = sumSpend(transactions, priorWeekStart, priorWeekEnd, 'all');
  const billsSpend = sumSpend(transactions, weekStart, weekEnd, 'bills');
  const priorWeekBillsSpend = sumSpend(transactions, priorWeekStart, priorWeekEnd, 'bills');
  const dayToDaySpend = sumSpend(transactions, weekStart, weekEnd, 'dayToDay');
  const priorWeekDayToDaySpend = sumSpend(transactions, priorWeekStart, priorWeekEnd, 'dayToDay');

  const currentByCategory = sumVerifiedSpendByCategory(transactions, weekStart, weekEnd);
  const priorByCategory = sumVerifiedSpendByCategory(transactions, priorWeekStart, priorWeekEnd);

  const allCategories = new Set([...currentByCategory.keys(), ...priorByCategory.keys()]);
  const topCategoryDeltas = Array.from(allCategories)
    .map(key => {
      const currentEntry = currentByCategory.get(key);
      const priorEntry = priorByCategory.get(key);
      const current = currentEntry?.amount ?? 0;
      const prior = priorEntry?.amount ?? 0;
      return {
        category: currentEntry?.display ?? priorEntry?.display ?? key,
        current,
        prior,
        absDelta: Math.abs(subtractMoney(current, prior)),
      };
    })
    .filter(d => d.absDelta > 0)
    .sort((a, b) => b.absDelta - a.absDelta)
    .slice(0, 3)
    .map(({ category, current, prior }) => ({ category, current, prior }));

  const habitCompletions = habits.reduce(
    (sum, h) => sum + h.completedDates.filter(d => d >= weekStart && d <= weekEnd).length,
    0,
  );

  const streaksAtRisk = habits
    .filter(h => h.streakDays >= 3 && !h.completedDates.includes(weekEnd))
    .map(h => ({ habitTitle: h.title, streakDays: h.streakDays }));

  // --- Ceremony -----------------------------------------------------------
  // Every per-member figure is DERIVED from habit completions over the closed
  // week — attribution for shared habits plus each member's assigned chores.
  const ceremony = assembleCeremony({ habits, members, weekStart, weekEnd });
  const priorWeekPoints = weekPointsTotal(habits, members, priorWeekStart, priorWeekEnd);

  // ONE source, no fallback: `pointsByMember` is the same derivation the
  // ceremony's facts are, so the two can never disagree. `memberFacts` is empty
  // exactly when no member holds a completion for the week, and this list is then
  // empty too — an honest "nothing per-member to report" rather than a row of
  // zeroes that reads like a real, silent week.
  const pointsByMember = ceremony.memberFacts.map(f => ({
    memberId: f.memberId,
    name: f.name,
    points: f.points,
  }));

  const billsStart = shiftDay(weekEnd, 1);
  const billsEnd = shiftDay(weekEnd, 7);
  const upcomingBills = calendarItems
    .filter(c => c.type === 'expense' && c.date >= billsStart && c.date <= billsEnd)
    .map(c => ({ title: c.title, amount: c.amount, date: c.date }));

  return {
    totalSpend,
    priorWeekSpend,
    billsSpend,
    priorWeekBillsSpend,
    dayToDaySpend,
    priorWeekDayToDaySpend,
    topCategoryDeltas,
    habitCompletions,
    streaksAtRisk,
    pointsByMember,
    upcomingBills,
    memberFacts: ceremony.memberFacts,
    dailyPoints: ceremony.dailyPoints,
    totalPoints: ceremony.totalPoints,
    priorWeekPoints,
    unattributedSplit: ceremony.unattributedSplit,
  };
}
