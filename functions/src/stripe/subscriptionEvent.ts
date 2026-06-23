import type Stripe from "stripe";

/**
 * Pure Stripe-webhook-event → household-subscription-patch mapping (Plan 050a).
 *
 * This module has NO runtime dependencies (it imports only the Stripe *type*), so
 * it is trivially unit-testable. The HTTP transport, signature verification, and
 * Firestore write live in webhook.ts; this file only decides "given this event,
 * what should households/{id}.subscription become?".
 */

/**
 * The subscription statuses we persist, mirroring the
 * `Household.subscription.status` union in the client schema (types/schema.ts).
 * Keep the two in sync.
 */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

/** A partial subscription block to deep-merge onto the household doc. */
export interface SubscriptionPatch {
  plan?: "free" | "premium";
  status?: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
  priceId?: string;
}

export interface ParsedSubEvent {
  /** Present on checkout.session.completed — the household id we set at Checkout. */
  clientReferenceId: string | null;
  /** The Stripe customer id, used to resolve the household for later events. */
  customerId: string | null;
  /** The fields to merge onto households/{id}.subscription. */
  patch: SubscriptionPatch;
}

/** Stripe expandable fields are a bare id string OR the full object — extract the id. */
const idOf = (
  ref: string | { id: string } | null | undefined
): string | null => {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && typeof ref.id === "string") return ref.id;
  return null;
};

/** Map a Stripe subscription status onto our persisted union (unknown → canceled). */
const mapStatus = (status: string): SubscriptionStatus => {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    // canceled / incomplete_expired / unpaid / paused (and anything unknown) all
    // mean "no premium access" — collapse to canceled.
    default:
      return "canceled";
  }
};

/** Statuses that still grant premium access (matches utils/entitlements.ts). */
const grantsPremium = (status: SubscriptionStatus): boolean =>
  status === "active" || status === "trialing" || status === "past_due";

/**
 * Read `current_period_end` (unix seconds) from a subscription and convert to ISO.
 * Tolerates both the top-level location (older API versions) and the subscription-
 * item level (2025+ versions). Narrow structural casts avoid depending on whichever
 * apiVersion the installed SDK's types are pinned to.
 */
const periodEndIso = (sub: Stripe.Subscription): string | undefined => {
  const topLevel = (sub as { current_period_end?: number }).current_period_end;
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const epoch = typeof topLevel === "number" ? topLevel : item?.current_period_end;
  return typeof epoch === "number" ? new Date(epoch * 1000).toISOString() : undefined;
};

/**
 * Translate a Stripe webhook event into the household subscription patch it implies,
 * or `null` for events we don't act on. PURE — no Stripe client, no Firestore.
 */
export const parseSubscriptionEvent = (
  event: Stripe.Event
): ParsedSubEvent | null => {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = idOf(session.customer);
      const patch: SubscriptionPatch = { plan: "premium", status: "active" };
      if (customerId) patch.stripeCustomerId = customerId;
      const subId = idOf(session.subscription);
      if (subId) patch.stripeSubscriptionId = subId;
      return {
        clientReferenceId: session.client_reference_id ?? null,
        customerId,
        patch,
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const status = mapStatus(sub.status);
      const patch: SubscriptionPatch = {
        plan: grantsPremium(status) ? "premium" : "free",
        status,
        stripeSubscriptionId: sub.id,
      };
      const priceId = sub.items?.data?.[0]?.price?.id;
      if (priceId) patch.priceId = priceId;
      const period = periodEndIso(sub);
      if (period) patch.currentPeriodEnd = period;
      return { clientReferenceId: null, customerId: idOf(sub.customer), patch };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return {
        clientReferenceId: null,
        customerId: idOf(sub.customer),
        patch: { plan: "free", status: "canceled" },
      };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      return {
        clientReferenceId: null,
        customerId: idOf(invoice.customer),
        patch: { status: "past_due" },
      };
    }
    default:
      return null;
  }
};
