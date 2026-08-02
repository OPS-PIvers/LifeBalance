import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { PLAID_SECRETS, assertHouseholdMember } from "./client";
import { revokeAllPlaidItems } from "./revoke";

/**
 * Callable: disconnect (remove) all linked Plaid bank connections for a
 * household. Best-effort invalidates each item at Plaid via /item/remove (so the
 * access token stops working and, on a paid plan, stops accruing the per-Item
 * monthly fee), then deletes the server-only `plaidItems` doc and decrements the
 * ops-only counter.
 *
 * Why server-side: `plaidItems` (and the access_token inside) are denied to ALL
 * clients in firestore.rules, so only the Admin SDK can read/delete them — a
 * client cannot clean these up directly.
 *
 * The mechanics live in `revokeAllPlaidItems` (./revoke), shared with
 * `deletehousehold` so the two revocation paths cannot drift.
 *
 * Lowercased name — client must call "plaiddisconnectbank".
 */
export const plaiddisconnectbank = onCall(
  { secrets: PLAID_SECRETS, cors: true },
  async (request): Promise<{ removed: number }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const { householdId } = (request.data ?? {}) as { householdId?: unknown };
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError("invalid-argument", "A householdId is required.");
    }
    await assertHouseholdMember(request.auth.uid, householdId);

    const removed = await revokeAllPlaidItems(householdId);

    logger.info("Plaid bank(s) disconnected", { householdId, removed });
    return { removed };
  },
);
