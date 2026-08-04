import { describe, it, expect } from 'vitest';
import { BudgetBucket } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { computeSafeToSpendDistribution } from '@/utils/safeToSpendDistribution';
import { computeBudgetFit, OVER_ALLOCATION_MIN_SHORTFALL } from '@/utils/budgetFit';

function makeBreakdown(safeToSpend: number): SafeToSpendBreakdown {
  return {
    checkingBalance: safeToSpend,
    unpaidBills: 0,
    pendingSpend: 0,
    safeToSpend,
    nextPaycheckDate: null,
    unpaidBillItems: [],
    pendingTransactions: [],
  };
}

function makeBucket(overrides: Partial<BudgetBucket> & { id: string; limit: number }): BudgetBucket {
  return {
    name: overrides.id,
    color: 'green',
    isVariable: true,
    isCore: false,
    ...overrides,
  };
}

function spentMap(entries: Record<string, BucketSpent>): Map<string, BucketSpent> {
  return new Map(Object.entries(entries));
}

describe('computeBudgetFit', () => {
  it('delegates claimed/leftover to computeSafeToSpendDistribution (single source of truth)', () => {
    const breakdown = makeBreakdown(356.22);
    const buckets = [makeBucket({ id: 'b1', limit: 300 }), makeBucket({ id: 'b2', limit: 123.76 })];
    const map = spentMap({ b1: { verified: 0, pending: 0 }, b2: { verified: 0, pending: 0 } });

    const expected = computeSafeToSpendDistribution(breakdown, buckets, map);
    const fit = computeBudgetFit(breakdown, buckets, map);

    expect(fit.claimed).toBe(expected.claimed);
    expect(fit.leftover).toBe(expected.leftover);
  });

  it('matches the CLAUDE.md worked example: StS $356.22 vs $423.76 claimed => $67.54 shortfall, over-allocated', () => {
    const breakdown = makeBreakdown(356.22);
    const buckets = [makeBucket({ id: 'b1', limit: 423.76 })];
    const map = spentMap({ b1: { verified: 0, pending: 0 } });

    const fit = computeBudgetFit(breakdown, buckets, map);

    expect(fit.claimed).toBe(423.76);
    expect(fit.leftover).toBeCloseTo(-67.54, 2);
    expect(fit.shortfall).toBeCloseTo(67.54, 2);
    expect(fit.isOverAllocated).toBe(true);
  });

  it('is NOT over-allocated when shortfall is just under the $10 threshold', () => {
    const breakdown = makeBreakdown(100);
    // claimed 109.99 => leftover -9.99, shortfall 9.99 < 10
    const buckets = [makeBucket({ id: 'b1', limit: 109.99 })];
    const map = spentMap({ b1: { verified: 0, pending: 0 } });

    const fit = computeBudgetFit(breakdown, buckets, map);

    expect(fit.shortfall).toBeCloseTo(9.99, 2);
    expect(fit.isOverAllocated).toBe(false);
  });

  it('IS over-allocated when shortfall is exactly at the $10 threshold', () => {
    const breakdown = makeBreakdown(100);
    // claimed 110 => leftover -10, shortfall exactly 10
    const buckets = [makeBucket({ id: 'b1', limit: 110 })];
    const map = spentMap({ b1: { verified: 0, pending: 0 } });

    const fit = computeBudgetFit(breakdown, buckets, map);

    expect(fit.shortfall).toBe(OVER_ALLOCATION_MIN_SHORTFALL);
    expect(fit.isOverAllocated).toBe(true);
  });

  it('is NOT over-allocated when Safe-to-Spend is negative, even with a huge claim (StS already reads red)', () => {
    const breakdown = makeBreakdown(-50);
    const buckets = [makeBucket({ id: 'b1', limit: 500 })];
    const map = spentMap({ b1: { verified: 0, pending: 0 } });

    const fit = computeBudgetFit(breakdown, buckets, map);

    // leftover is forced negative by the negative StS regardless of buckets.
    expect(fit.leftover).toBeLessThan(0);
    expect(fit.shortfall).toBeGreaterThan(OVER_ALLOCATION_MIN_SHORTFALL);
    // ...but the mark stays off because StS itself is already the alarm.
    expect(fit.isOverAllocated).toBe(false);
  });

  it('is not over-allocated with zero buckets (claimed 0, leftover = safeToSpend)', () => {
    const breakdown = makeBreakdown(356.22);
    const fit = computeBudgetFit(breakdown, [], new Map());

    expect(fit.claimed).toBe(0);
    expect(fit.leftover).toBe(356.22);
    expect(fit.shortfall).toBe(0);
    expect(fit.isOverAllocated).toBe(false);
  });

  it('an overspent bucket claims 0 (never negative), so it cannot mask another bucket\'s over-claim', () => {
    const breakdown = makeBreakdown(100);
    const buckets = [
      // Overspent by $200 — must contribute 0 to `claimed`, not -200.
      makeBucket({ id: 'over', limit: 100 }),
      makeBucket({ id: 'claims', limit: 115 }),
    ];
    const map = spentMap({
      over: { verified: 300, pending: 0 },
      claims: { verified: 0, pending: 0 },
    });

    const fit = computeBudgetFit(breakdown, buckets, map);

    // claimed should be exactly 115 (the overspent bucket contributes 0, not -200)
    expect(fit.claimed).toBe(115);
    expect(fit.leftover).toBeCloseTo(-15, 2);
    expect(fit.shortfall).toBeCloseTo(15, 2);
    expect(fit.isOverAllocated).toBe(true);
  });

  it('is not over-allocated when leftover is exactly zero (fully but not over allocated)', () => {
    const breakdown = makeBreakdown(100);
    const buckets = [makeBucket({ id: 'b1', limit: 100 })];
    const map = spentMap({ b1: { verified: 0, pending: 0 } });

    const fit = computeBudgetFit(breakdown, buckets, map);

    expect(fit.leftover).toBe(0);
    expect(fit.shortfall).toBe(0);
    expect(fit.isOverAllocated).toBe(false);
  });
});
