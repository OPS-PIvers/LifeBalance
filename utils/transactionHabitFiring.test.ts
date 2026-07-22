import { describe, it, expect } from 'vitest';
import { Habit } from '@/types/schema';
import {
  keywordMatchedHabitIds,
  selectHabitsToFire,
  transactionAttribution,
} from '@/utils/transactionHabitFiring';

function habit(id: string, keywords?: string[], extra?: Partial<Habit>): Habit {
  return {
    id,
    title: id,
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
    lastUpdated: '',
    ...(keywords ? { triggers: { keywords } } : {}),
    ...extra,
  };
}

describe('keywordMatchedHabitIds', () => {
  const habits = [
    habit('target', ['target']),
    habit('coffee', ['coffee', 'blue bottle']),
    habit('none'),
  ];

  it('matches whole-word single tokens against the merchant', () => {
    expect(keywordMatchedHabitIds(habits, { merchant: 'TARGET T-1234' })).toEqual(['target']);
  });

  it('does not match a single token as a substring of a larger word', () => {
    expect(keywordMatchedHabitIds(habits, { merchant: 'targeted ads inc' })).toEqual([]);
  });

  it('matches a spaced phrase as a case-insensitive substring', () => {
    expect(keywordMatchedHabitIds(habits, { merchant: 'BLUE BOTTLE COFFEE #7' })).toEqual(['coffee']);
  });

  it('matches against notes as well as merchant', () => {
    expect(keywordMatchedHabitIds(habits, { merchant: 'Amazon', notes: 'coffee beans' })).toEqual(['coffee']);
  });

  it('returns every matching habit, not just the first', () => {
    const both = [habit('a', ['target']), habit('b', ['target'])];
    expect(keywordMatchedHabitIds(both, { merchant: 'Target' })).toEqual(['a', 'b']);
  });

  it('excludes archived habits', () => {
    const archived = [habit('a', ['target'], { archivedAt: '2026-01-01T00:00:00Z' })];
    expect(keywordMatchedHabitIds(archived, { merchant: 'Target' })).toEqual([]);
  });

  it('ignores habits with no keywords', () => {
    expect(keywordMatchedHabitIds([habit('none')], { merchant: 'anything' })).toEqual([]);
  });
});

describe('selectHabitsToFire', () => {
  it('fires every requested id when none have fired before', () => {
    expect(selectHabitsToFire(['a', 'b'], [])).toEqual({ toFire: ['a', 'b'], nextFired: ['a', 'b'] });
  });

  it('skips ids that already fired for this transaction', () => {
    expect(selectHabitsToFire(['a', 'b'], ['a'])).toEqual({ toFire: ['b'], nextFired: ['a', 'b'] });
  });

  it('never fires anything when all requested ids already fired', () => {
    expect(selectHabitsToFire(['a', 'b'], ['a', 'b'])).toEqual({ toFire: [], nextFired: ['a', 'b'] });
  });

  it('de-duplicates repeats within the request', () => {
    expect(selectHabitsToFire(['a', 'a', 'b'], [])).toEqual({ toFire: ['a', 'b'], nextFired: ['a', 'b'] });
  });

  it('preserves request order', () => {
    expect(selectHabitsToFire(['b', 'a'], []).toFire).toEqual(['b', 'a']);
  });
});

describe('transactionAttribution', () => {
  it('builds the via-transaction phrase from the merchant', () => {
    expect(transactionAttribution('TARGET T-1234')).toBe('via transaction: TARGET T-1234');
  });

  it('trims and falls back for a blank merchant', () => {
    expect(transactionAttribution('   ')).toBe('via transaction: transaction');
    expect(transactionAttribution(undefined)).toBe('via transaction: transaction');
  });
});
