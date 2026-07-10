import { describe, it, expect } from 'vitest';
import { format, subDays } from 'date-fns';
import { getMissedHabitDates } from './freezeBankValidator';
import { Habit } from '@/types/schema';

// Plan 25: the manual patch validator (canUseFreezeBankToken /
// wouldBenefitFromFreezeToken / suggestFreezeBankDate) was deleted with the
// auto-applied freeze design — its tests went with it. getMissedHabitDates
// survives as the "was yesterday missed" input to the auto-apply candidate
// selection (utils/freezeBank.ts).

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
    ...overrides,
  } as Habit);

const daysAgo = (n: number): string => format(subDays(new Date(), n), 'yyyy-MM-dd');

describe('getMissedHabitDates', () => {
  it('returns no missed dates when there is no completion history', () => {
    expect(getMissedHabitDates(habit({ completedDates: [] }))).toEqual([]);
  });

  it('returns empty for non-positive habits', () => {
    const h = habit({ type: 'negative', completedDates: [daysAgo(2)] });
    expect(getMissedHabitDates(h)).toEqual([]);
  });

  it('does not flag days before the habit ever existed (earliest completion as floor)', () => {
    // Habit first (and only) completed 2 days ago. Days 3-7 ago predate it.
    const h = habit({ completedDates: [daysAgo(2)] });

    const missed = getMissedHabitDates(h, 7);

    // Only day 1 ago is missable (day 2 was completed; days 3+ predate the habit).
    expect(missed).toEqual([daysAgo(1)]);
    // Confirm no pre-existence days leaked in.
    expect(missed).not.toContain(daysAgo(3));
    expect(missed).not.toContain(daysAgo(7));
  });

  it('reports legitimately missed days within the valid window', () => {
    // Completed 5 days ago and yesterday; days 2,3,4 ago are real misses.
    const h = habit({ completedDates: [daysAgo(5), daysAgo(1)] });

    const missed = getMissedHabitDates(h, 7);

    expect(missed).toContain(daysAgo(2));
    expect(missed).toContain(daysAgo(3));
    expect(missed).toContain(daysAgo(4));
    // 5 days ago was completed (and is the floor) → not missed; 6/7 predate habit.
    expect(missed).not.toContain(daysAgo(5));
    expect(missed).not.toContain(daysAgo(6));
  });

  it('respects an explicit habitCreatedAt floor earlier than the first completion', () => {
    const h = habit({ completedDates: [daysAgo(2)] });

    const missed = getMissedHabitDates(h, 7, daysAgo(4));

    // Now days 1, 3, 4 ago are missable (4 ago is the floor, inclusive); day 2 completed.
    expect(missed).toContain(daysAgo(1));
    expect(missed).toContain(daysAgo(3));
    expect(missed).toContain(daysAgo(4));
    expect(missed).not.toContain(daysAgo(2));
    expect(missed).not.toContain(daysAgo(5));
  });

  it('anchors on an injected `today` for deterministic results (Plan 25 auto-apply)', () => {
    // Fixed calendar: today 2026-07-09; completed 07-05..07-07; 07-08 missed.
    const h = habit({ completedDates: ['2026-07-05', '2026-07-06', '2026-07-07'] });

    expect(getMissedHabitDates(h, 1, undefined, '2026-07-09')).toEqual(['2026-07-08']);
    // A completed yesterday is not missed.
    expect(getMissedHabitDates(h, 1, undefined, '2026-07-08')).toEqual([]);
  });
});
