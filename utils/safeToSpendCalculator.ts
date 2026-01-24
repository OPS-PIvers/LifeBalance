import { Account, CalendarItem, BudgetBucket } from '@/types/schema';
import { endOfMonth, parseISO, isAfter, isBefore, addMonths } from 'date-fns';
import { expandCalendarItems } from '@/utils/calendarRecurrence';

/**
 * Helper to find the next unpaid income item after a given date from a list of expanded items.
 *
 * @param expandedItems - Pre-expanded calendar items
 * @param afterDate - Date to search after (exclusive)
 * @returns The date of the next unpaid paycheck, or null if none found
 */
function findNextPaycheckFromExpanded(
  expandedItems: CalendarItem[],
  afterDate: Date
): string | null {
  const upcomingPaychecks = expandedItems
    .filter(item => {
      const itemDate = parseISO(item.date);
      return (
        item.type === 'income' &&
        !item.isPaid &&
        isAfter(itemDate, afterDate)
      );
    })
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  return upcomingPaychecks.length > 0 ? upcomingPaychecks[0].date : null;
}

/**
 * Helper to calculate unpaid bills within a date range, excluding bucket-covered items.
 *
 * @param expandedItems - Pre-expanded calendar items
 * @param startDate - Start of the range (exclusive)
 * @param endDate - End of the range (inclusive)
 * @param buckets - Budget buckets for exclusion logic
 * @returns Total amount of unpaid bills in range
 */
function calculateUnpaidBillsInRange(
  expandedItems: CalendarItem[],
  startDate: Date,
  endDate: Date,
  buckets: BudgetBucket[]
): number {
  // ⚡ Bolt Optimization: Pre-calculate lowercased bucket names
  // Prevents calling toLowerCase() N * M times inside the loop
  const normalizedBuckets = buckets.map(b => b.name.toLowerCase());

  return expandedItems
    .filter(item => {
      const itemDate = parseISO(item.date);
      const itemTitleLower = item.title.toLowerCase();

      // Exclude bills covered by buckets to avoid double-counting
      // Optimized check using pre-calculated bucket names
      const isCoveredByBucket = normalizedBuckets.some(bucketName =>
        itemTitleLower.includes(bucketName) ||
        bucketName.includes(itemTitleLower)
      );

      return (
        item.type === 'expense' &&
        !item.isPaid &&
        isAfter(itemDate, startDate) && // AFTER start date (exclusive)
        (isBefore(itemDate, endDate) || itemDate.getTime() === endDate.getTime()) && // Up to range end (inclusive)
        !isCoveredByBucket
      );
    })
    .reduce((sum, item) => sum + item.amount, 0);
}

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
  const parsedLastPaycheckDate = parseISO(lastPaycheckDate);
  const searchWindowEnd = addMonths(parsedLastPaycheckDate, 2); // 60-day search window
  const expandedItems = expandCalendarItems(
    calendarItems,
    parsedLastPaycheckDate,
    searchWindowEnd
  );

  return findNextPaycheckFromExpanded(expandedItems, parsedLastPaycheckDate);
}

/**
 * Calculate the safe-to-spend amount using pre-expanded calendar items.
 * Separating expansion from calculation allows for better performance optimization
 * (memoizing the expansion step) in React contexts.
 *
 * @param accounts - All household accounts
 * @param allExpandedItems - Pre-expanded calendar items (should cover at least 2 months from currentPeriodId)
 * @param buckets - All budget buckets
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD)
 */
export const calculateSafeToSpendFromExpanded = (
  accounts: Account[],
  allExpandedItems: CalendarItem[],
  buckets: BudgetBucket[],
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

  // Find next paycheck (Paycheck B) from the already expanded list
  const paycheckBDate = findNextPaycheckFromExpanded(allExpandedItems, paycheckA);

  let rangeEndDate: Date;
  if (paycheckBDate) {
    rangeEndDate = parseISO(paycheckBDate);
  } else {
    // Fallback: end of current month if no next paycheck found
    rangeEndDate = endOfMonth(paycheckA);
  }

  // 3. Calculate unpaid bills in the range (AFTER paycheck A, up to and including range end)
  const unpaidBills = calculateUnpaidBillsInRange(
    allExpandedItems,
    paycheckA,
    rangeEndDate,
    buckets
  );

  // 4. Final calculation: Checking - Bills (NO bucket liabilities)
  return checkingBalance - unpaidBills;
};

/**
 * Calculate the safe-to-spend amount based on checking balance and unpaid bills
 * between paychecks. This is the primary financial health metric for the household.
 *
 * Formula: Checking Balance - Unpaid Bills (from last paycheck to next paycheck)
 *
 * @param accounts - All household accounts
 * @param calendarItems - All calendar items (bills/income)
 * @param buckets - All budget buckets (for bill matching only)
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD), or empty string to return full checking balance
 * @returns The safe-to-spend amount
 */
export const calculateSafeToSpend = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  buckets: BudgetBucket[],
  currentPeriodId: string = ''
): number => {
  if (!currentPeriodId) {
    return calculateSafeToSpendFromExpanded(accounts, [], buckets, currentPeriodId);
  }

  const paycheckA = parseISO(currentPeriodId);

  // ⚡ Bolt Optimization: Expand items ONCE for a 60-day window
  // This covers the search for the next paycheck (Paycheck B) AND the bills in between.
  // Previously, this function called `findNextPaycheckDate` (which expanded for 60 days)
  // and then called `expandCalendarItems` AGAIN for the determined range.
  // This approach reduces the expensive expansion operation from 2x to 1x.
  const searchWindowEnd = addMonths(paycheckA, 2);
  const allExpandedItems = expandCalendarItems(calendarItems, paycheckA, searchWindowEnd);

  return calculateSafeToSpendFromExpanded(accounts, allExpandedItems, buckets, currentPeriodId);
};
