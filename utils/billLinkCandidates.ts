import { CalendarItem } from '@/types/schema';

/**
 * Pure filter/sort for the "Link to bill" picker (TransactionReviewForm):
 * candidate unpaid expense calendar items a bank-synced transaction could be
 * reconciled against, via `linkBankTransactionToBill`
 * (contexts/household/mutations/calendarMutations.ts). Callers pass the
 * ALREADY-EXPANDED item list (e.g. `useExpandedCalendarItems(windowStart,
 * windowEnd)`) so recurring occurrences carry their synthetic
 * `templateId_instance_yyyy-MM-dd` id — the exact id form
 * `linkBankTransactionToBill` expects.
 *
 * Sorted chronologically ascending (nearest-due first) since the target bill
 * is almost always the one closest to the transaction's own date.
 */
export function getBillLinkCandidates(expandedItems: CalendarItem[]): CalendarItem[] {
  return expandedItems
    .filter(item => item.type === 'expense' && !item.isPaid)
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
}
