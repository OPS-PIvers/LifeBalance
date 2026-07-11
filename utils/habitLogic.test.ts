import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isHabitStale,
  calculateStreak,
  calculateWeeklyStreak,
  streakEndingOnWeek,
  streakForHabit,
  streakEndingOnForHabit,
  getMultiplier,
  processToggleHabit,
  calculateResetPoints,
  streakEndingOn,
  calculatePointsForDate,
  calculatePointsForDateRange,
  getHabitResetUpdate,
  computeHouseholdPointsSync,
  computeManagedMemberPointsReset,
  isHabitCompletedInCurrentPeriod,
  normalizeHabitTitle,
  habitSign,
  habitPointsMagnitude,
  signedHabitPoints,
  pointsForHabitOnDate,
  calculateDayNetPoints
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

    it('honors an explicit injected today for deterministic boundary behavior', () => {
      // Fixed dates independent of the real clock. With injected today = Jan 3,
      // the consecutive run Jan 1-3 is a streak of 3.
      const fixed = ['2025-01-03', '2025-01-02', '2025-01-01'];
      expect(calculateStreak(fixed, '2025-01-03')).toBe(3);
      // If "today" is Jan 4, the most recent completion (Jan 3) is yesterday →
      // streak still counts (ends yesterday) = 3.
      expect(calculateStreak(fixed, '2025-01-04')).toBe(3);
      // If "today" is Jan 5, the most recent completion (Jan 3) is 2 days ago →
      // no current streak.
      expect(calculateStreak(fixed, '2025-01-05')).toBe(0);
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

    it('uses habit.count for today on a WEEKLY incremental habit, 1 for past days', () => {
      // Weekly incremental habit toggled 3 times today, plus one completion in
      // each of the 2 prior ISO weeks. Today's week is the 3rd consecutive ISO
      // week (streak 3 → 1.5x for weekly), past weeks have their own streaks.
      const weekStartStr = mondayWeeksAgo(0);
      const habit: Habit = {
        ...baseHabit,
        period: 'weekly',
        scoringType: 'incremental',
        basePoints: 10,
        count: 3, // 3 completions today
        totalCount: 5,
        completedDates: [today, mondayWeeksAgo(1), mondayWeeksAgo(2)],
        streakDays: 3,
      };

      // Range = just this ISO week so only today's completion is in range.
      const total = calculatePointsForDateRange([habit], weekStartStr, today);

      // Today is the only in-range completion. Streak ending this week = 3 → 1.5x
      // → perDay = floor(10 * 1.5) = 15. count=3 → 3 * 15 = 45.
      // Before the fix this counted only 1 completion (15), erasing earned points.
      expect(total).toBe(45);
    });

    it('counts past in-range weekly incremental days as 1 each', () => {
      // Full 3-week range: each past week counts as a single completion, today
      // uses habit.count.
      const habit: Habit = {
        ...baseHabit,
        period: 'weekly',
        scoringType: 'incremental',
        basePoints: 10,
        count: 3, // 3 completions today
        totalCount: 5,
        completedDates: [today, mondayWeeksAgo(1), mondayWeeksAgo(2)],
        streakDays: 3,
      };

      const total = calculatePointsForDateRange([habit], mondayWeeksAgo(2), today);

      // Per-week streaks ending at each completion's week:
      //   2 weeks ago → streak 1 → 1.0x → 10, counts as 1 completion → 10
      //   1 week ago  → streak 2 → 1.5x → 15, counts as 1 completion → 15
      //   this week   → streak 3 → 1.5x → 15, count=3 → 45
      // Total = 10 + 15 + 45 = 70.
      expect(total).toBe(70);
    });
  });

  // Weekly habits accumulate `count` across the whole ISO week and push every
  // later toggle-day into completedDates, so the recomputes must score each
  // ISO WEEK once — not each completion day independently (which over-counted
  // and let the corrective sync write unearned points).
  describe('weekly habits with multiple completion days in one ISO week', () => {
    // Deterministic mid-week clock: Wed 2026-06-03 (ISO week starts Mon 2026-06-01).
    const WED = '2026-06-03';
    const TUE = '2026-06-02';
    const MON = '2026-06-01';
    const PREV_MON = '2026-05-25';
    const PREV_WED = '2026-05-27';

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-03T12:00:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const weeklyHabit = (overrides: Partial<Habit>): Habit => ({
      ...baseHabit,
      period: 'weekly',
      lastUpdated: new Date().toISOString(),
      ...overrides,
    });

    describe('calculatePointsForDateRange', () => {
      it('incremental: scores the current week ONCE with habit.count, not per completion day', () => {
        // 2 toggles Monday (+20), 1 toggle Wednesday (+10): count=3, credited 30.
        const habit = weeklyHabit({
          scoringType: 'incremental',
          basePoints: 10,
          count: 3,
          totalCount: 3,
          completedDates: [MON, WED],
          streakDays: 1,
        });
        // Buggy per-day scoring: Mon 1x10 + Wed count(3)x10 = 40.
        expect(calculatePointsForDateRange([habit], MON, WED)).toBe(30);
      });

      it('threshold: awards at most once per week even with several completion days', () => {
        // "Gym 3x/week": completed Monday (+50), toggled again Wednesday (0 pts).
        const habit = weeklyHabit({
          scoringType: 'threshold',
          basePoints: 50,
          targetCount: 3,
          count: 4,
          totalCount: 4,
          completedDates: [MON, WED],
          streakDays: 1,
        });
        // Buggy per-day scoring: 50 + 50 = 100.
        expect(calculatePointsForDateRange([habit], MON, WED)).toBe(50);
      });

      it('threshold: collapses a PAST week with multiple completion days into one award', () => {
        const habit = weeklyHabit({
          scoringType: 'threshold',
          basePoints: 10,
          targetCount: 1,
          count: 1,
          totalCount: 3,
          completedDates: [PREV_MON, PREV_WED, WED],
          streakDays: 2,
        });
        // Prev week (streak 1 → 1.0x) once = 10; current week (streak 2 → 1.5x) once = 15.
        // Buggy per-day scoring: 10 + 10 + 15 = 35.
        expect(calculatePointsForDateRange([habit], PREV_MON, WED)).toBe(25);
      });

      it('threshold: current week earns nothing when the counter is back below target', () => {
        // Completed Monday then toggled back below target later: only "today" is
        // stripped from completedDates, so Monday remains while count < target.
        const habit = weeklyHabit({
          scoringType: 'threshold',
          basePoints: 50,
          targetCount: 3,
          count: 2,
          totalCount: 2,
          completedDates: [MON],
          streakDays: 1,
        });
        expect(calculatePointsForDateRange([habit], MON, WED)).toBe(0);
      });
    });

    describe('calculatePointsForDate', () => {
      it('incremental: attributes only the remainder of habit.count to today, 1 to earlier week days', () => {
        // count=3 across [Mon, Wed]: Wed (latest) gets count - 1 = 2, Mon gets 1.
        const habit = weeklyHabit({
          scoringType: 'incremental',
          basePoints: 10,
          count: 3,
          totalCount: 3,
          completedDates: [MON, WED],
          streakDays: 1,
        });
        // Buggy: count(3) x 10 = 30 written to points.daily by the corrective sync.
        expect(calculatePointsForDate([habit], WED)).toBe(20);
        expect(calculatePointsForDate([habit], MON)).toBe(10);
        // Per-day attributions sum to the week total from the range recompute.
        expect(calculatePointsForDate([habit], WED) + calculatePointsForDate([habit], MON)).toBe(
          calculatePointsForDateRange([habit], MON, WED)
        );
      });

      it('threshold: credits only the FIRST completed day of the week, not later toggle-days', () => {
        // Completed Tuesday (+10); Wednesday's toggle pushed WED into
        // completedDates with zero points awarded.
        const habit = weeklyHabit({
          scoringType: 'threshold',
          basePoints: 10,
          targetCount: 2,
          count: 3,
          totalCount: 3,
          completedDates: [TUE, WED],
          streakDays: 1,
        });
        // Buggy: Wednesday's recompute returned +10 unearned daily points.
        expect(calculatePointsForDate([habit], WED)).toBe(0);
        expect(calculatePointsForDate([habit], TUE)).toBe(10);
      });

      it('threshold: awards a completed PAST week even while the current week is below target', () => {
        // The live counter only describes the CURRENT week — a past week's
        // presence in completedDates proves it was completed, so the current
        // week sitting below target must not zero out the past week's award
        // (mirrors the isCurrentWeek bypass in calculatePointsForDateRange).
        const habit = weeklyHabit({
          scoringType: 'threshold',
          basePoints: 10,
          targetCount: 3,
          count: 1, // current week: 1 of 3 so far
          totalCount: 4,
          completedDates: [PREV_MON, PREV_WED, WED],
          streakDays: 2,
        });
        // Past week: award on its FIRST completed day (streak 1 → 1.0x → 10).
        expect(calculatePointsForDate([habit], PREV_MON)).toBe(10);
        expect(calculatePointsForDate([habit], PREV_WED)).toBe(0);
        // Current week still gated on the live counter.
        expect(calculatePointsForDate([habit], WED)).toBe(0);
      });

      it('threshold: a PAST week still scores after the week-rollover reset zeroed count', () => {
        // Completed last week; this week's rollover reset count to 0. The
        // count===0 short-circuit must not erase the past week's completion
        // (regression: §2C audit — the guard applied regardless of target date).
        const habit = weeklyHabit({
          scoringType: 'threshold',
          basePoints: 10,
          targetCount: 1,
          count: 0, // week rolled over, nothing done this week yet
          totalCount: 1,
          completedDates: [PREV_MON],
          streakDays: 0,
        });
        // Past week: streak ending there = 1 → 1.0x → 10 (pre-fix: 0).
        expect(calculatePointsForDate([habit], PREV_MON)).toBe(10);
        expect(calculatePointsForDate([habit], PREV_MON)).toBe(
          calculatePointsForDateRange([habit], PREV_MON, PREV_MON)
        );
      });
    });
  });

  describe('calculateResetPoints', () => {
    const twoDaysAgo = format(subDays(new Date(), 2), 'yyyy-MM-dd');

    it('returns 0 when count is 0', () => {
      expect(calculateResetPoints({ ...baseHabit, count: 0 })).toBe(0);
    });

    it('deducts pre-completion increments at the WITHOUT-today multiplier (mirrors the award path)', () => {
      // Incremental, targetCount 2, base 10, 2-day streak entering today.
      // Toggle #1 (before target): prospective streak excludes today → 1.0x → +10.
      // Toggle #2 (completes):     prospective streak includes today → 1.5x → +15.
      // Credited +25; the buggy reset deducted 2 x 15 = 30, leaving points 5 short.
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'incremental',
        targetCount: 2,
        basePoints: 10,
        count: 2,
        totalCount: 2,
        completedDates: [today, yesterday, twoDaysAgo],
        streakDays: 3,
      };
      expect(calculateResetPoints(habit)).toBe(25);
    });

    it('deducts every increment at the with-today multiplier when the target is 1 (unchanged)', () => {
      // With targetCount 1 the first toggle already completes the day, so ALL
      // increments were credited at the with-today streak multiplier.
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'incremental',
        targetCount: 1,
        basePoints: 10,
        count: 3,
        totalCount: 3,
        completedDates: [today, yesterday, twoDaysAgo],
        streakDays: 3,
      };
      // Streak 3 → 1.5x → 3 x 15 = 45.
      expect(calculateResetPoints(habit)).toBe(45);
    });

    it('deducts the single threshold award at the with-today multiplier (unchanged)', () => {
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 2,
        basePoints: 10,
        count: 2,
        totalCount: 2,
        completedDates: [today, yesterday, twoDaysAgo],
        streakDays: 3,
      };
      // Streak 3 → 1.5x → 15.
      expect(calculateResetPoints(habit)).toBe(15);
    });

    it('uses 1.0x throughout for negative habits', () => {
      const habit: Habit = {
        ...baseHabit,
        type: 'negative',
        scoringType: 'incremental',
        targetCount: 2,
        basePoints: 10,
        count: 2,
        totalCount: 2,
        completedDates: [today, yesterday, twoDaysAgo],
        streakDays: 3,
      };
      // Negative habits never get streak multipliers: -1 x 2 x 10 = -20.
      expect(calculateResetPoints(habit)).toBe(-20);
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

    it('excludes assigned (per-member/kid chore) habits from the household recompute (Plan 080c)', () => {
      const shared: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        count: 1,
        totalCount: 1,
        completedDates: [today],
      };
      const kidChore: Habit = { ...shared, id: 'h2', assignedTo: 'kid_leo' };

      // Assigned chores credit the assignee's own member.points, so they must NOT
      // be summed into the shared household pool (else they'd be double-counted).
      expect(calculatePointsForDate([shared, kidChore], today)).toBe(10);
      expect(calculatePointsForDate([kidChore], today)).toBe(0);
      expect(calculatePointsForDateRange([shared, kidChore], today, today)).toBe(10);
      expect(calculatePointsForDateRange([kidChore], today, today)).toBe(0);
    });

    it('scopes to one member when an assignedTo uid is passed (Plan 080c-2)', () => {
      const make = (id: string, assignedTo?: string): Habit => ({
        ...baseHabit,
        id,
        scoringType: 'threshold',
        count: 1,
        totalCount: 1,
        completedDates: [today],
        assignedTo,
      });
      const all = [make('h1'), make('h2', 'kid_leo'), make('h3', 'kid_mia')];

      // Member scope counts ONLY that member's chores, ignoring shared + other kids.
      expect(calculatePointsForDate(all, today, 'kid_leo')).toBe(10);
      expect(calculatePointsForDateRange(all, today, today, 'kid_leo')).toBe(10);
      // A member with no completed chore scores 0.
      expect(calculatePointsForDate([make('h1'), make('h3', 'kid_mia')], today, 'kid_leo')).toBe(0);
    });
  });

  // Regression (§2C audit): the live `count` is zeroed by every period reset, so
  // the count===0 short-circuit (and the threshold/incremental counter reads)
  // must only apply when the target date falls in the CURRENT period. For a
  // historical date, presence in completedDates proves the completion —
  // otherwise every points recalc after a reset silently drops history and the
  // per-date totals drift away from calculatePointsForDateRange.
  describe('calculatePointsForDate — reset counter must not erase history', () => {
    it('daily threshold: a past completion still scores after the midnight reset zeroed count', () => {
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 10,
        count: 0, // midnight auto-reset already ran
        totalCount: 1,
        completedDates: [yesterday],
        streakDays: 1,
      };
      // Pre-fix: the count===0 guard returned 0 for yesterday.
      expect(calculatePointsForDate([habit], yesterday)).toBe(10);
      // And it agrees with the range recompute for the same day.
      expect(calculatePointsForDate([habit], yesterday)).toBe(
        calculatePointsForDateRange([habit], yesterday, yesterday)
      );
    });

    it('daily incremental: a past day scores as ONE completion, not the live counter', () => {
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'incremental',
        targetCount: 1,
        basePoints: 10,
        count: 3, // 3 completions made TODAY
        totalCount: 4,
        completedDates: [today, yesterday],
        streakDays: 2,
      };
      // Yesterday: streak ending there = 1 → 1.0x → 1 × 10 (pre-fix: 3 × 10).
      expect(calculatePointsForDate([habit], yesterday)).toBe(10);
      // Today keeps the live-counter behavior: streak 2 → 1.0x → 3 × 10.
      expect(calculatePointsForDate([habit], today)).toBe(30);
    });

    it('daily threshold: a past day scores even while today sits below target', () => {
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'threshold',
        targetCount: 3,
        basePoints: 10,
        count: 1, // today: 1 of 3 so far
        totalCount: 4,
        completedDates: [yesterday],
        streakDays: 1,
      };
      expect(calculatePointsForDate([habit], yesterday)).toBe(10);
    });

    it('today with a zeroed counter still scores 0 (guard preserved)', () => {
      const habit: Habit = {
        ...baseHabit,
        scoringType: 'incremental',
        targetCount: 1,
        basePoints: 10,
        count: 0,
        totalCount: 1,
        completedDates: [today], // manual-reset edge: today still listed
        streakDays: 1,
      };
      expect(calculatePointsForDate([habit], today)).toBe(0);
    });
  });

  describe('computeManagedMemberPointsReset (Plan 080c-2)', () => {
    const weekStartStr = format(startOfISOWeek(new Date()), 'yyyy-MM-dd');
    const makeChore = (id: string, assignedTo: string): Habit => ({
      ...baseHabit,
      id,
      scoringType: 'threshold',
      count: 1,
      totalCount: 1,
      completedDates: [today],
      assignedTo,
    });

    it("returns each managed kid's daily/weekly from their own chores", () => {
      const members = [
        { uid: 'parent1', isManaged: false },
        { uid: 'kid_leo', isManaged: true },
        { uid: 'kid_mia', isManaged: true },
      ];
      const habits = [
        makeChore('h1', 'kid_leo'),
        makeChore('h2', 'kid_mia'),
        makeChore('h3', 'kid_leo'),
      ];

      const result = computeManagedMemberPointsReset(members, habits, weekStartStr, today);

      expect(result).toHaveLength(2);
      // Leo has two completed chores (20), Mia one (10).
      expect(result.find(r => r.memberUid === 'kid_leo')).toEqual({
        memberUid: 'kid_leo',
        daily: 20,
        weekly: 20,
      });
      expect(result.find(r => r.memberUid === 'kid_mia')).toEqual({
        memberUid: 'kid_mia',
        daily: 10,
        weekly: 10,
      });
    });

    it('skips non-managed members and managed kids with no assigned chore', () => {
      const members = [
        { uid: 'parent1', isManaged: false },
        { uid: 'kid_leo', isManaged: true }, // has a chore
        { uid: 'kid_nochores', isManaged: true }, // none assigned
      ];
      const result = computeManagedMemberPointsReset(
        members,
        [makeChore('h1', 'kid_leo')],
        weekStartStr,
        today,
      );
      expect(result.map(r => r.memberUid)).toEqual(['kid_leo']);
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

    it('preserves the ISO-week streak for a weekly habit on reset', () => {
      // Weekly habit completed in this week + the 2 prior ISO weeks (streak = 3).
      // The midnight reset drops today's completion but the remaining ISO-week
      // streak must be computed with the WEEKLY algorithm, not the daily one
      // (which would have collapsed it to ~0).
      const habit: Habit = {
        ...baseHabit,
        period: 'weekly',
        scoringType: 'threshold',
        targetCount: 1,
        basePoints: 100,
        count: 1,
        totalCount: 3,
        completedDates: [today, mondayWeeksAgo(1), mondayWeeksAgo(2)],
        streakDays: 3,
      };

      const update = getHabitResetUpdate(habit, today);
      expect(update.count).toBe(0);
      expect(update.completedDates).not.toContain(today);
      // Remaining completions are in last week + 2 weeks ago = 2 consecutive
      // ISO weeks. A daily streak calc would have returned 0/1 here.
      expect(update.streakDays).toBe(2);
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

    it('honors an explicit injected today for deterministic boundary behavior', () => {
      // Fixed ISO weeks: Mondays 2025-01-06, 2024-12-30, 2024-12-23 (3 consecutive
      // ISO weeks). Injecting today inside the most recent of those weeks yields a
      // streak of 3, independent of the real clock.
      const weeks = ['2025-01-06', '2024-12-30', '2024-12-23'];
      expect(calculateWeeklyStreak(weeks, '2025-01-08')).toBe(3); // today in 01-06 week
      // Injecting today in the week AFTER the latest completion → latest is the
      // previous ISO week, streak still extends = 3.
      expect(calculateWeeklyStreak(weeks, '2025-01-13')).toBe(3);
      // Two ISO weeks after the latest completion → no current streak.
      expect(calculateWeeklyStreak(weeks, '2025-01-20')).toBe(0);
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

  // Regression test for the habit-submission backfill bug
  // (pages/MigrateSubmissions.tsx + scripts/migrateHabitSubmissions.ts).
  //
  // The backfill previously computed each historical day's streak with
  // `calculateStreak(datesUpToNow)`, which returns the streak ending TODAY/yesterday
  // and therefore 0 for every PAST date — so all backfilled submissions were written
  // with streakDaysAtTime=0 / multiplier=1.0 even on days that earned a bonus. The fix
  // is `streakEndingOnForHabit({ period, completedDates }, date)`, which reconstructs the
  // streak that ended ON that specific date. This block proves the primitive the backfill
  // now relies on assigns each day the streak its own position warranted (1,2,3,…) and the
  // correct per-period multiplier, including for weekly habits.
  describe('streakEndingOnForHabit — backfill historical streak reconstruction', () => {
    // Fixed, real-calendar streak: 2026-06-01 .. 2026-06-10 (10 consecutive days).
    const dailyStreak = [
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05',
      '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10',
    ];

    it('daily: assigns each historical day the streak its own position warranted (not 0)', () => {
      const habit = { period: 'daily' as const, completedDates: dailyStreak };
      // The whole point of the fix: a mid-streak past day is NON-zero.
      expect(streakEndingOnForHabit(habit, '2026-06-05')).toBe(5);
      // Each day equals its 1-based position in the run.
      dailyStreak.forEach((date, idx) => {
        expect(streakEndingOnForHabit(habit, date)).toBe(idx + 1);
      });
    });

    it('daily: the buggy calculateStreak primitive returned 0 for those same past days', () => {
      // Documents WHY the fix was needed: calculateStreak anchors on today/yesterday,
      // so a 2026 history is "stale" and every day scores 0.
      expect(calculateStreak(dailyStreak, '2026-06-20')).toBe(0);
    });

    it('daily: drives the correct per-period multiplier on each backfilled day', () => {
      const habit = { period: 'daily' as const, completedDates: dailyStreak };
      // Days 1-2 → 1.0x, days 3-6 → 1.5x, days 7-10 → 2.0x (daily thresholds: 3→1.5, 7→2.0).
      const expectedMultiplier = [1.0, 1.0, 1.5, 1.5, 1.5, 1.5, 2.0, 2.0, 2.0, 2.0];
      dailyStreak.forEach((date, idx) => {
        const streak = streakEndingOnForHabit(habit, date);
        expect(getMultiplier(streak, true, 'daily')).toBe(expectedMultiplier[idx]);
      });
    });

    it('weekly: reconstructs the ISO-week streak (not the daily streak) for past weeks', () => {
      // One completion per ISO week for 4 consecutive weeks ending this week.
      const weekly = [mondayWeeksAgo(3), mondayWeeksAgo(2), mondayWeeksAgo(1), today];
      const habit = { period: 'weekly' as const, completedDates: weekly };

      // Week-based streak, not day-based.
      expect(streakEndingOnForHabit(habit, mondayWeeksAgo(3))).toBe(1);
      expect(streakEndingOnForHabit(habit, mondayWeeksAgo(2))).toBe(2);
      expect(streakEndingOnForHabit(habit, mondayWeeksAgo(1))).toBe(3);
      expect(streakEndingOnForHabit(habit, today)).toBe(4);

      // Per-period multipliers (weekly thresholds: 2→1.5, 4→2.0).
      expect(getMultiplier(streakEndingOnForHabit(habit, mondayWeeksAgo(3)), true, 'weekly')).toBe(1.0);
      expect(getMultiplier(streakEndingOnForHabit(habit, mondayWeeksAgo(1)), true, 'weekly')).toBe(1.5);
      expect(getMultiplier(streakEndingOnForHabit(habit, today), true, 'weekly')).toBe(2.0);
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

  describe('computeHouseholdPointsSync', () => {
    // Fixed Monday so `today` === start-of-week, keeping the date math simple
    // and timezone-stable (noon local avoids day rollover at any UTC offset).
    const now = new Date(2025, 5, 9, 12, 0, 0); // Mon 2025-06-09
    const todayStr = '2025-06-09';
    const lastWeek = '2025-06-02'; // a prior Monday, before this week's start

    const dailyHabit: Habit = {
      ...baseHabit,
      scoringType: 'incremental',
      period: 'daily',
      basePoints: 10,
    };

    it('recomputes daily/weekly/total from completions and flags an update', () => {
      const habits: Habit[] = [
        { ...dailyHabit, count: 1, completedDates: [todayStr] },
      ];
      const result = computeHouseholdPointsSync(
        habits,
        { daily: 0, weekly: 0, total: 0 },
        now
      );
      expect(result.needsUpdate).toBe(true);
      expect(result.points).toEqual({ daily: 10, weekly: 10, total: 10 });
    });

    it('reports no update when stored points already match', () => {
      const habits: Habit[] = [
        { ...dailyHabit, count: 1, completedDates: [todayStr] },
      ];
      const result = computeHouseholdPointsSync(
        habits,
        { daily: 10, weekly: 10, total: 10 },
        now
      );
      expect(result.needsUpdate).toBe(false);
      expect(result.points).toEqual({ daily: 10, weekly: 10, total: 10 });
    });

    it('preserves the cumulative total when completions predate this week', () => {
      // A completion from a prior week means not all completions are this week,
      // so total must not be clamped down to the weekly figure.
      const habits: Habit[] = [
        { ...dailyHabit, count: 1, completedDates: [todayStr, lastWeek] },
      ];
      const result = computeHouseholdPointsSync(
        habits,
        { daily: 10, weekly: 10, total: 200 },
        now
      );
      expect(result.needsUpdate).toBe(false);
      expect(result.points.total).toBe(200);
      expect(result.points.daily).toBe(10);
      expect(result.points.weekly).toBe(10);
    });

    it('zeroes daily/weekly but keeps total when there are no completions', () => {
      const result = computeHouseholdPointsSync(
        [],
        { daily: 5, weekly: 5, total: 100 },
        now
      );
      expect(result.needsUpdate).toBe(true);
      expect(result.points).toEqual({ daily: 0, weekly: 0, total: 100 });
    });
  });

  describe('isHabitCompletedInCurrentPeriod', () => {
    // Deterministic Monday-anchored week: 2026-06-22 (Mon) .. 2026-06-28 (Sun).
    // The previous ISO week's Monday is 2026-06-15.
    const MONDAY = '2026-06-22';
    const WEDNESDAY = '2026-06-24';
    const PREV_WEEK_WED = '2026-06-17';

    it('daily habit: done when today is in completedDates', () => {
      const habit = { period: 'daily', completedDates: [WEDNESDAY] } as Pick<
        Habit,
        'period' | 'completedDates'
      >;
      expect(isHabitCompletedInCurrentPeriod(habit, WEDNESDAY)).toBe(true);
    });

    it('daily habit: not done when today is not in completedDates', () => {
      const habit = { period: 'daily', completedDates: [MONDAY] } as Pick<
        Habit,
        'period' | 'completedDates'
      >;
      // Completed Monday, but "today" is Wednesday → daily check is exact-day.
      expect(isHabitCompletedInCurrentPeriod(habit, WEDNESDAY)).toBe(false);
    });

    it('weekly habit: completed earlier this week reads as done on a later day', () => {
      const habit = { period: 'weekly', completedDates: [MONDAY] } as Pick<
        Habit,
        'period' | 'completedDates'
      >;
      // Completed Monday; asking on Wednesday of the SAME Mon-anchored week → done.
      expect(isHabitCompletedInCurrentPeriod(habit, WEDNESDAY)).toBe(true);
    });

    it('weekly habit: completed last week reads as not done this week', () => {
      const habit = { period: 'weekly', completedDates: [PREV_WEEK_WED] } as Pick<
        Habit,
        'period' | 'completedDates'
      >;
      // Last week's completion does not satisfy the current week.
      expect(isHabitCompletedInCurrentPeriod(habit, WEDNESDAY)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Plan 25 — frozen-date streak semantics.
//
// The "shared parity table" describe block below MUST stay IDENTICAL (same
// inputs, same expectations) to the one in
// functions/src/quickAdd/habitProcessor.test.ts — the client and Cloud
// Functions streak primitives are deliberately kept in lockstep.
//
// Fixed calendar facts: 2026-07-06 is a Monday; "today" is 2026-07-09 (Thu).
// Mondays used by the weekly cases: 2026-06-15, 2026-06-22, 2026-06-29,
// 2026-07-06.
// ---------------------------------------------------------------------------

describe('Plan 25 — frozen dates: shared client/functions parity table', () => {
  const T = '2026-07-09';

  describe('calculateStreak with frozenDates', () => {
    it('frozen yesterday bridges a 3-day streak (streak survives, frozen day NOT counted)', () => {
      expect(calculateStreak(['2026-07-05', '2026-07-06', '2026-07-07'], T, ['2026-07-08'])).toBe(3);
    });

    it('completing today after a frozen yesterday extends the bridged streak', () => {
      expect(
        calculateStreak(['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-09'], T, ['2026-07-08'])
      ).toBe(4);
    });

    it('two consecutive frozen days both bridge', () => {
      expect(
        calculateStreak(['2026-07-04', '2026-07-05', '2026-07-06'], T, ['2026-07-07', '2026-07-08'])
      ).toBe(3);
    });

    it('without the frozen date the streak breaks (regression anchor)', () => {
      expect(calculateStreak(['2026-07-05', '2026-07-06', '2026-07-07'], T)).toBe(0);
      expect(calculateStreak(['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-09'], T)).toBe(1);
    });

    it('frozen dates alone never create a streak (no completions)', () => {
      expect(calculateStreak([], T, ['2026-07-08'])).toBe(0);
    });

    it('a date in BOTH completed and frozen counts as a completion (completion wins)', () => {
      // Auto-apply can never create this overlap, but locking the resolution
      // keeps client/functions from diverging if the code is edited later.
      expect(
        calculateStreak(['2026-07-07', '2026-07-08', '2026-07-09'], T, ['2026-07-08'])
      ).toBe(3);
    });

    it('a frozen date deep in the past does not resurrect a dead streak', () => {
      expect(calculateStreak(['2026-07-01'], T, ['2026-07-02'])).toBe(0);
    });
  });

  describe('calculateWeeklyStreak with frozenDates', () => {
    it('a frozen day bridges an otherwise-empty ISO week', () => {
      // Weeks 06-15 and 06-22 completed; week 06-29 has only a frozen day
      // (bridge, not counted); week 07-06 completed → 3 completed weeks.
      expect(
        calculateWeeklyStreak(['2026-06-16', '2026-06-22', '2026-07-07'], T, ['2026-06-30'])
      ).toBe(3);
    });

    it('without the frozen day the weekly streak resets at the gap week', () => {
      expect(calculateWeeklyStreak(['2026-06-16', '2026-06-22', '2026-07-07'], T)).toBe(1);
    });

    it('a frozen current week keeps the chain anchored on a completed prior week', () => {
      expect(calculateWeeklyStreak(['2026-06-29'], T, ['2026-07-08'])).toBe(1);
    });
  });

  describe('getMultiplier continuity across a frozen bridge', () => {
    it('daily: the bridged 4-completion streak earns the 1.5x tier', () => {
      const streak = calculateStreak(
        ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-09'],
        T,
        ['2026-07-08']
      );
      expect(getMultiplier(streak, true, 'daily')).toBe(1.5);
    });
  });
});

// ---------------------------------------------------------------------------
// Plan 25 — client-only frozen-date invariants (points + reset + historical
// reconstruction). Central invariant: a frozen date preserves streak
// CONTINUITY but earns ZERO points.
// ---------------------------------------------------------------------------

describe('Plan 25 — frozen days earn zero points (client points paths)', () => {
  const localToday = format(new Date(), 'yyyy-MM-dd');
  const d = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

  const frozenHabit = (overrides: Partial<Habit> = {}): Habit => ({
    id: 'hf1',
    title: 'Stretch',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 1,
    totalCount: 5,
    // Completed the 3 days before the frozen day, plus today; yesterday frozen.
    completedDates: [localToday, d(2), d(3), d(4)],
    frozenDates: [d(1)],
    streakDays: 4,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  } as Habit);

  it('calculatePointsForDate returns 0 for the frozen day itself', () => {
    expect(calculatePointsForDate([frozenHabit()], d(1))).toBe(0);
  });

  it('calculatePointsForDateRange scores the frozen day as 0 (range covering only it)', () => {
    expect(calculatePointsForDateRange([frozenHabit()], d(1), d(1))).toBe(0);
  });

  it("today's recalculated points get the bridged-streak multiplier (continuity)", () => {
    // streakEndingOn(today) = 4 across the frozen bridge → 1.5x → 15 pts.
    expect(calculatePointsForDate([frozenHabit()], localToday)).toBe(15);
    // Without the freeze the same history is a 1-day streak → 1.0x → 10 pts.
    expect(calculatePointsForDate([frozenHabit({ frozenDates: [] })], localToday)).toBe(10);
  });

  it('calculatePointsForDateRange sums per-day multipliers across the bridge, never scoring the frozen day', () => {
    // d4:1 → 10, d3:2 → 10, d2:3 → 15, d1 frozen → 0, today:4 → 15.
    expect(calculatePointsForDateRange([frozenHabit()], d(4), localToday)).toBe(50);
  });

  it('streakEndingOn returns 0 for a frozen (non-completed) date', () => {
    expect(streakEndingOn([d(2), d(3), d(4)], d(1), [d(1)])).toBe(0);
  });

  it('streakEndingOnWeek bridges a frozen week without counting it', () => {
    // Mondays: 2026-06-15, 2026-06-22 completed; 2026-06-29 frozen; 2026-07-06 completed.
    expect(
      streakEndingOnWeek(['2026-06-16', '2026-06-22', '2026-07-07'], '2026-07-07', ['2026-06-30'])
    ).toBe(3);
  });
});

describe('Plan 25 — frozen-aware streak persistence (reset + toggle)', () => {
  const localToday = format(new Date(), 'yyyy-MM-dd');
  const d = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

  it('getHabitResetUpdate keeps the bridged streak across the midnight reset', () => {
    const update = getHabitResetUpdate(
      { period: 'daily', completedDates: [d(2), d(3), d(4)], frozenDates: [d(1)] },
      localToday
    );
    expect(update.streakDays).toBe(3);
    // Without the freeze, the same reset collapses the streak.
    expect(
      getHabitResetUpdate({ period: 'daily', completedDates: [d(2), d(3), d(4)] }, localToday)
        .streakDays
    ).toBe(0);
  });

  it('processToggleHabit awards the bridged-streak multiplier and never completes the frozen day', () => {
    const habit = {
      id: 'hf2',
      title: 'Read',
      category: 'Health',
      type: 'positive',
      basePoints: 10,
      scoringType: 'threshold',
      period: 'daily',
      targetCount: 1,
      count: 0,
      totalCount: 3,
      completedDates: [d(2), d(3), d(4)],
      frozenDates: [d(1)],
      streakDays: 3,
      lastUpdated: new Date().toISOString(),
    } as Habit;

    const result = processToggleHabit(habit, 'up');
    expect(result).not.toBeNull();
    // Prospective streak = 3 completions + today across the frozen bridge = 4 → 1.5x.
    expect(result!.multiplier).toBe(1.5);
    expect(result!.pointsChange).toBe(15);
    expect(result!.updatedHabit.streakDays).toBe(4);
    // The frozen day never enters completedDates.
    expect(result!.updatedHabit.completedDates).not.toContain(d(1));
    expect(result!.updatedHabit.completedDates).toContain(localToday);
  });
});

// TODO.md §2A — client twin of functions/src/quickAdd/habitProcessor.ts's
// normalizeHabitTitle.
describe('normalizeHabitTitle', () => {
  it('lowercases and trims', () => {
    expect(normalizeHabitTitle('  Read Before Bed  ')).toBe('read before bed');
  });

  it('is idempotent on an already-normalized string', () => {
    expect(normalizeHabitTitle('read')).toBe('read');
  });

  it('collapses only leading/trailing whitespace, not internal', () => {
    expect(normalizeHabitTitle(' Drink   Water ')).toBe('drink   water');
  });
});

// Canonical sign handling: habit.type drives the sign, |basePoints| the
// magnitude. Two creation paths historically stored negative habits with
// opposite basePoints signs (wizard: -2, form: 2 + type 'negative'), so every
// scoring/display path must survive BOTH conventions.
describe('habitSign / habitPointsMagnitude / signedHabitPoints', () => {
  const negStoredPositive = { type: 'negative', basePoints: 2 } as Habit;
  const negStoredNegative = { type: 'negative', basePoints: -2 } as Habit;
  const positive = { type: 'positive', basePoints: 10 } as Habit;

  it('derives the sign from type only', () => {
    expect(habitSign(positive)).toBe(1);
    expect(habitSign(negStoredPositive)).toBe(-1);
    expect(habitSign(negStoredNegative)).toBe(-1);
  });

  it('derives the magnitude regardless of stored sign', () => {
    expect(habitPointsMagnitude(negStoredPositive)).toBe(2);
    expect(habitPointsMagnitude(negStoredNegative)).toBe(2);
  });

  it('produces identical signed points for both storage conventions', () => {
    expect(signedHabitPoints(negStoredPositive)).toBe(-2);
    expect(signedHabitPoints(negStoredNegative)).toBe(-2);
    expect(signedHabitPoints(positive, 1.5)).toBe(15);
    // Negative habits never get a streak multiplier (getMultiplier is 1.0),
    // but signedHabitPoints itself must still floor on the magnitude.
    expect(signedHabitPoints(negStoredNegative, 1.5)).toBe(-3);
  });
});

describe('processToggleHabit (negative habit stored with negative basePoints)', () => {
  const localToday = format(new Date(), 'yyyy-MM-dd');

  const wizardNegative = {
    id: 'n1',
    title: 'Skip workout',
    type: 'negative',
    period: 'daily',
    scoringType: 'incremental',
    basePoints: -2, // HabitCreatorWizard convention
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
  } as unknown as Habit;

  it('DEBITS points on up-toggle (raw basePoints double-negated to +2)', () => {
    const result = processToggleHabit(wizardNegative, 'up');
    expect(result).not.toBeNull();
    expect(result!.pointsChange).toBe(-2);
    expect(result!.updatedHabit.completedDates).toContain(localToday);
  });

  it('credits points back on down-toggle', () => {
    const active = { ...wizardNegative, count: 1, totalCount: 1, completedDates: [localToday] };
    const result = processToggleHabit(active, 'down');
    expect(result).not.toBeNull();
    expect(result!.pointsChange).toBe(2);
  });
});

describe('pointsForHabitOnDate', () => {
  const localToday = format(new Date(), 'yyyy-MM-dd');
  const d = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

  const base = {
    id: 'p1',
    type: 'positive',
    period: 'daily',
    scoringType: 'threshold',
    basePoints: 10,
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
  } as unknown as Habit;

  it('returns 0 for a date with no completion', () => {
    expect(pointsForHabitOnDate(base, d(1), localToday)).toBe(0);
  });

  it('scores a past threshold day with the streak that ended on that day', () => {
    // 3-day chain ending on d(1): that day's streak is 3 → 1.5x → 15.
    const habit = { ...base, completedDates: [d(3), d(2), d(1)] };
    expect(pointsForHabitOnDate(habit, d(1), localToday)).toBe(15);
    expect(pointsForHabitOnDate(habit, d(3), localToday)).toBe(10);
  });

  it('is signed for negative habits under both storage conventions', () => {
    const negA = { ...base, type: 'negative', basePoints: 2, scoringType: 'incremental', completedDates: [d(1)] } as Habit;
    const negB = { ...negA, basePoints: -2 } as Habit;
    expect(pointsForHabitOnDate(negA, d(1), localToday)).toBe(-2);
    expect(pointsForHabitOnDate(negB, d(1), localToday)).toBe(-2);
  });

  it('matches calculatePointsForDate summed over habits', () => {
    const h1 = { ...base, completedDates: [d(1)] };
    const h2 = { ...base, id: 'p2', type: 'negative', basePoints: 2, scoringType: 'incremental', completedDates: [d(1)] } as Habit;
    expect(calculatePointsForDate([h1, h2], d(1))).toBe(
      pointsForHabitOnDate(h1, d(1)) + pointsForHabitOnDate(h2, d(1))
    );
  });
});

describe('calculateDayNetPoints', () => {
  const localToday = format(new Date(), 'yyyy-MM-dd');
  const d = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

  const habit = {
    id: 'h1',
    type: 'positive',
    period: 'daily',
    scoringType: 'incremental',
    basePoints: 10,
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [d(1)],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
  } as unknown as Habit;

  it('falls back to the derived per-date attribution without submissions', () => {
    expect(calculateDayNetPoints([habit], d(1), undefined, localToday)).toBe(10);
  });

  it('prefers stored submission totals when present (multi-count backfills)', () => {
    const totals = new Map([[
      'h1', new Map([[d(1), { count: 3, points: 30 }]]),
    ]]);
    expect(calculateDayNetPoints([habit], d(1), totals, localToday)).toBe(30);
  });

  it('sums signed contributions across habits', () => {
    const neg = { ...habit, id: 'h2', type: 'negative', basePoints: 2 } as Habit;
    expect(calculateDayNetPoints([habit, neg], d(1), undefined, localToday)).toBe(8);
  });
});
