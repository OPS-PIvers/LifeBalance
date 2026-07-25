import { describe, expect, it } from 'vitest';
import { INCOME_CATEGORY, type MerchantRule, type Transaction } from '@/types/schema';
import { detectSubscriptions } from '@/utils/subscriptionDetection';

type TestTxn = Pick<Transaction, 'id' | 'merchant' | 'amount' | 'date' | 'category'>;

function txn(
  id: string,
  merchant: string,
  amount: number,
  date: string,
  category = 'Subscriptions'
): TestTxn {
  return { id, merchant, amount, date, category };
}

describe('detectSubscriptions', () => {
  it('detects a clean monthly subscription (3 occurrences, ~30-day gaps)', () => {
    const txns = [
      txn('t1', 'Netflix', 15.99, '2026-04-15'),
      txn('t2', 'Netflix', 15.99, '2026-05-15'),
      txn('t3', 'Netflix', 15.99, '2026-06-14'),
    ];
    const result = detectSubscriptions(txns, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      merchant: 'Netflix',
      cadence: 'monthly',
      occurrences: 3,
      averageAmount: 15.99,
      lastDate: '2026-06-14',
    });
    expect(result[0]?.transactionIds).toEqual(['t1', 't2', 't3']);
  });

  it('detects a clean weekly subscription (4 occurrences, ~7-day gaps)', () => {
    const txns = [
      txn('t1', 'Spotify', 5, '2026-06-01'),
      txn('t2', 'Spotify', 5, '2026-06-08'),
      txn('t3', 'Spotify', 5, '2026-06-15'),
      txn('t4', 'Spotify', 5, '2026-06-22'),
    ];
    const result = detectSubscriptions(txns, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ merchant: 'Spotify', cadence: 'weekly', occurrences: 4 });
  });

  it('rejects a monthly gap of 27 days (just under the window)', () => {
    const txns = [
      txn('t1', 'Gymrat', 40, '2026-04-01'),
      txn('t2', 'Gymrat', 40, '2026-04-28'), // 27 days
      txn('t3', 'Gymrat', 40, '2026-05-28'), // 30 days
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(0);
  });

  it('accepts a monthly gap of exactly 28 days', () => {
    const txns = [
      txn('t1', 'Gymrat', 40, '2026-04-01'),
      txn('t2', 'Gymrat', 40, '2026-04-29'), // 28 days
      txn('t3', 'Gymrat', 40, '2026-05-27'), // 28 days
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(1);
  });

  it('accepts a monthly gap of exactly 33 days', () => {
    const txns = [
      txn('t1', 'Gymrat', 40, '2026-04-01'),
      txn('t2', 'Gymrat', 40, '2026-05-04'), // 33 days
      txn('t3', 'Gymrat', 40, '2026-06-06'), // 33 days
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(1);
  });

  it('rejects a monthly gap of 34 days (just over the window)', () => {
    const txns = [
      txn('t1', 'Gymrat', 40, '2026-04-01'),
      txn('t2', 'Gymrat', 40, '2026-05-05'), // 34 days
      txn('t3', 'Gymrat', 40, '2026-06-08'), // 34 days
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(0);
  });

  it('rejects a group whose amount varies more than the 1.3x stability ratio', () => {
    const txns = [
      txn('t1', 'Utility Co', 100, '2026-04-15'),
      txn('t2', 'Utility Co', 100, '2026-05-15'),
      txn('t3', 'Utility Co', 140, '2026-06-14'), // 1.4x min
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(0);
  });

  it('accepts a group right at the 1.3x amount stability boundary', () => {
    const txns = [
      txn('t1', 'Utility Co', 100, '2026-04-15'),
      txn('t2', 'Utility Co', 100, '2026-05-15'),
      txn('t3', 'Utility Co', 130, '2026-06-14'), // exactly 1.3x min
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(1);
  });

  it('collapses same-day duplicates before classifying', () => {
    const txns = [
      txn('t1', 'Netflix', 15.99, '2026-04-15'),
      txn('t1b', 'Netflix', 15.99, '2026-04-15'), // same-day dupe, dropped
      txn('t2', 'Netflix', 15.99, '2026-05-15'),
      txn('t3', 'Netflix', 15.99, '2026-06-14'),
    ];
    const result = detectSubscriptions(txns, []);
    expect(result).toHaveLength(1);
    expect(result[0]?.occurrences).toBe(3);
    expect(result[0]?.transactionIds).not.toContain('t1b');
  });

  it('excludes income transactions from detection', () => {
    const txns = [
      txn('t1', 'Employer', 3000, '2026-04-15', INCOME_CATEGORY),
      txn('t2', 'Employer', 3000, '2026-05-15', INCOME_CATEGORY),
      txn('t3', 'Employer', 3000, '2026-06-14', INCOME_CATEGORY),
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(0);
  });

  it('excludes a group whose merchant matches an existing calendar-bill title', () => {
    const txns = [
      txn('t1', 'Netflix', 15.99, '2026-04-15'),
      txn('t2', 'Netflix', 15.99, '2026-05-15'),
      txn('t3', 'Netflix', 15.99, '2026-06-14'),
    ];
    expect(detectSubscriptions(txns, ['Netflix Subscription'])).toHaveLength(0);
  });

  it('excludes a detected merchant LONGER than the existing bill title (symmetric match)', () => {
    // Bill "Netflix" must suppress a detected "Netflix Monthly" — the shorter
    // token sequence is looked for inside the longer one in both directions.
    const txns = [
      txn('t1', 'Netflix Monthly', 15.99, '2026-04-15'),
      txn('t2', 'Netflix Monthly', 15.99, '2026-05-15'),
      txn('t3', 'Netflix Monthly', 15.99, '2026-06-14'),
    ];
    expect(detectSubscriptions(txns, ['Netflix'])).toHaveLength(0);
  });

  it('does not flag fewer than 3 occurrences', () => {
    const txns = [
      txn('t1', 'Netflix', 15.99, '2026-05-15'),
      txn('t2', 'Netflix', 15.99, '2026-06-14'),
    ];
    expect(detectSubscriptions(txns, [])).toHaveLength(0);
  });

  it('groups merchant variants via merchantSimilar (NETFLIX.COM vs Netflix)', () => {
    const txns = [
      txn('t1', 'NETFLIX.COM', 15.99, '2026-04-15'),
      txn('t2', 'Netflix', 15.99, '2026-05-15'),
      txn('t3', 'Netflix', 15.99, '2026-06-14'),
    ];
    const result = detectSubscriptions(txns, []);
    expect(result).toHaveLength(1);
    expect(result[0]?.occurrences).toBe(3);
  });

  it('computes nextExpectedDate as lastDate + median gap', () => {
    const txns = [
      txn('t1', 'Netflix', 15.99, '2026-04-15'),
      txn('t2', 'Netflix', 15.99, '2026-05-15'), // 30 days
      txn('t3', 'Netflix', 15.99, '2026-06-14'), // 30 days
    ];
    const result = detectSubscriptions(txns, []);
    expect(result[0]?.nextExpectedDate).toBe('2026-07-14');
  });

  it('returns an empty array for no transactions', () => {
    expect(detectSubscriptions([], [])).toEqual([]);
  });

  it('keeps unrelated merchants in separate groups', () => {
    const txns = [
      txn('t1', 'Netflix', 15.99, '2026-04-15'),
      txn('t2', 'Netflix', 15.99, '2026-05-15'),
      txn('t3', 'Netflix', 15.99, '2026-06-14'),
      txn('s1', 'Spotify', 5, '2026-06-01'),
      txn('s2', 'Spotify', 5, '2026-06-08'),
      txn('s3', 'Spotify', 5, '2026-06-15'),
      txn('s4', 'Spotify', 5, '2026-06-22'),
    ];
    const result = detectSubscriptions(txns, []);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.merchant).sort()).toEqual(['Netflix', 'Spotify']);
  });
});

describe('detectSubscriptions — merchant-rule-aware bill exclusion (F-MONEY-14)', () => {
  const APPLE_TXNS = [
    txn('a1', 'APPLE.COM/BILL 866-712-7753 CA', 2.99, '2026-04-15'),
    txn('a2', 'APPLE.COM/BILL 866-712-7753 CA', 2.99, '2026-05-15'),
    txn('a3', 'APPLE.COM/BILL 866-712-7753 CA', 2.99, '2026-06-14'),
  ];
  const APPLE_RULE: MerchantRule = {
    id: 'r-apple',
    pattern: 'APPLE.COM',
    name: 'iCloud storage',
    createdAt: '2026-07-01T00:00:00.000Z',
  };

  it('detects the raw descriptor when no bill covers it', () => {
    expect(detectSubscriptions(APPLE_TXNS, [], [APPLE_RULE])).toHaveLength(1);
  });

  it('suppresses the detection when a bill is named after the RULE, not the descriptor', () => {
    // The regression this guards: adding the detection as a bill titled
    // "iCloud storage" would otherwise leave the raw descriptor un-excluded, so
    // the same subscription would be re-detected on every open, forever.
    expect(detectSubscriptions(APPLE_TXNS, ['iCloud storage'], [APPLE_RULE])).toHaveLength(0);
  });

  it('does NOT suppress it on a rule-named bill when the rule is absent', () => {
    // Without the rule there is no connection between the two strings, so the
    // pre-feature behaviour must be preserved exactly.
    expect(detectSubscriptions(APPLE_TXNS, ['iCloud storage'])).toHaveLength(1);
    expect(detectSubscriptions(APPLE_TXNS, ['iCloud storage'], [])).toHaveLength(1);
  });

  it('still suppresses on a descriptor-matching bill title, rules or not', () => {
    expect(detectSubscriptions(APPLE_TXNS, ['Apple.com'])).toHaveLength(0);
    expect(detectSubscriptions(APPLE_TXNS, ['Apple.com'], [APPLE_RULE])).toHaveLength(0);
  });

  it('ignores an amount-qualified rule, whose amount cannot be resolved from a cluster', () => {
    // A detection's amount is an average across the cluster, not any one row's,
    // so an amount-qualified rule must not be applied here by coincidence.
    const amountRule: MerchantRule = { ...APPLE_RULE, amount: 2.99 };
    expect(detectSubscriptions(APPLE_TXNS, ['iCloud storage'], [amountRule])).toHaveLength(1);
  });
});
