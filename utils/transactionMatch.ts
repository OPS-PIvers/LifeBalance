/**
 * Match an AI-scanned receipt against the household's EXISTING pending-review
 * transactions, so a scan can RECONCILE an Apple Pay `$0` stub (or a duplicate
 * pending entry) instead of creating a second transaction for the same purchase.
 *
 * Pure + dependency-light on purpose (mirrors `utils/storeMatch.ts`): no React,
 * no Firestore, no toast — just data in, best match out — so it is trivially
 * unit-testable and reusable from the capture flow.
 *
 * Store/merchant comparison reuses `normalizeStoreName` from `storeMatch.ts`, so
 * "Trader Joe's" on the receipt matches a "trader joes" transaction. Amount is
 * deliberately NOT part of the match: an Apple Pay `$0` stub has amount 0, so
 * amount equality would defeat the primary use case (filling that stub in).
 *
 * Plan 03 PR-1 note: `normalizeStoreName`'s exact-equality comparison here is
 * intentionally NOT replaced by the newer `merchantSimilar` token-overlap
 * comparator in `utils/transactionIdentity.ts` — `normalizeStoreName` treats
 * apostrophes/periods differently than that module's own normalizer (see the
 * divergence note there), and this file's tests pin the exact-equality
 * behavior. `isLikelyDuplicate`/`fingerprint` are the shared vocabulary future
 * wire-ins (Plaid sync, quickAdd — plan 03 PR-3) should use for NEW duplicate
 * detection; this file keeps its historical store-based matching unchanged.
 */
import { differenceInCalendarDays, parseISO } from 'date-fns';

import type { ReceiptData } from '@/services/geminiService.types';
import type { Transaction } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { normalizeStoreName } from '@/utils/storeMatch';

export interface MatchPendingTransactionOptions {
  /**
   * Max allowed difference (in calendar days, absolute) between the receipt date
   * and a candidate transaction's date. Default 3.
   */
  windowDays?: number;
  /**
   * Caller-local "today" as `yyyy-MM-dd`, used when the receipt has no date.
   * Defaults to `getLocalDateString()` (the user's LOCAL day). Injectable so
   * boundary tests are deterministic.
   */
  today?: string;
}

const DEFAULT_WINDOW_DAYS = 3;

/** Receipt's effective store/merchant label (store preferred, merchant fallback). */
const receiptName = (receipt: ReceiptData): string => receipt.store || receipt.merchant || '';

/** Transaction's effective store/merchant label (store preferred, merchant fallback). */
const transactionName = (tx: Transaction): string => tx.store || tx.merchant || '';

/**
 * Find the single best EXISTING pending-review transaction that this receipt is
 * most likely a record of, or `undefined` when nothing qualifies.
 *
 * A transaction qualifies when ALL of:
 *  1. `status === 'pending_review'`
 *  2. its normalized store/merchant equals the receipt's normalized
 *     store/merchant (and the receipt name is non-empty)
 *  3. its date is within `windowDays` calendar days of the receipt date
 *     (receipt date falls back to `today`)
 *
 * Among qualifiers the best match is chosen by, in order:
 *  - a `needsAmount` Apple Pay stub is preferred (that's exactly what a scan is
 *    meant to fill in),
 *  - then the smallest absolute date difference,
 *  - then the most recent transaction date,
 *  - then the most recently created (`createdAt`) as a final stable tiebreak.
 *
 * v1 deliberately returns only the best match.
 */
