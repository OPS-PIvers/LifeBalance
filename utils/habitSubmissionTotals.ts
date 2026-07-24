import { Habit, HabitSubmission } from '@/types/schema';
import type { DaySubmissionTotals, SubmissionTotalsByHabitDate } from '@/utils/habitLogic';

/** One habit's submissions, as returned by `getHabitSubmissions`. */
export type HabitSubmissionsEntry = readonly [habitId: string, submissions: HabitSubmission[]];

/** Signature of the context's `getHabitSubmissions` (injected so this stays testable). */
export type GetHabitSubmissions = (
  habitId: string,
  startDate?: string,
  endDate?: string,
) => Promise<HabitSubmission[]>;

/**
 * Collapse per-habit submission lists into the habitId → date → totals map the
 * scorers consume. Habits with no submissions in the window are omitted, so a
 * `.get()` miss means "no stored record for this (habit, date)" — which is what
 * `calculateDayNetPoints`/`calculatePointsForDate*` treat as "fall back to the
 * derived attribution".
 */
export const buildSubmissionTotals = (
  entries: readonly HabitSubmissionsEntry[],
): SubmissionTotalsByHabitDate => {
  const totals: SubmissionTotalsByHabitDate = new Map();
  for (const [habitId, submissions] of entries) {
    const byDate = new Map<string, DaySubmissionTotals>();
    for (const submission of submissions) {
      const day = byDate.get(submission.date) ?? { count: 0, points: 0 };
      day.count += submission.count;
      day.points += submission.pointsEarned;
      byDate.set(submission.date, day);
    }
    if (byDate.size > 0) totals.set(habitId, byDate);
  }
  return totals;
};

/**
 * Fetch the stored submissions covering `startDate..endDate` and reduce them to
 * per-(habit, date) totals.
 *
 * Deliberately bounded on both axes, because this feeds the login/midnight
 * points recompute (previously synchronous and I/O-free):
 *   - only habits flagged `hasSubmissionTracking` are read, so a household that
 *     has never back-dated a completion issues ZERO reads and resolves through
 *     the same path with an empty map;
 *   - only the window actually being scored is read — one day for the daily
 *     recompute, at most seven for the weekly one — never a habit's full
 *     history.
 *
 * A per-habit read failure is swallowed by `getHabitSubmissions` (it returns
 * `[]`), which degrades to the derived attribution rather than failing the whole
 * recompute — the same trade the calendar already makes.
 */
export const fetchSubmissionTotals = async (
  habits: Habit[],
  startDate: string,
  endDate: string,
  getHabitSubmissions: GetHabitSubmissions,
): Promise<SubmissionTotalsByHabitDate> => {
  const tracked = habits.filter(h => h.hasSubmissionTracking);
  if (tracked.length === 0) return new Map();

  const entries = await Promise.all(
    tracked.map(async habit =>
      [habit.id, await getHabitSubmissions(habit.id, startDate, endDate)] as const
    )
  );
  return buildSubmissionTotals(entries);
};
