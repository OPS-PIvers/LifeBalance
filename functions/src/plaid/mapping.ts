import { mapPfcToBucket } from "./categoryMap";
import { getPayPeriodForTransaction } from "./payPeriod";

/** Matches INCOME_CATEGORY in the app (types/schema.ts) — kept local because the
 *  functions package can't import from the app root. Inflows use this so
 *  sumPendingSpend excludes them (a refund must not lower safe-to-spend). */
export const INCOME_CATEGORY = "Income";

/** Minimal shape of a Plaid transaction we read (subset of the SDK's Transaction). */
export interface PlaidTxnInput {
  transaction_id: string;
  name?: string | null;
  merchant_name?: string | null;
  amount: number; // Plaid: positive = money OUT of a depository account; negative = in
  date: string; // YYYY-MM-DD
  personal_finance_category?: { primary?: string | null } | null;
}

/** The deterministic, fields-only transaction doc for a Plaid txn (no id, no
 *  createdAt, no checking-balance write — the caller adds the server timestamp).
 *  Pure → unit-testable. */
export interface MappedPlaidDoc {
  amount: number;
  merchant: string;
  category: string;
  date: string;
  status: "pending_review";
  isRecurring: false;
  source: "plaid";
  autoCategorized: true;
  plaidTransactionId: string;
  payPeriodId: string;
}

/**
 * Map a Plaid transaction to a LifeBalance pending-review transaction.
 *
 * - Amount stored POSITIVE (the app's convention; quickAdd does the same).
 * - A Plaid NEGATIVE amount is an inflow (deposit/refund) → category Income so
 *   sumPendingSpend excludes it.
 * - Category clamped to the household's bucket names (or 'Uncategorized').
 * - payPeriodId via the correct paycheck-period helper (not quickAdd's shortcut).
 * - NO checking-balance effect: synced txns are pending_review and only debit
 *   checking when the user verifies them (mirrors quickAdd's "don't deduct yet").
 *
 * Pure (no firebase-functions / plaid / Firestore imports) so it unit-tests in
 * the root Vitest runner without pulling in the Cloud Functions runtime.
 */
export function plaidTransactionToDoc(
  p: PlaidTxnInput,
  ctx: { bucketNames: readonly string[]; lastPaycheckDate: string | undefined },
): MappedPlaidDoc {
  const isInflow = p.amount < 0;
  const merchant = (p.merchant_name || p.name || "Unknown").slice(0, 100);
  const category = isInflow
    ? INCOME_CATEGORY
    : mapPfcToBucket(p.personal_finance_category?.primary, ctx.bucketNames);
  return {
    amount: Math.abs(p.amount),
    merchant,
    category,
    date: p.date,
    status: "pending_review",
    isRecurring: false,
    source: "plaid",
    autoCategorized: true,
    plaidTransactionId: p.transaction_id,
    payPeriodId: getPayPeriodForTransaction(p.date, ctx.lastPaycheckDate),
  };
}
