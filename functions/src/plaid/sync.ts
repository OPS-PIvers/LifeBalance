import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { PLAID_SECRETS, makePlaidClient } from "./client";
import { plaidTransactionToDoc, type PlaidTxnInput } from "./mapping";
import { decidePlaidWrite, type ExistingRow } from "./dedup";
import { DUPLICATE_WINDOW_DAYS } from "../quickAdd/transactionIdentity";

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

    // Fetch ONLY active Plaid items across all households via a collection-group
    // query (O(active connections), not O(all households)), then group by
    // household so we read each active household's doc + buckets just once.
    // Mirrors the apiKeys collection-group query (needs the matching index in
    // firestore.indexes.json).
    const activeItems = await db
      .collectionGroup("plaidItems")
      .where("status", "==", "active")
      .get();
    if (activeItems.empty) return;

    const itemsByHousehold = new Map<string, typeof activeItems.docs>();
    for (const itemDoc of activeItems.docs) {
      const householdId = itemDoc.ref.parent.parent?.id;
      if (!householdId) continue;
      const list = itemsByHousehold.get(householdId);
      if (list) list.push(itemDoc);
      else itemsByHousehold.set(householdId, [itemDoc]);
    }

    for (const [householdId, items] of itemsByHousehold) {
      const hhRef = db.doc(`households/${householdId}`);
      const hhSnap = await hhRef.get();
      const lastPaycheckDate = hhSnap.data()?.lastPaycheckDate as string | undefined;

      // Bucket names this household clamps categories against.
      const bucketsSnap = await hhRef.collection("buckets").get();
      const bucketNames = bucketsSnap.docs
        .map((d) => d.data()?.name)
        .filter((n): n is string => typeof n === "string");

      // Cross-path dedup (plan 03 PR-3): fetch this household's transactions
      // once, up front, and reuse the same set as the fingerprint-window
      // candidate pool for EVERY Plaid transaction in this sync (one query per
      // household per sync, not per txn). A single-field `date >=` query needs
      // no composite index; the window is small (≤ DUPLICATE_WINDOW_DAYS back
      // from today, since that's the widest lag isLikelyDuplicate considers)
      // so filtering candidates further (by day-distance to each incoming txn)
      // happens in memory inside dedup.ts via isLikelyDuplicate itself.
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - DUPLICATE_WINDOW_DAYS);
      const windowStartStr = windowStart.toISOString().slice(0, 10);
      const recentSnap = await hhRef
        .collection("transactions")
        .where("date", ">=", windowStartStr)
        .get();
      const recentRows: ExistingRow[] = recentSnap.docs
        .map((d): ExistingRow | null => {
          const data = d.data() as Record<string, unknown>;
          if (
            typeof data.amount !== "number" ||
            typeof data.merchant !== "string" ||
            typeof data.date !== "string" ||
            typeof data.category !== "string" ||
            (data.status !== "verified" && data.status !== "pending_review")
          ) {
            return null;
          }
          return {
            id: d.id,
            amount: data.amount,
            merchant: data.merchant,
            date: data.date,
            category: data.category,
            status: data.status,
            accountId: typeof data.accountId === "string" ? data.accountId : undefined,
            needsAmount: data.needsAmount === true,
          };
        })
        .filter((row): row is ExistingRow => row !== null);

      for (const itemDoc of items) {
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

              const mapped = plaidTransactionToDoc(p as PlaidTxnInput, { bucketNames, lastPaycheckDate });
              const decision = decidePlaidWrite(mapped, recentRows);

              if (decision.action === "skip-annotate-existing") {
                // A confident duplicate of an existing row from another path:
                // don't write a second row — annotate the existing one with the
                // Plaid link (its own `source` is left as-is; Plaid didn't win).
                await hhRef.collection("transactions").doc(decision.existingId).update({
                  plaidTransactionId: p.transaction_id,
                });
                continue;
              }

              await ref.set({
                ...mapped,
                ...(decision.possibleDuplicateOf ? { possibleDuplicateOf: decision.possibleDuplicateOf } : {}),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              // Newly-inserted Plaid rows are themselves eligible candidates for
              // later transactions in this SAME page (e.g. two near-identical
              // Plaid txns for the same purchase, unlikely but not impossible).
              recentRows.push({
                id: ref.id,
                amount: mapped.amount,
                merchant: mapped.merchant,
                date: mapped.date,
                category: mapped.category,
                status: mapped.status,
                needsAmount: false,
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
