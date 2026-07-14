import { describe, it, expect } from 'vitest';
import {
  bucketDatesByDayOfWeek,
  calculateDayOfWeekPattern,
  calculateAggregateDayOfWeekPattern,
} from '@/utils/habitPatterns';
import { Habit } from '@/types/schema';

const makeHabit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Read',
  category: 'Personal',
  type: 'positive',
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  basePoints: 10,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-07-14',
  ...overrides,
});

describe('bucketDatesByDayOfWeek', () => {
  it('buckets dates into the correct day-of-week slot', () => {
    // 2026-07-13 is a Monday, 2026-07-14 is a Tuesday, 2026-07-19 is a Sunday
    const result = bucketDatesByDayOfWeek(['2026-07-13', '2026-07-14', '2026-07-19']);
    expect(result).toHaveLength(7);
    expect(result[0]).toEqual({ dayIndex: 0, label: 'Sun', count: 1 });
    expect(result[1]).toEqual({ dayIndex: 1, label: 'Mon', count: 1 });
    expect(result[2]).toEqual({ dayIndex: 2, label: 'Tue', count: 1 });
    expect(result[3]).toEqual({ dayIndex: 3, label: 'Wed', count: 0 });
  });

  it('counts multiple occurrences of the same day of week', () => {
    // Two Mondays
    const result = bucketDatesByDayOfWeek(['2026-07-06', '2026-07-13']);
    expect(result[1]?.count).toBe(2);
  });

  it('skips malformed date strings instead of throwing', () => {
    expect(() => bucketDatesByDayOfWeek(['not-a-date', '2026-07-13'])).not.toThrow();
    const result = bucketDatesByDayOfWeek(['not-a-date', '2026-07-13']);
    const total = result.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(1);
  });

  it('returns all-zero buckets for an empty input', () => {
    const result = bucketDatesByDayOfWeek([]);
    expect(result.every(d => d.count === 0)).toBe(true);
    expect(result.map(d => d.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });
});

describe('calculateDayOfWeekPattern', () => {
  it('reads a single habit\'s completedDates', () => {
    const habit = makeHabit({ completedDates: ['2026-07-13', '2026-07-13' /* not deduped by design */] });
    const result = calculateDayOfWeekPattern(habit);
    expect(result[1]?.count).toBe(2);
  });

  it('handles a habit with no completedDates', () => {
    const habit = makeHabit({ completedDates: undefined });
    const result = calculateDayOfWeekPattern(habit);
    expect(result.every(d => d.count === 0)).toBe(true);
  });
});

describe('calculateAggregateDayOfWeekPattern', () => {
  it('sums completions across multiple habits', () => {
    const habits = [
      makeHabit({ id: 'a', completedDates: ['2026-07-13'] }),
      makeHabit({ id: 'b', completedDates: ['2026-07-13', '2026-07-14'] }),
    ];
    const result = calculateAggregateDayOfWeekPattern(habits);
    expect(result[1]?.count).toBe(2); // Monday
    expect(result[2]?.count).toBe(1); // Tuesday
  });

  it('returns all-zero buckets for no habits', () => {
    const result = calculateAggregateDayOfWeekPattern([]);
    expect(result.every(d => d.count === 0)).toBe(true);
  });
});
