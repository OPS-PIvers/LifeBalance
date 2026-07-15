import { describe, it, expect } from 'vitest';
import { decideMealCookedHabitToggle } from '@/utils/mealCookedHabit';
import { Habit } from '@/types/schema';

const dailyHabit = (id: string, completedDates: string[]): Pick<Habit, 'id' | 'period' | 'completedDates'> => ({
  id,
  period: 'daily',
  completedDates,
});

const weeklyHabit = (id: string, completedDates: string[]): Pick<Habit, 'id' | 'period' | 'completedDates'> => ({
  id,
  period: 'weekly',
  completedDates,
});

describe('decideMealCookedHabitToggle', () => {
  it('returns null when no habit is linked', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: undefined,
        habits: [dailyHabit('h1', [])],
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: true,
      })
    ).toBeNull();
  });

  it('returns null when the plan item date is not today (cannot backfill)', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'h1',
        habits: [dailyHabit('h1', [])],
        planItemDate: '2026-07-13',
        today: '2026-07-14',
        isCooked: true,
      })
    ).toBeNull();
  });

  it('returns null when the linked habit no longer exists', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'deleted-habit',
        habits: [dailyHabit('h1', [])],
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: true,
      })
    ).toBeNull();
  });

  it('returns an "up" toggle when marking cooked and the habit is not yet completed today', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'h1',
        habits: [dailyHabit('h1', [])],
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: true,
      })
    ).toEqual({ habitId: 'h1', direction: 'up' });
  });

  it('returns null when marking cooked but the habit is already completed today (no double-credit)', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'h1',
        habits: [dailyHabit('h1', ['2026-07-14'])],
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: true,
      })
    ).toBeNull();
  });

  it('returns a "down" toggle when un-marking cooked and the habit is currently completed', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'h1',
        habits: [dailyHabit('h1', ['2026-07-14'])],
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: false,
      })
    ).toEqual({ habitId: 'h1', direction: 'down' });
  });

  it('returns null when un-marking cooked but the habit was not completed (nothing to undo)', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'h1',
        habits: [dailyHabit('h1', [])],
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: false,
      })
    ).toBeNull();
  });

  it('treats a weekly habit already completed earlier this week as completed (no double-credit)', () => {
    expect(
      decideMealCookedHabitToggle({
        mealCookedHabitId: 'h1',
        habits: [weeklyHabit('h1', ['2026-07-13'])], // same ISO week as 2026-07-14 (Tue)
        planItemDate: '2026-07-14',
        today: '2026-07-14',
        isCooked: true,
      })
    ).toBeNull();
  });
});