export function findMatchingPendingTransaction(
  receipt: ReceiptData,
  transactions: readonly Transaction[],
  opts: MatchPendingTransactionOptions = {},
): Transaction | undefined {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const receiptDate = receipt.date || opts.today || getLocalDateString();

  const key = normalizeStoreName(receiptName(receipt));
  if (!key) return undefined;

  const receiptDay = parseISO(receiptDate);
  // A malformed receipt date → Invalid Date → NaN distance, which would slip past
  // the `> windowDays` filter (NaN comparisons are always false). Bail instead.
  if (Number.isNaN(receiptDay.getTime())) return undefined;

  // Annotate qualifying candidates with their absolute day-distance once, so the
  // comparator is cheap and the distance is computed a single time per tx.
  const candidates: Array<{ tx: Transaction; distance: number }> = [];
  for (const tx of transactions) {
    if (tx.status !== 'pending_review') continue;
    if (normalizeStoreName(transactionName(tx)) !== key) continue;
    if (!tx.date) continue;
    const txDay = parseISO(tx.date);
    if (Number.isNaN(txDay.getTime())) continue; // skip transactions with a bad date
    const distance = Math.abs(differenceInCalendarDays(txDay, receiptDay));
    if (distance > windowDays) continue;
    candidates.push({ tx, distance });
  }

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    // 1. Prefer a needsAmount stub.
    const aStub = a.tx.needsAmount ? 1 : 0;
    const bStub = b.tx.needsAmount ? 1 : 0;
    if (aStub !== bStub) return bStub - aStub;
    // 2. Closest date.
    if (a.distance !== b.distance) return a.distance - b.distance;
    // 3. Most recent transaction date.
    if (a.tx.date !== b.tx.date) return a.tx.date < b.tx.date ? 1 : -1;
    // 4. Stable final tiebreak: most recently created.
    const aCreated = a.tx.createdAt ?? '';
    const bCreated = b.tx.createdAt ?? '';
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    return 0;
  });

  return candidates[0]?.tx;
}

/**
 * Build the `updateTransaction` patch for MERGING a scanned receipt into an
 * existing pending transaction `candidate` (the result of
 * {@link findMatchingPendingTransaction}).
 *
 * Money-safety: under the verified-only balance model (Plan 015) a
 * `pending_review` transaction never touches the checking balance, and this
 * merge leaves the status `pending_review` (see below), so the amount change
 * here is purely cosmetic to the balance — the merged spend is reflected in
 * Safe-to-Spend via the pendingSpend term, and the real debit happens later when
 * the row is verified. We still only include `amount` when it actually changes
 * (full value for a `$0` Apple Pay stub, the correction for a differing row,
 * omitted when equal) so the stored doc and the eventual verify-time impact are
 * exact. `needsAmount` is cleared only when the candidate was a stub. Status is
 * left untouched (stays `pending_review`) so the merged receipt still flows
 * through the normal review/Action-Queue path.
 */
export function buildReceiptMergeUpdates(
  receiptTx: Transaction,
  candidate: Transaction,
): Partial<Transaction> {
  const updates: Partial<Transaction> = {
    // merchant/category/date are always present on a scanned receipt; `|| candidate`
    // is harmless defense in case a field is ever empty.
    merchant: receiptTx.merchant || candidate.merchant,
    category: receiptTx.category || candidate.category,
    date: receiptTx.date || candidate.date,
    autoCategorized: true,
  };
  // Enrich with the receipt's metadata, but NEVER wipe a value the candidate
  // already had when the receipt doesn't supply one (and never write undefined,
  // which Firestore rejects) — only set each field when there's a usable value.
  const habitIds =
    receiptTx.relatedHabitIds && receiptTx.relatedHabitIds.length > 0
      ? receiptTx.relatedHabitIds
      : candidate.relatedHabitIds;
  if (habitIds && habitIds.length > 0) updates.relatedHabitIds = habitIds;
  const subBucketId = receiptTx.subBucketId || candidate.subBucketId;
  if (subBucketId) updates.subBucketId = subBucketId;
  const store = receiptTx.store || candidate.store;
  if (store) updates.store = store;
  // Delta-safe amount: only when it changes (full debit for a $0 stub, the
  // correction for a differing row, omitted when equal). Clear the stub flag.
  if (candidate.needsAmount || candidate.amount !== receiptTx.amount) {
    updates.amount = receiptTx.amount;
    if (candidate.needsAmount) updates.needsAmount = false;
  }
  return updates;
}
