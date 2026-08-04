import { type BudgetBucket, type BucketPeriodSnapshot } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { suggestBucketLimit } from '@/utils/payPeriodCeremony';
import { sumMoney, subtractMoney, roundMoney } from '@/utils/money';

/**
 * PR B2 — "which buckets should I trim, and by how much" for the rebalance
 * drawer.
 *
 * {@link import('@/utils/budgetFit').computeBudgetFit} answers WHETHER the
 * household's budgets over-claim the Safe-to-Spend pool. This module answers
 * WHAT TO DO about it: given that shortfall, recommend a set of new bucket
 * limits that closes it. It is a RECOMMENDATION, never a write — the rebalance
 * drawer seeds `BucketPlanEditor`'s drafts with it and the user can override
 * every row before saving.
 *
 * THE ALGORITHM (a settled product decision — read this before "improving" it):
 *
 *  - `need`  = max(spent this period, {@link suggestBucketLimit}) — the floor
 *              this bucket's limit should not drop below.
 *  - `slack` = max(0, limit − need) — the trimmable fat in that bucket.
 *  - Take the shortfall from the LARGEST slack first, then the next, until it
 *    is satisfied or the slack runs out.
 *
 * WHY LARGEST-SLACK-FIRST, NOT PROPORTIONAL: a bucket you haven't touched
 * should be cut before one you are actively spending from. Spreading the cut
 * proportionally shaves the grocery budget you're mid-way through using in
 * order to spare a bucket at $0.
 *
 * WHY THE HISTORY AVERAGE, NOT A RUN-RATE: extrapolating a couple of days of
 * spend early in a period projects wildly — a real case projected ~$2,856 of
 * groceries from 2 days in, which would have recommended RAISING the bucket in
 * the middle of closing a shortfall. `suggestBucketLimit` (a 3-period average
 * rounded up to $5) is the figure the pay-period ceremony already trusts, so
 * the two surfaces recommend from the same history.
 *
 * THE HARD FLOOR: a suggested limit is never below what the bucket has ALREADY
 * SPENT this period. A trim that instantly puts a bucket over budget trades one
 * red number for another — it is worse than the over-allocation it "fixed".
 * The floor is structural (`need >= spent`, so `limit − slack >= spent`), and
 * {@link planBucketTrims} re-clamps it anyway so a future change to `need`
 * cannot quietly breach it.
 *
 * UNRESOLVED IS SURFACED, NEVER SWALLOWED: when the total slack cannot absorb
 * the whole shortfall, {@link TrimPlan.unresolved} carries the remainder so the
 * UI can say so. Silently recommending a plan that still doesn't fit — while
 * the meter above it reads "short" — is exactly the kind of figure/explanation
 * divergence this repo keeps getting bitten by.
 *
 * All arithmetic is summed in integer cents via `utils/money.ts`, but every
 * value in and out is DECIMAL DOLLARS (the shape everything is stored in).
 */

/** One bucket's trimmable headroom, and the inputs that produced it. */
export interface TrimCandidate {
  id: string;
  name: string;
  /** The bucket's current limit. */
  limit: number;
  /** Verified + pending spend for this bucket THIS period. */
  spent: number;
  /** `max(spent, suggestBucketLimit(...))` — the floor the limit shouldn't cross. */
  need: number;
  /** `max(0, limit − need)` — how much can be trimmed out of this bucket. */
  slack: number;
}

/** A recommended new limit for one bucket. */
export interface TrimSuggestion {
  id: string;
  currentLimit: number;
  suggestedLimit: number;
  /** `currentLimit − suggestedLimit`, always > 0 (a no-op trim is never emitted). */
  trim: number;
}

export interface TrimPlan {
  /**
   * One entry per bucket the plan actually trims, largest trim first. Buckets
   * left alone are absent — a consumer seeding an editor should fall back to
   * each bucket's saved limit.
   */
  suggestions: TrimSuggestion[];
  /** How much of the shortfall these trims close. */
  resolved: number;
  /** What is left over because the available slack ran out. `0` when the plan closes it all. */
  unresolved: number;
}

