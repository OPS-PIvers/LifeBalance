import { describe, it, expect } from 'vitest';
import { computeHabitTriggerFire } from '@/utils/habitTriggerFire';
import { getLocalDateString } from '@/utils/dateHelpers';
import { Habit } from '@/types/schema';

const today = getLocalDateString();

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    title: 'Test habit',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeHabitTriggerFire', () => {
  it('fires a fresh threshold habit like one manual tap (points + completedDate)', () => {
    const delta = computeHabitTriggerFire(makeHabit(), 'up');
    expect(delta).not.toBeNull();
    expect(delta!.count).toBe(1);
    expect(delta!.totalCount).toBe(1);
    expect(delta!.addedDate).toBe(today);
    expect(delta!.removedDate).toBeUndefined();
    expect(delta!.pointsChange).toBe(10);
    expect(delta!.multiplier).toBe(1.0);
  });

  it('applies the streak multiplier on the prospective streak', () => {
    // Completed the previous two days; firing today makes a 3-day streak → 1.5x.
    const d1 = getLocalDateString(new Date(Date.now() - 86400000));
    const d2 = getLocalDateString(new Date(Date.now() - 2 * 86400000));
    const habit = makeHabit({ completedDates: [d1, d2], streakDays: 2 });
    const delta = computeHabitTriggerFire(habit, 'up');
    expect(delta!.multiplier).toBe(1.5);
    expect(delta!.pointsChange).toBe(15);
  });

  it('reverses a fired habit (down toggle) removing the date and points', () => {
    const habit = makeHabit({ count: 1, totalCount: 1, completedDates: [today], streakDays: 1 });
    const delta = computeHabitTriggerFire(habit, 'down');
    expect(delta).not.toBeNull();
    expect(delta!.count).toBe(0);
    expect(delta!.removedDate).toBe(today);
    expect(delta!.addedDate).toBeUndefined();
    expect(delta!.pointsChange).toBe(-10);
  });

  it('returns null when reversing a habit already at count 0', () => {
    expect(computeHabitTriggerFire(makeHabit(), 'down')).toBeNull();
  });

  it('debits points for a negative incremental habit fire', () => {
    const habit = makeHabit({ type: 'negative', scoringType: 'incremental', basePoints: 10 });
    const delta = computeHabitTriggerFire(habit, 'up');
    expect(delta!.pointsChange).toBe(-10);
  });

  it('lazy-resets a stale habit before an up fire (counter starts at 0)', () => {
    // lastUpdated far in the past → stale; the counter should be treated as 0,
    // so firing yields count 1 (not count+1 on top of a stale counter).
    const habit = makeHabit({
      count: 5,
      totalCount: 5,
      lastUpdated: '2020-01-01T00:00:00.000Z',
    });
    const delta = computeHabitTriggerFire(habit, 'up');
    expect(delta!.count).toBe(1);
  });
});
