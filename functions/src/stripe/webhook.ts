import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { parseSubscriptionEvent, type ParsedSubEvent } from "./subscriptionEvent";

/**
 * Stripe secrets, held server-side (mirrors GEMINI_API_KEY). A human sets them via
 * `firebase functions:secrets:set …`; until then this function is dormant — nothing
 * in the app reaches it (no upgrade UI ships in 050a). See docs/STRIPE_SETUP_RUNBOOK.md.
 */
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

/** Resolve the household document an event applies to, or null if none matches. */
async function resolveHouseholdRef(
  db: admin.firestore.Firestore,
  parsed: ParsedSubEvent
): Promise<admin.firestore.DocumentReference | null> {
  // checkout.session.completed carries our householdId directly (client_reference_id).
  if (parsed.clientReferenceId) {
    const ref = db.collection("households").doc(parsed.clientReferenceId);
    const snap = await ref.get();
    return snap.exists ? ref : null;
  }
  // Later events carry only the Stripe customer id; find the household it was stored on.
  if (parsed.customerId) {
    const q = await db
      .collection("households")
      .where("subscription.stripeCustomerId", "==", parsed.customerId)
      .limit(1)
      .get();
    const doc = q.docs[0];
    return doc ? doc.ref : null;
  }
  return null;
}

/**
 * Stripe webhook — the ONLY writer of household subscription state (Plan 050a
 * principle #2). Verifies the signature with STRIPE_WEBHOOK_SECRET, maps the event
 * to a household subscription patch (see subscriptionEvent.ts), and deep-merges it
 * onto the household doc. Uses the Admin SDK, so it bypasses firestore.rules — no
 * rules change ships in 050a. Idempotent: Stripe redelivers, and every handled event
 * is an upsert.
 */
export const stripewebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = new Stripe(stripeSecretKey.value());
      // req.rawBody (Buffer) is required — the parsed body would fail signature checks.
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      // Never act on an unverified payload.
      logger.warn("stripewebhook signature verification failed", err);
      res.status(400).send("Invalid signature");
      return;
    }

    const parsed = parseSubscriptionEvent(event);
    if (!parsed) {
      // An event type we don't act on — ack so Stripe stops retrying.
      res.status(200).send("ignored");
      return;
    }

    try {
      const db = admin.firestore();
      const householdRef = await resolveHouseholdRef(db, parsed);
      if (!householdRef) {
        // Ack (200) so Stripe doesn't retry-storm an event we can't place.
        logger.warn("stripewebhook: no household matched event", {
          type: event.type,
        });
        res.status(200).send("no matching household");
        return;
      }
      // Deep-merge so a partial patch (e.g. a lone status change) preserves the rest
      // of the stored subscription block.
      await householdRef.set({ subscription: parsed.patch }, { merge: true });
      res.status(200).send("ok");
    } catch (err) {
      logger.error("stripewebhook handler failed", err);
      res.status(500).send("handler error");
    }
  }
);
