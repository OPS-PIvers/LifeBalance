import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { PLAID_SECRETS, makePlaidClient } from "./client";
import { plaidTransactionToDoc, type PlaidTxnInput } from "./mapping";
import { decidePlaidWrite, type ExistingRow } from "./dedup";
import { decideModifiedWrite, decideRemovedWrite, type RevisableRow } from "./revisions";
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
 * MODIFIED/REMOVED (plan 04): decided by the pure helpers in revisions.ts —
 * an untouched (`pending_review`) row is overwritten/deleted directly; a
 * user-`verified` row is never clobbered (a `plaidRevision` delta or
 * `plaidRemoved` flag is written instead so a future review UI can surface
 * it). "Untouched" === `status === 'pending_review'`, since every client
 * mutation path that edits a row's fields also flips it to `verified` — see
 * revisions.ts's file comment for the full argument.
 *
 * BALANCE SYNC (plan 04): `transactionsSync`'s response includes `accounts`
 * with current balances (Plaid SDK ^42, no extra product needed) — those are
 * written, per mapped LifeBalance account (via the item's `accountMap`, set
 * at link time in exchange.ts), as `plaidBalanceCurrent`/`plaidBalanceAvailable`/
 * `plaidBalanceUpdatedAt`. The manual `Account.balance` field is NEVER
 * touched here; these are purely advisory (see utils/plaidBalance.ts).
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
        const { accessToken, cursor, accountMap } = itemDoc.data() as {
          accessToken?: string;
          cursor?: string | null;
          accountMap?: Record<string, string>;
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

            // Balance sync (plan 04, section B): stamp each mapped LifeBalance
            // account with the advisory Plaid balance from THIS page's
            // `accounts` array. Cheap to repeat per page (small array, no
            // extra API call) and keeps the value fresh even mid-cursor-walk.
            for (const plaidAccount of resp.data.accounts ?? []) {
              const lifeBalanceAccountId = accountMap?.[plaidAccount.account_id];
              if (!lifeBalanceAccountId) continue; // unmapped — nothing to stamp
              const balances = plaidAccount.balances;
              // `current`/`available` are nullable per the Plaid SDK; skip a
              // reading entirely rather than writing `null` into a `number`-typed
              // client field. `current` is the primary signal for the affordance
              // (utils/plaidBalance.ts) so without it there is nothing to stamp.
              if (balances.current == null) continue;
              await hhRef.collection("accounts").doc(lifeBalanceAccountId).update({
                plaidBalanceCurrent: balances.current,
                ...(balances.available != null ? { plaidBalanceAvailable: balances.available } : {}),
                plaidBalanceUpdatedAt: new Date().toISOString(),
              });
            }

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

            // MODIFIED (plan 04): a Plaid revision to a transaction we already
            // wrote. Only applies to rows this sync itself created (matched by
            // the deterministic `plaid_<id>` doc id) — if we never wrote it
            // (e.g. it was added+modified between two of our syncs and only
            // shows up as `modified` here because our cursor skipped past the
            // `added` event), there's nothing to update.
            for (const p of resp.data.modified ?? []) {
              const ref = db.doc(
                `households/${householdId}/transactions/${docIdFor(p.transaction_id)}`,
              );
              const existingSnap = await ref.get();
              if (!existingSnap.exists) continue;
              const existingData = existingSnap.data() as Record<string, unknown>;
              const existingRow: RevisableRow = {
                id: ref.id,
                status: existingData.status === "verified" ? "verified" : "pending_review",
              };
              const mapped = plaidTransactionToDoc(p as PlaidTxnInput, { bucketNames, lastPaycheckDate });
              const decision = decideModifiedWrite(
                existingRow,
                mapped,
                {
                  amount: typeof existingData.amount === "number" ? existingData.amount : mapped.amount,
                  merchant: typeof existingData.merchant === "string" ? existingData.merchant : mapped.merchant,
                  category: typeof existingData.category === "string" ? existingData.category : mapped.category,
                  date: typeof existingData.date === "string" ? existingData.date : mapped.date,
                },
              );
              if (decision.action === "overwrite") {
                await ref.update({
                  amount: decision.fields.amount,
                  merchant: decision.fields.merchant,
                  category: decision.fields.category,
                  date: decision.fields.date,
                });
              } else {
                await ref.update({
                  plaidRevision: { ...decision.revision, revisedAt: new Date().toISOString() },
                });
              }
            }

            // REMOVED (plan 04): a transaction Plaid no longer reports (e.g. a
            // pending auth that never settled). Same matched-by-us constraint
            // as `modified` above.
            for (const r of resp.data.removed ?? []) {
              const ref = db.doc(
                `households/${householdId}/transactions/${docIdFor(r.transaction_id)}`,
              );
              const existingSnap = await ref.get();
              if (!existingSnap.exists) continue;
              const existingData = existingSnap.data() as Record<string, unknown>;
              const existingRow: RevisableRow = {
                id: ref.id,
                status: existingData.status === "verified" ? "verified" : "pending_review",
              };
              const decision = decideRemovedWrite(existingRow);
              if (decision === "delete") {
                await ref.delete();
              } else {
                await ref.update({ plaidRemoved: true });
              }
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
