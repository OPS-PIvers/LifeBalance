/**
 * Weekly ceremony — the per-member scorer (per-member points, stage 5).
 *
 * Pure, Firestore-free assembly of everything the ceremony deck needs that the
 * money half of `dataAssembly.ts` doesn't already produce: per-member weekly
 * points/completions, each member's best day, top streak and perfect habits,
 * and the day-by-day member-stacked series behind the 7-day chart.
 *
 * 🛡️ WHY THIS IS DERIVED, NOT READ. Until stage 5 the recap's `pointsByMember`
 * came straight off `HouseholdMember.points.weekly`, which was safe while
 * generation ran Sunday 17:00 — mid-week, long before any rollover. Generation
 * now runs MONDAY MORNING (the week must be closed before anyone is crowned),
 * and by then the client's midnight scheduler may already have rolled
 * `points.weekly` to zero for the new week. Reading it would hand the ceremony
 * a household of zeroes on exactly the households that use the app most. So
 * every per-member figure here is recomputed from habit data over the closed
 * week, which no rollover can disturb.
 *
 * 🛡️ CLOSED PERIODS ONLY. Every date scored here is strictly in the past
 * relative to generation (the recap week ended yesterday), so the live
 * `Habit.count` — which only ever describes the CURRENT period and is zeroed by
 * each reset — is deliberately not consulted. A past period's presence in
 * `completedDates` already proves its target was met, which is exactly the
 * `pointsForHabitOnDate` / `calculatePointsForDateRange` rule for a historical
 * date. Do not reuse these helpers to score today.
 *
 * The scoring rules mirror the client's `utils/habitAttribution.ts`:
 *
 *     household(date) = Σ_members memberPoints(m, date) + unattributed(date)
 *
 * where `unattributed` is the grandfathering term — completions recorded before
 * the attribution layer shipped belong to nobody but still happened, so they
 * stay visible as their own series rather than deleting a household's history
 * from its own recap. functions/ is a separate pnpm package from the root app,
 * so (like `quickAdd/streakLogic.ts`) the logic is ported rather than imported;
 * the streak/multiplier primitives themselves ARE shared, from that module.
 */
import {
  effectiveFrozenDates,
  getMultiplier,
  habitPeriodStart,
  streakEndingOnForPeriod,
  streakForPeriod,
  type HabitPeriod,
} from "../quickAdd/streakLogic";
import { RecapDayPoints, RecapMemberFacts } from "./types";

/**
 * The habit fields the ceremony scorer reads. Everything past `title` /
 * `completedDates` is OPTIONAL so the money-only assembly tests (and any
 * partially-written habit doc) keep working — each falls back to the value that
 * makes the habit score exactly as it did before attribution existed.
 */
export interface RecapScoringHabit {
  title: string;
  completedDates: string[];
  period?: HabitPeriod;
  type?: "positive" | "negative";
  basePoints?: number;
  scoringType?: "incremental" | "threshold";
  targetCount?: number;
  /** A permanently assigned chore credits its assignee, never the pool. */
  assignedTo?: string;
  /** date → memberId → completion count (see `Habit.completedBy`). */
  completedBy?: Record<string, Record<string, number>>;
  frozenDates?: string[];
  /** date → uids a per-member freeze was spent for (`freezeMode: 'per_member'`). */
  frozenDatesBy?: Record<string, string[]>;
  pausedUntil?: string;
}

/** Minimal member shape the ceremony needs. */
export interface CeremonyMember {
  uid: string;
  displayName: string;
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
}

// ---------------------------------------------------------------------------
// Small habit accessors (each defaults to the pre-attribution behaviour)
// ---------------------------------------------------------------------------

const periodOf = (habit: RecapScoringHabit): HabitPeriod => habit.period ?? "daily";
const isPositive = (habit: RecapScoringHabit): boolean => (habit.type ?? "positive") === "positive";
const signOf = (habit: RecapScoringHabit): 1 | -1 => (habit.type === "negative" ? -1 : 1);
const magnitudeOf = (habit: RecapScoringHabit): number => Math.abs(habit.basePoints ?? 0);
const isIncremental = (habit: RecapScoringHabit): boolean => habit.scoringType === "incremental";

/** Adds/subtracts whole days from a yyyy-MM-dd date string (UTC-safe arithmetic). */
export function shiftDay(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** The 7 yyyy-MM-dd dates of a recap week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(weekStart, i));
}

