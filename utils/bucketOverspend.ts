import { addMoney, subtractMoney, sumMoney } from '@/utils/money';
import type { BucketSpent } from '@/utils/bucketSpentCalculator';

/**
 * Pure display logic for a single budget bucket's overspend state.
 *
 * Buckets are a display/tracking overlay on the checking pool, NOT envelopes —
 * going over a bucket does not move money out of anywhere and does not reduce
 * Safe to Spend (see the Safe-to-Spend section of CLAUDE.md). This helper only
 * decides how a bucket card should *present* its spend against its own limit.
 */
export interface BucketOverspend {
  /** verified + pending, exact to the cent. */
  committed: number;
  /** True when committed spend exceeds the bucket's limit. */
  isOverspent: boolean;
  /** How far past the limit, in dollars (0 when not overspent). */
  overage: number;
  /**
   * Fill percentage for the progress bar, clamped to 0–100. A bucket with no
   * positive limit reads as 100% once anything is spent (e.g. the synthetic
   * "Unbudgeted & Other" pseudo-bucket) and 0% otherwise.
   */
  percent: number;
}

/**
 * Compute the overspend state for one bucket from its spent figures and limit.
 */
export function getBucketOverspend(spent: BucketSpent, limit: number): BucketOverspend {
  const committed = addMoney(spent.verified, spent.pending);
  const isOverspent = committed > limit;
  const overage = isOverspent ? subtractMoney(committed, limit) : 0;
  const percent =
    limit > 0 ? Math.min(100, (committed / limit) * 100) : committed > 0 ? 100 : 0;
  return { committed, isOverspent, overage, percent };
}

export interface BucketsOverspendSummary {
  /** How many real (positive-limit) buckets are over their limit. */
  overspentCount: number;
  /** Sum of every overspent bucket's overage, exact to the cent. */
  totalOverage: number;
}

/**
 * Aggregate overspend across a set of buckets for a group-level summary.
 *
 * Only buckets with a positive limit count — a bucket with no budget (limit
 * ≤ 0, e.g. the "Unbudgeted & Other" pseudo-bucket) has nothing to be "over",
 * so it never inflates the group total.
 */
export function getBucketsOverspendSummary(
  entries: ReadonlyArray<{ spent: BucketSpent; limit: number }>
): BucketsOverspendSummary {
  const overages: number[] = [];
  for (const { spent, limit } of entries) {
    if (limit <= 0) continue;
    const { isOverspent, overage } = getBucketOverspend(spent, limit);
    if (isOverspent) overages.push(overage);
  }
  return { overspentCount: overages.length, totalOverage: sumMoney(overages) };
}
