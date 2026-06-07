import { addDays, format, startOfWeek, subDays } from 'date-fns';

/**
 * Central definitions for the default "windows" applied to the high-cardinality
 * Firestore `onSnapshot` listeners in FirebaseHouseholdContext.
 *
 * These bound the number of documents read on a cold load so cost no longer
 * scales linearly with a household's age. Data outside the live window is still
 * reachable on demand via the "load older" / "ensure range" helpers exposed by
 * the household context.
 *
 * The values here are intentionally the single source of truth: change a window
 * once and both the live listener and the corresponding tests/mock follow.
 */

/** Transactions: live listener covers (at least) the last N days. */
export const TRANSACTION_WINDOW_DAYS = 90;

/** Page size used by the transactions "load older" cursor pagination. */
export const TRANSACTION_PAGE_SIZE = 100;

/** Bucket history: live listener keeps the most recent N period snapshots. */
export const BUCKET_HISTORY_LIMIT = 12;

/** Insights: live listener keeps the most recent N insights. */
export const INSIGHTS_LIMIT = 20;

/** To-dos: completed items are only kept live if completed within the last N days. */
export const TODO_COMPLETED_WINDOW_DAYS = 30;

/** Page size used by the completed-to-dos "load older" cursor pagination. */
export const TODO_COMPLETED_PAGE_SIZE = 50;

/**
 * Meal plan: live listener covers the current week ± this many weeks.
 * 1 → previous, current and next week (the range "Copy Last Week" needs).
 */
export const MEAL_PLAN_WEEK_RADIUS = 1;

/**
 * Determine the inclusive lower bound (yyyy-MM-dd) for the live transactions
 * listener, or `null` when transactions should NOT be windowed at all.
 *
 * Correctness guarantee: derived totals (`bucketSpent`) only ever sum
 * transactions belonging to `currentPeriodId`. To keep those totals exact under
 * windowing we make sure the live window always reaches back to (at least) the
 * start of the current pay period — using the EARLIER of "N days ago" and the
 * current period start.
 *
 * When period tracking is disabled (`currentPeriodId` is empty) `bucketSpent`
 * sums *all* transactions, so windowing would undercount. In that mode we return
 * `null`, signalling the caller to load the full collection (legacy behaviour).
 *
 * Dates are compared as `yyyy-MM-dd` strings, which sort chronologically.
 */
export function getTransactionWindowStart(
  currentPeriodId: string,
  now: Date = new Date()
): string | null {
  if (!currentPeriodId) return null;

  const cutoff = format(subDays(now, TRANSACTION_WINDOW_DAYS), 'yyyy-MM-dd');
  // Earlier of the two (string comparison is chronological for yyyy-MM-dd).
  return currentPeriodId < cutoff ? currentPeriodId : cutoff;
}

/** Inclusive `yyyy-MM-dd` start/end bounds for the live meal-plan window. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * Inclusive date bounds (yyyy-MM-dd) for a week containing `date`, expanded by
 * `radius` weeks on each side. Weeks start on Monday to match the rest of the app.
 */
export function getMealPlanWindow(
  date: Date = new Date(),
  radius: number = MEAL_PLAN_WEEK_RADIUS
): DateRange {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const start = addDays(weekStart, -7 * radius);
  const end = addDays(weekStart, 7 * (radius + 1) - 1);
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  };
}

/** Inclusive date bounds (yyyy-MM-dd) for the single week containing `date`. */
export function getWeekRange(date: Date): DateRange {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  return {
    start: format(weekStart, 'yyyy-MM-dd'),
    end: format(addDays(weekStart, 6), 'yyyy-MM-dd'),
  };
}

/** Timestamp-comparable lower bound for the completed-to-dos live window. */
export function getCompletedTodoWindowStart(now: Date = new Date()): Date {
  return subDays(now, TODO_COMPLETED_WINDOW_DAYS);
}
