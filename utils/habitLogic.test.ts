import { describe, it, expect } from 'vitest';
import {
  isHabitStale,
  calculateStreak,
  getMultiplier,
  processToggleHabit,
  streakEndingOn,
  calculatePointsForDate,
  calculatePointsForDateRange
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

  describe('streakEndingOn', () => {
    const dates = (n: number, endOffset = 0): string[] => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        out.push(format(subDays(new Date(), endOffset + i), 'yyyy-MM-dd'));
      }
      return out;
    };

    it('returns 0 when the date is not in completedDates', () => {
      expect(streakEndingOn([yesterday], today)).toBe(0);
    });

    it('counts consecutive days ending on the given date (inclusive)', () => {
      // 5 consecutive days ending today.
      expect(streakEndingOn(dates(5), today)).toBe(5);
    });

    it('stops at a gap', () => {
      const threeAgo = format(subDays(new Date(), 3), 'yyyy-MM-dd');
      // today + yesterday, then a gap, then threeAgo.
      expect(streakEndingOn([today, yesterday, threeAgo], today)).toBe(2);
    });

    it('matches calculateStreak when the date is the most recent completed day', () => {
      const history = dates(8); // 8 consecutive days ending today
      expect(streakEndingOn(history, today)).toBe(calculateStreak(history));
    });

    it('reconstructs the streak for a historical date', () => {
      // 8 consecutive days ending today; the streak ending 3 days ago was 5.
      const history = dates(8);
      const threeAgo = format(subDays(new Date(), 3), 'yyyy-MM-dd');
      expect(streakEndingOn(history, threeAgo)).toBe(5);
    });
  });

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
    weatherSensitive: false,
  };

  describe('calculatePointsForDateRange — per-date streak reconstruction', () => {
    const consecutive = (n: number): string[] => {
      // n consecutive days ending today (index 0 = oldest).
      const out: string[] = [];
      for (let i = n - 1; i >= 0; i--) {
        out.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
      }
      return out;
    };

    it('sums per-date multipliers across 8 consecutive days (NOT 8 x current multiplier)', () => {
      // Threshold habit, basePoints 10, targetCount 1, count 1 (completed today).
      const history = consecutive(8);
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: 8,
        completedDates: history,
        streakDays: 8,
      };

      const startDate = history[0];
      const endDate = history[history.length - 1];
      const total = calculatePointsForDateRange([habit], startDate, endDate);

      // Per-date: days 1-2 = 1.0x (10), days 3-6 = 1.5x (floor(15)=15), days 7-8 = 2.0x (20).
      // 2*10 + 4*15 + 2*20 = 20 + 60 + 40 = 120.
      expect(total).toBe(120);
      // The buggy current-multiplier behavior would have been 8 * 20 = 160.
      expect(total).not.toBe(160);
    });

    it('handles a broken-then-resumed streak with correct per-date multipliers', () => {
      // Days (ago): completed 7,6,5,4 (4-day run) then GAP at 3 then 2,1,0 (3-day run).
      const d = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');
      const history = [d(7), d(6), d(5), d(4), d(2), d(1), d(0)];
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: history.length,
        completedDates: history,
        streakDays: 3,
      };

      const total = calculatePointsForDateRange([habit], d(7), d(0));

      // First run streaks: 1,2,3,4 → mults 1.0,1.0,1.5,1.5 → 10+10+15+15 = 50.
      // Second run streaks: 1,2,3 → 1.0,1.0,1.5 → 10+10+15 = 35.
      // Total = 85.
      expect(total).toBe(85);
    });

    it('negative (bad) habits always use 1.0x', () => {
      const history = consecutive(8);
      const habit: Habit = {
        ...baseHabit,
        type: 'negative',
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: 8,
        completedDates: history,
        streakDays: 8,
      };

      const total = calculatePointsForDateRange([habit], history[0], history[7]);
      // 8 days * -10 * 1.0 = -80.
      expect(total).toBe(-80);
    });

    it('uses habit.count for today on a daily incremental habit, 1 for other days', () => {
      const history = consecutive(2); // yesterday + today, both streak < 3 → 1.0x
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'incremental',
        period: 'daily',
        basePoints: 10,
        count: 3, // 3 completions today
        totalCount: 4,
        completedDates: history,
        streakDays: 2,
      };

      const total = calculatePointsForDateRange([habit], history[0], history[1]);
      // Yesterday: 1 completion * 10 = 10. Today: 3 completions * 10 = 30. Total 40.
      expect(total).toBe(40);
    });
  });

  describe('calculatePointsForDate — per-date streak reconstruction', () => {
    it('uses the streak that ended on the target date, not the current streak', () => {
      // 8 consecutive days ending today; evaluate a historical day (3 ago, streak 5 → 1.5x).
      const d = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');
      const history: string[] = [];
      for (let i = 0; i < 8; i++) history.push(d(i));

      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: 8,
        completedDates: history,
        streakDays: 8,
      };

      // Streak ending 3 days ago = 5 → 1.5x → 15.
      expect(calculatePointsForDate([habit], d(3))).toBe(15);
      // Today's streak = 8 → 2.0x → 20.
      expect(calculatePointsForDate([habit], today)).toBe(20);
    });

    it('returns 0 when the habit was not completed on the target date', () => {
      const habit: Habit = {
        ...baseHabit,
        count: 1,
        totalCount: 1,
        completedDates: [today],
      };
      expect(calculatePointsForDate([habit], yesterday)).toBe(0);
    });
  });
});
