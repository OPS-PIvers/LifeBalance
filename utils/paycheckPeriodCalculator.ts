import { parseISO, isSameDay, isAfter } from 'date-fns';

/**
 * Determines which pay period a transaction belongs to based on paycheck approval dates.
 *
 * In the paycheck-triggered system, pay periods are defined by paycheck approvals,
 * not by fixed calendar dates. Transactions belong to the current period if they
 * occur on or after the most recent paycheck date.
 *
 * @param transactionDate - Transaction date in YYYY-MM-DD format
 * @param lastPaycheckDate - Date of most recent approved paycheck, or undefined if none
 * @returns Period ID (YYYY-MM-DD matching lastPaycheckDate) or empty string if no tracking
 *
 * @example
 * // Paycheck approved on 2024-01-15
 * getPayPeriodForTransaction('2024-01-15', '2024-01-15') // '2024-01-15'
 * getPayPeriodForTransaction('2024-01-20', '2024-01-15') // '2024-01-15'
 * getPayPeriodForTransaction('2024-01-10', '2024-01-15') // '' (before current period)
 * getPayPeriodForTransaction('2024-01-20', undefined)    // '' (no tracking)
 */
export function getPayPeriodForTransaction(
  transactionDate: string,
  lastPaycheckDate: string | undefined
): string {
  // No period tracking if no paycheck has been approved yet
  if (!lastPaycheckDate) return '';

  const txDate = parseISO(transactionDate);
  const paycheckDate = parseISO(lastPaycheckDate);

  // Transactions on or after the paycheck belong to the current period
  if (isSameDay(txDate, paycheckDate) || isAfter(txDate, paycheckDate)) {
    return lastPaycheckDate;
  }

  // Transactions before the current paycheck are outside the current period
  // (Historical transactions from previous periods)
  return '';
}
