import { Account, CalendarItem, BudgetBucket, Transaction } from '@/types/schema';
import { startOfToday, endOfMonth, parseISO, isAfter, isBefore, addMonths } from 'date-fns';
import { calculateBucketSpent } from './bucketSpentCalculator';
import { expandCalendarItems } from '@/utils/calendarRecurrence';

/**
 * Find the date of the next unpaid paycheck (income calendar item)
 * after the given paycheck date.
 *
 * @param calendarItems - All calendar items from the database
 * @param lastPaycheckDate - The most recent paycheck date (Paycheck A)
 * @returns The date of the next unpaid paycheck, or null if none found
 */
export function findNextPaycheckDate(
  calendarItems: CalendarItem[],
  lastPaycheckDate: string
): string | null {
  const searchWindowEnd = addMonths(parseISO(lastPaycheckDate), 2); // 60-day search window
  const expandedItems = expandCalendarItems(
    calendarItems,
    parseISO(lastPaycheckDate),
    searchWindowEnd
  );

  // Filter for unpaid income items after lastPaycheckDate
  const upcomingPaychecks = expandedItems
    .filter(item => {
      const itemDate = parseISO(item.date);
      return (
        item.type === 'income' &&
        !item.isPaid &&
        isAfter(itemDate, parseISO(lastPaycheckDate))
      );
    })
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  return upcomingPaychecks.length > 0 ? upcomingPaychecks[0].date : null;
}

/**
 * Calculate the safe-to-spend amount based on checking balance and unpaid bills
 * between paychecks. This is the primary financial health metric for the household.
 *
 * Formula: Checking Balance - Unpaid Bills (from last paycheck to next paycheck)
 *
 * @param accounts - All household accounts
 * @param calendarItems - All calendar items (bills/income)
 * @param buckets - All budget buckets (for bill matching only)
 * @param transactions - All transactions (unused, kept for compatibility)
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD), or empty string to return full checking balance
 * @returns The safe-to-spend amount
 */
export const calculateSafeToSpend = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  buckets: BudgetBucket[],
  transactions: Transaction[],
  currentPeriodId: string = ''
): number => {
  // 1. Available Checking Balance (Assets)
  // STRICT: Only Checking. No Savings, No Credit.
  const checkingBalance = accounts
    .filter(a => a.type === 'checking')
    .reduce((sum, a) => sum + a.balance, 0);

  // 2. Determine the bill date range (Paycheck A to Paycheck B)
  // If no paycheck tracking, return full checking balance
  if (!currentPeriodId) {
    return checkingBalance;
  }

  const paycheckA = parseISO(currentPeriodId); // lastPaycheckDate
  const paycheckBDate = findNextPaycheckDate(calendarItems, currentPeriodId);

  let rangeEndDate: Date;
  if (paycheckBDate) {
    rangeEndDate = parseISO(paycheckBDate);
  } else {
    // Fallback: end of current month if no next paycheck found
    rangeEndDate = endOfMonth(paycheckA);
  }

  // 3. Calculate unpaid bills in the range (AFTER paycheck A, up to and including range end)
  // Expand recurring items to ensure all instances in the period are counted
  const expandedItems = expandCalendarItems(calendarItems, paycheckA, rangeEndDate);

  const unpaidBills = expandedItems
    .filter(item => {
      const itemDate = parseISO(item.date);

      // Exclude bills covered by buckets to avoid double-counting
      const isCoveredByBucket = buckets.some(b =>
        item.title.toLowerCase().includes(b.name.toLowerCase()) ||
        b.name.toLowerCase().includes(item.title.toLowerCase())
      );

      return (
        item.type === 'expense' &&
        !item.isPaid &&
        isAfter(itemDate, paycheckA) && // AFTER paycheck A (exclusive)
        (isBefore(itemDate, rangeEndDate) || itemDate.getTime() === rangeEndDate.getTime()) && // Up to range end (inclusive)
        !isCoveredByBucket
      );
    })
    .reduce((sum, item) => sum + item.amount, 0);

  // 4. Final calculation: Checking - Bills (NO bucket liabilities)
  return checkingBalance - unpaidBills;
};
