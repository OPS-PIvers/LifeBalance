import { Habit } from '@/types/schema';
import { format, subDays, parseISO } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';

// Plan 25: the manual freeze-token patch flow (canUseFreezeBankToken's 6-check
// validator, wouldBenefitFromFreezeToken, suggestFreezeBankDate) was removed
// with the auto-applied freeze design. getMissedHabitDates survives — the
// auto-apply candidate selection (utils/freezeBank.ts) uses it to decide
// whether yesterday was actually missed.

/**
 * Gets dates (within lookback period) where a habit was not completed
 *
 * The lookback is floored at the habit's earliest known existence so we never
 * flag days that predate the habit as "missed" — a habit had no streak to
 * protect before its first-ever completion. Without a `createdAt` on the habit,
 * the earliest `completedDate` is used as that floor; callers may pass an
 * explicit `habitCreatedAt` for greater precision once the schema supports it.
 *
 * @param habit - The habit to check
 * @param lookbackDays - Number of days to look back (default 7)
 * @param habitCreatedAt - Optional creation date (YYYY-MM-DD) used as the floor
 * @param today - "Today" (YYYY-MM-DD, caller's local timezone); injectable for
 *                deterministic tests, defaults to the local date
 * @returns Array of date strings (YYYY-MM-DD) where habit was missed
 */
export function getMissedHabitDates(
  habit: Habit,
  lookbackDays: number = 7,
  habitCreatedAt?: string,
  today: string = getLocalDateString()
): string[] {
  // Only consider positive habits for freeze protection
  if (habit.type !== 'positive') {
    return [];
  }

  // Without any completion history there is no streak to protect, so nothing
  // counts as "missed".
  if (habit.completedDates.length === 0) {
    return [];
  }

  // Determine the earliest date the habit could plausibly have been missed.
  // Prefer an explicit creation date when provided, otherwise fall back to the
  // earliest completed date. Days before this floor predate the habit.
  const earliestCompleted = habit.completedDates.reduce((min, d) => (d < min ? d : min));
  const floorDate =
    habitCreatedAt && habitCreatedAt < earliestCompleted ? habitCreatedAt : earliestCompleted;

  const missedDates: string[] = [];
  const todayDate = parseISO(today);
  const completedDatesSet = new Set(habit.completedDates);

  for (let i = 1; i <= lookbackDays; i++) {
    const checkDate = subDays(todayDate, i);
    const dateStr = format(checkDate, 'yyyy-MM-dd');

    // Don't look back earlier than the habit existed.
    if (dateStr < floorDate) break;

    // Check if date is NOT in completedDates
    if (!completedDatesSet.has(dateStr)) {
      missedDates.push(dateStr);
    }
  }

  return missedDates;
}
