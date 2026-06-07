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
import { format } from 'date-fns';

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