// ---------------------------------------------------------------------------
// Attribution readers (mirrors utils/habitAttribution.ts)
// ---------------------------------------------------------------------------

/**
 * How many completions `memberId` logged on `date`. Clamped at zero for the
 * same reason the client clamps: attribution is written as unconditional
 * dot-path increments in both directions, so a node can rest at (or dip below)
 * zero and `count <= 0` means ABSENT everywhere.
 */
export function memberUnitsOnDate(
  habit: RecapScoringHabit,
  memberId: string,
  date: string
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
 * dates for a shared habit, or the habit's own dates for a chore assigned to
 * them (whose completions are theirs by definition, with no attribution needed).
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
  extraFrozen: string[] = []
): string[] {
  return effectiveFrozenDates(
    {
      completedDates: dates,
      frozenDates: [...(habit.frozenDates ?? []), ...extraFrozen],
      pausedUntil: habit.pausedUntil,
    },
    anchor
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
    bridgeFor(habit, habit.completedDates, anchor)
  );
  return perUnitAt(habit, streak);
}

/**
 * How many units the LEGACY scorer counts on `date` — always 0 or 1, because
 * only CLOSED periods are ever scored here (see the module header):
 *
 *  - daily: one unit per completed day;
 *  - weekly: the week's single unit, parked on the same day the client's
 *    `pointsForHabitOnDate` parks it — the week's LATEST completed day for an
 *    incremental habit, its FIRST for a threshold one — so summing the week's
 *    days reproduces the week's total exactly once.
 */
