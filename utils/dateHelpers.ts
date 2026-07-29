/**
 * Date helpers for working with calendar dates in the user's *local* timezone.
 *
 * Throughout the app, calendar dates (transaction dates, to-do due dates, etc.)
 * are stored as `yyyy-MM-dd` strings and parsed back with date-fns `parseISO`,
 * which interprets a date-only string as **local** midnight. The matching
 * "today" string must therefore also be computed in local time.
 *
 * `new Date().toISOString().split('T')[0]` returns the date in **UTC**, which is
 * a different calendar day from the user's local day during the evening in
 * western timezones (e.g. 7pm CST is already the next day in UTC). That caused
 * transactions/to-dos created in the evening to be stamped with tomorrow's date
 * — and, for transactions, assigned to the wrong pay period.
 */
import { format, getISOWeeksInYear, setISOWeek, startOfISOWeek } from 'date-fns';

/**
 * Returns the local calendar date as a `yyyy-MM-dd` string.
 *
 * @param date - The date to format. Defaults to now.
 * @returns Local date string, e.g. "2026-06-07".
 *
 * @example
 * getLocalDateString()                       // today, local time
 * getLocalDateString(new Date(2026, 0, 15))  // "2026-01-15"
 */
export const getLocalDateString = (date: Date = new Date()): string =>
  format(date, 'yyyy-MM-dd');

/**
 * Parses an ISO week identifier (e.g. `"2026-W27"`, the doc id used by
 * `WeeklyRecap` — see `functions/src/shared/isoWeek.ts`) into the Monday that
 * starts that week. Returns `null` for a malformed string, and also for a
 * well-formed but out-of-range week (`W00`, or a `W53`/`W54` beyond what the
 * given ISO week-year actually has).
 *
 * Built from Jan 4 of the given year: by the ISO 8601 definition, Jan 4 always
 * falls in week 1 of its *own* ISO week-year, so `setISOWeek` on it lands in
 * the requested week without a separate ISO-week-year adjustment. Verified
 * across the year boundary — `isoWeekStartDate('2026-W01')` resolves to
 * `2025-12-29`, the correct Monday.
 *
 * @example
 * isoWeekStartDate('2026-W27') // Date for 2026-06-29 (Monday)
 * isoWeekStartDate('2026-W01') // Date for 2025-12-29 (Monday, prior calendar year)
 */
export function isoWeekStartDate(isoWeek: string): Date | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) return null;
  const [, yearStr, weekStr] = match;
  const year = Number(yearStr);
  const week = Number(weekStr);
  const jan4 = new Date(year, 0, 4);
  // The regex only validates shape ("W60" matches), not range — date-fns'
  // setISOWeek happily extrapolates an out-of-range week into a later/earlier
  // ISO week-year (e.g. week 60 lands in the following February) instead of
  // failing, so a malformed/hand-edited isoWeek would silently render a
  // confidently wrong date. Reject anything outside the year's actual week
  // count (52 or 53, per ISO 8601) so the documented null-on-malformed
  // contract holds for range as well as shape.
  const weeksInYear = getISOWeeksInYear(jan4);
  if (week < 1 || week > weeksInYear) return null;
  return startOfISOWeek(setISOWeek(jan4, week));
}
