import { HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Plaid credentials, held server-side in Secret Manager (mirrors GEMINI_API_KEY
 * / STRIPE_SECRET_KEY). A human sets them via:
 *   firebase functions:secrets:set PLAID_CLIENT_ID
 *   firebase functions:secrets:set PLAID_SECRET
 *   firebase functions:secrets:set PLAID_ENV      # sandbox | production
 * (or by adding a new version in the Secret Manager console). The functions are
 * pinned to the secret VERSION resolved at deploy time, so after changing a
 * value you must redeploy for it to take effect.
 */
export const plaidClientId = defineSecret("PLAID_CLIENT_ID");
export const plaidSecret = defineSecret("PLAID_SECRET");
export const plaidEnv = defineSecret("PLAID_ENV");

/** Bind this to every Plaid function's `secrets` option. */
export const PLAID_SECRETS = [plaidClientId, plaidSecret, plaidEnv];

/**
 * Build a PlaidApi client from the resolved secret values. Called INSIDE each
 * handler (after the function starts) so `.value()` is available — never at
 * module top-level.
 */
export function makePlaidClient(): PlaidApi {
  const env = plaidEnv.value();
  const basePath =
    (PlaidEnvironments as Record<string, string>)[env] ?? PlaidEnvironments.sandbox;
  // Log the resolved environment (name only — never a credential) so the
  // function logs confirm which Plaid env a deploy is bound to.
  logger.info("Plaid client initialized", { env });
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": plaidClientId.value(),
        "PLAID-SECRET": plaidSecret.value(),
      },
    },
  });
  return new PlaidApi(config);
}

/**
 * Throw unless `uid` is a member of `householdId`. Mirrors the membership gate
 * used by the other callables (bank-linking shares the household's finance data,
 * so any member may link — not admin-only).
 */
export async function assertHouseholdMember(
  uid: string,
  householdId: string,
): Promise<void> {
  const db = admin.firestore();
  const memberSnap = await db.doc(`households/${householdId}/members/${uid}`).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this household.");
  }
}
