import { describe, it, expect } from 'vitest';
import { Habit, MerchantRule } from '@/types/schema';
import {
  keywordMatchesText,
  habitMatchesInput,
  findMatchingHabits,
} from '@/utils/habitKeywordMatch';

function makeHabit(id: string, keywords: string[]): Habit {
  return {
    id,
    title: id,
    category: 'Test',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-22',
    triggers: { keywords },
  };
}

describe('keywordMatchesText', () => {
  it('is case-insensitive for single tokens', () => {
    expect(keywordMatchesText('target', 'TARGET T-1234')).toBe(true);
    expect(keywordMatchesText('TARGET', 'went into target')).toBe(true);
  });

  it('matches single tokens only on a whole-word boundary', () => {
    expect(keywordMatchesText('target', 'targeted ads')).toBe(false);
    expect(keywordMatchesText('target', 'untargeted')).toBe(false);
    expect(keywordMatchesText('target', 'my target.')).toBe(true);
    expect(keywordMatchesText('target', 'target-store')).toBe(true);
  });

  it('matches spaced phrases as a case-insensitive substring', () => {
    expect(keywordMatchesText('whole foods', 'WHOLE FOODS MARKET #42')).toBe(true);
    // A spaced phrase does NOT require word boundaries around the whole thing.
    expect(keywordMatchesText('ole foods m', 'whole foods market')).toBe(true);
  });

  it('returns false for empty keyword or empty text', () => {
    expect(keywordMatchesText('', 'target')).toBe(false);
    expect(keywordMatchesText('   ', 'target')).toBe(false);
    expect(keywordMatchesText('target', '')).toBe(false);
  });

  it('trims surrounding whitespace on the keyword', () => {
    expect(keywordMatchesText('  target  ', 'at the target')).toBe(true);
  });

  it('treats regex metacharacters in a token literally', () => {
    // The dot is escaped, so it is NOT a wildcard.
    expect(keywordMatchesText('a.b', 'axb')).toBe(false);
    expect(keywordMatchesText('a.b', 'an a.b token')).toBe(true);
  });

  it('matches a single-token keyword starting/ending in a non-ASCII letter', () => {
    expect(keywordMatchesText('café', 'café')).toBe(true);
    expect(keywordMatchesText('café', 'Café Zupas')).toBe(true);
    expect(keywordMatchesText('café', 'I went to café')).toBe(true);
  });

  it('still enforces ASCII whole-word semantics alongside Unicode keywords', () => {
    // "target" must still NOT match "targeted" (regression guard).
    expect(keywordMatchesText('target', 'targeted')).toBe(false);
  });

  it('does not match an accented keyword as a substring of a longer accented word', () => {
    expect(keywordMatchesText('café', 'cafétéria')).toBe(false);
  });
});

describe('habitMatchesInput', () => {
  it('matches against the merchant field', () => {
    const habit = makeHabit('h1', ['target']);
    expect(habitMatchesInput(habit, { merchant: 'TARGET T-1234' })).toBe(true);
  });

  it('matches against the notes field', () => {
    const habit = makeHabit('h1', ['impulse']);
    expect(
      habitMatchesInput(habit, { merchant: 'Amazon', notes: 'impulse buy' }),
    ).toBe(true);
  });

  it('does not match when the habit has no keywords', () => {
    const bare = makeHabit('h1', []);
    expect(habitMatchesInput(bare, { merchant: 'target' })).toBe(false);
    const noTriggers = makeHabit('h2', []);
    delete noTriggers.triggers;
    expect(habitMatchesInput(noTriggers, { merchant: 'target' })).toBe(false);
  });
});

describe('findMatchingHabits', () => {
  it('returns every matching habit, preserving input order', () => {
    const wentIn = makeHabit('went-into-target', ['target']);
    const impulse = makeHabit('impulse', ['impulse', 'target']);
    const unrelated = makeHabit('gym', ['gym']);
    const result = findMatchingHabits([wentIn, impulse, unrelated], {
      merchant: 'TARGET T-1234',
      notes: '',
    });
    expect(result.map(h => h.id)).toEqual(['went-into-target', 'impulse']);
  });

  it('returns an empty array when nothing matches', () => {
    const habit = makeHabit('gym', ['gym']);
    expect(findMatchingHabits([habit], { merchant: 'Target' })).toEqual([]);
  });
});

describe('merchant-rule-aware keyword matching', () => {
  const makeRule = (overrides: Partial<MerchantRule> = {}): MerchantRule => ({
    id: 'rule-1',
    pattern: 'SQ *BLUE BOTTLE',
    name: 'Coffee run',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  });

  // The motivating case: the keyword targets the name the USER chose, which
  // appears nowhere in the bank's descriptor.
  const coffeeHabit = makeHabit('coffee', ['coffee']);
  const rawRow = { merchant: 'SQ *BLUE BOTTLE' };

  it('fires on a keyword that matches the friendly name but NOT the raw descriptor', () => {
    expect(habitMatchesInput(coffeeHabit, rawRow, [makeRule()])).toBe(true);
  });

  it('still fires on a keyword that matches only the raw descriptor', () => {
    const bottleHabit = makeHabit('bottle', ['blue bottle']);
    expect(habitMatchesInput(bottleHabit, rawRow, [makeRule()])).toBe(true);
  });

  it('does not fire on the friendly name when rules are omitted or empty', () => {
    expect(habitMatchesInput(coffeeHabit, rawRow)).toBe(false);
    expect(habitMatchesInput(coffeeHabit, rawRow, [])).toBe(false);
  });

  it('leaves notes matching untouched', () => {
    const impulse = makeHabit('impulse', ['impulse']);
    expect(habitMatchesInput(impulse, { ...rawRow, notes: 'impulse buy' }, [makeRule()])).toBe(true);
  });

  it('applies whole-word semantics to the friendly name too', () => {
    // "coffee" must not match inside "Coffeehouse" — the same boundary rule the
    // raw descriptor gets.
    const renamed = [makeRule({ name: 'Coffeehouse' })];
    expect(habitMatchesInput(coffeeHabit, rawRow, renamed)).toBe(false);
  });

  it('resolves an amount-qualified rule from the input amount', () => {
    const rules = [makeRule({ pattern: 'APPLE.COM', name: 'iCloud storage', amount: 2.99 })];
    const icloud = makeHabit('icloud', ['icloud']);

    expect(habitMatchesInput(icloud, { merchant: 'APPLE.COM/BILL', amount: 2.99 }, rules)).toBe(true);
    expect(habitMatchesInput(icloud, { merchant: 'APPLE.COM/BILL', amount: 79 }, rules)).toBe(false);
    // No amount to verify against ⇒ an amount-qualified rule cannot apply.
    expect(habitMatchesInput(icloud, { merchant: 'APPLE.COM/BILL' }, rules)).toBe(false);
  });

  it('threads rules through findMatchingHabits, preserving input order', () => {
    const habits = [coffeeHabit, makeHabit('gym', ['gym']), makeHabit('bottle', ['blue bottle'])];
    expect(findMatchingHabits(habits, rawRow, [makeRule()]).map(h => h.id)).toEqual([
      'coffee',
      'bottle',
    ]);
    expect(findMatchingHabits(habits, rawRow).map(h => h.id)).toEqual(['bottle']);
  });
});
