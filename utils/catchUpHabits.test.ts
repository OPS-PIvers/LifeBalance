import { describe, it, expect } from 'vitest';
import { getCatchUpEligibleHabits } from '@/utils/catchUpHabits';
import { Habit } from '@/types/schema';

const TODAY = '2026-07-14';
const YESTERDAY = '2026-07-13';

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    title: 'Read',
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
    lastUpdated: YESTERDAY,
    ...overrides,
  };
}

describe('getCatchUpEligibleHabits', () => {
  it('includes a positive habit completed yesterday but not today', () => {
    const habit = makeHabit({ completedDates: [YESTERDAY] });
    expect(getCatchUpEligibleHabits([habit], TODAY, YESTERDAY)).toEqual([habit]);
  });

  it('excludes a habit already completed today', () => {
    const habit = makeHabit({ completedDates: [YESTERDAY, TODAY] });
    expect(getCatchUpEligibleHabits([habit], TODAY, YESTERDAY)).toEqual([]);
  });

  it('excludes a habit not completed yesterday', () => {
    const habit = makeHabit({ completedDates: [] });
    expect(getCatchUpEligibleHabits([habit], TODAY, YESTERDAY)).toEqual([]);
  });

  it('excludes negative habits even if "completed" yesterday', () => {
    const habit = makeHabit({ type: 'negative', completedDates: [YESTERDAY] });
    expect(getCatchUpEligibleHabits([habit], TODAY, YESTERDAY)).toEqual([]);
  });

  it('returns multiple eligible habits, preserving order', () => {
    const a = makeHabit({ id: 'a', completedDates: [YESTERDAY] });
    const b = makeHabit({ id: 'b', completedDates: [YESTERDAY] });
    const c = makeHabit({ id: 'c', completedDates: [TODAY] });
    expect(getCatchUpEligibleHabits([a, b, c], TODAY, YESTERDAY)).toEqual([a, b]);
  });

  it('returns an empty array when given no habits', () => {
    expect(getCatchUpEligibleHabits([], TODAY, YESTERDAY)).toEqual([]);
  });
});
