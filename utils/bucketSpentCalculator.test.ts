import { describe, it, expect } from 'vitest';
import {
  calculateBucketSpent,
  getTotalVerifiedSpending,
  getTotalPendingSpending,
} from './bucketSpentCalculator';
import { BudgetBucket, Transaction } from '@/types/schema';
import { getTransactionWindowStart } from './listenerWindows';

const bucket = (id: string, name: string): BudgetBucket =>
  ({ id, name } as BudgetBucket);

const tx = (
  category: string,
  amount: number,
  status: Transaction['status'],
): Transaction => ({ category, amount, status } as Transaction);

describe('calculateBucketSpent', () => {
  it('sums verified and pending spend per bucket (case-insensitive)', () => {
    const buckets = [bucket('b1', 'Groceries'), bucket('b2', 'Gas')];
    const transactions = [
      tx('groceries', 10, 'verified'),
      tx('Groceries', 5.5, 'pending_review'),
      tx('GAS', 40, 'verified'),
    ];

    const map = calculateBucketSpent(buckets, transactions, '');

    expect(map.get('b1')).toEqual({ verified: 10, pending: 5.5 });
    expect(map.get('b2')).toEqual({ verified: 40, pending: 0 });
  });

  it('accumulates without floating-point drift', () => {
    const buckets = [bucket('b1', 'Groceries')];
    // 0.1 + 0.2 naively === 0.30000000000000004
    const transactions = [
      tx('Groceries', 0.1, 'verified'),
      tx('Groceries', 0.2, 'verified'),
    ];

    const map = calculateBucketSpent(buckets, transactions, '');

    expect(map.get('b1')!.verified).toBe(0.3);
  });

  it('ignores uncategorized transactions and unknown categories', () => {
    const buckets = [bucket('b1', 'Groceries')];
    const transactions = [
      tx('', 99, 'verified'),
      tx('Mystery', 99, 'verified'),
      tx('Groceries', 12, 'verified'),
    ];

    const map = calculateBucketSpent(buckets, transactions, '');
    expect(map.get('b1')!.verified).toBe(12);
  });

  it('credits all buckets sharing a (case-insensitive) name so a duplicate is not silently $0', () => {
    // Transactions link to buckets only by category name; with two buckets named
    // "Groceries" we cannot disambiguate, so both are credited rather than the
    // previous first-match-only behavior that left the second bucket at $0.
    const buckets = [bucket('b1', 'Groceries'), bucket('b2', 'groceries')];
    const transactions = [tx('Groceries', 30, 'verified')];

    const map = calculateBucketSpent(buckets, transactions, '');

    expect(map.get('b1')).toEqual({ verified: 30, pending: 0 });
    expect(map.get('b2')).toEqual({ verified: 30, pending: 0 });
  });

  it('filters by pay period when a period id is provided', () => {
    const buckets = [bucket('b1', 'Groceries')];
    const inPeriod = { ...tx('Groceries', 10, 'verified'), payPeriodId: '2026-06-01' } as Transaction;
    const outOfPeriod = { ...tx('Groceries', 5, 'verified'), payPeriodId: '2026-05-01' } as Transaction;

    const map = calculateBucketSpent(buckets, [inPeriod, outOfPeriod], '2026-06-01');
    expect(map.get('b1')!.verified).toBe(10);
  });
});

// Regression coverage for the listener-windowing work: bucketSpent must stay
// exact even though the live transactions listener only loads a recent window.
describe('calculateBucketSpent under transaction windowing', () => {
  const txOn = (
    category: string,
    amount: number,
    date: string,
    payPeriodId: string,
  ): Transaction =>
    ({ category, amount, status: 'verified', date, payPeriodId } as Transaction);

  it('matches the full-history result because the window always covers the current period', () => {
    const now = new Date('2026-06-15T12:00:00');
    const buckets = [bucket('b1', 'Groceries'), bucket('b2', 'Gas')];
    const currentPeriodId = '2026-06-01';

    // Current-period spend (inside any sane window) ...
    const current = [
      txOn('Groceries', 30, '2026-06-02', currentPeriodId),
      txOn('Groceries', 12.5, '2026-06-10', currentPeriodId),
      txOn('Gas', 45, '2026-06-05', currentPeriodId),
    ];
    // ... plus lots of old spend in earlier periods, far outside the window.
    const historical = [
      txOn('Groceries', 100, '2026-01-15', '2026-01-01'),
      txOn('Gas', 200, '2025-11-15', '2025-11-01'),
      txOn('Groceries', 75, '2024-08-15', '2024-08-01'),
    ];
    const allTransactions = [...current, ...historical];

    // Apply the same windowing the live listener would.
    const windowStart = getTransactionWindowStart(currentPeriodId, now);
    expect(windowStart).not.toBeNull();
    const windowed = allTransactions.filter(t => t.date >= windowStart!);

    // The window drops the old rows but keeps the entire current period.
    expect(windowed).toHaveLength(current.length);

    const fromWindow = calculateBucketSpent(buckets, windowed, currentPeriodId);
    const fromFull = calculateBucketSpent(buckets, allTransactions, currentPeriodId);

    expect(fromWindow.get('b1')).toEqual(fromFull.get('b1'));
    expect(fromWindow.get('b2')).toEqual(fromFull.get('b2'));
    expect(fromWindow.get('b1')!.verified).toBe(42.5);
    expect(fromWindow.get('b2')!.verified).toBe(45);
  });

  it('covers the whole period even when the current period started more than 90 days ago', () => {
    const now = new Date('2026-06-15T12:00:00');
    const buckets = [bucket('b1', 'Groceries')];
    const oldPeriodId = '2026-01-01'; // ~165 days before "now"

    const periodTxns = [
      txOn('Groceries', 20, '2026-01-05', oldPeriodId),
      txOn('Groceries', 30, '2026-03-20', oldPeriodId),
    ];

    const windowStart = getTransactionWindowStart(oldPeriodId, now);
    // Window reaches back to the period start, so no period rows are dropped.
    expect(windowStart).toBe(oldPeriodId);
    const windowed = periodTxns.filter(t => t.date >= windowStart!);

    const map = calculateBucketSpent(buckets, windowed, oldPeriodId);
    expect(map.get('b1')!.verified).toBe(50);
  });
});

describe('total spending helpers', () => {
  it('sum verified/pending across buckets without drift', () => {
    const buckets = [bucket('b1', 'A'), bucket('b2', 'B'), bucket('b3', 'C')];
    const transactions = [
      tx('A', 0.1, 'verified'),
      tx('B', 0.2, 'verified'),
      tx('C', 0.1, 'pending_review'),
      tx('A', 0.2, 'pending_review'),
    ];

    const map = calculateBucketSpent(buckets, transactions, '');

    expect(getTotalVerifiedSpending(map)).toBe(0.3);
    expect(getTotalPendingSpending(map)).toBe(0.3);
  });
});
