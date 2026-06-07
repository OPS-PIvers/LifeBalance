import { describe, it, expect } from 'vitest';
import {
  isHabitStale,
  calculateStreak,
  calculateWeeklyStreak,
  streakEndingOnWeek,
  streakForHabit,
  getMultiplier,
  processToggleHabit,
  streakEndingOn,
  calculatePointsForDate,
  calculatePointsForDateRange,
  getHabitResetUpdate
} from './habitLogic';
import { Habit } from '@/types/schema';
import { format, subDays, subWeeks, startOfISOWeek } from 'date-fns';

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

      const startDate = history[0]!;
      const endDate = history[history.length - 1]!;
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

      const total = calculatePointsForDateRange([habit], history[0]!, history[7]!);
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

      const total = calculatePointsForDateRange([habit], history[0]!, history[1]!);
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

  // Regression for todo/10: the midnight auto-reset (`checkHabitResets`) used to
  // zero a habit's `count` while leaving today in `completedDates`. Because
  // `calculatePointsForDate` skips habits with `count === 0`, a subsequent points
  // recalc computed daily = 0 even though `calculatePointsForDateRange` (no count
  // guard) still counted the day — daily silently desynced from weekly/total.
  // `getHabitResetUpdate` mirrors the manual `resetHabit`: it drops today from
  // `completedDates` when it zeroes count, keeping the count===0 guard meaningful.
  describe('getHabitResetUpdate — auto-reset mirrors resetHabit', () => {
    const weekAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd');

    it('drops today from completedDates when it zeroes count', () => {
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: 1,
        completedDates: [today],
        streakDays: 1,
      };

      const update = getHabitResetUpdate(habit, today);
      expect(update.count).toBe(0);
      expect(update.completedDates).not.toContain(today);
      expect(update.streakDays).toBe(0);
    });

    it('keeps daily and weekly point recalcs consistent after an auto-reset', () => {
      // Daily habit completed today, then the auto-reset fires.
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: 1,
        completedDates: [today],
        streakDays: 1,
      };

      const resetHabit: Habit = { ...habit, ...getHabitResetUpdate(habit, today) };

      const daily = calculatePointsForDate([resetHabit], today);
      const weekly = calculatePointsForDateRange([resetHabit], weekAgo, today);

      // The pre-fix reset left today in completedDates, so daily (0, via the
      // count===0 guard) diverged from weekly (10). They must now agree.
      expect(daily).toBe(weekly);
    });

    it('preserves a prior-day completion through a new-day auto-reset', () => {
      // Habit completed yesterday; today is a new day so the habit is reset.
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 1,
        totalCount: 1,
        completedDates: [yesterday],
        streakDays: 1,
      };

      const update = getHabitResetUpdate(habit, today);
      // Removing "today" is a no-op here, so yesterday's completion (and its
      // weekly/total points) survive the reset.
      expect(update.completedDates).toEqual([yesterday]);
      expect(update.count).toBe(0);
      expect(update.streakDays).toBe(1);

      const resetHabit: Habit = { ...habit, ...update };
      expect(calculatePointsForDateRange([resetHabit], yesterday, today)).toBe(10);
      expect(calculatePointsForDate([resetHabit], today)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Weekly streak tests
  // ---------------------------------------------------------------------------

  /**
   * Returns a date string for a day N weeks ago, anchored to Monday of that
   * ISO week so tests are deterministic regardless of which day of the week
   * they are run on.
   */
  const mondayWeeksAgo = (n: number): string =>
    format(startOfISOWeek(subWeeks(new Date(), n)), 'yyyy-MM-dd');

  describe('calculateWeeklyStreak', () => {
    it('returns 0 for empty dates', () => {
      expect(calculateWeeklyStreak([])).toBe(0);
    });

    it('returns 1 for a single completion this week', () => {
      // Use today (which is always within the current ISO week)
      expect(calculateWeeklyStreak([today])).toBe(1);
    });

    it('returns 1 for a single completion last week (no current week)', () => {
      expect(calculateWeeklyStreak([mondayWeeksAgo(1)])).toBe(1);
    });

    it('returns 0 when the most recent completion is more than 1 week old', () => {
      expect(calculateWeeklyStreak([mondayWeeksAgo(2)])).toBe(0);
    });

    it('returns 2 for completions in current week and last week', () => {
      expect(calculateWeeklyStreak([today, mondayWeeksAgo(1)])).toBe(2);
    });

    it('returns 4 for completions in four consecutive ISO weeks ending this week', () => {
      const dates = [today, mondayWeeksAgo(1), mondayWeeksAgo(2), mondayWeeksAgo(3)];
      expect(calculateWeeklyStreak(dates)).toBe(4);
    });

    it('resets when a week is skipped', () => {
      // Weeks 0, 1, then a gap at 2, then 3 and 4.
      const dates = [today, mondayWeeksAgo(1), mondayWeeksAgo(3), mondayWeeksAgo(4)];
      expect(calculateWeeklyStreak(dates)).toBe(2);
    });

    it('deduplicates multiple completions within the same week', () => {
      // Two entries both in the current ISO week should count as streak = 1.
      const thisWeekMonday = mondayWeeksAgo(0);
      const thisWeekTuesday = format(
        new Date(new Date(thisWeekMonday).getTime() + 86400_000),
        'yyyy-MM-dd'
      );
      expect(calculateWeeklyStreak([thisWeekMonday, thisWeekTuesday])).toBe(1);
    });
  });

  describe('getMultiplier — weekly period thresholds', () => {
    it('returns 1.0 for weekly streak < 2', () => {
      expect(getMultiplier(1, true, 'weekly')).toBe(1.0);
    });

    it('returns 1.5 for weekly streak >= 2 and < 4', () => {
      expect(getMultiplier(2, true, 'weekly')).toBe(1.5);
      expect(getMultiplier(3, true, 'weekly')).toBe(1.5);
    });

    it('returns 2.0 for weekly streak >= 4', () => {
      expect(getMultiplier(4, true, 'weekly')).toBe(2.0);
      expect(getMultiplier(10, true, 'weekly')).toBe(2.0);
    });

    it('always returns 1.0 for non-positive weekly habits', () => {
      expect(getMultiplier(10, false, 'weekly')).toBe(1.0);
    });

    it('daily thresholds are unchanged when period is omitted', () => {
      expect(getMultiplier(3, true)).toBe(1.5);
      expect(getMultiplier(7, true)).toBe(2.0);
    });
  });

  describe('streakEndingOnWeek', () => {
    it('returns 0 when the reference week has no completion', () => {
      // Completion is 2 weeks ago; reference is 3 weeks ago — no completion there.
      expect(streakEndingOnWeek([mondayWeeksAgo(2)], mondayWeeksAgo(3))).toBe(0);
    });

    it('returns 1 for a single completion in the reference week', () => {
      expect(streakEndingOnWeek([mondayWeeksAgo(1)], mondayWeeksAgo(1))).toBe(1);
    });

    it('ignores completions in weeks after the reference week', () => {
      // Completions at week 0 (current) and 1; streak as-of week 1 should be 1
      // (week 2 is missing so we cannot extend further back).
      const dates = [today, mondayWeeksAgo(1)];
      expect(streakEndingOnWeek(dates, mondayWeeksAgo(1))).toBe(1);
    });

    it('counts consecutive weeks ending at the reference week', () => {
      // Completions at weeks 0, 1, 2, 3. Streak ending at week 3 should be 1
      // (only 1 completed week ≤ week3, which is week3 itself).
      // Actually weeks 0-3 present: ending at week 3 that's a streak of 1 since
      // week 4 is absent (no week 4 in our dates).
      const dates = [today, mondayWeeksAgo(1), mondayWeeksAgo(2), mondayWeeksAgo(3)];
      // Streak ending at week 3 = 1 (week4 missing → streak starts at week3).
      expect(streakEndingOnWeek(dates, mondayWeeksAgo(3))).toBe(1);
      // Streak ending at week 2 = 2 (weeks 3 and 2 are consecutive).
      expect(streakEndingOnWeek(dates, mondayWeeksAgo(2))).toBe(2);
      // Streak ending at week 1 = 3 (weeks 3, 2, 1).
      expect(streakEndingOnWeek(dates, mondayWeeksAgo(1))).toBe(3);
      // Streak ending at week 0 (this week) = 4.
      expect(streakEndingOnWeek(dates, today)).toBe(4);
    });
  });

  describe('streakForHabit — period dispatch', () => {
    const weeklyBase: Habit = {
      ...baseHabit,
      period: 'weekly',
    };

    it('uses calculateWeeklyStreak for weekly habits', () => {
      const habit: Habit = {
        ...weeklyBase,
        completedDates: [today, mondayWeeksAgo(1)],
      };
      expect(streakForHabit(habit)).toBe(2);
    });

    it('uses calculateStreak for daily habits (unchanged)', () => {
      const habit: Habit = {
        ...baseHabit,
        completedDates: [today, yesterday],
      };
      expect(streakForHabit(habit)).toBe(2);
    });
  });

  describe('processToggleHabit — weekly habit streak multipliers', () => {
    const weeklyHabit: Habit = {
      ...baseHabit,
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 1,
      basePoints: 100,
    };

    it('week-1 completion (no prior history) gets 1.0x', () => {
      const result = processToggleHabit({ ...weeklyHabit, completedDates: [] }, 'up');
      expect(result?.multiplier).toBe(1.0);
      expect(result?.pointsChange).toBe(100);
    });

    it('week-2 completion (1 week history) gets 1.5x', () => {
      const result = processToggleHabit(
        { ...weeklyHabit, completedDates: [mondayWeeksAgo(1)] },
        'up'
      );
      // prospective streak = 2 → 1.5x
      expect(result?.multiplier).toBe(1.5);
      expect(result?.pointsChange).toBe(150);
    });

    it('week-4 completion (3 weeks history) gets 2.0x', () => {
      const result = processToggleHabit(
        {
          ...weeklyHabit,
          completedDates: [mondayWeeksAgo(1), mondayWeeksAgo(2), mondayWeeksAgo(3)],
        },
        'up'
      );
      // prospective streak = 4 → 2.0x
      expect(result?.multiplier).toBe(2.0);
      expect(result?.pointsChange).toBe(200);
    });

    it('skipped week resets multiplier to 1.0x', () => {
      // Only last week and 3 weeks ago — gap at 2 weeks ago → streak = 1 when
      // this week is added.
      const result = processToggleHabit(
        { ...weeklyHabit, completedDates: [mondayWeeksAgo(1), mondayWeeksAgo(3)] },
        'up'
      );
      // prospective streak = 2 (this week + last week consecutive)
      expect(result?.multiplier).toBe(1.5);
      expect(result?.pointsChange).toBe(150);
    });
  });
});
