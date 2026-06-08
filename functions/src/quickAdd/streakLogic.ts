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
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @returns The current consecutive-day streak
 */
export function calculateStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const uniqueDates = Array.from(new Set(dates));
  const sortedDates = uniqueDates.sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) return 0;

  let currentStreak = 0;
  let checkDate = sortedDates[0] === today ? today : yesterday;

  for (const dateStr of sortedDates) {
    if (dateStr === checkDate) {
      currentStreak++;
      checkDate = format(subDays(parseISO(checkDate), 1), "yyyy-MM-dd");
    } else {
      break;
    }
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
 * ISO weeks start on Monday.  A full week with zero completions resets the
 * streak.  The streak can only extend from the current or immediately prior
 * ISO week.
 *
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @returns The current consecutive-week streak
 */
export function calculateWeeklyStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  // Deduplicate, then collect the Monday of each completion's ISO week.
  const uniqueDates = Array.from(new Set(dates));
  const weekStarts = Array.from(
    new Set(
      uniqueDates.map((d) => format(startOfISOWeek(parseISO(d)), "yyyy-MM-dd"))
    )
  ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()); // newest first

  // The streak can only extend from the current week or the immediately past week.
  const nowWeekStart = format(startOfISOWeek(new Date()), "yyyy-MM-dd");
  const prevWeekStart = format(
    subWeeks(startOfISOWeek(new Date()), 1),
    "yyyy-MM-dd"
  );

  if (weekStarts[0] !== nowWeekStart && weekStarts[0] !== prevWeekStart) {
    return 0;
  }

  let streak = 0;
  let expectedWeek = weekStarts[0]!;
  for (const weekStart of weekStarts) {
    if (weekStart === expectedWeek) {
      streak++;
      expectedWeek = format(
        subWeeks(parseISO(expectedWeek), 1),
        "yyyy-MM-dd"
      );
    } else {
      break;
    }
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
 */
export function streakForPeriod(
  dates: string[],
  period: HabitPeriod
): number {
  return period === "weekly"
    ? calculateWeeklyStreak(dates)
    : calculateStreak(dates);
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
