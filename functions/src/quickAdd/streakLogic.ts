/**
 * Pure streak and multiplier helpers — no firebase-admin dependency.
 *
 * Ported from utils/habitLogic.ts so the Cloud Function's habitProcessor can
 * share identical logic with the client, and so unit tests can import these
 * helpers without pulling in any admin SDK.
 *
 * All dates are YYYY-MM-DD strings in the user's local timezone, consistent
 * with how completedDates are stored in Firestore.
 */

import {
  format,
  subDays,
  parseISO,
  startOfISOWeek,
  subWeeks,
} from "date-fns";

/** The two habit cadences supported by the app. */
export type HabitPeriod = "daily" | "weekly";

// ---------------------------------------------------------------------------
// Day-based streak helpers (daily habits)
// ---------------------------------------------------------------------------

/**
 * Calculate the current streak for a DAILY habit in consecutive days.
 *
 * Mirrors `calculateStreak` in utils/habitLogic.ts exactly.
 *
 * Frozen dates (Plan 25 auto-applied freeze protection) BRIDGE the chain
 * without counting: a date in `frozenDates` keeps the streak alive across a
 * missed day, but only completed dates increment the streak count. With
 * `frozenDates` empty/omitted, behavior is identical to the pre-freeze
 * implementation.
 *
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @param today - "Today" in YYYY-MM-DD (caller's local timezone)
 * @param frozenDates - Dates protected by an auto-applied freeze (YYYY-MM-DD)
 * @returns The current consecutive-day streak (completed days only)
 */
export function calculateStreak(
  dates: string[],
  today: string = format(new Date(), "yyyy-MM-dd"),
  frozenDates: string[] = []
): number {
  if (dates.length === 0) return 0;

  const completedSet = new Set(dates);
  const frozenSet = new Set(frozenDates);
  const yesterday = format(subDays(parseISO(today), 1), "yyyy-MM-dd");

  // Anchor: the streak is alive only if today or yesterday is completed or
  // frozen (completions are never future-dated, so this matches the previous
  // "most recent completion must be today/yesterday" check).
  let checkDate: string;
  if (completedSet.has(today) || frozenSet.has(today)) {
    checkDate = today;
  } else if (completedSet.has(yesterday) || frozenSet.has(yesterday)) {
    checkDate = yesterday;
  } else {
    return 0;
  }

  let currentStreak = 0;
  while (completedSet.has(checkDate) || frozenSet.has(checkDate)) {
    if (completedSet.has(checkDate)) currentStreak++;
    checkDate = format(subDays(parseISO(checkDate), 1), "yyyy-MM-dd");
  }

  return currentStreak;
}

// ---------------------------------------------------------------------------
// Week-based streak helpers (weekly habits)
// ---------------------------------------------------------------------------

/**
 * Calculate the current streak for a WEEKLY habit in consecutive ISO weeks.
 *
 * Mirrors `calculateWeeklyStreak` in utils/habitLogic.ts exactly.
 *
 * ISO weeks start on Monday.  A full week with zero completions (and no frozen
 * date) resets the streak.  The streak can only extend from the current or
 * immediately prior ISO week.  Frozen dates bridge at WEEK granularity: an ISO
 * week containing only a frozen date keeps the chain alive without counting as
 * a completed week.
 *
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @param today - "Today" in YYYY-MM-DD (caller's local timezone)
 * @param frozenDates - Dates protected by an auto-applied freeze (YYYY-MM-DD)
 * @returns The current consecutive-week streak (completed weeks only)
 */
