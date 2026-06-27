import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  PLAID_SECRETS,
  makePlaidClient,
  assertHouseholdMember,
} from "./client";

/**
 * Callable: exchange a Plaid public_token (from a completed Link flow) for a
 * long-lived access_token, and persist it SERVER-SIDE ONLY at
 * households/{id}/plaidItems/{itemId} (firestore.rules denies all client access;
 * the Admin SDK bypasses rules). The access_token is NEVER returned to the
 * client. Also bumps app_config/global.plaidItemCount so the Developer Console
 * can show a connected-account count without ever reading a token.
 *
 * Lowercased name — client must call "plaidexchangepublictoken".
 */
export const plaidexchangepublictoken = onCall(
  { secrets: PLAID_SECRETS, cors: true },
  async (request): Promise<{ itemId: string }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const { householdId, publicToken } = (request.data ?? {}) as {
      householdId?: unknown;
      publicToken?: unknown;
    };
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError("invalid-argument", "A householdId is required.");
    }
    if (typeof publicToken !== "string" || !publicToken) {
      throw new HttpsError("invalid-argument", "A publicToken is required.");
    }
    await assertHouseholdMember(request.auth.uid, householdId);

    const plaid = makePlaidClient();
    const resp = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = resp.data.access_token;
    const itemId = resp.data.item_id;

    const db = admin.firestore();
    // SECURITY: access_token is server-only — this path is denied to all clients
    // (firestore.rules). Never echo it back in the response.
    await db.doc(`households/${householdId}/plaidItems/${itemId}`).set({
      accessToken,
      itemId,
      cursor: null, // transactionsSync cursor; null = full initial sync
      linkedBy: request.auth.uid,
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "active",
    });

    // Ops-only counter (count, never a token) for the Developer Console status line.
    await db.doc("app_config/global").set(
      { plaidItemCount: admin.firestore.FieldValue.increment(1) },
      { merge: true },
    );

    return { itemId };
  },
);
