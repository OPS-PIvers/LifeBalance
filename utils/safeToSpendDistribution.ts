import { BudgetBucket } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { sumMoney, subtractMoney } from '@/utils/money';

/**
 * Plan 016 — Safe-to-Spend "pool + tracking overlay" decomposition.
 *
 * Checking is ONE pool and all of it is safe to spend; buckets do NOT reserve
 * or subtract from Safe-to-Spend. This helper decomposes that single pool into
 * where the money is nominally allocated across buckets, plus the unallocated
 * leftover — for DISPLAY only. It is explicitly NOT an envelope model.
 *
 *   safeToSpend = Σ max(0, bucket remaining) + leftover
 */

export interface BucketDistroRow {
  id: string;
  name: string;
  limit: number;
  spent: number;
  remaining: number;
  isOver: boolean;
  /**
   * What this bucket claims from the pool: `max(0, remaining)`. An overspent
   * bucket claims nothing (it can't reclaim cash it already spent), which is
   * why this is not simply `remaining`.
   */
  claim: number;
}

export interface SafeToSpendDistribution {
  rows: BucketDistroRow[];
  /** Σ of every row's `claim` — the total the buckets still expect to spend. */
  claimed: number;
  /** StS − Σ max(0, remaining). May be negative when budgets exceed free cash. */
  leftover: number;
  /** True when leftover < 0 (over-allocated). */
  overAllocated: boolean;
}

/**
 * Decompose the Safe-to-Spend pool across the household's budget buckets.
 *
 * `spent` = verified + pending for the bucket. Per D3 (Plan 016), spent MUST
 * stay checking-drawing-only — `bucketSpentMap` already excludes credit-card
 * and income spend by construction (see bucketSpentCalculator). Keep it that
 * way so the future credit-decoupling plan doesn't leak credit spend into this
 * distribution.
 */
export function computeSafeToSpendDistribution(
  breakdown: SafeToSpendBreakdown,
  buckets: BudgetBucket[],
  bucketSpentMap: Map<string, BucketSpent>,
): SafeToSpendDistribution {
  const rows: BucketDistroRow[] = buckets.map(b => {
    const s = bucketSpentMap.get(b.id) ?? { verified: 0, pending: 0 };
    const spent = sumMoney([s.verified, s.pending]);
    const remaining = subtractMoney(b.limit, spent);
    return {
      id: b.id,
      name: b.name,
      limit: b.limit,
      spent,
      remaining,
      isOver: remaining < 0,
      // Overspent buckets contribute 0 (never negative) to the claimed total —
      // an over-budget bucket doesn't reclaim cash from the pool.
      claim: remaining > 0 ? remaining : 0,
    };
  });
  const claimed = sumMoney(rows.map(r => r.claim));
  const leftover = subtractMoney(breakdown.safeToSpend, claimed);
  return { rows, claimed, leftover, overAllocated: leftover < 0 };
}