export function calculateWeeklyStreak(
  dates: string[],
  today: string = format(new Date(), "yyyy-MM-dd"),
  frozenDates: string[] = []
): number {
  if (dates.length === 0) return 0;

  const weekStartOf = (d: string): string =>
    format(startOfISOWeek(parseISO(d)), "yyyy-MM-dd");
  const completedWeeks = new Set(dates.map(weekStartOf));
  const frozenWeeks = new Set(frozenDates.map(weekStartOf));

  // The streak can only extend from the current week or the immediately past week.
  const nowWeekStart = format(startOfISOWeek(parseISO(today)), "yyyy-MM-dd");
  const prevWeekStart = format(
    subWeeks(startOfISOWeek(parseISO(today)), 1),
    "yyyy-MM-dd"
  );

  // Anchor: alive only if the current or previous ISO week is completed or
  // frozen (completions are never future-dated, so this matches the previous
  // "most recent completion week must be current/previous" check).
  let checkWeek: string;
  if (completedWeeks.has(nowWeekStart) || frozenWeeks.has(nowWeekStart)) {
    checkWeek = nowWeekStart;
  } else if (
    completedWeeks.has(prevWeekStart) ||
    frozenWeeks.has(prevWeekStart)
  ) {
    checkWeek = prevWeekStart;
  } else {
    return 0;
  }

  let streak = 0;
  // Walk backward one ISO week at a time: completed → count, frozen → bridge.
  while (completedWeeks.has(checkWeek) || frozenWeeks.has(checkWeek)) {
    if (completedWeeks.has(checkWeek)) streak++;
    checkWeek = format(subWeeks(parseISO(checkWeek), 1), "yyyy-MM-dd");
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Period-aware dispatch
// ---------------------------------------------------------------------------

/**
 * Return the current streak in the correct unit for the given period:
 * - daily  → consecutive days  (via `calculateStreak`)
 * - weekly → consecutive ISO weeks (via `calculateWeeklyStreak`)
 *
 * Frozen dates bridge the chain without counting (see the primitives).
 */
export function streakForPeriod(
  dates: string[],
  period: HabitPeriod,
  today: string = format(new Date(), "yyyy-MM-dd"),
  frozenDates: string[] = []
): number {
  return period === "weekly"
    ? calculateWeeklyStreak(dates, today, frozenDates)
    : calculateStreak(dates, today, frozenDates);
}

// ---------------------------------------------------------------------------
// Pause / vacation-mode bridging (F-HABITS-01)
// ---------------------------------------------------------------------------

/**
 * Safety cap on synthesized pause-bridge dates (mirrors MAX_PAUSE_BRIDGE_DAYS in
 * utils/habitLogic.ts).
 */
export const MAX_PAUSE_BRIDGE_DAYS = 400;

/**
 * Synthesize the frozen-style bridge dates for a planned pause (F-HABITS-01).
 *
 * MUST stay in lockstep with `pauseBridgeDates` in utils/habitLogic.ts: the
 * bridge covers `(lastPre, pausedUntil]` where `lastPre` is the last completion
 * STRICTLY BEFORE `today`, so a resume completion on the pause-end day doesn't
 * collapse the bridge and the bridge never links an older, unrelated gap.
 * Returns [] when there is nothing to bridge.
 *
 * @param completedDates - The habit's completion dates (YYYY-MM-DD)
 * @param pausedUntil - The planned-break end date (YYYY-MM-DD) or undefined
 * @param today - "Today" (YYYY-MM-DD, caller-local)
 */
export function pauseBridgeDates(
  completedDates: string[],
  pausedUntil: string | undefined,
  today: string = format(new Date(), "yyyy-MM-dd")
): string[] {
  if (!pausedUntil || completedDates.length === 0) return [];

  const prior = completedDates.filter((d) => d < today);
  if (prior.length === 0) return [];
  const lastPre = prior.reduce((a, b) => (a > b ? a : b));
  if (pausedUntil <= lastPre) return [];

  const out: string[] = [];
  let d = parseISO(pausedUntil);
  while (out.length < MAX_PAUSE_BRIDGE_DAYS) {
    const ds = format(d, "yyyy-MM-dd");
    if (ds <= lastPre) break;
    out.push(ds);
    d = subDays(d, 1);
  }
  return out;
}

/**
 * True while a planned break is in effect (`pausedUntil >= today`). Mirrors
 * `isHabitPaused` in utils/habitLogic.ts.
 */
export function isHabitPaused(
  pausedUntil: string | undefined,
  today: string
): boolean {
  return !!pausedUntil && pausedUntil >= today;
}

// ---------------------------------------------------------------------------
// Multiplier
// ---------------------------------------------------------------------------

/**
 * Get the point multiplier based on streak, habit type, and period.
 *
 * Thresholds per period (positive habits only):
 *   - daily:  3 consecutive days → 1.5×,  7 → 2.0×
 *   - weekly: 2 consecutive weeks → 1.5×,  4 → 2.0×
 *
 * Mirrors `getMultiplier(streak, isPositive, period)` in utils/habitLogic.ts.
 *
 * @param streak     - Current streak count (days for daily, weeks for weekly)
 * @param isPositive - Whether this is a positive-type habit
 * @param period     - Habit cadence ('daily' | 'weekly'), defaults to 'daily'
 * @returns The multiplier to apply to base points
 */
export function getMultiplier(
  streak: number,
  isPositive: boolean,
  period: HabitPeriod = "daily"
): number {
  if (!isPositive) return 1.0;
  if (period === "weekly") {
    if (streak >= 4) return 2.0;
    if (streak >= 2) return 1.5;
    return 1.0;
  }
  // daily (default)
  if (streak >= 7) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}