function legacyUnitsOnDate(habit: RecapScoringHabit, date: string): number {
  if (!habit.completedDates.includes(date)) return 0;
  if (periodOf(habit) !== "weekly") return 1;

  const start = habitPeriodStart("weekly", date);
  const sameWeek = habit.completedDates.filter((d) => habitPeriodStart("weekly", d) === start);
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
 *   Both members completing the same threshold habit each earn a full award —
 *   the locked competition model.
 */
export function memberAttributedPointsOnDate(
  habit: RecapScoringHabit,
  memberId: string,
  date: string,
  anchor: string
): number {
  const units = memberUnitsOnDate(habit, memberId, date);
  if (units <= 0) return 0;

  const dates = memberDatesFor(habit, memberId);
  const streak = streakEndingOnForPeriod(
    dates,
    periodOf(habit),
    date,
    bridgeFor(habit, dates, anchor, memberFrozenDates(habit, memberId))
  );
  const perUnit = perUnitAt(habit, streak);

  if (isIncremental(habit)) return units * perUnit;

  // Threshold: the period must actually have completed. Every date scored here
  // is in a CLOSED period, so its presence in `completedDates` is proof.
  const period = periodOf(habit);
  const start = habitPeriodStart(period, date);
  if (!habit.completedDates.some((d) => habitPeriodStart(period, d) === start)) return 0;

  const samePeriod = dates.filter((d) => habitPeriodStart(period, d) === start);
  if (samePeriod.length === 0) return 0;
  const firstInPeriod = samePeriod.reduce((a, b) => (a < b ? a : b));
  return date === firstInPeriod ? perUnit : 0;
}

/** Signed points a chore ASSIGNED to a member earned on one (closed) date. */
export function assignedChorePointsOnDate(
  habit: RecapScoringHabit,
  date: string,
  anchor: string
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
  anchor: string
): number {
  const baseUnits = legacyUnitsOnDate(habit, date);
  if (baseUnits === 0) return 0;
  const perUnit = legacyPerUnit(habit, date, anchor);
  if (perUnit === 0) return 0;
  if (!periodHasAttribution(habit, date)) return baseUnits * perUnit;
  if (!isIncremental(habit)) return 0;

  const held =
    periodOf(habit) === "weekly"
      ? attributedUnitsInPeriod(habit, date)
      : attributedUnitsOnDate(habit, date);
  return Math.max(baseUnits - held, 0) * perUnit;
}

/** Signed points `memberId` earned from ALL habits on one (closed) date. */
export function memberPointsOnDate(
  habits: RecapScoringHabit[],
  memberId: string,
  date: string,
  anchor: string
): number {
  let total = 0;
  for (const habit of habits) {
    if (habit.assignedTo) {
      if (habit.assignedTo === memberId) total += assignedChorePointsOnDate(habit, date, anchor);
      continue;
    }
    total += memberAttributedPointsOnDate(habit, memberId, date, anchor);
  }
  return total;
}

/** Signed points on one date that no member holds (assigned chores excluded). */
function unattributedPointsForDate(
  habits: RecapScoringHabit[],
  date: string,
  anchor: string
): number {
  let total = 0;
  for (const habit of habits) {
    if (habit.assignedTo) continue;
    total += unattributedPointsOnDate(habit, date, anchor);
  }
  return total;
}

// ---------------------------------------------------------------------------
// The 7-day series
// ---------------------------------------------------------------------------

/**
 * The Monday-first, member-stacked day series for a closed week.
 *
 * `total = Σ byMember + unattributed` by construction. Members who scored
 * nothing on a day are omitted from that day's map, so an untouched week
 * produces seven all-zero rows rather than a dense matrix of zeroes.
 */
export function buildDailyPoints(
  habits: RecapScoringHabit[],
  members: CeremonyMember[],
  weekStart: string,
  anchor: string
): RecapDayPoints[] {
  return weekDates(weekStart).map((date) => {
    const byMember: Record<string, number> = {};
    let memberSum = 0;
    for (const member of members) {
      const points = memberPointsOnDate(habits, member.uid, date, anchor);
      if (points !== 0) {
        byMember[member.uid] = points;
        memberSum += points;
      }
    }
    const unattributed = unattributedPointsForDate(habits, date, anchor);
    return { date, byMember, unattributed, total: memberSum + unattributed };
  });
}

/** Signed household points across a closed week — `Σ dailyPoints[].total`. */
export function weekPointsTotal(
  habits: RecapScoringHabit[],
  members: CeremonyMember[],
  weekStart: string,
  anchor: string
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
  dates: string[]
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
  weekEnd: string
): RecapMemberFacts["topStreak"] {
  let best: RecapMemberFacts["topStreak"] = null;
  for (const habit of habits) {
    const dates = memberDatesFor(habit, memberId);
    if (dates.length === 0) continue;
    const period = periodOf(habit);
    const days = streakForPeriod(
      dates,
      period,
      weekEnd,
      bridgeFor(habit, dates, weekEnd, memberFrozenDates(habit, memberId))
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
  dates: string[]
): string[] {
  const out: string[] = [];
  for (const habit of habits) {
    if (periodOf(habit) !== "daily") continue;
    const owned = new Set(memberDatesFor(habit, memberId));
    if (owned.size === 0) continue;
    if (dates.every((d) => owned.has(d))) out.push(habit.title);
  }
  return out;
}

/**
 * Assemble every ceremony field for one closed week.
 *
 * The week's last day (`weekEnd`) is the anchor for every streak walk and pause
 * bridge, so the result depends only on the week being described — regenerating
 * the same week on a later day produces the same document.
 */
export function assembleCeremony(input: CeremonyInput): AssembledCeremony {
  const { habits, members, weekStart, weekEnd } = input;
  const dates = weekDates(weekStart);
  const dailyPoints = buildDailyPoints(habits, members, weekStart, weekEnd);

  const memberFacts: RecapMemberFacts[] = members.map((member) => {
    let points = 0;
    let bestDay: RecapMemberFacts["bestDay"] = null;
    for (const day of dailyPoints) {
      const dayPoints = day.byMember[member.uid] ?? 0;
      points += dayPoints;
      if (dayPoints > 0 && (!bestDay || dayPoints > bestDay.points)) {
        bestDay = { date: day.date, points: dayPoints };
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
    };
  });

  return {
    memberFacts,
    dailyPoints,
    totalPoints: dailyPoints.reduce((sum, d) => sum + d.total, 0),
  };
}

/**
 * Does this week carry ANY per-member attribution?
 *
 * The switch that keeps a fully-grandfathered household whole: with no
 * attribution at all, `pointsByMember` keeps its pre-stage-5 source (each
 * member's stored `points.weekly`) rather than reporting a household of zeroes
 * derived from history that predates the attribution layer.
 */
export function weekHasAttribution(habits: RecapScoringHabit[], weekStart: string): boolean {
  const dates = new Set(weekDates(weekStart));
  for (const habit of habits) {
    for (const [date, day] of Object.entries(habit.completedBy ?? {})) {
      if (!dates.has(date)) continue;
      for (const count of Object.values(day)) if (count > 0) return true;
    }
  }
  return false;
}
