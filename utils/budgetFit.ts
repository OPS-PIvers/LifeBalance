import { BudgetBucket } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { computeSafeToSpendDistribution } from '@/utils/safeToSpendDistribution';
import { roundMoney, subtractMoney } from '@/utils/money';

/**
 * PR A — Safe-to-Spend header amber mark (see SafeToSpendBreakdownDrawer's
 * `overAllocationCopy` for the fuller narrative this pairs with).
 *
 * Below this shortfall, don't raise an alarm — a $3 rounding-scale overlap
 * between bucket limits and free cash isn't a real budgeting problem.
 *
 * RECONCILED (PR B2) — this floor is the ALARM threshold, shared, and it is
 * deliberately NOT the same thing as the truth about whether budgets over-claim:
 *
 *  - THE TRUTH fires at one cent. `computeSafeToSpendDistribution`'s
 *    `overAllocated` and `BucketPlanEditor`'s "Short by $X" verdict both stay
 *    on it, so a $5 over-claim is still reported as a $5 over-claim.
 *  - THE ALARM fires at this constant. The toolbar's amber mark,
 *    `SafeToSpendBreakdownDrawer`'s red closing-row treatment / red caption /
 *    over-allocation lead-in + "Rebalance buckets" CTA, and
 *    `BucketPlanEditor`'s warning styling all key off it, so nothing shouts
 *    about $3 of rounding-scale overlap.
 *
 * STAYING QUIET IS NOT THE SAME AS SAYING IT BALANCES — do NOT extend this
 * floor to a verdict. An earlier draft gated the fit meter's verdict on it and
 * a $9.99 shortfall rendered "Fully planned"; both of those surfaces now carry
 * a regression test pinning the split.
 *
 * `SafeToSpendBreakdownDrawer` applies the threshold but NOT this function's
 * additional `safeToSpend >= 0` suppression: the mark suppresses itself there
 * to avoid a second alarm beside an already-red figure, while the drawer is
 * the surface that has to explain that exact case.
 */
export const OVER_ALLOCATION_MIN_SHORTFALL = 10;

export interface BudgetFit {
  /** Σ max(0, bucket remaining) — what the buckets still expect to spend. */
  claimed: number;
  /** safeToSpend − claimed. Negative means the buckets over-claim the pool. */
  leftover: number;
  /** max(0, −leftover), rounded to the cent. */
  shortfall: number;
  /** True only when the shortfall clears the noise floor AND StS itself is non-negative. */
  isOverAllocated: boolean;
}

/**
 * Decide whether the household's budget buckets claim more of the
 * Safe-to-Spend pool than is actually free — for the toolbar's amber mark.
 *
 * MUST delegate to `computeSafeToSpendDistribution` for `claimed`/`leftover`
 * rather than recompute them: the drawer's ledger and this header mark have
 * to agree bit-for-bit, and this repo has been bitten before by a figure and
 * its explanation drifting apart because they were derived twice.
 *
 * When `breakdown.safeToSpend` is itself negative, bills and pending spend
 * have already outrun the balance — the toolbar figure already renders red
 * for that. Raising the amber mark on top would be a second alarm for the
 * same problem, so `isOverAllocated` is forced false there regardless of
 * what the buckets claim (matching `overAllocationCopy` in
 * `SafeToSpendBreakdownDrawer.tsx`).
 */
export function computeBudgetFit(
  breakdown: SafeToSpendBreakdown,
  buckets: BudgetBucket[],
  bucketSpentMap: Map<string, BucketSpent>,
): BudgetFit {
  const { claimed, leftover } = computeSafeToSpendDistribution(breakdown, buckets, bucketSpentMap);
  const shortfall = roundMoney(Math.max(0, subtractMoney(0, leftover)));
  const isOverAllocated = shortfall >= OVER_ALLOCATION_MIN_SHORTFALL && breakdown.safeToSpend >= 0;
  return { claimed, leftover, shortfall, isOverAllocated };
}
