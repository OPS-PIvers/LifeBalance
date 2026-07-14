import { format, parseISO } from 'date-fns';

/**
 * Formats a `yyyy-MM` month id into a human label like "June 2026".
 *
 * Parses the month as the first of that month (`yyyy-MM-01`) in LOCAL time via
 * date-fns `parseISO` + `format`, so there is no UTC off-by-one. Falls back to
 * the raw input for anything that isn't a clean `yyyy-MM` string.
 */
export function formatMonthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  try {
    return format(parseISO(`${month}-01`), 'MMMM yyyy');
  } catch {
    return month;
  }
}
