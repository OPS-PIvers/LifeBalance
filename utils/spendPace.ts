import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';

/**
 * Number of days remaining until `nextPaycheckDate`, or `null` when there's
 * no known next paycheck date, or when that date is today or in the past (no
 * meaningful "days remaining" window). Callers can compute this once and
 * reuse it across the pool-level pace and every bucket row instead of
 * re-parsing dates on each call.
 *
 * @param nextPaycheckDate - `yyyy-MM-dd`, or `null`/`undefined` if unknown.
 * @param today - Caller-local "today" as `yyyy-MM-dd` (defaults to
 *   `getLocalDateString()`), for parity with other date-aware helpers and
 *   deterministic tests.
 * @returns Whole days remaining (always ≥ 1), or `null` when it can't be computed.
 */
export const getDaysLeft = (
  nextPaycheckDate: string | null | undefined,
  today: string = getLocalDateString()
): number | null => {
  if (!nextPaycheckDate) return null;

  const daysLeft = differenceInCalendarDays(parseISO(nextPaycheckDate), parseISO(today));
  return daysLeft > 0 ? daysLeft : null;
};

/**
 * Derived "safe daily spend" pace: the Safe-to-Spend pool divided by the
 * number of days remaining until the next paycheck. Pure display math — never
 * writes anywhere, never touches the Safe-to-Spend formula itself (F-MONEY-02).
 *
 * Returns `null` when there's no known next paycheck date, or when that date
 * is today or in the past (no meaningful "days remaining" window) — callers
 * should hide the pace line in that case rather than show a nonsensical
 * figure.
 *
 * @param breakdown - The memoized Safe-to-Spend breakdown (checkingBalance,
 *   unpaidBills, pendingSpend, safeToSpend, nextPaycheckDate).
 * @param today - Caller-local "today" as `yyyy-MM-dd` (defaults to
 *   `getLocalDateString()`), for parity with other date-aware helpers and
 *   deterministic tests.
 * @returns Daily pace in decimal dollars, or `null` when it can't be computed.
 */
export const calculateDailyPace = (
  breakdown: Pick<SafeToSpendBreakdown, 'safeToSpend' | 'nextPaycheckDate'>,
  today: string = getLocalDateString()
): number | null => {
  const daysLeft = getDaysLeft(breakdown.nextPaycheckDate, today);
  if (daysLeft === null) return null;
  return breakdown.safeToSpend / daysLeft;
};

/**
 * Per-bucket variant of {@link calculateDailyPace}: applies the same
 * days-remaining window to a bucket's remaining balance so each row can show
 * "$X/day until payday" alongside the pool-level figure. Takes a
 * pre-computed `daysLeft` (see {@link getDaysLeft}) rather than the whole
 * breakdown so a render loop over N buckets doesn't re-parse dates N times.
 *
 * @param remaining - A bucket's remaining amount (decimal dollars).
 * @param daysLeft - Pre-computed days remaining until the next paycheck
 *   (from {@link getDaysLeft}), or `null` when it can't be computed.
 * @returns Daily pace in decimal dollars, or `null` when it can't be computed.
 */
export const calculateBucketDailyPace = (
  remaining: number,
  daysLeft: number | null
): number | null => {
  if (daysLeft === null) return null;
  return remaining / daysLeft;
};
