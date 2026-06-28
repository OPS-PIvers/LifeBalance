import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format, subDays } from 'date-fns';
import {
  getMissedHabitDates,
  wouldBenefitFromFreezeToken,
  suggestFreezeBankDate,
  canUseFreezeBankToken,
} from './freezeBankValidator';
import { Habit } from '@/types/schema';

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
    weatherSensitive: false,
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
});

describe('wouldBenefitFromFreezeToken', () => {
  it('is false for a habit first completed recently with no missable pre-existence days', () => {
    // Completed yesterday only → floor is yesterday → no missable days before it.
    const h = habit({ completedDates: [daysAgo(1)] });
    expect(wouldBenefitFromFreezeToken(h)).toBe(false);
  });

  it('is true when there is a real missed day inside the valid window', () => {
    const h = habit({ completedDates: [daysAgo(3), daysAgo(1)] });
    expect(wouldBenefitFromFreezeToken(h)).toBe(true);
  });

  it('is false with no completion history', () => {
    expect(wouldBenefitFromFreezeToken(habit({ completedDates: [] }))).toBe(false);
  });
});

describe('suggestFreezeBankDate', () => {
  it('returns null when no dates are missable', () => {
    expect(suggestFreezeBankDate(habit({ completedDates: [daysAgo(1)] }))).toBeNull();
  });

  it('suggests the most recent missed date', () => {
    const h = habit({ completedDates: [daysAgo(4), daysAgo(1)] });
    expect(suggestFreezeBankDate(h)).toBe(daysAgo(2));
  });
});

describe('canUseFreezeBankToken — deterministic window boundaries', () => {
  // canUseFreezeBankToken derives "today" / the 30-day & 1-day windows from
  // `new Date()`, so the boundary cases (EXACTLY 30 days, EXACTLY 1 day) flip
  // across midnight or in a non-local TZ if asserted against the real clock.
  // Pin the clock to a fixed local midnight so the differenceInDays() math is
  // exact and reproducible. parseISO() of a "yyyy-MM-dd" string yields local
  // midnight, matching todayStart, so whole-day diffs are unambiguous.
  const FIXED_NOW = new Date(2026, 5, 15, 0, 0, 0, 0); // 2026-06-15 local midnight

  // A positive habit with no completion on the dates under test, so only the
  // date-window checks (4 & 5) decide the outcome.
  const freezable = (): Habit => habit({ type: 'positive', completedDates: [] });

  // n days before FIXED_NOW, as a yyyy-MM-dd string in local time.
  const before = (n: number): string => format(subDays(FIXED_NOW, n), 'yyyy-MM-dd');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when there are no tokens (regardless of date)', () => {
    const res = canUseFreezeBankToken(freezable(), before(2), 0);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/no freeze tokens/i);
  });

  it('rejects a non-positive habit even with tokens and a valid past date', () => {
    const h = habit({ type: 'negative', completedDates: [] });
    const res = canUseFreezeBankToken(h, before(2), 3);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/positive habits/i);
  });

  it('rejects a date the habit is already completed on', () => {
    const target = before(2);
    const h = habit({ type: 'positive', completedDates: [target] });
    const res = canUseFreezeBankToken(h, target, 3);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/already completed/i);
  });

  it('rejects today (not strictly in the past)', () => {
    const res = canUseFreezeBankToken(freezable(), before(0), 3);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/past dates/i);
  });

  it('rejects a future date', () => {
    const future = format(subDays(FIXED_NOW, -1), 'yyyy-MM-dd'); // tomorrow
    const res = canUseFreezeBankToken(freezable(), future, 3);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/past dates/i);
  });

  it('ALLOWS exactly 1 day in the past (lower boundary, inclusive)', () => {
    // daysDiff === 1 → passes the "< 1" check; this is the earliest allowed day.
    const res = canUseFreezeBankToken(freezable(), before(1), 3);
    expect(res.allowed).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('ALLOWS exactly 30 days in the past (upper boundary, inclusive)', () => {
    // daysDiff === 30 → passes the "> 30" check; this is the oldest allowed day.
    const res = canUseFreezeBankToken(freezable(), before(30), 3);
    expect(res.allowed).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('REJECTS exactly 31 days in the past (just past the 30-day window)', () => {
    const res = canUseFreezeBankToken(freezable(), before(31), 3);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/within the last 30 days/i);
  });

  it('allows a date comfortably inside the window (15 days past)', () => {
    const res = canUseFreezeBankToken(freezable(), before(15), 3);
    expect(res.allowed).toBe(true);
  });

  // KNOWN BUG (flagged follow-up, not fixed here — tests-only PR): an unparseable
  // date does NOT take the "Invalid date format" branch. parseISO('not-a-date')
  // returns an Invalid Date (NaN time) instead of throwing, so the try/catch never
  // fires; every numeric comparison against NaN is false, so the function falls
  // through to { allowed: true }. The "Invalid date format" reason is dead code for
  // this input.
  //
  // Written with `it.fails` asserting the CORRECT behavior (allowed: false): it
  // PASSES now because the assertion fails as expected (the bug is present), and it
  // will START FAILING — prompting conversion to a regular `it` — the moment
  // canUseFreezeBankToken is fixed to reject invalid dates. This avoids codifying
  // the bug as expected behavior.
  it.fails('rejects an unparseable date (currently slips through as allowed due to NaN comparisons)', () => {
    const res = canUseFreezeBankToken(freezable(), 'not-a-date', 3);
    expect(res.allowed).toBe(false);
  });
});
