import { describe, it, expect } from 'vitest';
import { computeHabitHistoryRepair } from './habitHistoryRepair';
import { format, subDays } from 'date-fns';

const d = (daysAgo: number) => format(subDays(new Date(), daysAgo), 'yyyy-MM-dd');

const baseHabit = {
  scoringType: 'incremental' as const,
  targetCount: 1,
  completedDates: [] as string[],
  period: 'daily' as const,
  frozenDates: undefined,
  pausedUntil: undefined,
};

describe('computeHabitHistoryRepair', () => {
  it('returns null when there are no submissions', () => {
    expect(computeHabitHistoryRepair(baseHabit, [])).toBeNull();
  });

  it('returns null when every submission date is already present (idempotent)', () => {
    const habit = { ...baseHabit, completedDates: [d(1), d(2)] };
    const plan = computeHabitHistoryRepair(habit, [
      { date: d(1), count: 1 },
      { date: d(2), count: 3 },
    ]);
    expect(plan).toBeNull();
  });

  it('recovers wiped incremental days and recomputes the streak over the merge', () => {
    // completedDates wiped to [] but three consecutive days of submissions survive.
    const plan = computeHabitHistoryRepair(baseHabit, [
      { date: d(0), count: 1 },
      { date: d(1), count: 2 },
      { date: d(2), count: 1 },
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.missingDates).toEqual([d(2), d(1), d(0)]);
    expect(plan!.streakDays).toBe(3);
  });

  it('is additive: existing toggle-path dates are preserved in the streak, never removed', () => {
    // d(1) was logged via the toggle path (no submission doc); d(0) and d(2)
    // have submissions. The plan must only ADD the missing two and count the
    // toggle day toward the merged streak.
    const habit = { ...baseHabit, completedDates: [d(1)] };
    const plan = computeHabitHistoryRepair(habit, [
      { date: d(0), count: 1 },
      { date: d(2), count: 1 },
    ]);
    expect(plan!.missingDates).toEqual([d(2), d(0)]);
    expect(plan!.streakDays).toBe(3);
  });

  it('threshold habits only recover dates whose summed counts reach targetCount', () => {
    const habit = { ...baseHabit, scoringType: 'threshold' as const, targetCount: 3 };
    const plan = computeHabitHistoryRepair(habit, [
      // d(2): two submissions summing to 3 → complete
      { date: d(2), count: 2 },
      { date: d(2), count: 1 },
      // d(1): only 2 of 3 → NOT complete
      { date: d(1), count: 2 },
    ]);
    expect(plan!.missingDates).toEqual([d(2)]);
  });

  it('bridges frozen dates when recomputing the merged streak', () => {
    // d(1) frozen; submissions on d(0) and d(2). A frozen day bridges the
    // chain without itself counting → streak of 2, not broken at d(1).
    const habit = { ...baseHabit, frozenDates: [d(1)] };
    const plan = computeHabitHistoryRepair(habit, [
      { date: d(0), count: 1 },
      { date: d(2), count: 1 },
    ]);
    expect(plan!.streakDays).toBe(2);
  });
});
