import { describe, it, expect } from 'vitest';
import {
  isHabitStale,
  calculateStreak,
  getMultiplier,
  processToggleHabit
} from './habitLogic';
import { Habit } from '@/types/schema';
import { format, subDays, subWeeks } from 'date-fns';

describe('habitLogic', () => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  describe('isHabitStale', () => {
    it('returns true if lastUpdated is missing', () => {
      const habit = { id: '1', period: 'daily', lastUpdated: null } as unknown as Habit;
      expect(isHabitStale(habit)).toBe(true);
    });

    it('returns false for daily habit updated today', () => {
      const habit = {
        id: '1',
        period: 'daily',
        lastUpdated: new Date().toISOString() // Fixed: changed Date object to ISO string to match Habit type
      } as unknown as Habit;
      expect(isHabitStale(habit)).toBe(false);
    });

    it('returns true for daily habit updated yesterday', () => {
      const habit = {
        id: '1',
        period: 'daily',
        lastUpdated: subDays(new Date(), 1).toISOString()
      } as unknown as Habit;
      expect(isHabitStale(habit)).toBe(true);
    });

    it('returns false for weekly habit updated this week', () => {
      const habit = {
        id: '1',
        period: 'weekly',
        lastUpdated: new Date().toISOString()
      } as unknown as Habit;
      expect(isHabitStale(habit)).toBe(false);
    });

    it('returns true for weekly habit updated last week', () => {
      const habit = {
        id: '1',
        period: 'weekly',
        lastUpdated: subWeeks(new Date(), 1).toISOString()
      } as unknown as Habit;
      expect(isHabitStale(habit)).toBe(true);
    });

    it('handles string dates correctly', () => {
       const habit = {
        id: '1',
        period: 'daily',
        lastUpdated: new Date().toISOString()
      } as unknown as Habit;
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
      it('increments count and adds points for positive habit', () => {
        const result = processToggleHabit(baseHabit, 'up');
        expect(result).not.toBeNull();
        expect(result?.updatedHabit.count).toBe(1);
        expect(result?.pointsChange).toBe(10); // 10 * 1.0
        expect(result?.updatedHabit.completedDates).toContain(today);
      });

      it('increments count and subtracts points for negative habit', () => {
        const negativeHabit = { ...baseHabit, type: 'negative' as const };
        const result = processToggleHabit(negativeHabit, 'up');
        expect(result).not.toBeNull();
        expect(result?.updatedHabit.count).toBe(1);
        expect(result?.pointsChange).toBe(-10); // -10 * 1.0 (sign applied)
        expect(result?.updatedHabit.completedDates).toContain(today);
      });

      it('decrements count and removes points (adds back for positive)', () => {
        const habit = { ...baseHabit, count: 1, totalCount: 1, completedDates: [today] };
        const result = processToggleHabit(habit, 'down');

        expect(result).not.toBeNull();
        expect(result?.updatedHabit.count).toBe(0);
        expect(result?.pointsChange).toBe(-10);
        expect(result?.updatedHabit.completedDates).not.toContain(today);
      });

      it('decrements count and adds points back for negative habit', () => {
        const negativeHabit = { ...baseHabit, type: 'negative' as const, count: 1, totalCount: 1, completedDates: [today] };
        const result = processToggleHabit(negativeHabit, 'down');

        expect(result).not.toBeNull();
        expect(result?.updatedHabit.count).toBe(0);
        expect(result?.pointsChange).toBe(10); // -(-10) = 10
        expect(result?.updatedHabit.completedDates).not.toContain(today);
      });

      it('applies multiplier to incremental points — 6-day history gives 7-day new streak (2.0x)', () => {
        // History: 6 consecutive days ending yesterday (days 1–6 ago).
        // Today is NOT yet in completedDates when the toggle is called.
        // After the fix, the multiplier is computed from the PROSPECTIVE streak that
        // includes today → streak becomes 7 → 2.0x.
        const history: string[] = [];
        for (let i = 1; i <= 6; i++) {
          history.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
        }

        const habit = { ...baseHabit, completedDates: history, streakDays: 6 };
        const result = processToggleHabit(habit, 'up');
        expect(result?.multiplier).toBe(2.0);
        expect(result?.pointsChange).toBe(20); // 10 * 2.0
      });

      it('applies multiplier to incremental points — 2-day history gives 3-day new streak (1.5x)', () => {
        // History: 2 consecutive days ending yesterday.
        // Including today → streak = 3 → 1.5x.
        const history = [
          format(subDays(new Date(), 1), 'yyyy-MM-dd'),
          format(subDays(new Date(), 2), 'yyyy-MM-dd'),
        ];
        const habit = { ...baseHabit, completedDates: history, streakDays: 2 };
        const result = processToggleHabit(habit, 'up');
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
        const result = processToggleHabit(habit, 'up');

        expect(result?.updatedHabit.count).toBe(2);
        expect(result?.pointsChange).toBe(0);
        expect(result?.updatedHabit.completedDates).not.toContain(today);
      });

      it('awards points when threshold is reached', () => {
        const habit = { ...thresholdHabit, count: 2 };
        const result = processToggleHabit(habit, 'up');

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
        const result = processToggleHabit(habit, 'down');

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
        const result = processToggleHabit(habit, 'down');

        expect(result?.updatedHabit.count).toBe(3);
        expect(result?.pointsChange).toBe(0);
        expect(result?.updatedHabit.completedDates).toContain(today);
      });

      describe('streak multiplier applied on correct day (off-by-one bug fix)', () => {
        // Uses a threshold habit with targetCount=1, basePoints=100 so maths are easy.
        const singleStepHabit: Habit = {
          ...baseHabit,
          scoringType: 'threshold',
          targetCount: 1,
          basePoints: 100,
        };

        it('day-1 completion (no prior history) gets 1.0x multiplier', () => {
          const habit = { ...singleStepHabit, completedDates: [] as string[] };
          const result = processToggleHabit(habit, 'up');
          expect(result?.multiplier).toBe(1.0);
          expect(result?.pointsChange).toBe(100);
        });

        it('day-2 completion (1 day history) gets 1.0x multiplier', () => {
          const history = [format(subDays(new Date(), 1), 'yyyy-MM-dd')];
          const habit = { ...singleStepHabit, completedDates: history };
          const result = processToggleHabit(habit, 'up');
          // new streak = 2 — below the 3-day threshold → still 1.0x
          expect(result?.multiplier).toBe(1.0);
          expect(result?.pointsChange).toBe(100);
        });

        it('day-3 completion (2-day history) gets 1.5x multiplier', () => {
          const history = [
            format(subDays(new Date(), 1), 'yyyy-MM-dd'),
            format(subDays(new Date(), 2), 'yyyy-MM-dd'),
          ];
          const habit = { ...singleStepHabit, completedDates: history };
          const result = processToggleHabit(habit, 'up');
          // new streak = 3 → 1.5x (previously the bug made this return 1.0x)
          expect(result?.multiplier).toBe(1.5);
          expect(result?.pointsChange).toBe(150);
        });

        it('day-6 completion (5-day history) gets 1.5x multiplier', () => {
          const history: string[] = [];
          for (let i = 1; i <= 5; i++) {
            history.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
          }
          const habit = { ...singleStepHabit, completedDates: history };
          const result = processToggleHabit(habit, 'up');
          // new streak = 6 → still 1.5x
          expect(result?.multiplier).toBe(1.5);
          expect(result?.pointsChange).toBe(150);
        });

        it('day-7 completion (6-day history) gets 2.0x multiplier', () => {
          const history: string[] = [];
          for (let i = 1; i <= 6; i++) {
            history.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
          }
          const habit = { ...singleStepHabit, completedDates: history };
          const result = processToggleHabit(habit, 'up');
          // new streak = 7 → 2.0x (previously the bug made this return 1.5x)
          expect(result?.multiplier).toBe(2.0);
          expect(result?.pointsChange).toBe(200);
        });

        it('toggle-down from completed today uses OLD streak (no regression)', () => {
          // 7-day streak: today + 6 days prior.
          const history: string[] = [today];
          for (let i = 1; i <= 6; i++) {
            history.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
          }
          const habit = {
            ...singleStepHabit,
            count: 1,
            totalCount: 1,
            completedDates: history,
            streakDays: 7,
          };
          const result = processToggleHabit(habit, 'down');
          // Removing today → old streak was 7 → 2.0x removed
          expect(result?.multiplier).toBe(2.0);
          expect(result?.pointsChange).toBe(-200);
          expect(result?.updatedHabit.completedDates).not.toContain(today);
        });
      });
    });
  });
});
