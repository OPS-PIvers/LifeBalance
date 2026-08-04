import { describe, it, expect } from 'vitest';
import { type BudgetBucket, type BucketPeriodSnapshot } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import {
  buildTrimCandidates,
  computeTrimPlan,
  planBucketTrims,
  type TrimCandidate,
} from '@/utils/bucketTrimPlan';

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

/** One history snapshot; only bucketId / periodId / spend actually feed `suggestBucketLimit`. */
function snapshot(bucketId: string, periodId: string, totalSpent: number): BucketPeriodSnapshot {
  return {
    id: `${bucketId}-${periodId}`,
    bucketId,
    bucketName: bucketId,
    periodId,
    periodStartDate: periodId,
    periodEndDate: periodId,
    limit: 0,
    totalSpent,
    totalPending: 0,
    transactionCount: 1,
    createdAt: `${periodId}T00:00:00.000Z`,
  };
}

/** A hand-built candidate, for the pure `planBucketTrims` cases. */
function candidate(over: Partial<TrimCandidate> & { id: string; limit: number; slack: number }): TrimCandidate {
  return {
    name: over.id,
    spent: 0,
    need: over.limit - over.slack,
    ...over,
  };
}

describe('buildTrimCandidates', () => {
  it('takes `need` from the history average when it exceeds this period’s spend', () => {
    // Three periods averaging $190 → rounded UP to the nearest $5 = $190.
    const history = [
      snapshot('groc', '2026-06-01', 180),
      snapshot('groc', '2026-06-15', 200),
      snapshot('groc', '2026-07-01', 190),
    ];
    const [c] = buildTrimCandidates(
      [makeBucket({ id: 'groc', name: 'Groceries', limit: 300 })],
      spentMap({ groc: { verified: 20, pending: 0 } }),
      history,
    );

    expect(c).toBeDefined();
    expect(c?.need).toBe(190);
    expect(c?.spent).toBe(20);
    expect(c?.slack).toBe(110);
  });

  it('counts pending spend toward `spent` (a pending charge is money already committed)', () => {
    const [c] = buildTrimCandidates(
      [makeBucket({ id: 'groc', limit: 300 })],
      spentMap({ groc: { verified: 100, pending: 25.5 } }),
      [],
    );

    expect(c?.spent).toBe(125.5);
  });

  it('falls back to the current limit as `need` when the bucket has no history (nothing to trim)', () => {
    // suggestBucketLimit returns `currentLimit` with no snapshots — "keep the
    // same" — so an untouched bucket with no history offers no slack at all.
    const [c] = buildTrimCandidates(
      [makeBucket({ id: 'new', limit: 250 })],
      spentMap({ new: { verified: 0, pending: 0 } }),
      [],
    );

    expect(c?.need).toBe(250);
    expect(c?.slack).toBe(0);
  });

  it('treats a bucket with no entry in the spent map as $0 spent', () => {
    const [c] = buildTrimCandidates(
      [makeBucket({ id: 'ghost', limit: 100 })],
      new Map(),
      [snapshot('ghost', '2026-07-01', 40)],
    );

    expect(c?.spent).toBe(0);
    expect(c?.need).toBe(40);
    expect(c?.slack).toBe(60);
  });
});

