import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { makePlaidClient } from "./client";

/**
 * Revoke every Plaid connection a household holds: ask Plaid to invalidate each
 * Item via /item/remove, delete the server-only `plaidItems` doc that holds its
 * access token, and keep the ops-only `app_config/global.plaidItemCount` in step.
 *
 * Shared by BOTH revocation paths so they can never drift:
 *   - `plaiddisconnectbank` — the explicit "Disconnect bank" action in Settings.
 *   - `deletehousehold` — deleting an account must revoke at the bank too.
 *
 * Order matters for the delete path. The `plaidItems` docs hold the ONLY access
 * tokens that can invalidate an Item at Plaid, so this must run BEFORE
 * `recursiveDelete` — otherwise the tokens are destroyed while the bank
 * connection stays live at Plaid, with nothing left that could revoke it.
 *
 * Best-effort per item: a stale or cross-env token (e.g. a sandbox token after
 * a switch to production) throws on /item/remove. We log and still delete our
 * record — an access token we cannot use is one we should not keep, and leaving
 * an undeletable doc behind is the worse outcome.
 *
 * Returns how many item records were removed (0 when the household never linked
 * a bank — the common case, which never constructs a Plaid client at all).
 */
export async function revokeAllPlaidItems(householdId: string): Promise<number> {
  const db = admin.firestore();
  const itemsSnap = await db.collection(`households/${householdId}/plaidItems`).get();
  if (itemsSnap.empty) return 0;

  const plaid = makePlaidClient();
  let removed = 0;
  for (const itemDoc of itemsSnap.docs) {
    const accessToken = itemDoc.data()?.accessToken as string | undefined;
    if (accessToken) {
      try {
        await plaid.itemRemove({ access_token: accessToken });
      } catch (err) {
        logger.warn(
          `Plaid itemRemove failed for household ${householdId} item ${itemDoc.id} (deleting record anyway)`,
          err,
        );
      }
    }
    await itemDoc.ref.delete();
    removed += 1;
  }

  // Keep the ops-only counter (count, never a token) in step — mirrors the
  // increment(+1) in plaidexchangepublictoken.
  if (removed > 0) {
    await db.doc("app_config/global").set(
      { plaidItemCount: admin.firestore.FieldValue.increment(-removed) },
      { merge: true },
    );
  }

  return removed;
}
