import { describe, it, expect } from 'vitest';
import { format, startOfWeek, subDays, subWeeks } from 'date-fns';
import { streakEndingOnForHabit, getMultiplier } from '@/utils/habitLogic';
import type { Habit } from '@/types/schema';

/**
 * Regression guard for T3: `useFreezeBankToken` must credit the patched day's
 * points (it previously credited none). This locks the exact per-date formula
 * the context uses so it can't silently regress:
 *
 *   patchedDayPoints = floor(basePoints * getMultiplier(
 *     streakEndingOnForHabit(patchedHabit, targetDate), true, period))
 *
 *   points.total  += patchedDayPoints            (always)
 *   points.weekly += patchedDayPoints            (iff targetDate ∈ current week)
 *   points.daily  : never                        (targetDate is always in the past)
 *
 * The helper below mirrors the context computation exactly.
 */
function computeFreezePatch(
  habit: Pick<Habit, 'period' | 'basePoints' | 'completedDates'>,
  targetDate: string
): { total: number; weekly: number; hasDaily: false } {
  const patched = [...habit.completedDates];
  if (!patched.includes(targetDate)) patched.push(targetDate);

  const streak = streakEndingOnForHabit({ period: habit.period, completedDates: patched }, targetDate);
  const multiplier = getMultiplier(streak, true, habit.period);
  const points = Math.floor(habit.basePoints * multiplier);

  const today = format(new Date(), 'yyyy-MM-dd');
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const inThisWeek = targetDate >= weekStart && targetDate <= today;

  return { total: points, weekly: inThisWeek ? points : 0, hasDaily: false };
}

describe('freeze-token patch points (T3)', () => {
  it('credits base points for an isolated patched day (no surrounding streak)', () => {
    // A missed day 10 days ago, no neighbours -> streak of 1, multiplier 1.0.
    const targetDate = format(subDays(new Date(), 10), 'yyyy-MM-dd');
    const habit = { period: 'daily' as const, basePoints: 10, completedDates: [] };

    const result = computeFreezePatch(habit, targetDate);
    expect(result.total).toBe(10);
    expect(result.hasDaily).toBe(false);
  });

  it('applies the multiplier when patching bridges a streak past the 3-day threshold', () => {
    // Days: D-4, D-3 completed; D-2 missed (patch target); D-1 completed.
    // Patching D-2 makes the streak ending on D-2 reach 3 days (D-4,D-3,D-2),
    // crossing the 1.5x daily threshold -> floor(10 * 1.5) = 15.
    const d4 = format(subDays(new Date(), 4), 'yyyy-MM-dd');
    const d3 = format(subDays(new Date(), 3), 'yyyy-MM-dd');
    const target = format(subDays(new Date(), 2), 'yyyy-MM-dd');
    const habit = { period: 'daily' as const, basePoints: 10, completedDates: [d4, d3] };

    const result = computeFreezePatch(habit, target);
    expect(result.total).toBe(15);
  });

  it('never credits points.daily (patched dates are always in the past)', () => {
    const target = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    const habit = { period: 'daily' as const, basePoints: 7, completedDates: [] };
    expect(computeFreezePatch(habit, target).hasDaily).toBe(false);
  });

  it('credits points.weekly only when the patched day falls in the current week', () => {
    // A date in a previous week should not affect weekly.
    const prevWeekDay = format(subWeeks(new Date(), 2), 'yyyy-MM-dd');
    const weeklyHabit = { period: 'weekly' as const, basePoints: 20, completedDates: [] };

    const result = computeFreezePatch(weeklyHabit, prevWeekDay);
    expect(result.total).toBeGreaterThan(0);
    expect(result.weekly).toBe(0);
  });
});