describe('planBucketTrims — largest slack first', () => {
  it('takes the whole shortfall out of the single largest-slack bucket when it can absorb it', () => {
    const plan = planBucketTrims(50, [
      candidate({ id: 'small', limit: 100, slack: 20 }),
      candidate({ id: 'big', limit: 400, slack: 200 }),
    ]);

    expect(plan.suggestions).toEqual([
      { id: 'big', currentLimit: 400, suggestedLimit: 350, trim: 50 },
    ]);
    expect(plan.resolved).toBe(50);
    expect(plan.unresolved).toBe(0);
  });

  it('spills into the next-largest bucket only after the largest is exhausted', () => {
    const plan = planBucketTrims(120, [
      candidate({ id: 'small', limit: 100, slack: 20 }),
      candidate({ id: 'big', limit: 400, slack: 100 }),
      candidate({ id: 'mid', limit: 200, slack: 60 }),
    ]);

    // 100 from `big`, then 20 from `mid` — `small` is never touched.
    expect(plan.suggestions).toEqual([
      { id: 'big', currentLimit: 400, suggestedLimit: 300, trim: 100 },
      { id: 'mid', currentLimit: 200, suggestedLimit: 180, trim: 20 },
    ]);
    expect(plan.resolved).toBe(120);
    expect(plan.unresolved).toBe(0);
    expect(plan.suggestions.some(s => s.id === 'small')).toBe(false);
  });

  it('breaks a slack tie by input order — the household’s own bucket display order', () => {
    // Both offer exactly $80 of slack and only $80 is needed, so exactly one is
    // picked and WHICH one is the whole assertion. `first` precedes `second` in
    // the input array, so `first` wins.
    const plan = planBucketTrims(80, [
      candidate({ id: 'first', limit: 200, slack: 80 }),
      candidate({ id: 'second', limit: 500, slack: 80 }),
    ]);

    expect(plan.suggestions.map(s => s.id)).toEqual(['first']);

    // Reversing the input reverses the winner — the rule is input order, not
    // an id/name/limit sort that would happen to produce the same answer here
    // ('first' < 'second' alphabetically, and 200 < 500).
    const reversed = planBucketTrims(80, [
      candidate({ id: 'second', limit: 500, slack: 80 }),
      candidate({ id: 'first', limit: 200, slack: 80 }),
    ]);
    expect(reversed.suggestions.map(s => s.id)).toEqual(['second']);
  });
});

describe('planBucketTrims — the hard floor', () => {
  it('never suggests a limit below what the bucket has already spent this period', () => {
    // $200 limit, $180 already spent, history suggests only $50 → `need` is the
    // SPEND ($180), so only $20 of slack exists no matter how big the shortfall.
    const candidates = buildTrimCandidates(
      [makeBucket({ id: 'groc', name: 'Groceries', limit: 200 })],
      spentMap({ groc: { verified: 150, pending: 30 } }),
      [
        snapshot('groc', '2026-06-01', 50),
        snapshot('groc', '2026-06-15', 50),
        snapshot('groc', '2026-07-01', 50),
      ],
    );
    expect(candidates[0]?.need).toBe(180);

    const plan = planBucketTrims(100, candidates);

    expect(plan.suggestions).toEqual([
      { id: 'groc', currentLimit: 200, suggestedLimit: 180, trim: 20 },
    ]);
    // The suggested limit is exactly the spend — never below it.
    expect(plan.suggestions[0]?.suggestedLimit).toBeGreaterThanOrEqual(180);
    // …and the part the floor refused to give up is reported, not swallowed.
    expect(plan.resolved).toBe(20);
    expect(plan.unresolved).toBe(80);
  });

  it('clamps to the spend even if a candidate arrives with slack that breaches it', () => {
    // Defensive: `need` normally guarantees the floor, but the clamp inside
    // planBucketTrims is what makes that guarantee independent of `need`.
    const plan = planBucketTrims(500, [
      { id: 'groc', name: 'Groceries', limit: 200, spent: 180, need: 0, slack: 200 },
    ]);

    expect(plan.suggestions).toEqual([
      { id: 'groc', currentLimit: 200, suggestedLimit: 180, trim: 20 },
    ]);
    expect(plan.unresolved).toBe(480);
  });
});