/**
 * Measure every bucket's trimmable slack.
 *
 * Buckets are returned in the order given (the household's own display order);
 * ordering for the greedy take happens in {@link planBucketTrims}.
 */
export function buildTrimCandidates(
  buckets: BudgetBucket[],
  bucketSpentMap: Map<string, BucketSpent>,
  bucketHistory: BucketPeriodSnapshot[],
): TrimCandidate[] {
  return buckets.map(bucket => {
    const s = bucketSpentMap.get(bucket.id) ?? { verified: 0, pending: 0 };
    const spent = sumMoney([s.verified, s.pending]);
    // THE HARD FLOOR lives here: whatever history suggests, a bucket's need is
    // at least what it has already spent. Drop the `spent` term and the greedy
    // take below will happily recommend a limit the bucket is already over.
    const suggested = suggestBucketLimit(bucket.id, bucket.limit, bucketHistory);
    const need = Math.max(spent, suggested);
    const slack = Math.max(0, subtractMoney(bucket.limit, need));
    return { id: bucket.id, name: bucket.name, limit: bucket.limit, spent, need, slack };
  });
}

/**
 * Recommend which candidates to trim, and by how much, to close `shortfall`.
 *
 * TIE-BREAKING IS EXPLICIT, NOT INCIDENTAL: candidates are sorted by slack
 * descending and, when two carry the SAME slack, by their position in the input
 * array — i.e. the household's own bucket display order, the order they appear
 * everywhere else in the app. That decoration is deliberate rather than a
 * reliance on `Array.prototype.sort` stability: the tie rule is a behaviour with
 * a test pinning it, so it is written down in the comparator.
 *
 * A non-positive `shortfall` produces an empty plan (nothing to close).
 */
export function planBucketTrims(shortfall: number, candidates: TrimCandidate[]): TrimPlan {
  const shortfallCents = Math.max(0, Math.round(shortfall * 100));
  if (shortfallCents === 0) return { suggestions: [], resolved: 0, unresolved: 0 };

  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) =>
      b.candidate.slack === a.candidate.slack
        ? a.index - b.index
        : b.candidate.slack - a.candidate.slack,
    );

  let remainingCents = shortfallCents;
  const suggestions: TrimSuggestion[] = [];

  for (const { candidate } of ordered) {
    if (remainingCents === 0) break;
    const slackCents = Math.round(candidate.slack * 100);
    if (slackCents <= 0) continue;

    const takeCents = Math.min(slackCents, remainingCents);
    // Re-clamp the floor rather than trusting `slack` to have encoded it. This
    // is a no-op while `need >= spent` holds, and the one line that keeps a
    // future change to `need` from silently recommending a limit below spend.
    const rawLimitCents = Math.round(candidate.limit * 100) - takeCents;
    const spentCents = Math.round(candidate.spent * 100);
    const suggestedLimitCents = Math.max(rawLimitCents, spentCents);
    const trimCents = Math.round(candidate.limit * 100) - suggestedLimitCents;
    if (trimCents <= 0) continue;

    suggestions.push({
      id: candidate.id,
      currentLimit: candidate.limit,
      suggestedLimit: suggestedLimitCents / 100,
      trim: trimCents / 100,
    });
    remainingCents -= trimCents;
  }

  return {
    suggestions,
    resolved: (shortfallCents - remainingCents) / 100,
    unresolved: remainingCents / 100,
  };
}

/**
 * The whole recommendation in one call: measure the slack, then take the
 * shortfall out of it. This is what the rebalance drawer uses.
 */
export function computeTrimPlan(
  shortfall: number,
  buckets: BudgetBucket[],
  bucketSpentMap: Map<string, BucketSpent>,
  bucketHistory: BucketPeriodSnapshot[],
): TrimPlan {
  return planBucketTrims(
    roundMoney(shortfall),
    buildTrimCandidates(buckets, bucketSpentMap, bucketHistory),
  );
}
