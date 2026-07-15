import { CalendarItem } from '@/types/schema';
import { roundMoney, sumMoney } from '@/utils/money';

/** Weeks and pay-cycles per month used to normalize cadence to a monthly-equivalent cost. */
const WEEKS_PER_MONTH = 52 / 12;
const BIWEEKLY_CYCLES_PER_MONTH = 26 / 12;

export interface RecurringSummaryItem {
  /** The recurring calendar item template (id, title, amount, frequency, etc.). */
  item: CalendarItem & { frequency: NonNullable<CalendarItem['frequency']> };
  /** Cost normalized to a monthly-equivalent dollar amount, cent-safe. */
  monthlyEquivalent: number;
}

export interface RecurringSpendSummary {
  /** Recurring expense templates with their monthly-equivalent cost, sorted
   *  by monthly-equivalent cost descending (biggest recurring spend first). */
  items: RecurringSummaryItem[];
  /** Sum of every item's monthly-equivalent cost, cent-safe. */
  totalMonthly: number;
  /** Items the user explicitly marked `isSubscription` (same sort order). */
  subscriptions: RecurringSummaryItem[];
  /** Sum of subscription items' monthly-equivalent cost, cent-safe. */
  subscriptionsMonthly: number;
  /** Recurring expense items NOT marked as subscriptions (same sort order). */
  otherBills: RecurringSummaryItem[];
  /** Sum of non-subscription items' monthly-equivalent cost, cent-safe. */
  otherBillsMonthly: number;
}

/**
 * Converts a single recurring expense template's raw amount + cadence into a
 * monthly-equivalent dollar cost. Rounds to the cent via `utils/money.ts` so
 * repeated summation never drifts.
 */
function toMonthlyEquivalent(amount: number, frequency: CalendarItem['frequency']): number {
  switch (frequency) {
    case 'weekly':
      return roundMoney(amount * WEEKS_PER_MONTH);
    case 'bi-weekly':
      return roundMoney(amount * BIWEEKLY_CYCLES_PER_MONTH);
    case 'monthly':
      return roundMoney(amount);
    default:
      return 0;
  }
}

/**
 * Summarizes recurring EXPENSE calendar items (subscriptions/bills) into a
 * "$X/month" rollup. Calendar-only (Plan F-MONEY-05 v1): reads recurring
 * templates directly off `CalendarItem`, no transaction cross-referencing.
 *
 * Filters to `isRecurring && frequency && type === 'expense' && !parentRecurringId`
 * — templates only, mirroring the same filter `expandCalendarItems` uses to
 * find recurring templates (paid/deleted instances carry `parentRecurringId`
 * and must never be double-counted here).
 */
export function summarizeRecurringItems(calendarItems: CalendarItem[]): RecurringSpendSummary {
  const templates = calendarItems.filter(
    (item): item is CalendarItem & { frequency: NonNullable<CalendarItem['frequency']> } =>
      Boolean(item.isRecurring) &&
      Boolean(item.frequency) &&
      item.type === 'expense' &&
      !item.parentRecurringId
  );

  const items: RecurringSummaryItem[] = templates
    .map(item => ({
      item,
      monthlyEquivalent: toMonthlyEquivalent(item.amount, item.frequency),
    }))
    .sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);

  const totalMonthly = sumMoney(items.map(i => i.monthlyEquivalent));

  // Recurring ≠ subscription: only explicitly user-flagged items count as
  // subscriptions (F-MONEY-05 human note); the rest are "other recurring bills".
  const subscriptions = items.filter(i => i.item.isSubscription === true);
  const otherBills = items.filter(i => i.item.isSubscription !== true);
  const subscriptionsMonthly = sumMoney(subscriptions.map(i => i.monthlyEquivalent));
  const otherBillsMonthly = sumMoney(otherBills.map(i => i.monthlyEquivalent));

  return { items, totalMonthly, subscriptions, subscriptionsMonthly, otherBills, otherBillsMonthly };
}
