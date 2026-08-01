import type { Household, ShoppingItem, ToDo, Transaction } from '@/types/schema';
import { isManualReview } from '@/utils/captureReview';

/**
 * A single held-for-review capture, normalized into a tagged union so one
 * cycling drawer can render the right per-type review form. Consumed by
 * `ReviewPendingDrawer` (Layer 3b) and, later, by the Action-Queue layer that
 * opens the same drawer on demand.
 *
 * `id` is duplicated onto the envelope so callers can key/dedupe without
 * reaching into the payload; each `kind` carries its full domain object.
 */
export type ReviewQueueItem =
  | { kind: 'transaction'; id: string; transaction: Transaction }
  | { kind: 'shopping'; id: string; item: ShoppingItem }
  | { kind: 'todo'; id: string; item: ToDo };

/**
 * A transaction is a REVIEW candidate when it is either a classic
 * `pending_review` row OR a bank-email-sync row that was born `verified` but
 * still `needsCategory` (bankEmailSync Cloud Function). The latter carries an
 * authoritative balance already, so its review is a bucket-assignment only (no
 * balance delta on categorize) — but it must still surface in the same review
 * surfaces (Action Queue + on-open review drawer) so it doesn't sit
 * uncategorized forever.
 *
 * Lives here (a pure util) rather than in `hooks/useActionQueue.ts`, which is
 * where it used to be declared and is still re-exported from, so pure modules
 * — e.g. `utils/settledBillDuplicate.ts` — can answer "is this row in review?"
 * without importing a module that pulls in React and the household contexts.
 */
export const needsReview = (
  tx: Pick<Transaction, 'status' | 'needsCategory'>,
): boolean => tx.status === 'pending_review' || (tx.status === 'verified' && tx.needsCategory === true);

interface BuildReviewQueueSnapshotParams {
  /**
   * Pending-review transactions ALREADY filtered (`needsReview && !snoozed`)
   * and ordered newest-first by the caller. They are the money side of the
   * queue and are the ONLY source gated on a review-mode flag (below).
   */
  pendingReviewTransactions: Transaction[];
  /** Held-for-review to-dos (`needsReview === true`), from `useTodos()`. */
  todosAwaitingReview: ToDo[];
  /** Held-for-review shopping captures (`needsReview === true`), from `useShopping()`. */
  shoppingAwaitingReview: ShoppingItem[];
  /** Household settings — read for the `expense` capture-review mode gate. */
  householdSettings: Pick<Household, 'captureReview'> | null | undefined;
}

/**
 * Builds the ordered, mixed-type review snapshot the on-open drawer cycles
 * through: transactions first, then to-dos, then shopping.
 *
 * Accounting rule (the reason this is a pure, tested helper): pending
 * transactions are force-surfaced here ONLY when the household's `expense`
 * capture routing is `review`. When it is `auto`, those transactions still
 * exist, still count toward pendingSpend / Safe-to-Spend, and stay reviewable
 * via the Action Queue — they are simply not pushed into this auto-open drawer.
 * Their inclusion is gated purely on the expense mode, independent of whether
 * the drawer opens for held to-dos or shopping items.
 *
 * `todosAwaitingReview` / `shoppingAwaitingReview` only exist in `review` mode
 * by construction (the context splits them out of the visible lists), so they
 * are always included when present.
 */
export function buildReviewQueueSnapshot({
  pendingReviewTransactions,
  todosAwaitingReview,
  shoppingAwaitingReview,
  householdSettings,
}: BuildReviewQueueSnapshotParams): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];

  if (isManualReview(householdSettings, 'expense')) {
    for (const transaction of pendingReviewTransactions) {
      items.push({ kind: 'transaction', id: transaction.id, transaction });
    }
  }

  for (const item of todosAwaitingReview) {
    items.push({ kind: 'todo', id: item.id, item });
  }

  for (const item of shoppingAwaitingReview) {
    items.push({ kind: 'shopping', id: item.id, item });
  }

  return items;
}
