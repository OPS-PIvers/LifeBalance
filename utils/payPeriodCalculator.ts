import { parseISO, addDays, differenceInDays, format, isBefore, isAfter, isSameDay } from 'date-fns';

export interface PayPeriod {
  periodId: string; // YYYY-MM-DD format of period start
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive)
}

/**
 * Calculate the current pay period based on a bi-weekly schedule
 * @param startDate - Anchor date for the first pay period (YYYY-MM-DD)
 * @returns Current pay period with start and end dates
 */
export function getCurrentPayPeriod(startDate: string): PayPeriod {
  const today = new Date();
  return getPayPeriodForDate(format(today, 'yyyy-MM-dd'), startDate);
}

/**
 * Get the pay period that a specific date falls into
 * @param transactionDate - Date to check (YYYY-MM-DD)
 * @param periodStartDate - Anchor date for the first pay period (YYYY-MM-DD)
 * @returns Pay period containing the transaction date
 */
export function getPayPeriodForDate(transactionDate: string, periodStartDate: string): PayPeriod {
  const txDate = parseISO(transactionDate);
  const anchorDate = parseISO(periodStartDate);

  // If transaction is before the anchor date, return the anchor as earliest period
  if (isBefore(txDate, anchorDate) || isSameDay(txDate, anchorDate)) {
    return {
      periodId: periodStartDate,
      startDate: periodStartDate,
      endDate: format(addDays(anchorDate, 13), 'yyyy-MM-dd'), // 14 days total (0-13)
    };
  }

  // Calculate how many days since anchor
  const daysSinceAnchor = differenceInDays(txDate, anchorDate);

  // Calculate which period (0-indexed) - each period is 14 days
  const periodNumber = Math.floor(daysSinceAnchor / 14);

  // Calculate this period's start date
  const thisStartDate = addDays(anchorDate, periodNumber * 14);
  const thisEndDate = addDays(thisStartDate, 13); // 14 days total

  return {
    periodId: format(thisStartDate, 'yyyy-MM-dd'),
    startDate: format(thisStartDate, 'yyyy-MM-dd'),
    endDate: format(thisEndDate, 'yyyy-MM-dd'),
  };
}

/**
 * Check if a new pay period has started since the last checked date
 * @param lastCheckedDate - The period ID or date last checked (YYYY-MM-DD)
 * @param currentDate - Today's date (YYYY-MM-DD)
 * @param periodStartDate - Anchor date for the first pay period
 * @returns true if we've crossed into a new period
 */
export function hasNewPeriodStarted(
  lastCheckedDate: string,
  currentDate: string,
  periodStartDate: string
): boolean {
  if (!lastCheckedDate) return false;

  const lastPeriod = getPayPeriodForDate(lastCheckedDate, periodStartDate);
  const currentPeriod = getPayPeriodForDate(currentDate, periodStartDate);

  return lastPeriod.periodId !== currentPeriod.periodId;
}

/**
 * Get all pay periods within a date range (useful for reporting)
 * @param startDate - Start of date range (YYYY-MM-DD)
 * @param endDate - End of date range (YYYY-MM-DD)
 * @param periodStartDate - Anchor date for the first pay period
 * @returns Array of pay periods in the range
 */
export function getPayPeriodsInRange(
  startDate: string,
  endDate: string,
  periodStartDate: string
): PayPeriod[] {
  const periods: PayPeriod[] = [];
  const start = parseISO(startDate);
  const end = parseISO(endDate);

  let currentDate = start;
  const seenPeriodIds = new Set<string>();

  while (isBefore(currentDate, end) || isSameDay(currentDate, end)) {
    const period = getPayPeriodForDate(format(currentDate, 'yyyy-MM-dd'), periodStartDate);

    if (!seenPeriodIds.has(period.periodId)) {
      periods.push(period);
      seenPeriodIds.add(period.periodId);
    }

    // Move to next period
    currentDate = addDays(parseISO(period.endDate), 1);
  }

  return periods;
}
