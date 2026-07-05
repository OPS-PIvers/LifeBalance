/**
 * Plaid-sync `modified`/`removed` policy layer (plan 04, section A).
 *
 * `plaidsynctransactions` (sync.ts) previously handled ADDED transactions
 * only; Plaid's `transactionsSync` also reports `modified` (a pending charge
 * whose amount/merchant/date/category changed as it posted) and `removed`
 * (a transaction that no longer exists, e.g. a pending auth that never
 * settled). Naively applying either to a row that has already been reviewed
 * by the user would clobber their edit or silently delete money they already
 * accounted for — this module is the pure decision layer that keeps that from
 * happening.
 *
 * User-edited / reviewed heuristic: a row is considered "untouched" (safe to
 * overwrite/delete) iff its `status` is still `'pending_review'`. The
 * `updateTransactionCategory`/`updateTransaction` context paths (the ONLY
 * client mutation paths for a transaction) always flip `status` to
 * `'verified'` when the user finishes reviewing a row, and there is no
 * client path that edits a `pending_review` row's fields without also
 * verifying it. So `status === 'verified'` is a reliable, cheap proxy for
 * "the user has looked at and accepted this row" without needing a separate
 * dirty-tracking field. `pending_review` rows carrying `needsAmount: true`
 * (an Apple-Pay stub reconciled by a DIFFERENT pipeline) are still untouched
 * by the user and are treated the same as any other pending_review row here.
 */

/** Minimal shape of an existing transaction row this module needs to see. */
export interface RevisableRow {
  id: string;
  status: "verified" | "pending_review";
}

/** The subset of a Plaid `modified` transaction's fields we may overwrite. */
export interface PlaidModifiedFields {
  amount: number;
  merchant: string;
  category: string;
  date: string;
}

/** What the caller (sync.ts) should write for one `modified` Plaid transaction
 *  matched to an existing `plaid_<id>` doc. */
export type ModifiedDecision =
  | { action: "overwrite"; fields: PlaidModifiedFields }
  | { action: "flag-revision"; revision: PlaidRevisionValue };

/** The `Transaction.plaidRevision` field shape (also declared on the client
 *  type in types/schema.ts — keep the two in sync). */
export interface PlaidRevisionValue {
  amount?: number;
  merchant?: string;
  date?: string;
  /** ISO timestamp string; the caller stamps this at write time (kept out of
   *  this pure decision so the function stays deterministic/testable). */
  revisedAt?: string;
}

/**
 * Decide how to persist a Plaid `modified` transaction against the existing
 * row it was matched to (by deterministic `plaid_<transaction_id>` doc id).
 *
 * - Untouched (`pending_review`): overwrite amount/merchant/category/date
 *   directly — the row hasn't been shown to the user as final yet.
 * - Verified: do NOT touch the verified fields (a balance delta for a
 *   verified row must go through the same batched balance-adjustment path as
 *   `updateTransactionCategory`'s overrides param, which this sync job does
 *   not have — out of scope for this PR per the review-UI note in the plan).
 *   Instead compute a `plaidRevision` delta (only the fields that actually
 *   changed) for a future review-UI affordance to surface.
 */
export function decideModifiedWrite(
  existing: RevisableRow,
  incoming: PlaidModifiedFields,
  currentFields: { amount: number; merchant: string; category: string; date: string },
): ModifiedDecision {
  if (existing.status === "pending_review") {
    return { action: "overwrite", fields: incoming };
  }

  const revision: PlaidRevisionValue = {};
  if (incoming.amount !== currentFields.amount) revision.amount = incoming.amount;
  if (incoming.merchant !== currentFields.merchant) revision.merchant = incoming.merchant;
  if (incoming.date !== currentFields.date) revision.date = incoming.date;

  return { action: "flag-revision", revision };
}

/** What the caller (sync.ts) should do for one `removed` Plaid transaction
 *  matched to an existing `plaid_<id>` doc. */
export type RemovedDecision = "delete" | "flag-removed";

/**
 * Decide how to persist a Plaid `removed` transaction against the existing
 * row it maps to.
 *
 * - Untouched (`pending_review`): delete the doc outright — nothing in the
 *   app's model depended on it (pending rows have no balance effect).
 * - Verified: the user already accepted this row and it debited their
 *   checking balance in-app; deleting it would silently un-delete that money
 *   from their books. Flag `plaidRemoved: true` instead so a review surface
 *   (future UI) can prompt the user to reconcile — never auto-delete
 *   already-verified money.
 */
export function decideRemovedWrite(existing: RevisableRow): RemovedDecision {
  return existing.status === "pending_review" ? "delete" : "flag-removed";
}
