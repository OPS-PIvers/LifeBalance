import { parseISO, isSameDay, isAfter } from "date-fns";

/**
 * Port of `utils/paycheckPeriodCalculator.ts` `getPayPeriodForTransaction` into
 * the functions package (the app root can't be imported across the pnpm
 * workspace boundary). Keep in sync with the client version.
 *
 * Returns the period id (== lastPaycheckDate) for a transaction on/after the
 * most recent paycheck, or '' for pre-period / untracked transactions. This is
 * the correct helper — do NOT reuse quickAdd's simplified
 * `lastPaycheckDate || transactionDate`, which mis-scopes pre-period txns.
 */
export function getPayPeriodForTransaction(
  transactionDate: string,
  lastPaycheckDate: string | undefined,
): string {
  if (!lastPaycheckDate) return "";

  const txDate = parseISO(transactionDate);
  const paycheckDate = parseISO(lastPaycheckDate);

  if (isSameDay(txDate, paycheckDate) || isAfter(txDate, paycheckDate)) {
    return lastPaycheckDate;
  }
  return "";
}
