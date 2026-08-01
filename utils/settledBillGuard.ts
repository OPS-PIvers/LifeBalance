import { roundMoney } from '@/utils/money';
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
 * `merge`, `split`, `edit` and `undo` all REFUSE and point at the side that can
 * actually undo it — they replace or re-price the row, so there is no coherent
 * "and also un-pay the bill" to offer. DELETE is the exception: it destroys the
 * row outright, which has exactly one sensible counterpart on the calendar, so
 * `deleteTransaction` UN-SETTLES the bill in its own batch instead of refusing
 * (the caller confirms the extra effect first). See makeDeleteTransaction.
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

/**
 * Compare one money field old-vs-new, normalising the shapes that mean "no
 * change" but aren't `===`: cent-rounded amounts, a `creditPayment` that is
 * `false`/`undefined`/absent, and an `accountId` that is `''`/`undefined`.
 */
function sameMoneyValue(field: (typeof MONEY_FIELDS)[number], next: unknown, prev: unknown): boolean {
  if (field === 'amount') {
    return roundMoney(typeof next === 'number' ? next : 0) === roundMoney(typeof prev === 'number' ? prev : 0);
  }
  if (field === 'creditPayment') return Boolean(next) === Boolean(prev);
  return (next ?? '') === (prev ?? '');
}

/**
 * Does this `updateTransaction` patch actually CHANGE anything the settled bill
 * depends on?
 *
 * Compares values, never mere key presence. `EditTransactionModal` — the only
 * edit surface for an existing row — always sends the whole form (amount,
 * category, accountId, creditPayment) on every save, so a presence check
 * refused a settled row for a pure notes or merchant edit, i.e. exactly the
 * metadata case this guard's contract promises to leave alone. That made a
 * settled bill-payment permanently uneditable through the app's own UI, with
 * deleting the calendar payment as the only escape.
 */
export function touchesSettledBillFields(
  updates: Partial<Transaction>,
  existing: Partial<Transaction>,
): boolean {
  return MONEY_FIELDS.some(
    field => field in updates && !sameMoneyValue(field, updates[field], existing[field]),
  );
}
