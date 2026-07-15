import type { ReceiptLineItem, ReceiptLineItemsData } from '@/services/geminiService.types';
import type { ParsedTransaction } from '@/types/ui';
import { roundMoney, sumMoney } from '@/utils/money';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * F-DASH-04 — pure helpers for turning an itemized receipt (a list of
 * `{description, amount, category}` line items sharing one merchant) into a small
 * set of categorized transactions.
 *
 * The default transformation GROUPS line items by category and sums each group,
 * so a mixed Target run of 20 scanned lines collapses into e.g. one Groceries
 * transaction + one Household transaction — the outcome the roadmap describes —
 * rather than 20 tiny rows. All money math is cent-safe via `utils/money.ts`.
 * These functions never touch Firestore or generate side effects; the caller
 * writes the resulting transactions atomically (single writeBatch).
 */

export interface CategoryGroup {
  category: string;
  /** Summed decimal-dollar total of every line item in this category. */
  amount: number;
}

/**
 * Groups line items by their category, summing amounts cent-safely. Category
 * order follows first appearance in `items`. Groups whose summed total is not
 * strictly positive are dropped (a receipt line can't create a $0 transaction).
 */
export function groupLineItemsByCategory(items: ReceiptLineItem[]): CategoryGroup[] {
  const order: string[] = [];
  const byCategory = new Map<string, number[]>();

  for (const item of items) {
    const category = item.category?.trim() || 'Other';
    const existing = byCategory.get(category);
    if (existing) {
      existing.push(item.amount);
    } else {
      byCategory.set(category, [item.amount]);
      order.push(category);
    }
  }

  const groups: CategoryGroup[] = [];
  for (const category of order) {
    const amount = sumMoney(byCategory.get(category) ?? []);
    if (amount > 0) {
      groups.push({ category, amount });
    }
  }
  return groups;
}

/**
 * Builds one `ParsedTransaction` per category group from a parsed itemized
 * receipt, all sharing `receiptGroupId` (so the transaction list can group them
 * back into the original purchase) and the receipt's merchant/date/store. Rows
 * default to selected so the review UI shows them checked.
 *
 * `date` falls back to today (local) when the receipt had no visible date —
 * mirrors the single-receipt capture path.
 */
export function buildLineItemTransactions(
  data: ReceiptLineItemsData,
  receiptGroupId: string,
  makeId: () => string = () => crypto.randomUUID(),
): ParsedTransaction[] {
  const groups = groupLineItemsByCategory(data.items);
  const date = data.date || getLocalDateString();
  const merchant = data.merchant?.trim() || 'Receipt';
  const store = data.store?.trim() || undefined;

  return groups.map(group => ({
    id: makeId(),
    merchant,
    amount: roundMoney(group.amount),
    category: group.category,
    date,
    selected: true,
    store,
    receiptGroupId,
  }));
}

/**
 * True when a parsed receipt is worth splitting into multiple transactions: it
 * has more than one category group with a positive total. A single-category (or
 * single-item) receipt is handled by the normal single-transaction path instead.
 */
export function shouldSplitReceipt(data: ReceiptLineItemsData): boolean {
  return groupLineItemsByCategory(data.items).length > 1;
}
