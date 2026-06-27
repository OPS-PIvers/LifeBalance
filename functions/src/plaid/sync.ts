import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { PLAID_SECRETS, makePlaidClient } from "./client";
import { plaidTransactionToDoc, type PlaidTxnInput } from "./mapping";

/** Plaid transaction ids are URL-safe; strip anything unexpected so the value is
 *  a safe Firestore doc id (deterministic id = cheap, idempotent dedup). */
const docIdFor = (transactionId: string): string =>
  `plaid_${transactionId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/**
 * Scheduled daily sync: for every active Plaid item, pull new transactions via
 * transactionsSync (cursor-based) and write each ADDED item as a pending_review
 * transaction (deduped by a deterministic doc id, so re-syncs never duplicate
 * and a user-verified txn is never clobbered). The per-item cursor is persisted
 * after each page so a crash resumes from the last committed point.
 *
 * v1 handles ADDED only; `modified`/`removed` are deferred (must not clobber a
 * user-verified/edited transaction — see the runbook).
 */
export const plaidsynctransactions = onSchedule(
  { schedule: "every 24 hours", secrets: PLAID_SECRETS, timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore();
    const plaid = makePlaidClient();

    const households = await db.collection("households").get();
    for (const hh of households.docs) {
      const householdId = hh.id;
      const lastPaycheckDate = hh.data()?.lastPaycheckDate as string | undefined;

      const items = await hh.ref
        .collection("plaidItems")
        .where("status", "==", "active")
        .get();
      if (items.empty) continue;

      // Bucket names this household clamps categories against.
      const bucketsSnap = await hh.ref.collection("buckets").get();
      const bucketNames = bucketsSnap.docs
        .map((d) => d.data()?.name)
        .filter((n): n is string => typeof n === "string");

      for (const itemDoc of items.docs) {
        const { accessToken, cursor } = itemDoc.data() as {
          accessToken?: string;
          cursor?: string | null;
        };
        if (!accessToken) continue;

        try {
          let nextCursor = cursor ?? undefined;
          let hasMore = true;
          while (hasMore) {
            const resp = await plaid.transactionsSync({
              access_token: accessToken,
              cursor: nextCursor,
            });
            const added = resp.data.added ?? [];
            for (const p of added) {
              const ref = db.doc(
                `households/${householdId}/transactions/${docIdFor(p.transaction_id)}`,
              );
              const existing = await ref.get();
              if (existing.exists) continue; // dedup (also preserves user edits)
              await ref.set({
                ...plaidTransactionToDoc(p as PlaidTxnInput, { bucketNames, lastPaycheckDate }),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
            nextCursor = resp.data.next_cursor;
            hasMore = resp.data.has_more;
            // Persist the cursor after each page so a crash resumes safely.
            await itemDoc.ref.update({
              cursor: nextCursor,
              lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        } catch (err) {
          // One bad item must not abort the whole job.
          logger.error(
            `Plaid sync failed for household ${householdId} item ${itemDoc.id}`,
            err,
          );
        }
      }
    }
  },
);
