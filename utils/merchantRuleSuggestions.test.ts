import { describe, it, expect } from 'vitest';

import { ruleMatches } from '@/utils/merchantRules';
import {
  SUGGESTION_MIN_OCCURRENCES,
  suggestMerchantRules,
  type MerchantRuleSuggestion,
} from '@/utils/merchantRuleSuggestions';

import type { MerchantRule, Transaction } from '@/types/schema';

type Row = Pick<Transaction, 'merchant' | 'date' | 'category'>;

const APPLE = 'APPLE.COM/BILL 866-712-7753 CA';

function makeRule(overrides: Partial<MerchantRule> & { pattern: string }): MerchantRule {
  return {
    id: overrides.id ?? `rule-${overrides.pattern}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function row(merchant: string, date: string, category = 'Groceries'): Row {
  return { merchant, date, category };
}

/** `count` identical rows on consecutive days starting at `2026-07-{startDay}`. */
function repeat(merchant: string, count: number, startDay = 1, category = 'Groceries'): Row[] {
  return Array.from({ length: count }, (_, i) =>
    row(merchant, `2026-07-${String(startDay + i).padStart(2, '0')}`, category),
  );
}

const patternsOf = (suggestions: MerchantRuleSuggestion[]): string[] =>
  suggestions.map((s) => s.pattern);

describe('SUGGESTION_MIN_OCCURRENCES', () => {
  it('is the product decision: three sightings', () => {
    expect(SUGGESTION_MIN_OCCURRENCES).toBe(3);
  });
});

describe('suggestMerchantRules — occurrence threshold', () => {
  it('says nothing about a descriptor seen twice', () => {
    expect(suggestMerchantRules(repeat(APPLE, 2), [])).toEqual([]);
  });

  it('suggests a descriptor seen three times', () => {
    const suggestions = suggestMerchantRules(repeat(APPLE, 3), []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      pattern: 'APPLE.COM/BILL',
      sampleDescriptor: APPLE,
      occurrences: 3,
      lastDate: '2026-07-03',
      suggestedCategory: 'Groceries',
    });
  });

  it('honours a caller-supplied minOccurrences', () => {
    expect(suggestMerchantRules(repeat(APPLE, 2), [], { minOccurrences: 2 })).toHaveLength(1);
    expect(suggestMerchantRules(repeat(APPLE, 3), [], { minOccurrences: 4 })).toEqual([]);
  });

  it('clamps a nonsensical minOccurrences to 1 rather than suggesting nothing seen', () => {
    expect(suggestMerchantRules(repeat(APPLE, 1), [], { minOccurrences: 0 })).toHaveLength(1);
    expect(suggestMerchantRules(repeat(APPLE, 1), [], { minOccurrences: -5 })).toHaveLength(1);
    expect(suggestMerchantRules([], [], { minOccurrences: 0 })).toEqual([]);
  });

  it('counts two visits to the same store on the same day as two occurrences', () => {
    const sameDay = [
      row('CUB FOODS 1841', '2026-07-04'),
      row('CUB FOODS 1841', '2026-07-04'),
      row('CUB FOODS 1841', '2026-07-04'),
    ];
    const suggestions = suggestMerchantRules(sameDay, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.occurrences).toBe(3);
    expect(suggestions[0]?.lastDate).toBe('2026-07-04');
  });
});

describe('suggestMerchantRules — existing rule coverage', () => {
  it('says nothing when a bare rule already matches the descriptor', () => {
    const rules = [makeRule({ pattern: 'APPLE.COM', name: 'Apple' })];
    expect(suggestMerchantRules(repeat(APPLE, 5), rules)).toEqual([]);
  });

  it('suppresses via the engine, not string equality (broad CONTAINS pattern)', () => {
    const rules = [makeRule({ pattern: 'apple', name: 'Apple' })];
    expect(suggestMerchantRules(repeat(APPLE, 5), rules)).toEqual([]);
  });

  it('is unaffected by a rule that matches a different merchant', () => {
    const rules = [makeRule({ pattern: 'NETFLIX', name: 'Netflix' })];
    expect(patternsOf(suggestMerchantRules(repeat(APPLE, 3), rules))).toEqual(['APPLE.COM/BILL']);
  });

  it('ignores a blank-pattern rule, which matches nothing', () => {
    const rules = [makeRule({ pattern: '   ', name: 'Everything' })];
    expect(patternsOf(suggestMerchantRules(repeat(APPLE, 3), rules))).toEqual(['APPLE.COM/BILL']);
  });

  it('still suggests when only an AMOUNT-QUALIFIED rule covers the descriptor', () => {
    // Documented decision: an amount-qualified rule fires only on the rows at
    // that exact cent value, so it can never cover a descriptor's whole
    // history — the household's $79 Apple charges are still showing raw bank
    // text and deserve a bare rule.
    const rules = [makeRule({ pattern: 'APPLE.COM', amount: 2.99, name: 'iCloud+' })];
    const suggestions = suggestMerchantRules(repeat(APPLE, 3), rules);
    expect(patternsOf(suggestions)).toEqual(['APPLE.COM/BILL']);
  });

  it('a bare rule suppresses where the same-pattern amount-qualified rule does not', () => {
    const qualified = [makeRule({ id: 'q', pattern: 'APPLE.COM', amount: 2.99 })];
    const bare = [makeRule({ id: 'b', pattern: 'APPLE.COM' })];
    expect(suggestMerchantRules(repeat(APPLE, 3), qualified)).toHaveLength(1);
    expect(suggestMerchantRules(repeat(APPLE, 3), bare)).toEqual([]);
  });

  it('excludes covered rows from the occurrence count instead of the cluster', () => {
    const rows = [...repeat('SAFEWAY 1234', 3), row('SAFEWAY 9999', '2026-07-04')];
    const rules = [makeRule({ pattern: 'SAFEWAY 9999', name: 'Safeway (west)' })];
    const suggestions = suggestMerchantRules(rows, rules);
    expect(suggestions).toHaveLength(1);
    // 4 rows, one already covered → 3, not 4.
    expect(suggestions[0]?.occurrences).toBe(3);
    expect(suggestions[0]?.lastDate).toBe('2026-07-03');
  });

  it('drops a cluster below the threshold once covered rows are removed', () => {
    const rows = [...repeat('KWIK TRIP 41', 2), row('KWIK TRIP 99', '2026-07-03')];
    const rules = [makeRule({ pattern: 'KWIK TRIP 99' })];
    expect(suggestMerchantRules(rows, rules)).toEqual([]);
    // Without the rule the same rows are one 3-strong cluster.
    expect(patternsOf(suggestMerchantRules(rows, []))).toEqual(['KWIK TRIP']);
  });
});

describe('suggestMerchantRules — clustering variant spellings', () => {
  const traderJoes = [
    row('TRADER JOES 710 ST PAUL MN', '2026-07-01'),
    row('TRADER JOES #710', '2026-07-02'),
    row('TRADER JOES', '2026-07-03'),
  ];

  it('groups variant spellings of one merchant into a single suggestion', () => {
    const suggestions = suggestMerchantRules(traderJoes, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.occurrences).toBe(3);
  });

  it('proposes the pattern that covers the most of the cluster, not the most common one', () => {
    // Two of the three rows seed "TRADER JOES 710 ST PAUL"-style patterns, but
    // only the short pattern relabels all three.
    const suggestions = suggestMerchantRules(
      [...traderJoes, row('TRADER JOES 710 ST PAUL MN', '2026-07-04')],
      [],
    );
    expect(suggestions[0]?.pattern).toBe('TRADER JOES');
    expect(suggestions[0]?.occurrences).toBe(4);
  });

  it('shows the most recent MATCHING descriptor as evidence', () => {
    expect(suggestMerchantRules(traderJoes, [])[0]?.sampleDescriptor).toBe('TRADER JOES');
    expect(suggestMerchantRules(traderJoes, [])[0]?.lastDate).toBe('2026-07-03');
  });

  it('keeps genuinely different merchants apart', () => {
    const rows = [...repeat('NETFLIX', 3, 1), ...repeat('SPOTIFY', 3, 10)];
    const suggestions = suggestMerchantRules(rows, []);
    // Two clusters of 3, so the more recent one leads (see the ordering suite).
    expect(patternsOf(suggestions)).toEqual(['SPOTIFY', 'NETFLIX']);
    expect(suggestions.map((s) => s.occurrences)).toEqual([3, 3]);
  });

  it('merges names that differ only by a single-character token', () => {
    // `merchantSimilar` drops 1-char tokens as noise, so "MERCHANT A" and
    // "MERCHANT B" compare as the same {merchant} token set. Pinned as known
    // behaviour of the shared clustering primitive: the suggestion is still
    // useful (the "MERCHANT" pattern relabels both) and the user edits it.
    const rows = [...repeat('SUPERAMERICA A', 2, 1), ...repeat('SUPERAMERICA B', 2, 5)];
    const suggestions = suggestMerchantRules(rows, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.occurrences).toBe(4);
    expect(suggestions[0]?.pattern).toBe('SUPERAMERICA');
  });

  it('clusters descriptors that normalize to nothing but are identical', () => {
    // `merchantSimilar` strips punctuation and refuses an empty comparison, so
    // identical patterns cluster on equality alone.
    expect(suggestMerchantRules(repeat('***', 3), [])).toHaveLength(1);
  });
});

describe('suggestMerchantRules — ordering, determinism and limit', () => {
  const mixed = [
    ...repeat('NETFLIX', 4, 1),
    ...repeat('SPOTIFY', 3, 10),
    ...repeat('HULU', 3, 20),
  ];

  it('sorts by occurrences desc, then most recent, then pattern', () => {
    expect(patternsOf(suggestMerchantRules(mixed, []))).toEqual(['NETFLIX', 'HULU', 'SPOTIFY']);
  });

  it('breaks a full tie alphabetically by pattern', () => {
    const tied = [
      ...Array.from({ length: 3 }, () => row('ZARA', '2026-07-05')),
      ...Array.from({ length: 3 }, () => row('ALDI', '2026-07-05')),
    ];
    expect(patternsOf(suggestMerchantRules(tied, []))).toEqual(['ALDI', 'ZARA']);
  });

  it('is independent of input order', () => {
    const forwards = suggestMerchantRules(mixed, []);
    const backwards = suggestMerchantRules([...mixed].reverse(), []);
    const shuffled = suggestMerchantRules(
      [...mixed].sort((a, b) => a.merchant.localeCompare(b.merchant)),
      [],
    );
    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('returns at most five suggestions by default', () => {
    const names = ['ALDI', 'BESTBUY', 'COSTCO', 'DELTA', 'ETSY', 'FEDEX', 'GAP', 'HOMEDEPOT'];
    const many = names.flatMap((name) => repeat(name, 3, 1));
    expect(suggestMerchantRules(many, [], { limit: 99 })).toHaveLength(8);
    expect(suggestMerchantRules(many, [])).toHaveLength(5);
  });

  it('honours a caller-supplied limit, keeping the strongest', () => {
    expect(patternsOf(suggestMerchantRules(mixed, [], { limit: 2 }))).toEqual(['NETFLIX', 'HULU']);
    expect(suggestMerchantRules(mixed, [], { limit: 0 })).toEqual([]);
    expect(suggestMerchantRules(mixed, [], { limit: -1 })).toEqual([]);
    expect(suggestMerchantRules(mixed, [], { limit: 99 })).toHaveLength(3);
  });
});

describe('suggestMerchantRules — suggestedCategory', () => {
  it('picks the modal category across the cluster', () => {
    const rows = [
      row('CUB FOODS 1841', '2026-07-01', 'Groceries'),
      row('CUB FOODS 1841', '2026-07-02', 'Groceries'),
      row('CUB FOODS 1841', '2026-07-03', 'Dining'),
    ];
    expect(suggestMerchantRules(rows, [])[0]?.suggestedCategory).toBe('Groceries');
  });

  it('breaks a category tie alphabetically, not by first-seen', () => {
    const rows = [
      row('CUB FOODS 1841', '2026-07-01', 'Groceries'),
      row('CUB FOODS 1841', '2026-07-02', 'Dining'),
      row('CUB FOODS 1841', '2026-07-03', 'Groceries'),
      row('CUB FOODS 1841', '2026-07-04', 'Dining'),
    ];
    expect(suggestMerchantRules(rows, [])[0]?.suggestedCategory).toBe('Dining');
    expect(suggestMerchantRules([...rows].reverse(), [])[0]?.suggestedCategory).toBe('Dining');
  });

  it('ignores blank categories when choosing the mode', () => {
    const rows = [
      row('CUB FOODS 1841', '2026-07-01', '  '),
      row('CUB FOODS 1841', '2026-07-02', '  '),
      row('CUB FOODS 1841', '2026-07-03', 'Dining'),
    ];
    expect(suggestMerchantRules(rows, [])[0]?.suggestedCategory).toBe('Dining');
  });

  it('omits the field entirely when no row carries a category', () => {
    const suggestion = suggestMerchantRules(repeat('CUB FOODS 1841', 3, 1, ''), [])[0];
    expect(suggestion?.suggestedCategory).toBeUndefined();
    expect(suggestion && 'suggestedCategory' in suggestion).toBe(false);
  });

  it('does not exclude income — deposits get rules too', () => {
    const suggestions = suggestMerchantRules(
      repeat('DIRECT DEP PAYROLL 240725', 3, 1, 'Income'),
      [],
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.pattern).toBe('DIRECT DEP PAYROLL');
    expect(suggestions[0]?.suggestedCategory).toBe('Income');
  });
});

describe('suggestMerchantRules — degenerate input', () => {
  it('returns nothing for empty inputs', () => {
    expect(suggestMerchantRules([], [])).toEqual([]);
    expect(suggestMerchantRules([], [makeRule({ pattern: 'APPLE.COM' })])).toEqual([]);
  });

  it('skips blank and whitespace-only merchants', () => {
    expect(suggestMerchantRules(repeat('   ', 4), [])).toEqual([]);
    expect(suggestMerchantRules(repeat('', 4), [])).toEqual([]);
  });

  it('does not let blank merchants join or inflate a real cluster', () => {
    const rows = [...repeat('NETFLIX', 3, 1), ...repeat('  ', 3, 10)];
    const suggestions = suggestMerchantRules(rows, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.occurrences).toBe(3);
  });

  it('trims the descriptor before using it as evidence', () => {
    const suggestions = suggestMerchantRules(repeat('  NETFLIX  ', 3), []);
    expect(suggestions[0]?.sampleDescriptor).toBe('NETFLIX');
    expect(suggestions[0]?.pattern).toBe('NETFLIX');
  });

  it('handles an all-noise descriptor without proposing a blank pattern', () => {
    const suggestions = suggestMerchantRules(repeat('866-712-7753 CA 240725', 3), []);
    expect(suggestions[0]?.pattern).toBe('866-712-7753 CA 240725');
  });
});

describe('suggestMerchantRules — the proposed pattern is usable as-is', () => {
  const corpus: Row[] = [
    ...repeat(APPLE, 3, 1),
    ...repeat('AMERICAN EXPRESS ACH PMT 240725', 3, 5),
    ...repeat('STARBUCKS #4021', 3, 9),
    row('TRADER JOES 710 ST PAUL MN', '2026-07-13'),
    row('TRADER JOES #710', '2026-07-14'),
    row('TRADER JOES', '2026-07-15'),
    ...repeat('7-ELEVEN 22371 MAIN ST', 3, 16),
  ];

  it('every suggestion produces a rule that matches its own sample descriptor', () => {
    for (const suggestion of suggestMerchantRules(corpus, [], { limit: 99 })) {
      expect(ruleMatches(makeRule({ pattern: suggestion.pattern }), suggestion.sampleDescriptor)).toBe(true);
    }
  });

  it('accepting every suggestion silences the suggester', () => {
    const first = suggestMerchantRules(corpus, [], { limit: 99 });
    expect(first.length).toBeGreaterThan(0);
    const accepted = first.map((s, i) => makeRule({ id: `accepted-${i}`, pattern: s.pattern }));
    // Re-running with the accepted rules must not re-propose anything the
    // household just authored — otherwise the card would never go away.
    expect(suggestMerchantRules(corpus, accepted, { limit: 99 })).toEqual([]);
  });
});
