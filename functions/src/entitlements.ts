/**
 * Server-side entitlements helper (Plan 10): the minimal slice of the client's
 * `utils/entitlements.ts` that the `geminiproxy` quota enforcement needs.
 *
 * KEEP IN SYNC with `utils/entitlements.ts` (the client copy used for display /
 * UX limits) — the cap numbers and the premium status list below are mirrored
 * from it verbatim. The two packages deliberately do not import from each other
 * (same convention as functions/src/utils/formatCurrency.ts), so a change to
 * either file must be hand-applied to the other.
 */

/**
 * Subscription statuses that still grant premium access. `past_due` keeps
 * access during the grace period before Stripe finalizes a downgrade;
 * `canceled`/`incomplete` do not. Mirrors PREMIUM_STATUSES in
 * `utils/entitlements.ts`.
 */
const PREMIUM_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/**
 * Legacy flat AI request cap, applied to EVERY household while billing is
 * dormant (`billingEnabled` off — the current state). Mirrors
 * LEGACY_AI_DAILY_QUOTA in `services/geminiService.ts`.
 */
export const LEGACY_AI_DAILY_QUOTA = 100;

/** Free-tier daily AI cap once billing is live. Mirrors FREE_LIMITS.aiDailyCap. */
export const FREE_AI_DAILY_CAP = 3;

/** Premium daily AI cap once billing is live. Mirrors PREMIUM_LIMITS.aiDailyCap. */
export const PREMIUM_AI_DAILY_CAP = 500;

/**
 * The subset of the household doc the cap decision reads. Loosely typed on
 * purpose: this is raw Firestore data, so both fields tolerate absence or
 * unexpected shapes (an absent/invalid subscription resolves to the free tier,
 * exactly like the client's `getPlan`).
 */
export interface HouseholdEntitlementData {
  subscription?: {
    plan?: unknown;
    status?: unknown;
  };
}

/**
 * Resolve the household's daily AI request cap.
 *
 * - Billing dormant (`billingEnabled` false): the flat legacy cap for everyone,
 *   regardless of any subscription block — matching the client's
 *   `checkAndIncrementAiUsage`.
 * - Billing live: plan-aware — premium (an `active`/`trialing`/`past_due`
 *   subscription with `plan === "premium"`) gets the premium cap, everyone else
 *   the free cap.
 */
export function getAiDailyCap(
  household: HouseholdEntitlementData,
  billingEnabled: boolean
): number {
  if (!billingEnabled) return LEGACY_AI_DAILY_QUOTA;

  return isPremiumHousehold(household)
    ? PREMIUM_AI_DAILY_CAP
    : FREE_AI_DAILY_CAP;
}

/** Free-tier managed-kid-profile cap (Plan 080). Mirrors FREE_LIMITS.maxKidProfiles. */
export const FREE_MAX_KID_PROFILES = 2;

/** Premium managed-kid-profile cap (Plan 080). Mirrors PREMIUM_LIMITS.maxKidProfiles. */
export const PREMIUM_MAX_KID_PROFILES = 10;

/**
 * Whether the household's subscription grants premium access — an `active` /
 * `trialing` / `past_due` subscription with `plan === "premium"`. Mirrors
 * `isPremium` / `getPlan` in `utils/entitlements.ts`.
 */
export function isPremiumHousehold(household: HouseholdEntitlementData): boolean {
  const sub = household.subscription;
  return (
    sub?.plan === "premium" &&
    typeof sub.status === "string" &&
    PREMIUM_STATUSES.includes(sub.status)
  );
}

/**
 * The household's managed-kid-profile cap for the current plan. Unlike
 * `getAiDailyCap` this does NOT take `billingEnabled`: the caller
 * (`createkidprofile`) enforces the cap ONLY while billing is live, matching the
 * client's `addKidProfile`. Mirrors `getLimits().maxKidProfiles` in
 * `utils/entitlements.ts`.
 */
export function getMaxKidProfiles(household: HouseholdEntitlementData): number {
  return isPremiumHousehold(household)
    ? PREMIUM_MAX_KID_PROFILES
    : FREE_MAX_KID_PROFILES;
}
