import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  PLAID_SECRETS,
  makePlaidClient,
  assertHouseholdMember,
} from "./client";

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

    const db = admin.firestore();
    const itemsSnap = await db
      .collection(`households/${householdId}/plaidItems`)
      .get();
    if (itemsSnap.empty) return { removed: 0 };

    const plaid = makePlaidClient();
    let removed = 0;
    for (const itemDoc of itemsSnap.docs) {
      const accessToken = itemDoc.data()?.accessToken as string | undefined;
      // Best-effort: ask Plaid to invalidate the item. A stale or cross-env
      // token (e.g. a sandbox token after switching to production) will throw —
      // that's fine; we still delete our record so the connection is gone.
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

    // Keep the ops-only counter in step (count, never a token) — mirrors the
    // increment(+1) in plaidexchangepublictoken.
    if (removed > 0) {
      await db.doc("app_config/global").set(
        { plaidItemCount: admin.firestore.FieldValue.increment(-removed) },
        { merge: true },
      );
    }

    logger.info("Plaid bank(s) disconnected", { householdId, removed });
    return { removed };
  },
);
