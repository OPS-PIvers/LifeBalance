import { describe, it, expect } from 'vitest';
import { format, subDays } from 'date-fns';
import { calculateChallengeProgress } from './challengeCalculator';
import { Challenge, Habit } from '@/types/schema';

const challenge = (overrides: Partial<Challenge> = {}): Challenge =>
  ({
    id: 'c1',
    month: format(new Date(), 'yyyy-MM'),
    title: 'Test Challenge',
    relatedHabitIds: [],
    targetType: 'count',
    yearlyRewardLabel: '',
    status: 'active',
    ...overrides,
  } as Challenge);

const habit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h1',
    title: 'Test Habit',
    category: 'Health',
    count: 0,
    totalCount: 0,
    targetCount: 1,
    basePoints: 10,
    scoringType: 'incremental',
    type: 'positive',
    period: 'daily',
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
    createdBy: 'u1',
    weatherSensitive: false,
    ...overrides,
  } as Habit);

describe('calculateChallengeProgress — divide-by-zero protection', () => {
  describe('count type', () => {
    it('treats a stored targetValue of 0 as invalid and uses the 100 fallback (finite, not NaN/Infinity)', () => {
      const c = challenge({ targetType: 'count', targetValue: 0 });
      const habits = [habit({ type: 'positive', totalCount: 50 })];

      const result = calculateChallengeProgress(c, habits);

      expect(Number.isFinite(result.progress)).toBe(true);
      expect(Number.isNaN(result.progress)).toBe(false);
      // 50 / 100 fallback * 100 = 50
      expect(result.progress).toBe(50);
      expect(result.currentValue).toBe(50);
    });

    it('treats a negative targetValue as invalid and uses the 100 fallback', () => {
      const c = challenge({ targetType: 'count', targetValue: -10 });
      const habits = [habit({ type: 'positive', totalCount: 25 })];

      const result = calculateChallengeProgress(c, habits);

      expect(Number.isFinite(result.progress)).toBe(true);
      expect(result.progress).toBe(25); // 25 / 100 * 100
    });

    it('falls back through targetTotalCount when targetValue is 0', () => {
      const c = challenge({ targetType: 'count', targetValue: 0, targetTotalCount: 200 });
      const habits = [habit({ type: 'positive', totalCount: 50 })];

      const result = calculateChallengeProgress(c, habits);

      // 50 / 200 * 100 = 25
      expect(result.progress).toBe(25);
    });

    it('computes normal progress for a valid positive target (unchanged behavior)', () => {
      const c = challenge({ targetType: 'count', targetValue: 100 });
      const habits = [habit({ type: 'positive', totalCount: 40 })];

      const result = calculateChallengeProgress(c, habits);

      expect(result.progress).toBe(40);
      expect(result.currentValue).toBe(40);
    });

    it('caps progress at 100 when the target is exceeded', () => {
      const c = challenge({ targetType: 'count', targetValue: 10 });
      const habits = [habit({ type: 'positive', totalCount: 50 })];

      const result = calculateChallengeProgress(c, habits);

      expect(result.progress).toBe(100);
    });
  });

  describe('percentage type', () => {
    it('treats a stored targetValue of 0 as invalid and uses the 100 fallback (finite)', () => {
      const monthKey = format(new Date(), 'yyyy-MM');
      const completed = [
        format(subDays(new Date(), 1), 'yyyy-MM-dd'),
        format(subDays(new Date(), 2), 'yyyy-MM-dd'),
      ].filter(d => d.startsWith(monthKey));

      const c = challenge({ targetType: 'percentage', targetValue: 0, month: monthKey });
      const habits = [habit({ type: 'positive', completedDates: completed })];

      const result = calculateChallengeProgress(c, habits);

      expect(Number.isFinite(result.progress)).toBe(true);
      expect(Number.isNaN(result.progress)).toBe(false);
    });

    it('computes normal percentage progress for a valid target (unchanged behavior)', () => {
      // Use a fixed past month so day counts are deterministic.
      const c = challenge({ targetType: 'percentage', targetValue: 100, month: '2026-01' });
      const habits = [
        habit({
          type: 'positive',
          completedDates: ['2026-01-01', '2026-01-02', '2026-01-03'],
        }),
      ];

      const result = calculateChallengeProgress(c, habits);

      // 3 success days / 31 days in Jan = ~10 (rounded). currentValue/100*100.
      expect(result.daysCompleted).toBe(3);
      expect(Number.isFinite(result.progress)).toBe(true);
    });
  });

  it('returns zeroed progress with no linked habits', () => {
    const result = calculateChallengeProgress(challenge({ targetValue: 0 }), []);
    expect(result).toEqual({ currentValue: 0, progress: 0, completedHabitsCount: 0 });
  });
});
