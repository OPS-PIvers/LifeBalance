/**
 * Tests for the PURE Stripe-event → household-subscription-patch mapping.
 *
 * This module has zero runtime dependencies (it only imports the Stripe *type*),
 * so these tests need no mocks — they feed crafted event objects and assert the
 * derived patch. The HTTP/signature/db wrapper is tested separately in
 * webhook.test.ts. (Plan 050a — "each event → the right household patch".)
 */

import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { parseSubscriptionEvent } from "./subscriptionEvent";

/** Build a minimal Stripe.Event fixture; the parser only reads a few fields. */
const asEvent = (type: string, object: unknown): Stripe.Event =>
  ({ type, data: { object } } as unknown as Stripe.Event);

describe("parseSubscriptionEvent", () => {
  it("maps checkout.session.completed to an active premium patch keyed by client_reference_id", () => {
    const parsed = parseSubscriptionEvent(
      asEvent("checkout.session.completed", {
        client_reference_id: "hh_1",
        customer: "cus_1",
        subscription: "sub_1",
      })
    );
    expect(parsed).toEqual({
      clientReferenceId: "hh_1",
      customerId: "cus_1",
      patch: {
        plan: "premium",
        status: "active",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
      },
    });
  });

  it("reads ids from expanded objects (customer/subscription as objects, not strings)", () => {
    const parsed = parseSubscriptionEvent(
      asEvent("checkout.session.completed", {
        client_reference_id: "hh_2",
        customer: { id: "cus_2" },
        subscription: { id: "sub_2" },
      })
    );
    expect(parsed?.customerId).toBe("cus_2");
    expect(parsed?.patch.stripeCustomerId).toBe("cus_2");
    expect(parsed?.patch.stripeSubscriptionId).toBe("sub_2");
  });

  it("maps customer.subscription.updated to a full patch (status, price, period) keyed by customer", () => {
    const parsed = parseSubscriptionEvent(
      asEvent("customer.subscription.updated", {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        current_period_end: 1700000000,
        items: { data: [{ price: { id: "price_1" } }] },
      })
    );
    expect(parsed).toEqual({
      clientReferenceId: null,
      customerId: "cus_1",
      patch: {
        plan: "premium",
        status: "active",
        stripeSubscriptionId: "sub_1",
        priceId: "price_1",
        currentPeriodEnd: new Date(1700000000 * 1000).toISOString(),
      },
    });
  });

  it("falls back to the item-level current_period_end when absent at the top level", () => {
    const parsed = parseSubscriptionEvent(
      asEvent("customer.subscription.updated", {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        items: { data: [{ current_period_end: 1700000500, price: { id: "price_1" } }] },
      })
    );
    expect(parsed?.patch.currentPeriodEnd).toBe(
      new Date(1700000500 * 1000).toISOString()
    );
  });

  it("downgrades to free/canceled on customer.subscription.deleted", () => {
    const parsed = parseSubscriptionEvent(
      asEvent("customer.subscription.deleted", {
        id: "sub_1",
        customer: "cus_1",
        status: "canceled",
      })
    );
    expect(parsed).toEqual({
      clientReferenceId: null,
      customerId: "cus_1",
      patch: { plan: "free", status: "canceled" },
    });
  });

  it("marks the subscription past_due on invoice.payment_failed without dropping the plan", () => {
    const parsed = parseSubscriptionEvent(
      asEvent("invoice.payment_failed", {
        customer: "cus_1",
        subscription: "sub_1",
      })
    );
    expect(parsed).toEqual({
      clientReferenceId: null,
      customerId: "cus_1",
      patch: { status: "past_due" },
    });
  });

  it("treats incomplete / paused / unpaid statuses as free (no premium access granted)", () => {
    for (const status of ["incomplete", "paused", "unpaid"]) {
      const parsed = parseSubscriptionEvent(
        asEvent("customer.subscription.updated", {
          id: "sub_x",
          customer: "cus_x",
          status,
        })
      );
      expect(parsed?.patch.plan).toBe("free");
    }
  });

  it("returns null for unrelated event types so the webhook ignores them", () => {
    expect(parseSubscriptionEvent(asEvent("payment_intent.succeeded", {}))).toBeNull();
  });
});
