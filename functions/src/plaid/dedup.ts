/**
 * Plaid-sync dedup decision layer (plan 03 PR-3).
 *
 * `plaidsynctransactions` (sync.ts) already dedups a Plaid transaction against
 * ITSELF via the deterministic `plaid_<transaction_id>` doc id. That only
 * catches a re-sync of the same Plaid item; it never notices that the SAME
 * real-world purchase already arrived through another path (manual entry,
 * receipt scan, the iOS Shortcut quickAdd pipeline, …). This module is the
 * pure decision layer for that cross-path case: given an incoming Plaid
 * transaction (mapped via `mapping.ts`) and the household's recent existing
 * transactions (fetched once per household per sync — see sync.ts), decide
 * whether to skip-and-annotate, insert-flagged, or insert-plain.
 *
 * Delegates the actual "same purchase?" call to the shared
 * `isLikelyDuplicate` from `./transactionIdentity` (absorbed there in PR-1) —
 * this module only wires that verdict into a Firestore-write decision.
 */
import { isLikelyDuplicate, type IdentityTransaction } from "../quickAdd/transactionIdentity";
import type { MappedPlaidDoc } from "./mapping";

/** An existing transaction row considered as a dedup candidate, alongside its doc id. */
export interface ExistingRow extends IdentityTransaction {
  id: string;
}

/** What the caller (sync.ts) should do for one incoming Plaid transaction. */
export type PlaidWriteDecision =
  | { action: "skip-annotate-existing"; existingId: string }
  | { action: "insert"; possibleDuplicateOf?: string };

/**
 * Decide how to persist one incoming Plaid transaction given the household's
 * recently-fetched transactions.
 *
 *  - Any existing row `isLikelyDuplicate` verdict `'duplicate'` → skip writing
 *    a new Plaid row; the caller instead annotates that existing row with
 *    `plaidTransactionId` (its `source` is left as-is — Plaid did not "win").
 *  - No `'duplicate'` but at least one `'possible'` → insert normally, with
 *    `possibleDuplicateOf` pointing at the first such candidate.
 *  - Otherwise → insert normally, unflagged.
 *
 * Pairwise only (never chains through a third row), matching
 * `isLikelyDuplicate`'s own contract.
 */
export function decidePlaidWrite(
  // `MappedPlaidDoc` itself never carries an accountId today (Plaid sync
  // doesn't yet resolve one — a `'duplicate'` verdict without a known account
  // on both sides is unreachable per isLikelyDuplicate's policy, so every
  // Plaid-vs-other-path match currently caps out at `'possible'`). The
  // optional `accountId` here is forward-compatible with a future account
  // resolution step.
  candidate: MappedPlaidDoc & { accountId?: string },
  existingRows: readonly ExistingRow[],
): PlaidWriteDecision {
  const incoming: IdentityTransaction = {
    amount: candidate.amount,
    merchant: candidate.merchant,
    date: candidate.date,
    category: candidate.category,
    status: "pending_review",
    accountId: candidate.accountId,
  };

  let possibleMatch: string | undefined;
  for (const row of existingRows) {
    const verdict = isLikelyDuplicate(incoming, row);
    if (verdict === "duplicate") {
      return { action: "skip-annotate-existing", existingId: row.id };
    }
    if (verdict === "possible" && !possibleMatch) {
      possibleMatch = row.id;
    }
  }

  return { action: "insert", possibleDuplicateOf: possibleMatch };
}