describe('planBucketTrims — nothing to give', () => {
  it('returns an empty plan and the full shortfall unresolved with zero buckets', () => {
    const plan = planBucketTrims(75, []);

    expect(plan.suggestions).toEqual([]);
    expect(plan.resolved).toBe(0);
    expect(plan.unresolved).toBe(75);
  });

  it('returns an empty plan when every bucket is already overspent', () => {
    const candidates = buildTrimCandidates(
      [makeBucket({ id: 'groc', limit: 100 }), makeBucket({ id: 'gas', limit: 60 })],
      spentMap({ groc: { verified: 150, pending: 0 }, gas: { verified: 90, pending: 0 } }),
      [snapshot('groc', '2026-07-01', 20), snapshot('gas', '2026-07-01', 10)],
    );
    // Both need MORE than their limit, so slack is clamped at 0 (never negative
    // — an overspent bucket must not "donate" cash it has already spent).
    expect(candidates.map(c => c.slack)).toEqual([0, 0]);

    const plan = planBucketTrims(120, candidates);

    expect(plan.suggestions).toEqual([]);
    expect(plan.resolved).toBe(0);
    expect(plan.unresolved).toBe(120);
  });

  it('reports the remainder when the total slack is smaller than the shortfall', () => {
    const plan = planBucketTrims(300, [
      candidate({ id: 'a', limit: 200, slack: 100 }),
      candidate({ id: 'b', limit: 150, slack: 50 }),
    ]);

    expect(plan.suggestions.map(s => s.trim)).toEqual([100, 50]);
    expect(plan.resolved).toBe(150);
    expect(plan.unresolved).toBe(150);
  });

  it('plans nothing at all for a zero or negative shortfall', () => {
    const candidates = [candidate({ id: 'a', limit: 200, slack: 100 })];

    for (const shortfall of [0, -25]) {
      const plan = planBucketTrims(shortfall, candidates);
      expect(plan.suggestions).toEqual([]);
      expect(plan.resolved).toBe(0);
      expect(plan.unresolved).toBe(0);
    }
  });

  it('never emits a zero-trim suggestion for a bucket with no slack', () => {
    const plan = planBucketTrims(50, [
      candidate({ id: 'flat', limit: 100, slack: 0 }),
      candidate({ id: 'roomy', limit: 100, slack: 50 }),
    ]);

    expect(plan.suggestions.map(s => s.id)).toEqual(['roomy']);
  });
});

describe('planBucketTrims — cents', () => {
  it('closes an awkward shortfall exactly, with no floating-point drift', () => {
    const plan = planBucketTrims(67.54, [
      candidate({ id: 'a', limit: 423.76, slack: 123.76 }),
    ]);

    expect(plan.suggestions).toEqual([
      { id: 'a', currentLimit: 423.76, suggestedLimit: 356.22, trim: 67.54 },
    ]);
    expect(plan.unresolved).toBe(0);
  });

  it('sums partial takes to the shortfall exactly across several buckets', () => {
    const plan = planBucketTrims(0.3, [
      candidate({ id: 'a', limit: 10, slack: 0.1 }),
      candidate({ id: 'b', limit: 10, slack: 0.2 }),
    ]);

    expect(plan.resolved).toBe(0.3);
    expect(plan.unresolved).toBe(0);
    expect(plan.suggestions.map(s => s.trim)).toEqual([0.2, 0.1]);
  });
});

describe('computeTrimPlan', () => {
  it('measures slack and takes the shortfall in one call', () => {
    const buckets = [
      makeBucket({ id: 'groc', name: 'Groceries', limit: 400 }),
      makeBucket({ id: 'fun', name: 'Fun money', limit: 300 }),
    ];
    const spent = spentMap({
      groc: { verified: 220, pending: 0 },
      fun: { verified: 10, pending: 0 },
    });
    const history = [
      snapshot('groc', '2026-07-01', 240),
      snapshot('fun', '2026-07-01', 100),
    ];

    // groc: need = max(220, 240) = 240 → slack 160.
    // fun:  need = max(10, 100) = 100 → slack 200 (the larger, so it goes first).
    const plan = computeTrimPlan(150, buckets, spent, history);

    expect(plan.suggestions).toEqual([
      { id: 'fun', currentLimit: 300, suggestedLimit: 150, trim: 150 },
    ]);
    expect(plan.unresolved).toBe(0);
  });
});
