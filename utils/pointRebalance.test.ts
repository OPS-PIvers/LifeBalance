import { describe, it, expect } from 'vitest';
import { parseISO, subDays } from 'date-fns';
import type { Habit } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  DEFAULT_MAX_MAGNITUDE,
  MAX_STEP,
  generatePointRebalanceSuggestions,
  householdMaxMagnitude,
  rebalanceDisplay,
} from '@/utils/pointRebalance';

const TODAY = '2026-07-27';

/** `n` calendar days before TODAY, as a `yyyy-MM-dd` string. */
const daysBefore = (n: number): string => getLocalDateString(subDays(parseISO(TODAY), n));

/** Every one of the last `count` days (today first). */
const lastDays = (count: number): string[] => Array.from({ length: count }, (_, i) => daysBefore(i));

const habit = (overrides: Partial<Habit>): Habit =>
  ({
    id: 'h1',
    title: 'Test Habit',
    category: 'health',
    type: 'positive',
    basePoints: 5,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: TODAY,
    ...overrides,
  }) as Habit;

/** A 60-day history with `misses` of the recent days removed (the 60th day is always kept so the window stays anchored). */
const historyWithMisses = (misses: number[]): string[] =>
  lastDays(60).filter((_, i) => !misses.includes(i));

describe('householdMaxMagnitude', () => {
  it('uses the largest magnitude in use, ignoring sign', () => {
    expect(householdMaxMagnitude([{ basePoints: 3 }, { basePoints: -7 }, { basePoints: 2 }])).toBe(7);
  });

  it('falls back to the default ceiling when nothing usable is set', () => {
    expect(householdMaxMagnitude([])).toBe(DEFAULT_MAX_MAGNITUDE);
    expect(householdMaxMagnitude([{ basePoints: 0 }])).toBe(DEFAULT_MAX_MAGNITUDE);
  });
});

describe('generatePointRebalanceSuggestions — positive habits', () => {
  it('LOWERS points for a habit that has become automatic', () => {
    const habits = [habit({ basePoints: 5, completedDates: lastDays(60) })];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion).toBeDefined();
    expect(suggestion?.currentPoints).toBe(5);
    expect(suggestion?.suggestedPoints).toBe(3);
    expect(suggestion?.reasoning).toContain('routine');
  });

  it('LOWERS points by one for a merely built-in habit', () => {
    // 51 of the last 60 days = 0.85 — built in, but not automatic.
    const habits = [
      habit({ basePoints: 5, completedDates: historyWithMisses([10, 11, 12, 13, 14, 15, 16, 17, 18]) }),
    ];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.suggestedPoints).toBe(4);
  });

  it('RAISES points slightly for a habit that is still being skipped', () => {
    const habits = [
      habit({ basePoints: 3, completedDates: [daysBefore(59), daysBefore(40), daysBefore(20), daysBefore(2)] }),
      habit({ id: 'ceiling', title: 'Big One', basePoints: 5 }),
    ];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.habitId).toBe('h1');
    expect(suggestion?.suggestedPoints).toBe(4);
    expect(suggestion?.reasoning).toContain('stretch');
  });

  it('judges a weekly habit in weeks, not days', () => {
    const weeklyDates = Array.from({ length: 12 }, (_, i) => daysBefore(i * 7));
    const habits = [habit({ period: 'weekly', basePoints: 5, completedDates: weeklyDates })];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.suggestedPoints).toBe(3);
    expect(suggestion?.reasoning).toContain('week');
  });
});

