import { describe, it, expect } from 'vitest';

import { MerchantRule } from '@/types/schema';
import {
  normalizeForRuleMatch,
  ruleMatches,
  ruleSpecificity,
  pickMerchantRule,
  displayMerchant,
  merchantSearchTerms,
  findShadowingRule,
  suggestPatternFromDescriptor,
} from '@/utils/merchantRules';

const APPLE = 'APPLE.COM/BILL 866-712-7753 CA';

function makeRule(overrides: Partial<MerchantRule> & { pattern: string }): MerchantRule {
  return {
    id: overrides.id ?? `rule-${overrides.pattern}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeForRuleMatch', () => {
  it('uppercases, collapses whitespace runs and trims', () => {
    expect(normalizeForRuleMatch('  apple.com/bill \n  866 ')).toBe('APPLE.COM/BILL 866');
    expect(normalizeForRuleMatch('american\t\texpress')).toBe('AMERICAN EXPRESS');
  });

  it('preserves punctuation', () => {
    expect(normalizeForRuleMatch('apple.com/bill')).toBe('APPLE.COM/BILL');
    expect(normalizeForRuleMatch('#4021 (866) 712-7753')).toBe('#4021 (866) 712-7753');
  });

  it('returns empty for blank input', () => {
    expect(normalizeForRuleMatch('')).toBe('');
    expect(normalizeForRuleMatch('   \t ')).toBe('');
  });
});

describe('ruleMatches', () => {
  it('is a case-insensitive contains match', () => {
    expect(ruleMatches(makeRule({ pattern: 'apple.com' }), APPLE)).toBe(true);
    expect(ruleMatches(makeRule({ pattern: 'APPLE.COM' }), 'apple.com/bill 240725')).toBe(true);
    expect(ruleMatches(makeRule({ pattern: 'BILL' }), APPLE)).toBe(true);
  });

  it('preserves punctuation — APPLE.COM does not match APPLECOM', () => {
    expect(ruleMatches(makeRule({ pattern: 'APPLE.COM' }), 'APPLECOM BILL 240725')).toBe(false);
    expect(ruleMatches(makeRule({ pattern: 'APPLECOM' }), APPLE)).toBe(false);
  });

  it('collapses whitespace on both sides before comparing', () => {
    const rule = makeRule({ pattern: 'AMERICAN   EXPRESS' });
    expect(ruleMatches(rule, 'AMERICAN EXPRESS ACH PMT 240725')).toBe(true);
    expect(ruleMatches(makeRule({ pattern: 'ACH PMT' }), 'AMERICAN  EXPRESS  ACH   PMT')).toBe(true);
  });

  it('never matches on an empty or whitespace-only pattern', () => {
    expect(ruleMatches(makeRule({ pattern: '' }), APPLE)).toBe(false);
    expect(ruleMatches(makeRule({ pattern: '   ' }), APPLE)).toBe(false);
    expect(ruleMatches(makeRule({ pattern: '' }), '')).toBe(false);
  });

  it('does not match an empty descriptor with a real pattern', () => {
    expect(ruleMatches(makeRule({ pattern: 'APPLE' }), '')).toBe(false);
  });

  it('requires a cent-exact amount when the rule qualifies on one', () => {
    const rule = makeRule({ pattern: 'APPLE.COM', amount: 2.99 });
    expect(ruleMatches(rule, APPLE, 2.99)).toBe(true);
    expect(ruleMatches(rule, APPLE, 3)).toBe(false);
    expect(ruleMatches(rule, APPLE, 2.98)).toBe(false);
  });

  it('tolerates float drift in the stored amount (2.9899999 is 2.99)', () => {
    const rule = makeRule({ pattern: 'APPLE.COM', amount: 2.99 });
    expect(ruleMatches(rule, APPLE, 2.9899999)).toBe(true);
    expect(ruleMatches(makeRule({ pattern: 'APPLE.COM', amount: 2.9899999 }), APPLE, 2.99)).toBe(true);
    // 0.1 + 0.2 === 0.30000000000000004 — the classic float === failure.
    expect(ruleMatches(makeRule({ pattern: 'APPLE.COM', amount: 0.3 }), APPLE, 0.1 + 0.2)).toBe(true);
  });

  it('cannot match an amount-qualified rule when no amount is supplied', () => {
    const rule = makeRule({ pattern: 'APPLE.COM', amount: 2.99 });
    expect(ruleMatches(rule, APPLE)).toBe(false);
    expect(ruleMatches(rule, APPLE, undefined)).toBe(false);
  });

  it('treats amount: 0 as a real qualifier, not an absent one', () => {
    const rule = makeRule({ pattern: 'APPLE.COM', amount: 0 });
    expect(ruleMatches(rule, APPLE, 0)).toBe(true);
    expect(ruleMatches(rule, APPLE, 2.99)).toBe(false);
    expect(ruleMatches(rule, APPLE)).toBe(false);
  });

  it('ignores the amount when the rule has no qualifier', () => {
    const rule = makeRule({ pattern: 'APPLE.COM' });
    expect(ruleMatches(rule, APPLE, 2.99)).toBe(true);
    expect(ruleMatches(rule, APPLE, 999)).toBe(true);
    expect(ruleMatches(rule, APPLE)).toBe(true);
  });
});

describe('ruleSpecificity', () => {
  it('ranks an amount-qualified rule above any bare rule, however long its pattern', () => {
    const bareLong = makeRule({ pattern: 'APPLE.COM/BILL 866-712-7753 CA' });
    const amountShort = makeRule({ pattern: 'A', amount: 2.99 });
    expect(ruleSpecificity(amountShort)).toBeGreaterThan(ruleSpecificity(bareLong));
  });

  it('prefers the longer normalized pattern among equals', () => {
    expect(ruleSpecificity(makeRule({ pattern: 'APPLE.COM/BILL' })))
      .toBeGreaterThan(ruleSpecificity(makeRule({ pattern: 'APPLE' })));
    expect(ruleSpecificity(makeRule({ pattern: 'APPLE.COM/BILL', amount: 5 })))
      .toBeGreaterThan(ruleSpecificity(makeRule({ pattern: 'APPLE', amount: 5 })));
  });

  it('scores identically-normalized patterns identically', () => {
    expect(ruleSpecificity(makeRule({ pattern: '  apple   com ' })))
      .toBe(ruleSpecificity(makeRule({ pattern: 'APPLE COM' })));
  });

  it('is zero for a blank pattern with no amount', () => {
    expect(ruleSpecificity(makeRule({ pattern: '  ' }))).toBe(0);
  });
});

describe('pickMerchantRule', () => {
  it('returns null for undefined, empty, and non-matching rule sets', () => {
    expect(pickMerchantRule(APPLE, 2.99, undefined)).toBeNull();
    expect(pickMerchantRule(APPLE, 2.99, [])).toBeNull();
    expect(pickMerchantRule(APPLE, 2.99, [makeRule({ pattern: 'NETFLIX' })])).toBeNull();
  });

  it('prefers an amount-qualified rule over a bare rule on the same pattern', () => {
    const bare = makeRule({ id: 'bare', pattern: 'APPLE.COM', name: 'Apple' });
    const qualified = makeRule({ id: 'qualified', pattern: 'APPLE.COM', amount: 2.99, name: 'iCloud+' });
    expect(pickMerchantRule(APPLE, 2.99, [bare, qualified])?.id).toBe('qualified');
    expect(pickMerchantRule(APPLE, 2.99, [qualified, bare])?.id).toBe('qualified');
    // At a different amount the qualified rule drops out and the bare one wins.
    expect(pickMerchantRule(APPLE, 79, [bare, qualified])?.id).toBe('bare');
  });

  it('prefers the longer pattern when neither rule is amount-qualified', () => {
    const short = makeRule({ id: 'short', pattern: 'APPLE' });
    const long = makeRule({ id: 'long', pattern: 'APPLE.COM/BILL' });
    expect(pickMerchantRule(APPLE, undefined, [short, long])?.id).toBe('long');
    expect(pickMerchantRule(APPLE, undefined, [long, short])?.id).toBe('long');
  });

  it('breaks an exact specificity tie by the earlier createdAt, not array order', () => {
    const older = makeRule({
      id: 'older',
      pattern: 'APPLE.COM',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = makeRule({
      id: 'newer',
      pattern: 'APPLE.COM',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    expect(ruleSpecificity(older)).toBe(ruleSpecificity(newer));
    expect(pickMerchantRule(APPLE, undefined, [newer, older])?.id).toBe('older');
    expect(pickMerchantRule(APPLE, undefined, [older, newer])?.id).toBe('older');
  });

  it('is deterministic when createdAt also ties (id decides)', () => {
    const a = makeRule({ id: 'aaa', pattern: 'APPLE.COM' });
    const b = makeRule({ id: 'zzz', pattern: 'APPLE.COM' });
    expect(pickMerchantRule(APPLE, undefined, [b, a])?.id).toBe('aaa');
    expect(pickMerchantRule(APPLE, undefined, [a, b])?.id).toBe('aaa');
  });

  it('skips blank-pattern rules entirely', () => {
    const blank = makeRule({ id: 'blank', pattern: '   ', name: 'Everything' });
    expect(pickMerchantRule(APPLE, undefined, [blank])).toBeNull();
  });
});

describe('displayMerchant', () => {
  const rules = [makeRule({ pattern: 'APPLE.COM', name: 'Apple' })];

  it('returns the winning rule name', () => {
    expect(displayMerchant({ merchant: APPLE }, rules)).toBe('Apple');
    expect(displayMerchant({ merchant: APPLE, amount: 2.99 }, rules)).toBe('Apple');
  });

  it('returns the raw merchant when nothing matches or there are no rules', () => {
    expect(displayMerchant({ merchant: 'NETFLIX.COM' }, rules)).toBe('NETFLIX.COM');
    expect(displayMerchant({ merchant: APPLE }, undefined)).toBe(APPLE);
    expect(displayMerchant({ merchant: APPLE }, [])).toBe(APPLE);
  });

  it('leaves the raw merchant when the winning rule has no name', () => {
    const categoryOnly = [makeRule({ pattern: 'APPLE.COM', category: 'Subscriptions' })];
    expect(displayMerchant({ merchant: APPLE }, categoryOnly)).toBe(APPLE);
  });

  it('treats a whitespace-only name as no name', () => {
    const blankName = [makeRule({ pattern: 'APPLE.COM', name: '   ' })];
    expect(displayMerchant({ merchant: APPLE }, blankName)).toBe(APPLE);
  });

  it('respects the winning rule when several match', () => {
    const many = [
      makeRule({ id: 'broad', pattern: 'APPLE', name: 'Apple' }),
      makeRule({ id: 'narrow', pattern: 'APPLE.COM/BILL', name: 'Apple Subscriptions' }),
    ];
    expect(displayMerchant({ merchant: APPLE }, many)).toBe('Apple Subscriptions');
  });
});

describe('merchantSearchTerms', () => {
  it('returns raw + display so either spelling finds the row', () => {
    const rules = [makeRule({ pattern: 'APPLE.COM', name: 'Apple' })];
    const terms = merchantSearchTerms({ merchant: APPLE }, rules);
    expect(terms).toContain(APPLE);
    expect(terms).toContain('Apple');
    expect(terms).toHaveLength(2);
  });

  it('always includes the raw merchant, even when renamed', () => {
    const rules = [makeRule({ pattern: 'APPLE.COM', name: 'Totally Different' })];
    expect(merchantSearchTerms({ merchant: APPLE, amount: 2.99 }, rules)[0]).toBe(APPLE);
  });

  it('dedupes when the rule name equals the merchant', () => {
    const rules = [makeRule({ pattern: 'NETFLIX', name: 'NETFLIX' })];
    expect(merchantSearchTerms({ merchant: 'NETFLIX' }, rules)).toEqual(['NETFLIX']);
  });

  it('dedupes case- and whitespace-insensitively', () => {
    const rules = [makeRule({ pattern: 'NETFLIX', name: 'netflix  inc' })];
    expect(merchantSearchTerms({ merchant: 'NETFLIX INC' }, rules)).toEqual(['NETFLIX INC']);
  });

  it('returns just the raw merchant with no rules', () => {
    expect(merchantSearchTerms({ merchant: APPLE }, undefined)).toEqual([APPLE]);
    expect(merchantSearchTerms({ merchant: APPLE }, [])).toEqual([APPLE]);
  });

  it('drops a blank merchant instead of emitting an empty term', () => {
    expect(merchantSearchTerms({ merchant: '   ' }, undefined)).toEqual([]);
  });
});

describe('findShadowingRule', () => {
  it('reports the later of two duplicate patterns as shadowed by the earlier', () => {
    const older = makeRule({ id: 'older', pattern: 'APPLE.COM', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makeRule({ id: 'newer', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(newer, [older, newer])?.id).toBe('older');
  });

  it('does not report the winner of a duplicate pair as shadowed', () => {
    const older = makeRule({ id: 'older', pattern: 'APPLE.COM', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makeRule({ id: 'newer', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(older, [older, newer])).toBeNull();
  });

  it('matches duplicates through normalization (case + whitespace)', () => {
    const older = makeRule({ id: 'older', pattern: 'apple   com', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makeRule({ id: 'newer', pattern: 'APPLE COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(newer, [older])?.id).toBe('older');
  });

  it('does not let a broader rule shadow a narrower one (the narrower wins instead)', () => {
    const broad = makeRule({ id: 'broad', pattern: 'APPLE', createdAt: '2026-01-01T00:00:00.000Z' });
    const narrow = makeRule({ id: 'narrow', pattern: 'APPLE.COM/BILL', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(narrow, [broad, narrow])).toBeNull();
  });

  it('does not shadow when the patterns are unrelated', () => {
    const netflix = makeRule({ id: 'netflix', pattern: 'NETFLIX', createdAt: '2026-01-01T00:00:00.000Z' });
    const apple = makeRule({ id: 'apple', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(apple, [netflix])).toBeNull();
  });

  it('does NOT shadow when the amount qualifiers differ', () => {
    const at299 = makeRule({
      id: 'at299',
      pattern: 'APPLE.COM',
      amount: 2.99,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const at999 = makeRule({
      id: 'at999',
      pattern: 'APPLE.COM',
      amount: 9.99,
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    expect(findShadowingRule(at999, [at299])).toBeNull();
    expect(findShadowingRule(at299, [at999])).toBeNull();
  });

  it('does NOT let an amount-qualified rule shadow a bare rule on the same pattern', () => {
    const qualified = makeRule({
      id: 'qualified',
      pattern: 'APPLE.COM',
      amount: 2.99,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bare = makeRule({ id: 'bare', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(bare, [qualified])).toBeNull();
  });

  it('shadows a bare rule with an earlier bare rule on an identical pattern only', () => {
    const older = makeRule({ id: 'older', pattern: 'APPLE.COM', createdAt: '2026-01-01T00:00:00.000Z' });
    const qualifiedNarrow = makeRule({
      id: 'qn',
      pattern: 'APPLE.COM/BILL',
      amount: 2.99,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    const newer = makeRule({ id: 'newer', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(newer, [older, qualifiedNarrow])?.id).toBe('older');
  });

  it('shadows duplicates that share the same amount qualifier', () => {
    const older = makeRule({
      id: 'older',
      pattern: 'APPLE.COM',
      amount: 2.99,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = makeRule({
      id: 'newer',
      pattern: 'APPLE.COM',
      amount: 2.9899999,
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    expect(findShadowingRule(newer, [older])?.id).toBe('older');
  });

  it('excludes the rule itself by id', () => {
    const rule = makeRule({ id: 'solo', pattern: 'APPLE.COM' });
    expect(findShadowingRule(rule, [rule])).toBeNull();
  });

  it('returns null for a blank pattern and is never shadowed BY a blank pattern', () => {
    const blank = makeRule({ id: 'blank', pattern: '  ', createdAt: '2026-01-01T00:00:00.000Z' });
    const real = makeRule({ id: 'real', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(findShadowingRule(blank, [real])).toBeNull();
    expect(findShadowingRule(real, [blank])).toBeNull();
  });

  it('handles an empty rule list', () => {
    expect(findShadowingRule(makeRule({ pattern: 'APPLE.COM' }), [])).toBeNull();
  });

  it('returns the strongest shadowing rule when several qualify', () => {
    const oldestBroad = makeRule({ id: 'oldest', pattern: 'APPLE', createdAt: '2026-01-01T00:00:00.000Z' });
    const exactOlder = makeRule({ id: 'exact', pattern: 'APPLE.COM', createdAt: '2026-02-01T00:00:00.000Z' });
    const newer = makeRule({ id: 'newer', pattern: 'APPLE.COM', createdAt: '2026-06-01T00:00:00.000Z' });
    // Both `oldestBroad` (shorter, so lower specificity) and `exactOlder` are
    // candidates by substring, but only an equal-or-higher specificity shadows.
    expect(findShadowingRule(newer, [oldestBroad, exactOlder])?.id).toBe('exact');
  });
});

describe('suggestPatternFromDescriptor', () => {
  const cases: Array<[string, string]> = [
    // The two real-world examples from the feature brief.
    ['APPLE.COM/BILL 866-712-7753 CA', 'APPLE.COM/BILL'],
    ['AMERICAN EXPRESS ACH PMT 240725', 'AMERICAN EXPRESS ACH PMT'],
    // Trailing store numbers, dates and state codes.
    ['STARBUCKS #4021', 'STARBUCKS'],
    ['XCEL ENERGY WEB PYMT 07/25/26', 'XCEL ENERGY WEB PYMT'],
    ['TRADER JOES 710 ST PAUL MN', 'TRADER JOES 710 ST PAUL'],
    // Space-separated phone digits are stripped token by token.
    ['SQ *COFFEE BAR 866 712 7753', 'SQ *COFFEE BAR'],
    // Nothing to strip.
    ['NETFLIX', 'NETFLIX'],
    ['AMAZON MKTPL', 'AMAZON MKTPL'],
    // Normalized on the way out.
    ['  apple.com/bill   240725 ', 'APPLE.COM/BILL'],
    // Interior noise is load-bearing and kept.
    ['7-ELEVEN 22371 MAIN ST', '7-ELEVEN 22371 MAIN ST'],
    // A single meaningful digit is not treated as a reference number.
    ['GAS STOP 7', 'GAS STOP 7'],
  ];

  it.each(cases)('%s → %s', (descriptor, expected) => {
    expect(suggestPatternFromDescriptor(descriptor)).toBe(expected);
  });

  it('never returns empty for an all-noise descriptor', () => {
    expect(suggestPatternFromDescriptor('866-712-7753 CA 240725')).toBe('866-712-7753 CA 240725');
    expect(suggestPatternFromDescriptor('240725')).toBe('240725');
    expect(suggestPatternFromDescriptor('CA')).toBe('CA');
  });

  it('returns empty only when there is nothing to seed from', () => {
    expect(suggestPatternFromDescriptor('')).toBe('');
    expect(suggestPatternFromDescriptor('   \t ')).toBe('');
  });

  it('produces a pattern that actually matches the descriptor it came from', () => {
    for (const [descriptor] of cases) {
      const pattern = suggestPatternFromDescriptor(descriptor);
      expect(ruleMatches(makeRule({ pattern }), descriptor)).toBe(true);
    }
  });
});
