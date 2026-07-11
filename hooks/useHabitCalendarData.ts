import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';
import {
  DaySubmissionTotals,
  SubmissionTotalsByHabitDate,
  calculateDayNetPoints,
  isHabitStale,
} from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * Data layer shared by the habit calendars (PastDayLogModal's mini month and
 * the History tab's HabitHistoryCalendar).
 *
 * Fetches the visible window's stored submissions once per (habit, window) —
 * only for habits flagged `hasSubmissionTracking`, so households that never
 * back-dated anything issue zero extra reads — and derives:
 *   - `netPointsByDate`: the signed net points each visible day earned, with
 *     stored submissions authoritative and `pointsForHabitOnDate` as the
 *     fallback for toggle-path completions (see calculateDayNetPoints);
 *   - `countForHabitOnDate`: how many units of one habit were logged on one
 *     day, for the day-editor row counters.
 *
 * Submissions have no standing listener (project convention — they are
 * fetched on demand), so mutations must call `refresh()` to refetch. Habit
 * doc changes arrive via the normal snapshot listener and re-run the fetch
 * anyway (the effect is keyed on `habits`), which keeps the two sources in
 * step after a log/clear round-trips.
 */
export const useHabitCalendarData = (habits: Habit[], days: Date[]) => {
  const { getHabitSubmissions } = useGamification();
  const [submissionTotals, setSubmissionTotals] = useState<SubmissionTotalsByHabitDate>(() => new Map());
  const [refreshToken, setRefreshToken] = useState(0);

  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const startDate = firstDay ? format(firstDay, 'yyyy-MM-dd') : '';
  const endDate = lastDay ? format(lastDay, 'yyyy-MM-dd') : '';

  useEffect(() => {
    if (!startDate || !endDate) return;

    // Only habits flagged hasSubmissionTracking can have submission docs; an
    // all-toggle household resolves through the same async path with zero reads.
    const tracked = habits.filter(h => h.hasSubmissionTracking);

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        tracked.map(async habit =>
          [habit.id, await getHabitSubmissions(habit.id, startDate, endDate)] as const
        )
      );
      if (cancelled) return;

      const next: SubmissionTotalsByHabitDate = new Map();
      results.forEach(([habitId, submissions]) => {
        const byDate = new Map<string, DaySubmissionTotals>();
        submissions.forEach(s => {
          const day = byDate.get(s.date) ?? { count: 0, points: 0 };
          day.count += s.count;
          day.points += s.pointsEarned;
          byDate.set(s.date, day);
        });
        if (byDate.size > 0) next.set(habitId, byDate);
      });
      setSubmissionTotals(next);
    })();

    return () => { cancelled = true; };
  }, [habits, getHabitSubmissions, startDate, endDate, refreshToken]);

  /** Refetch the window's submissions (call after a log/clear mutation). */
  const refresh = useCallback(() => setRefreshToken(t => t + 1), []);

  const netPointsByDate = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      map.set(dateStr, calculateDayNetPoints(habits, dateStr, submissionTotals));
    });
    return map;
  }, [habits, days, submissionTotals]);

  /**
   * Units of `habit` logged on `date`: the day's summed submission counts when
   * any exist, else derived from the completion record (today reads the live
   * counter; a past threshold day proved its target; a past incremental day
   * counts as one — no per-day history is stored for toggle-path logs).
   */
  const countForHabitOnDate = useCallback((habit: Habit, date: string): number => {
    const stored = submissionTotals.get(habit.id)?.get(date);
    if (stored) return stored.count;
    if (!habit.completedDates.includes(date)) return 0;
    if (date === getLocalDateString() && !isHabitStale(habit)) return habit.count;
    return habit.scoringType === 'threshold' ? Math.max(1, habit.targetCount) : 1;
  }, [submissionTotals]);

  return { submissionTotals, netPointsByDate, countForHabitOnDate, refresh };
};
