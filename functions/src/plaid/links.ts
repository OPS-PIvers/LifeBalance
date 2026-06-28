import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Products, CountryCode } from "plaid";
import {
  PLAID_SECRETS,
  makePlaidClient,
  assertHouseholdMember,
} from "./client";

/**
 * Callable: create a Plaid Link token for the signed-in household member so the
 * client can open Plaid Link. Returns only the short-lived link_token.
 *
 * Lowercased name to match the codebase convention (geminiproxy,
 * createcheckoutsession, stripewebhook). The client `httpsCallable` string must
 * be exactly "plaidcreatelinktoken".
 */
export const plaidcreatelinktoken = onCall(
  { secrets: PLAID_SECRETS, cors: true },
  async (request): Promise<{ linkToken: string }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const householdId = (request.data ?? {}).householdId;
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError("invalid-argument", "A householdId is required.");
    }
    await assertHouseholdMember(request.auth.uid, householdId);

    const plaid = makePlaidClient();
    const resp = await plaid.linkTokenCreate({
      user: { client_user_id: request.auth.uid },
      client_name: "LifeBalance",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return { linkToken: resp.data.link_token };
  },
);
