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
  /** Max managed kid profiles (Plan 080) allowed in the household. */
  maxKidProfiles: number;
}

/**
 * Limit tables — the one place these numbers live. The values are sensible defaults
 * and a tunable PRODUCT decision.
 *
 * Enforcement status (Plan 051 landed; do NOT re-implement these gates):
 * - `maxMembers` — enforced SERVER-SIDE in `firestore.rules` (`planMaxMembers()` /
 *   `withinMemberCap`, ~line 106). KEEP THE NUMBERS IN SYNC with that rule.
 * - `maxKidProfiles` — enforced SERVER-SIDE by the `createkidprofile` callable
 *   (`functions/src/kid/createKidProfile.ts`), which mirrors these values in
 *   `functions/src/entitlements.ts`. A managed kid is never in `memberUids`, so
 *   rules cannot count them — only the server can.
 * - `aiDailyCap` — enforced in `geminiService.checkAndIncrementAiUsage` (the proxy
 *   path holds the key server-side); the legacy flat cap applies while billing is off.
 * - `historyMonths` / `recapEnabled` — NOT gated yet.
 *
 * All of the above are INERT until the `billingEnabled` flag flips, which is why
 * nothing is capped in prod today. That is a dormant gate, not a missing one.
 * To change a limit, edit it here AND in the mirroring server gate named above.
 */
export const FREE_LIMITS: PlanLimits = {
  maxMembers: 2,
  // Deliberately small: the free tier is a teaser meant to drive upgrades. This cap
  // only takes effect once billing is LIVE (`billingEnabled` on) — until then
  // geminiService applies the legacy 100/day cap to everyone, so current users are
  // unaffected. Tune freely (it's a product knob). See geminiService.checkAndIncrementAiUsage.
  aiDailyCap: 3,
  historyMonths: 13,
  recapEnabled: false,
  // Managed kid profiles (Plan 080). Like every other free limit, this cap is
  // INERT until billing goes live: `addKidProfile` only enforces it while
  // `billingEnabled` is on (Plan 080 Principle 6 — gate the count, not the
  // mechanics). Tune freely; it's a product knob.
  maxKidProfiles: 2,
};

export const PREMIUM_LIMITS: PlanLimits = {
  maxMembers: 20,
  aiDailyCap: 500,
  historyMonths: 120,
  recapEnabled: true,
  maxKidProfiles: 10,
};

/**
 * Legacy flat AI request cap, applied to EVERY household while billing is dormant
 * (`billingEnabled` off — the current state). Once billing is live the cap becomes
 * plan-aware (`getLimits().aiDailyCap`). Lives here (the SDK-free entitlements
 * module) as the single source of truth so both `geminiService` (enforcement) and
 * the Developer Console AI meter (display) read the same number.
 *
 * NOTE: `functions/src/entitlements.ts` keeps its own server-side copy of this
 * value (separate package) and is documented to be kept in sync.
 */
export const LEGACY_AI_DAILY_QUOTA = 100;

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

/**
 * The household's TRUE premium status — matching the server's
 * `isPremiumHousehold` (`functions/src/recap/index.ts`, a separate protected
 * package; this is the client-side mirror the same way `utils/recapWeek.ts`
 * mirrors `functions/src/shared/isoWeek.ts`): while `billingEnabled` is off
 * (the current, dormant default — see the Feature Flags section of
 * CLAUDE.md), EVERY household is premium, because nobody is paying for
 * anything yet and nobody should see a paywall for a plan gate that isn't
 * live. Only once billing actually goes live does this narrow to the
 * household's real subscription status.
 *
 * Deliberately checks `subscription?.status` directly against
 * `PREMIUM_STATUSES` rather than delegating to `isPremium()`/`getPlan()` —
 * those ALSO require `subscription.plan === 'premium'`, a check the server's
 * `isPremiumHousehold` doesn't make. Anything that needs to agree with what a
 * SERVER-GENERATED recap's `premium` field says (this function's whole
 * purpose) has to match the server's exact condition, not the client's
 * slightly stricter one.
 *
 * ARCH-1's first (and so far only) caller: a client-derived recap
 * (`utils/recapCompose.ts`) has no server-written `premium` field of its own
 * to read, so it resolves this instead of ever hardcoding `true` or `false`.
 */
export const resolveIsPremiumHousehold = (
  household: Pick<Household, 'subscription'>,
  billingEnabled: boolean
): boolean => {
  if (!billingEnabled) return true;
  const status = household.subscription?.status;
  return status !== undefined && PREMIUM_STATUSES.includes(status);
};

/** The active limit table for a household's effective plan. */
export const getLimits = (household: Pick<Household, 'subscription'>): PlanLimits =>
  isPremium(household) ? PREMIUM_LIMITS : FREE_LIMITS;

/**
 * Whether a household has reached its managed-kid-profile cap (Plan 080).
 *
 * Pure predicate over the plan's `maxKidProfiles` limit. Like all entitlement
 * checks this is CLIENT product logic for UX only — the caller
 * (`addKidProfile`) enforces it solely while billing is live, so it never fires
 * for the current free-tier-permissive (billing-off) world. `>=` (not `>`) so a
 * household sitting exactly at the cap can't add one more.
 */
export const kidProfileLimitReached = (
  household: Pick<Household, 'subscription'>,
  managedKidCount: number,
): boolean => managedKidCount >= getLimits(household).maxKidProfiles;
