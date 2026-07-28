import { differenceInCalendarDays, parseISO, isValid } from 'date-fns';

import { INCOME_CATEGORY, type Transaction } from '@/types/schema';

/**
 * Pure filter/sort for the Edit Event drawer's "link this bill to a transaction"
 * picker (`components/budget/TransactionLinkPicker.tsx`), the calendar-side
 * entry point for `settleBillWithTransaction`. Mirrors the
 * `utils/billLinkCandidates.ts` split: all of the decision logic lives here so
 * it is unit-testable without a render.
 *
 * A row is a candidate when it could actually settle a bill:
 *   - not already linked to one (`paidCalendarItemId`) — the mutation refuses a
 *     second settle, so offering it would be a dead tap;
 *   - not income (a credit cannot pay an expense);
 *   - a real charge — a `needsAmount` $0 Apple Pay stub has no amount yet, and
 *     the mutation refuses a non-positive one.
 * BOTH `pending_review` and `verified` rows qualify: the screenshot-import case
 * that motivates this is `pending_review`, but a charge the user already
 * approved is exactly the one they later notice was really the bill.
 *
 * Sorted NEAREST-DATE-FIRST around the bill occurrence's own due date (ties
 * broken toward the later charge), because a bill is paid within days of when
 * it was due — not by absolute recency, which would bury a two-month-old bill's
 * match under this week's coffee.
 */
export interface TransactionLinkCandidateOptions {
  /** The bill occurrence's due date (`yyyy-MM-dd`) — the sort anchor. */
  anchorDate: string;
  /** Free-text filter. Matched case-insensitively against `searchTermsFor`. */
  query?: string;
  /**
   * Every string a row should be findable by. Callers pass
   * `useMerchantRules().searchTermsFor` so a merchant-rule-renamed row stays
   * findable by its RAW bank descriptor as well as its friendly name. Defaults
   * to the stored merchant + store.
   */
  searchTermsFor?: (tx: Transaction) => string[];
  /** Cap on the returned list (default 50) — the picker is a scroll, not a feed. */
  limit?: number;
}

const defaultSearchTerms = (tx: Transaction): string[] =>
  [tx.merchant, tx.store].filter((t): t is string => !!t);

/** Whole days between a transaction and the anchor; `Infinity` for a bad date. */
const distanceFrom = (anchor: Date, dateStr: string): number => {
  const date = parseISO(dateStr);
  if (!isValid(date)) return Number.POSITIVE_INFINITY;
  return Math.abs(differenceInCalendarDays(date, anchor));
};

export function getTransactionLinkCandidates(
  transactions: readonly Transaction[],
  options: TransactionLinkCandidateOptions,
): Transaction[] {
  const { anchorDate, query, searchTermsFor = defaultSearchTerms, limit = 50 } = options;
  const anchor = parseISO(anchorDate);
  const anchorValid = isValid(anchor);
  const q = (query ?? '').trim().toLowerCase();

  const eligible = transactions.filter((tx) => {
    if (tx.paidCalendarItemId) return false;
    if (tx.category === INCOME_CATEGORY) return false;
    if (tx.needsAmount) return false;
    if (!(tx.amount > 0)) return false;
    if (!q) return true;
    return searchTermsFor(tx).some((term) => term.toLowerCase().includes(q));
  });

  const sorted = anchorValid
    ? eligible.slice().sort((a, b) => {
        const distA = distanceFrom(anchor, a.date);
        const distB = distanceFrom(anchor, b.date);
        if (distA !== distB) return distA - distB;
        // Same distance either side of the anchor: prefer the later charge —
        // a bill is paid on or after its due date more often than before it.
        return a.date > b.date ? -1 : a.date < b.date ? 1 : 0;
      })
    : // Unparseable anchor (a malformed occurrence date): fall back to plain
      // most-recent-first rather than returning an arbitrary order.
      eligible.slice().sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  return sorted.slice(0, limit);
}
