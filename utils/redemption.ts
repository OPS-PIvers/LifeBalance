import type { RewardRedemption } from '@/types/schema';

/**
 * Cap for the bounded `Household.redemptionHistory` array (most-recent-first).
 * Keeps the household doc small — at ~100 bytes/record this is a few KB, far under
 * Firestore's 1 MB doc limit. Both the live context and the Test-Mode mock slice to
 * this when prepending a new redemption so the array can never grow unbounded.
 */
export const REDEMPTION_HISTORY_LIMIT = 30;

/**
 * Single source of truth for what APPROVING a reward redemption credits/deducts
 * on the kid's member doc (Plan 080d-2). Both the live Firebase context and the
 * Test-Mode mock call this so the two can never diverge.
 *
 * - `pointsDelta` is ALWAYS `-cost`: the point cost is deducted on approval
 *   regardless of reward type (the kid "spent" the points to redeem).
 * - `allowanceDelta` is the cash IOU credited, in integer cents — only for
 *   `allowance` rewards, and only when `allowanceCents` is present (a malformed
 *   allowance reward with no amount credits nothing rather than NaN). For a
 *   `realWorld` reward it is always `0` (no allowance is credited).
 *
 * Allowance is a tracked IOU ledger value — never an in-app payout.
 */
export const redemptionMemberDelta = (
  r: Pick<RewardRedemption, 'cost' | 'type' | 'allowanceCents'>,
): { pointsDelta: number; allowanceDelta: number } => ({
  pointsDelta: -r.cost,
  allowanceDelta: r.type === 'allowance' ? (r.allowanceCents ?? 0) : 0,
});
