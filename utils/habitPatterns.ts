import { Habit } from '@/types/schema';
import { getDay, parseISO } from 'date-fns';

/** One bucket of the day-of-week completion histogram. */
export interface DayOfWeekBucket {
  /** date-fns `getDay()` index: 0 = Sunday … 6 = Saturday. */
  dayIndex: number;
  /** Short display label, e.g. "Sun". */
  label: string;
  /** Total completions recorded on this day of week. */
  count: number;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Buckets a flat list of `yyyy-MM-dd` completion date strings into a 7-bar
 * day-of-week histogram (Sunday-first, matching date-fns `getDay()`).
 *
 * Malformed date strings (fails to parse) are skipped rather than throwing,
 * since `completedDates` is free-form historical data.
 */
export const bucketDatesByDayOfWeek = (dates: string[]): DayOfWeekBucket[] => {
  const counts = [0, 0, 0, 0, 0, 0, 0];

  for (const dateStr of dates) {
    const parsed = parseISO(dateStr);
    if (Number.isNaN(parsed.getTime())) continue;
    const dayIndex = getDay(parsed);
    counts[dayIndex] = (counts[dayIndex] ?? 0) + 1;
  }

  return DAY_LABELS.map((label, dayIndex) => ({
    dayIndex,
    label,
    count: counts[dayIndex] ?? 0,
  }));
};

/**
 * Day-of-week completion histogram for one habit's `completedDates`.
 */
export const calculateDayOfWeekPattern = (habit: Habit): DayOfWeekBucket[] =>
  bucketDatesByDayOfWeek(habit.completedDates ?? []);

/**
 * Aggregated day-of-week completion histogram across all provided habits —
 * used for a household-wide "which days do we get things done" view.
 */
export const calculateAggregateDayOfWeekPattern = (habits: Habit[]): DayOfWeekBucket[] => {
  const allDates = habits.flatMap(h => h.completedDates ?? []);
  return bucketDatesByDayOfWeek(allDates);
};