describe('generatePointRebalanceSuggestions — negative habits', () => {
  it('SHRINKS the penalty for a habit that is rarely triggered', () => {
    const habits = [
      habit({
        type: 'negative',
        basePoints: -5,
        completedDates: [daysBefore(59), daysBefore(30), daysBefore(10)],
      }),
    ];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.currentPoints).toBe(-5);
    expect(suggestion?.suggestedPoints).toBe(-4);
    expect(Math.abs(suggestion?.suggestedPoints ?? 0)).toBeLessThan(5);
    expect(suggestion?.reasoning).toContain('ease off');
  });

  it('GROWS the penalty for a habit triggered constantly', () => {
    const habits = [
      habit({ type: 'negative', basePoints: -5, completedDates: lastDays(60) }),
      habit({ id: 'ceiling', title: 'Big One', basePoints: 10 }),
    ];
    const suggestions = generatePointRebalanceSuggestions(habits, TODAY);
    const suggestion = suggestions.find(s => s.habitId === 'h1');

    expect(suggestion?.suggestedPoints).toBe(-7);
    expect(suggestion?.reasoning).toContain('sting');
  });

  it('never flips the sign, including when the penalty is STORED positive', () => {
    const habits = [
      habit({
        type: 'negative',
        basePoints: 4, // stored magnitude-only; sign comes from `type`
        completedDates: [daysBefore(59), daysBefore(30), daysBefore(10)],
      }),
    ];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.suggestedPoints).toBe(3);
    expect(suggestion?.suggestedPoints).toBeGreaterThan(0);
  });
});

describe('generatePointRebalanceSuggestions — guardrails', () => {
  it('never suggests a value above the household’s largest habit', () => {
    // Nothing in this household is worth more than 5, so a struggling habit
    // already at 5 gets no bump — and nothing anywhere exceeds 5.
    const habits = [
      habit({ id: 'a', basePoints: 5, completedDates: [daysBefore(59), daysBefore(20)] }),
      habit({ id: 'b', basePoints: 4, completedDates: [daysBefore(59), daysBefore(20)] }),
    ];
    const suggestions = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestions.find(s => s.habitId === 'a')).toBeUndefined();
    expect(suggestions.every(s => Math.abs(s.suggestedPoints) <= 5)).toBe(true);
  });

  it('does not let an ARCHIVED habit raise the scale ceiling', () => {
    // A retired 20-pt habit must not re-open the very escape hatch this
    // module exists to close: a struggling 4-pt habit should still be bounded
    // by the live economy (max 4), not lifted toward the dead habit's 20.
    const habits = [
      habit({ id: 'dead', basePoints: 20, archivedAt: '2026-07-01T00:00:00.000Z' }),
      habit({ id: 'live', basePoints: 4, completedDates: [daysBefore(59), daysBefore(20)] }),
    ];
    const suggestions = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestions.every(s => Math.abs(s.suggestedPoints) <= 4)).toBe(true);
  });

  it('lets a PAUSED habit still set the scale ceiling', () => {
    // A planned break is temporary — the habit returns at its stored value,
    // so it stays part of what this household treats as a big reward, even
    // though it is not itself scored while paused.
    const habits = [
      habit({ id: 'onBreak', basePoints: 8, pausedUntil: '2026-08-10' }),
      habit({ id: 'live', basePoints: 7, completedDates: [daysBefore(59), daysBefore(20)] }),
    ];
    const suggestions = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestions.map(s => s.habitId)).toEqual(['live']);
    expect(suggestions[0]?.suggestedPoints).toBe(8);
  });

  it('never moves a habit by more than the step cap', () => {
    const habits = [
      habit({ id: 'automatic', basePoints: 10, completedDates: lastDays(60) }),
      habit({ id: 'skipped', basePoints: 4, completedDates: [daysBefore(59), daysBefore(20)] }),
      habit({
        id: 'penalty',
        type: 'negative',
        basePoints: -8,
        completedDates: historyWithMisses([1, 2, 3]),
      }),
    ];
    const suggestions = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(Math.abs(s.suggestedPoints - s.currentPoints)).toBeLessThanOrEqual(MAX_STEP);
    }
  });

  it('never suggests zero points', () => {
    const habits = [
      habit({ id: 'tiny', basePoints: 2, completedDates: lastDays(60) }),
      habit({ id: 'ceiling', title: 'Big One', basePoints: 5 }),
    ];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.suggestedPoints).toBe(1);
  });

  it('suppresses a suggestion whose delta clamps away to nothing', () => {
    // Already at the 1-point floor and fully automatic — nowhere left to go.
    const habits = [
      habit({ id: 'floor', basePoints: 1, completedDates: lastDays(60) }),
      habit({ id: 'ceiling', title: 'Big One', basePoints: 5 }),
    ];
    expect(generatePointRebalanceSuggestions(habits, TODAY)).toEqual([]);
  });
});

