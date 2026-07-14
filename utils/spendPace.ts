import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';

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
 * Days remaining is floored at 1 (today counts as at least a 1-day window) so
 * the result is never `Infinity`/division-by-zero.
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
  if (!breakdown.nextPaycheckDate) return null;

  const daysLeft = differenceInCalendarDays(
    parseISO(breakdown.nextPaycheckDate),
    parseISO(today)
  );
  if (daysLeft <= 0) return null;

  // Floor at 1 day to avoid Infinity / a divide-by-near-zero blowup.
  const days = Math.max(1, daysLeft);
  return breakdown.safeToSpend / days;
};

/**
 * Per-bucket variant of {@link calculateDailyPace}: applies the same
 * days-remaining window to a bucket's remaining balance so each row can show
 * "$X/day until payday" alongside the pool-level figure.
 *
 * @param remaining - A bucket's remaining amount (decimal dollars).
 * @param breakdown - The memoized Safe-to-Spend breakdown, used only for its
 *   `nextPaycheckDate`.
 * @param today - Caller-local "today" as `yyyy-MM-dd`.
 * @returns Daily pace in decimal dollars, or `null` when it can't be computed.
 */
export const calculateBucketDailyPace = (
  remaining: number,
  breakdown: Pick<SafeToSpendBreakdown, 'nextPaycheckDate'>,
  today: string = getLocalDateString()
): number | null => {
  if (!breakdown.nextPaycheckDate) return null;

  const daysLeft = differenceInCalendarDays(
    parseISO(breakdown.nextPaycheckDate),
    parseISO(today)
  );
  if (daysLeft <= 0) return null;

  const days = Math.max(1, daysLeft);
  return remaining / days;
};
