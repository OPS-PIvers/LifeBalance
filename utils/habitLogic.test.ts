/* eslint-disable */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  isHabitStale,
  calculateStreak,
  getMultiplier,
  processToggleHabit,
  ToggleHabitResult
} from './habitLogic';
import { Habit, HouseholdMember } from '@/types/schema';
import { format, subDays, subWeeks, addDays } from 'date-fns';

describe('habitLogic', () => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  describe('isHabitStale', () => {
    it('returns true if lastUpdated is missing', () => {
      const habit = { id: '1', period: 'daily', lastUpdated: null } as any;
      expect(isHabitStale(habit)).toBe(true);
    });

    it('returns false for daily habit updated today', () => {
      const habit = {
        id: '1',
        period: 'daily',
        lastUpdated: new Date()
      } as any;
      expect(isHabitStale(habit)).toBe(false);
    });

    it('returns true for daily habit updated yesterday', () => {
      const habit = {
        id: '1',
        period: 'daily',
        lastUpdated: subDays(new Date(), 1)
      } as any;
      expect(isHabitStale(habit)).toBe(true);
    });

    it('returns false for weekly habit updated this week', () => {
      // Assuming today is not the very start of the week for this test to be robust,
      // but isHabitStale uses isSameWeek(now, lastUpdate, { weekStartsOn: 1 })
      const habit = {
        id: '1',
        period: 'weekly',
        lastUpdated: new Date()
      } as any;
      expect(isHabitStale(habit)).toBe(false);
    });

    it('returns true for weekly habit updated last week', () => {
      const habit = {
        id: '1',
        period: 'weekly',
        lastUpdated: subWeeks(new Date(), 1)
      } as any;
      expect(isHabitStale(habit)).toBe(true);
    });

    it('handles string dates correctly', () => {
       const habit = {
        id: '1',
        period: 'daily',
        lastUpdated: new Date().toISOString()
      } as any;
      expect(isHabitStale(habit)).toBe(false);
    });
  });

  describe('calculateStreak', () => {
    it('returns 0 for empty dates', () => {
      expect(calculateStreak([])).toBe(0);
    });

    it('returns 1 if completed today', () => {
      expect(calculateStreak([today])).toBe(1);
    });

    it('returns 1 if completed yesterday but not today', () => {
      expect(calculateStreak([yesterday])).toBe(1);
    });

    it('returns 2 if completed today and yesterday', () => {
      expect(calculateStreak([today, yesterday])).toBe(2);
    });

    it('breaks streak on missing day', () => {
      const dayBeforeYesterday = format(subDays(new Date(), 2), 'yyyy-MM-dd');
      // Gap between today and dayBeforeYesterday
      expect(calculateStreak([today, dayBeforeYesterday])).toBe(1);
    });

    it('calculates long streaks correctly', () => {
      const dates = [today];
      for (let i = 1; i < 10; i++) {
        dates.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
      }
      expect(calculateStreak(dates)).toBe(10);
    });
  });

  describe('getMultiplier', () => {
    it('returns 1.0 for streak < 3', () => {
      expect(getMultiplier(1, true)).toBe(1.0);
      expect(getMultiplier(2, true)).toBe(1.0);
    });

    it('returns 1.5 for streak >= 3 and < 7', () => {
      expect(getMultiplier(3, true)).toBe(1.5);
      expect(getMultiplier(6, true)).toBe(1.5);
    });

    it('returns 2.0 for streak >= 7', () => {
      expect(getMultiplier(7, true)).toBe(2.0);
      expect(getMultiplier(100, true)).toBe(2.0);
    });

    it('always returns 1.0 for non-positive habits', () => {
      expect(getMultiplier(10, false)).toBe(1.0);
    });
  });

  describe('processToggleHabit', () => {
    const mockUser: HouseholdMember = { id: 'u1', name: 'Test User' } as any;

    const baseHabit: Habit = {
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
      weatherSensitive: false
    };

    describe('Incremental Scoring', () => {
      it('increments count and adds points', () => {
        const result = processToggleHabit(baseHabit, 'up', mockUser);
        expect(result).not.toBeNull();
        expect(result?.updatedHabit.count).toBe(1);
        expect(result?.pointsChange).toBe(10); // 10 * 1.0
        expect(result?.updatedHabit.completedDates).toContain(today);
      });

      it('decrements count and removes points', () => {
        const habit = { ...baseHabit, count: 1, totalCount: 1, completedDates: [today] };
        const result = processToggleHabit(habit, 'down', mockUser);

        expect(result).not.toBeNull();
        expect(result?.updatedHabit.count).toBe(0);
        expect(result?.pointsChange).toBe(-10);
        expect(result?.updatedHabit.completedDates).not.toContain(today);
      });

      it('applies multiplier to incremental points', () => {
        // Streak of 7 days (including today if we consider it completed)
        // Ideally streak calculation looks at history.
        // Let's mock a history of 6 days + today
        const history = [];
        for (let i=0; i<6; i++) { // 0 to 5 days ago
             // Note: calculateStreak in the function uses the *passed* habit.completedDates
             // before modification to calculate multiplier?
             // Let's check source:
             // const currentStreak = calculateStreak(habit.completedDates);
             // const multiplier = getMultiplier(currentStreak, habit.type === 'positive');
             history.push(format(subDays(new Date(), i+1), 'yyyy-MM-dd'));
        }

        const habit = { ...baseHabit, completedDates: history, streakDays: 6 };
        // Current streak based on history (yesterday back to 6 days ago) = 6
        // So multiplier should be 1.5 (streak >= 3)
        // Wait: < 7 is 1.5. >= 7 is 2.0.
        // 6 days streak => 1.5x

        const result = processToggleHabit(habit, 'up', mockUser);
        expect(result?.multiplier).toBe(1.5);
        expect(result?.pointsChange).toBe(15); // 10 * 1.5
      });
    });

    describe('Threshold Scoring', () => {
      const thresholdHabit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 3,
        basePoints: 50
      };

      it('does not award points before threshold', () => {
        const habit = { ...thresholdHabit, count: 1 };
        const result = processToggleHabit(habit, 'up', mockUser);

        expect(result?.updatedHabit.count).toBe(2);
        expect(result?.pointsChange).toBe(0);
        expect(result?.updatedHabit.completedDates).not.toContain(today);
      });

      it('awards points when threshold is reached', () => {
        const habit = { ...thresholdHabit, count: 2 };
        const result = processToggleHabit(habit, 'up', mockUser);

        expect(result?.updatedHabit.count).toBe(3);
        expect(result?.pointsChange).toBe(50);
        expect(result?.updatedHabit.completedDates).toContain(today);
      });

      it('removes points when dropping below threshold', () => {
        const habit = {
          ...thresholdHabit,
          count: 3,
          completedDates: [today]
        };
        const result = processToggleHabit(habit, 'down', mockUser);

        expect(result?.updatedHabit.count).toBe(2);
        expect(result?.pointsChange).toBe(-50);
        expect(result?.updatedHabit.completedDates).not.toContain(today);
      });

      it('does not remove points if staying above threshold', () => {
        const habit = {
          ...thresholdHabit,
          count: 4,
          completedDates: [today]
        };
        const result = processToggleHabit(habit, 'down', mockUser);

        expect(result?.updatedHabit.count).toBe(3);
        expect(result?.pointsChange).toBe(0);
        expect(result?.updatedHabit.completedDates).toContain(today);
      });
    });
  });
});