describe('generatePointRebalanceSuggestions — noise floor', () => {
  it('returns an empty array for a habit with no history at all', () => {
    expect(generatePointRebalanceSuggestions([habit({ completedDates: [] })], TODAY)).toEqual([]);
  });

  it('returns an empty array for a brand-new habit with too few observable days', () => {
    const habits = [habit({ completedDates: lastDays(10) })];
    expect(generatePointRebalanceSuggestions(habits, TODAY)).toEqual([]);
  });

  it('returns an empty array for a weekly habit with too few observable weeks', () => {
    const weeklyDates = Array.from({ length: 3 }, (_, i) => daysBefore(i * 7));
    const habits = [habit({ period: 'weekly', completedDates: weeklyDates })];
    expect(generatePointRebalanceSuggestions(habits, TODAY)).toEqual([]);
  });

  it('returns an empty array for a habit sitting in the middle band', () => {
    // 36 of 60 days = 0.6 — neither built in nor struggling.
    const misses = Array.from({ length: 24 }, (_, i) => i + 1);
    const habits = [habit({ completedDates: historyWithMisses(misses) })];
    expect(generatePointRebalanceSuggestions(habits, TODAY)).toEqual([]);
  });

  it('ignores archived and paused habits', () => {
    const habits = [
      habit({ id: 'archived', completedDates: lastDays(60), archivedAt: '2026-07-01T00:00:00.000Z' }),
      habit({ id: 'paused', completedDates: lastDays(60), pausedUntil: '2026-08-10' }),
    ];
    expect(generatePointRebalanceSuggestions(habits, TODAY)).toEqual([]);
  });

  it('does not count freeze-absorbed days against a habit', () => {
    // 57 real completions + 3 frozen days = 57/57 observable days, i.e. automatic.
    const habits = [
      habit({
        basePoints: 5,
        completedDates: historyWithMisses([5, 6, 7]),
        frozenDates: [daysBefore(5), daysBefore(6), daysBefore(7)],
      }),
    ];
    const [suggestion] = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestion?.suggestedPoints).toBe(3);
  });
});

describe('generatePointRebalanceSuggestions — determinism', () => {
  it('returns identical output for identical input', () => {
    const habits = [
      habit({ id: 'a', basePoints: 5, completedDates: lastDays(60) }),
      habit({ id: 'b', basePoints: 4, completedDates: [daysBefore(59), daysBefore(20)] }),
    ];
    expect(generatePointRebalanceSuggestions(habits, TODAY)).toEqual(
      generatePointRebalanceSuggestions(habits, TODAY)
    );
  });

  it('orders the biggest correction first', () => {
    const habits = [
      habit({ id: 'small', basePoints: 5, completedDates: historyWithMisses([1, 2, 3, 4, 5, 6, 7, 8, 9]) }),
      habit({ id: 'big', basePoints: 5, completedDates: lastDays(60) }),
    ];
    const suggestions = generatePointRebalanceSuggestions(habits, TODAY);

    expect(suggestions[0]?.habitId).toBe('big');
  });
});

