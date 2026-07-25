import { describe, it, expect } from 'vitest';
import { Habit, MerchantRule } from '@/types/schema';
import {
  HABIT_BACKDATE_MAX_DAYS,
  isWithinBackdateWindow,
  keywordMatchedHabitIds,
  selectHabitsToFire,
  suppressAlreadyLoggedHabitIds,
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

  describe('with merchant rules', () => {
    const rule = (overrides: Partial<MerchantRule> = {}): MerchantRule => ({
      id: 'rule-1',
      pattern: 'SQ *BLUE BOTTLE',
      name: 'Coffee run',
      createdAt: '2026-07-01T00:00:00.000Z',
      ...overrides,
    });

    it('fires a habit whose keyword matches only the friendly name', () => {
      expect(
        keywordMatchedHabitIds(habits, { merchant: 'SQ *BLUE BOTTLE' }, [rule()]),
      ).toEqual(['coffee']);
    });

    it('does not fire on the friendly name when rules are omitted or empty', () => {
      expect(keywordMatchedHabitIds([habit('c', ['coffee'])], { merchant: 'SQ *BLUE' })).toEqual([]);
      expect(keywordMatchedHabitIds([habit('c', ['coffee'])], { merchant: 'SQ *BLUE' }, [])).toEqual([]);
    });

    it('still excludes archived habits when a rule renames the row', () => {
      const archived = [habit('coffee', ['coffee'], { archivedAt: '2026-01-01T00:00:00Z' })];
      expect(keywordMatchedHabitIds(archived, { merchant: 'SQ *BLUE BOTTLE' }, [rule()])).toEqual([]);
    });

    it('passes the transaction amount through for amount-qualified rules', () => {
      const rules = [rule({ pattern: 'APPLE.COM', name: 'iCloud storage', amount: 2.99 })];
      const icloud = [habit('icloud', ['icloud'])];

      expect(
        keywordMatchedHabitIds(icloud, { merchant: 'APPLE.COM/BILL', amount: 2.99 }, rules),
      ).toEqual(['icloud']);
      expect(
        keywordMatchedHabitIds(icloud, { merchant: 'APPLE.COM/BILL', amount: 79 }, rules),
      ).toEqual([]);
    });
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

describe('isWithinBackdateWindow', () => {
  const today = '2026-07-24';

  it('allows today and the nightly-sync range', () => {
    expect(isWithinBackdateWindow(today, today)).toBe(true);
    expect(isWithinBackdateWindow('2026-07-23', today)).toBe(true);
    expect(isWithinBackdateWindow('2026-07-21', today)).toBe(true);
  });

  it('allows exactly the window edge and rejects one day past it', () => {
    expect(isWithinBackdateWindow('2026-06-24', today)).toBe(true); // 30 days
    expect(isWithinBackdateWindow('2026-06-23', today)).toBe(false); // 31
  });

  it('rejects FUTURE dates — a future completion corrupts the streak chain', () => {
    expect(isWithinBackdateWindow('2026-07-25', today)).toBe(false);
  });

  it('pins the documented window so a silent widening fails here', () => {
    expect(HABIT_BACKDATE_MAX_DAYS).toBe(30);
  });
});

describe('suppressAlreadyLoggedHabitIds', () => {
  it('drops a DAILY habit already completed on the fire date', () => {
    const h = habit('a', ['amazon'], { completedDates: ['2026-07-20'] });
    expect(suppressAlreadyLoggedHabitIds([h], ['a'], '2026-07-20')).toEqual([]);
  });

  it('keeps a DAILY habit completed on a DIFFERENT day', () => {
    const h = habit('a', ['amazon'], { completedDates: ['2026-07-19'] });
    expect(suppressAlreadyLoggedHabitIds([h], ['a'], '2026-07-20')).toEqual(['a']);
  });

  it('drops a WEEKLY habit completed anywhere in the fire date’s ISO week', () => {
    // 2026-07-20 is a Monday; 2026-07-23 is the Thursday of the same ISO week.
    const h = habit('a', ['amazon'], { period: 'weekly', completedDates: ['2026-07-23'] });
    expect(suppressAlreadyLoggedHabitIds([h], ['a'], '2026-07-20')).toEqual([]);
  });

  it('keeps a WEEKLY habit whose completion is in the PREVIOUS ISO week', () => {
    const h = habit('a', ['amazon'], { period: 'weekly', completedDates: ['2026-07-19'] });
    expect(suppressAlreadyLoggedHabitIds([h], ['a'], '2026-07-20')).toEqual(['a']);
  });

  it('suppresses per habit, not wholesale', () => {
    const logged = habit('a', ['amazon'], { completedDates: ['2026-07-20'] });
    const fresh = habit('b', ['amazon']);
    expect(suppressAlreadyLoggedHabitIds([logged, fresh], ['a', 'b'], '2026-07-20')).toEqual(['b']);
  });

  it('passes an unknown id through — the mutation’s own lookup drops it', () => {
    expect(suppressAlreadyLoggedHabitIds([], ['ghost'], '2026-07-20')).toEqual(['ghost']);
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
