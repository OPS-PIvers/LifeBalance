import { describe, it, expect } from 'vitest';
import {
  calculateBucketSpent,
  getTotalVerifiedSpending,
  getTotalPendingSpending,
} from './bucketSpentCalculator';
import { BudgetBucket, Transaction } from '@/types/schema';

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

  it('filters by pay period when a period id is provided', () => {
    const buckets = [bucket('b1', 'Groceries')];
    const inPeriod = { ...tx('Groceries', 10, 'verified'), payPeriodId: '2026-06-01' } as Transaction;
    const outOfPeriod = { ...tx('Groceries', 5, 'verified'), payPeriodId: '2026-05-01' } as Transaction;

    const map = calculateBucketSpent(buckets, [inPeriod, outOfPeriod], '2026-06-01');
    expect(map.get('b1')!.verified).toBe(10);
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