// rebalanceDisplay — regression coverage for the direction-inversion bug.
//
// `suggestion.currentPoints`/`suggestedPoints` are in the habit's STORED
// basePoints convention (see the `storedSign` comment in
// generatePointRebalanceSuggestions) — that's correct for `updateHabit`,
// which writes them back verbatim, but WRONG for display/colour: reading
// the raw sign of a stored number can't tell "penalty eased off" from
// "reward lowered" once both conventions exist in the same household.
// `rebalanceDisplay` re-signs from `habit.type` instead, so these tests pin
// that the SAME underlying change renders identically under both.
describe('rebalanceDisplay', () => {
  const negativeHabit: Pick<Habit, 'type'> = { type: 'negative' };
  const positiveHabit: Pick<Habit, 'type'> = { type: 'positive' };

  it('a penalty easing off is favorable under the OLD (signed) convention', () => {
    expect(rebalanceDisplay(negativeHabit, { currentPoints: -3, suggestedPoints: -1 })).toEqual({
      currentPoints: -3,
      suggestedPoints: -1,
      favorable: true,
    });
  });

  it('the SAME penalty easing off is favorable under the NEW (magnitude-only) convention', () => {
    // Same habit, same real-world change (3 -> 1) as the OLD-convention case
    // above, but stored positive per this PR's converged convention.
    expect(rebalanceDisplay(negativeHabit, { currentPoints: 3, suggestedPoints: 1 })).toEqual({
      currentPoints: -3,
      suggestedPoints: -1,
      favorable: true,
    });
  });

  it('a penalty getting harsher is unfavorable under the OLD (signed) convention', () => {
    expect(rebalanceDisplay(negativeHabit, { currentPoints: -2, suggestedPoints: -4 })).toEqual({
      currentPoints: -2,
      suggestedPoints: -4,
      favorable: false,
    });
  });

  it('the SAME harsher penalty is unfavorable under the NEW (magnitude-only) convention', () => {
    expect(rebalanceDisplay(negativeHabit, { currentPoints: 2, suggestedPoints: 4 })).toEqual({
      currentPoints: -2,
      suggestedPoints: -4,
      favorable: false,
    });
  });

  it('a positive habit whose reward is raised is favorable', () => {
    expect(rebalanceDisplay(positiveHabit, { currentPoints: 3, suggestedPoints: 4 })).toEqual({
      currentPoints: 3,
      suggestedPoints: 4,
      favorable: true,
    });
  });

  it('a positive habit whose reward is lowered is unfavorable', () => {
    expect(rebalanceDisplay(positiveHabit, { currentPoints: 5, suggestedPoints: 3 })).toEqual({
      currentPoints: 5,
      suggestedPoints: 3,
      favorable: false,
    });
  });

  it('reproduces the empirical case end-to-end: a penalty triggered once in 60 days eases off identically under both conventions', () => {
    // The exact scenario from the PR #1215 review: type: 'negative',
    // period: 'daily', scoringType: 'incremental', triggered once in the
    // 60-day window — "the penalty can ease off" case.
    const base = {
      id: 'h1',
      title: 'Late night snack',
      category: 'health',
      type: 'negative' as const,
      scoringType: 'incremental' as const,
      period: 'daily' as const,
      targetCount: 1,
      count: 0,
      totalCount: 0,
      streakDays: 0,
      lastUpdated: TODAY,
      completedDates: [daysBefore(45)],
    };
    const habitOldConvention = { ...base, basePoints: -3 } as Habit;
    const habitNewConvention = { ...base, basePoints: 3 } as Habit;

    const [oldSuggestion] = generatePointRebalanceSuggestions([habitOldConvention], TODAY);
    const [newSuggestion] = generatePointRebalanceSuggestions([habitNewConvention], TODAY);
    if (!oldSuggestion || !newSuggestion) {
      throw new Error('expected a suggestion for the reproduced scenario under both conventions');
    }

    // The RAW suggestion values still preserve each convention (proving this
    // fix didn't touch what `updateHabit` writes).
    expect(oldSuggestion.currentPoints).toBe(-3);
    expect(oldSuggestion.suggestedPoints).toBe(-1);
    expect(newSuggestion.currentPoints).toBe(3);
    expect(newSuggestion.suggestedPoints).toBe(1);

    // But the DISPLAY derived from habit.type is identical either way.
    const oldDisplay = rebalanceDisplay(habitOldConvention, oldSuggestion);
    const newDisplay = rebalanceDisplay(habitNewConvention, newSuggestion);
    expect(oldDisplay).toEqual({ currentPoints: -3, suggestedPoints: -1, favorable: true });
    expect(newDisplay).toEqual(oldDisplay);
  });
});
