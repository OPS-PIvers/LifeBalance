import type { CalendarItem, Transaction } from '@/types/schema';

/**
 * The ONE rule every transaction mutation uses to refuse an edit that would
 * orphan a settled bill (TODO.md 2H(a)).
 *
 * A transaction carrying `paidCalendarItemId` is one half of a two-document
 * record: the row itself, and the calendar doc it marked PAID (a recurring
 * occurrence's paid-instance doc, or the one-off bill's own doc). Deleting,
 * merging away, splitting or re-pricing that row from the transaction side
 * moves the balance back but leaves the calendar side marked paid — and because
 * `expandCalendarItems` suppresses an occurrence on `{parentRecurringId, date}`,
 * that occurrence is permanently dropped from unpaid bills, so Safe-to-Spend
 * silently overstates cash by the bill's amount, every period, forever.
 *
 * Un-settling from the transaction side is deliberately out of scope, so every
 * such mutation REFUSES and points at the side that can actually undo it.
 *
 * The guard is deliberately keyed on the bill still BEING paid, not merely on
 * the field being present: once the user removes the payment on the calendar
 * (deleting the paid-instance doc, or clearing `isPaid`), the reference dangles
 * and there is nothing left to orphan — refusing then would trap the row with
 * no way out anywhere in the app. `calendarItems` is loaded by an UNBOUNDED
 * listener (see `financeListeners.ts`), so a miss really does mean "gone",
 * never "outside the window".
 */
export function findSettledBill(
  transaction: Pick<Transaction, 'paidCalendarItemId'>,
  calendarItems: readonly CalendarItem[],
): CalendarItem | undefined {
  const id = transaction.paidCalendarItemId;
  if (!id) return undefined;
  const bill = calendarItems.find(i => i.id === id);
  if (!bill || bill.isDeleted || !bill.isPaid) return undefined;
  return bill;
}

/**
 * The refusal copy shared by every guarded mutation. `action` is the verb of the
 * thing being refused ("delete", "merge", "split", "edit", "undo"), so the
 * message names both what was blocked and where to go instead.
 */
export function settledBillRefusal(action: string, billTitle?: string): string {
  const bill = billTitle?.trim() ? `“${billTitle.trim()}”` : 'a bill';
  return `Can't ${action} this transaction — it settled ${bill}. Undo that payment on the calendar first.`;
}

/**
 * Fields whose change would desync a settled row from the bill it paid: the
 * amount the bill was marked paid at, the account the money moved out of, and
 * anything that re-derives the balance impact (status/category/creditPayment).
 * A pure metadata edit (notes, merchant, date, split overlay) is left alone —
 * it can't diverge the two documents.
 */
const MONEY_FIELDS = ['amount', 'status', 'category', 'accountId', 'creditPayment'] as const;

/** Does this `updateTransaction` patch touch anything the settled bill depends on? */
export function touchesSettledBillFields(updates: Partial<Transaction>): boolean {
  return MONEY_FIELDS.some(field => field in updates);
}
