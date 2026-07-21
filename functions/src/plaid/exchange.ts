import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  PLAID_SECRETS,
  makePlaidClient,
  assertHouseholdMember,
} from "./client";
import { resolveAccountMap } from "./accountMapping";

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

    // Auto-map each Plaid account to an existing LifeBalance account (by
    // cardLast4/mask, else exact name — see accountMapping.ts) so the balance
    // sync (and a future transaction-routing wire-in) know which LifeBalance
    // account doc a Plaid account corresponds to. Best-effort: if the
    // accountsGet call fails for any reason, persist the item anyway with an
    // empty map rather than failing the whole link flow — balance sync simply
    // has nothing to update until a human maps it via a future settings UI.
    let accountMap: Record<string, string> = {};
    try {
      const accountsResp = await plaid.accountsGet({ access_token: accessToken });
      const lbAccountsSnap = await db.collection(`households/${householdId}/accounts`).get();
      const lbAccounts = lbAccountsSnap.docs.map((d) => {
        const data = d.data() ?? {};
        return {
          id: d.id,
          name: (data.name as string | undefined) ?? "",
          cardLast4: data.cardLast4 as string | undefined,
          cardLast4s: Array.isArray(data.cardLast4s)
            ? (data.cardLast4s as string[])
            : undefined,
          accountLast4: data.accountLast4 as string | undefined,
        };
      });
      accountMap = resolveAccountMap(accountsResp.data.accounts, lbAccounts);
    } catch (err) {
      logger.warn(
        `Plaid accountsGet failed while linking household ${householdId} item ${itemId} (leaving accountMap empty)`,
        err,
      );
    }

    // SECURITY: access_token is server-only — this path is denied to all clients
    // (firestore.rules). Never echo it back in the response.
    await db.doc(`households/${householdId}/plaidItems/${itemId}`).set({
      accessToken,
      itemId,
      cursor: null, // transactionsSync cursor; null = full initial sync
      linkedBy: request.auth.uid,
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "active",
      accountMap,
    });

    // Ops-only counter (count, never a token) for the Developer Console status line.
    await db.doc("app_config/global").set(
      { plaidItemCount: admin.firestore.FieldValue.increment(1) },
      { merge: true },
    );

    return { itemId };
  },
);
