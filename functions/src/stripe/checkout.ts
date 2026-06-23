import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import Stripe from "stripe";

/**
 * Stripe secret key, held server-side (mirrors GEMINI_API_KEY). Dormant until a
 * human sets it (docs/STRIPE_SETUP_RUNBOOK.md) — no upgrade UI ships in 050a, so
 * nothing calls this yet.
 */
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

interface CheckoutData {
  householdId?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
}

/**
 * Callable: create a Stripe Checkout Session for a household subscription and return
 * its hosted-page URL. Admin-only. Reads the configured price from app_config and
 * reuses a stored Stripe customer when present.
 *
 * Note: this function never writes subscription state — that is the webhook's job
 * (Plan 050a principle #2). It only reads the household to reuse a customer id; the
 * webhook persists the customer id from `checkout.session.completed`.
 */
export const createcheckoutsession = onCall(
  { secrets: [stripeSecretKey], cors: true },
  async (request): Promise<{ url: string | null }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const { householdId, successUrl, cancelUrl } = (request.data ?? {}) as CheckoutData;
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError("invalid-argument", "A householdId is required.");
    }
    if (typeof successUrl !== "string" || !successUrl) {
      throw new HttpsError("invalid-argument", "A successUrl is required.");
    }

    const db = admin.firestore();

    // Only a household admin may start a checkout for that household.
    const memberSnap = await db
      .doc(`households/${householdId}/members/${request.auth.uid}`)
      .get();
    if (!memberSnap.exists || memberSnap.data()?.role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Only a household admin can manage billing."
      );
    }

    // Reuse a previously-stored Stripe customer when we have one (avoids duplicates).
    const householdSnap = await db.doc(`households/${householdId}`).get();
    const storedCustomer = householdSnap.data()?.subscription?.stripeCustomerId;
    const existingCustomerId =
      typeof storedCustomer === "string" ? storedCustomer : undefined;

    // The recurring price id is operator config (set in the Stripe dashboard, then
    // written to app_config/global.stripePriceId — see STRIPE_SETUP_RUNBOOK.md).
    const configSnap = await db.doc("app_config/global").get();
    const priceId = configSnap.data()?.stripePriceId;
    if (typeof priceId !== "string" || !priceId) {
      throw new HttpsError("failed-precondition", "Billing is not configured yet.");
    }

    const stripe = new Stripe(stripeSecretKey.value());

    let customerId = existingCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { householdId },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      // The webhook resolves the household from client_reference_id on completion.
      client_reference_id: householdId,
      success_url: successUrl,
      ...(typeof cancelUrl === "string" && cancelUrl
        ? { cancel_url: cancelUrl }
        : {}),
    });

    return { url: session.url };
  }
);
