import type { Household } from '@/types/schema';

/**
 * Entitlements (Plan 050): the single source of truth for what a household's plan
 * unlocks. An absent `subscription` block — every legacy and free-tier household —
 * resolves to the free plan.
 *
 * IMPORTANT: this is read by the client for display and by free-tier logic, but a
 * paid feature must ALWAYS be gated on the server (Cloud Function / firestore.rules).
 * Never treat this client-readable value as the only gate (Plan 050 principle #1).
 */

type Subscription = NonNullable<Household['subscription']>;
type SubStatus = Subscription['status'];

/**
 * Statuses that still grant premium access. `past_due` keeps access during the
 * grace period before Stripe finalizes a downgrade; `canceled`/`incomplete` do not.
 */
const PREMIUM_STATUSES: readonly SubStatus[] = ['active', 'trialing', 'past_due'];

export interface PlanLimits {
  /** Max members allowed in the household. */
  maxMembers: number;
  /** Max AI requests per day. */
  aiDailyCap: number;
  /** How many months of history are retained / visible. */
  historyMonths: number;
  /** Whether the weekly recap (Plan 060) is available. */
  recapEnabled: boolean;
}

/**
 * Limit tables — the one place these numbers live. The values are sensible defaults
 * and a tunable PRODUCT decision; they are NOT enforced yet (gating lands in Plans
 * 050b/051/052). To change a limit, edit it here, then add/adjust the server-side
 * gate that reads it.
 */
export const FREE_LIMITS: PlanLimits = {
  maxMembers: 2,
  aiDailyCap: 10,
  historyMonths: 13,
  recapEnabled: false,
};

export const PREMIUM_LIMITS: PlanLimits = {
  maxMembers: 20,
  aiDailyCap: 200,
  historyMonths: 120,
  recapEnabled: true,
};

/**
 * Resolve a household's effective plan. Absent subscription → free. A `premium`
 * plan only counts while its status still grants access (active / trialing /
 * past_due); a canceled or incomplete subscription resolves to free even if the
 * stored `plan` field is momentarily stale.
 */
export const getPlan = (household: Pick<Household, 'subscription'>): 'free' | 'premium' => {
  const sub = household.subscription;
  if (sub?.plan === 'premium' && PREMIUM_STATUSES.includes(sub.status)) {
    return 'premium';
  }
  return 'free';
};

export const isPremium = (household: Pick<Household, 'subscription'>): boolean =>
  getPlan(household) === 'premium';

/** The active limit table for a household's effective plan. */
export const getLimits = (household: Pick<Household, 'subscription'>): PlanLimits =>
  isPremium(household) ? PREMIUM_LIMITS : FREE_LIMITS;
