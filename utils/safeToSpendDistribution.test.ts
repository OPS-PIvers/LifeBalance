import { describe, it, expect } from 'vitest';
import { computeSafeToSpendDistribution } from './safeToSpendDistribution';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { BudgetBucket } from '@/types/schema';

const breakdown = (safeToSpend: number): SafeToSpendBreakdown => ({
  checkingBalance: safeToSpend, // exact composition is irrelevant to the distribution
  unpaidBills: 0,
  pendingSpend: 0,
  safeToSpend,
  nextPaycheckDate: null,
  unpaidBillItems: [],
  pendingTransactions: [],
});

const bucket = (id: string, name: string, limit: number): BudgetBucket => ({
  id,
  name,
  limit,
  color: 'green',
  isVariable: true,
  isCore: false,
});

const spentMap = (entries: Record<string, BucketSpent>): Map<string, BucketSpent> =>
  new Map(Object.entries(entries));

describe('computeSafeToSpendDistribution', () => {
  it('normal case: leftover = StS − Σ remaining (all buckets under budget)', () => {
    const buckets = [bucket('groc', 'Groceries', 200), bucket('ent', 'Entertainment', 200)];
    const map = spentMap({
      groc: { verified: 40, pending: 10 }, // spent 50 → remaining 150
      ent: { verified: 0, pending: 0 },    // spent 0  → remaining 200
    });

    const result = computeSafeToSpendDistribution(breakdown(1700), buckets, map);

    expect(result.rows).toEqual([
      { id: 'groc', name: 'Groceries', limit: 200, spent: 50, remaining: 150, isOver: false, claim: 150 },
      { id: 'ent', name: 'Entertainment', limit: 200, spent: 0, remaining: 200, isOver: false, claim: 200 },
    ]);
    // claimed = 150 + 200 = 350; leftover = 1700 − 350 = 1350
    expect(result.claimed).toBe(350);
    expect(result.leftover).toBe(1350);
    expect(result.overAllocated).toBe(false);
  });

  it('an overspent bucket contributes 0 to the claimed total but its row shows the negative remaining', () => {
    const buckets = [bucket('groc', 'Groceries', 200), bucket('gas', 'Gas', 100)];
    const map = spentMap({
      groc: { verified: 50, pending: 0 }, // remaining 150
      gas: { verified: 150, pending: 0 }, // spent 150 → remaining -50 (over)
    });

    const result = computeSafeToSpendDistribution(breakdown(1000), buckets, map);

    const gasRow = result.rows.find(r => r.id === 'gas')!;
    expect(gasRow.remaining).toBe(-50);
    expect(gasRow.isOver).toBe(true);
    // The over-budget row's own claim is 0, not its negative remaining.
    expect(gasRow.claim).toBe(0);
    // claimed = 150 (groc) + 0 (gas contributes 0, NOT -50); leftover = 1000 − 150 = 850
    expect(result.claimed).toBe(150);
    expect(result.leftover).toBe(850);
    expect(result.overAllocated).toBe(false);
  });

  it('over-allocated: Σ remaining exceeds StS → negative leftover and overAllocated true', () => {
    const buckets = [bucket('rent', 'Rent', 2000), bucket('groc', 'Groceries', 500)];
    const map = spentMap({
      rent: { verified: 0, pending: 0 }, // remaining 2000
      groc: { verified: 0, pending: 0 }, // remaining 500
    });

    // claimed = 2500, StS = 1000 → leftover = -1500
    const result = computeSafeToSpendDistribution(breakdown(1000), buckets, map);

    expect(result.leftover).toBe(-1500);
    expect(result.overAllocated).toBe(true);
  });

  it('empty buckets: leftover equals StS', () => {
    const result = computeSafeToSpendDistribution(breakdown(1700), [], new Map());
    expect(result.rows).toEqual([]);
    expect(result.claimed).toBe(0);
    expect(result.leftover).toBe(1700);
    expect(result.overAllocated).toBe(false);
  });

  it('a missing bucketSpentMap entry is treated as zero spent', () => {
    const buckets = [bucket('new', 'New Bucket', 300)];
    // No entry for 'new' in the map.
    const result = computeSafeToSpendDistribution(breakdown(1000), buckets, new Map());

    expect(result.rows).toEqual([
      { id: 'new', name: 'New Bucket', limit: 300, spent: 0, remaining: 300, isOver: false, claim: 300 },
    ]);
    // claimed = 300; leftover = 1000 − 300 = 700
    expect(result.leftover).toBe(700);
    expect(result.overAllocated).toBe(false);
  });
});
