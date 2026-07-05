import { formatInTimeZone } from "date-fns-tz";
import { getISOWeek, getISOWeekYear } from "date-fns";

/**
 * Computes the ISO week identifier (e.g. "2026-W27") for an instant, evaluated
 * IN the given IANA timezone. The instant is first shifted into the timezone's
 * local wall-clock date (via date-fns-tz), then `getISOWeek`/`getISOWeekYear`
 * (date-fns) are applied to that local date — so a household with members in
 * different timezones near a week boundary gets a stable, single week id.
 *
 * ISO weeks start Monday and the year of the week is the ISO week-year (which
 * can differ from the calendar year for late-December/early-January dates).
 */
export function isoWeekId(date: Date, timezone: string): string {
  // Shift the instant into the target timezone's local wall-clock time, then
  // construct a new local Date from those components. date-fns' ISO week
  // helpers operate on a Date's local (host-timezone) fields, so building a
  // Date whose local fields already reflect the target timezone's wall clock
  // lets getISOWeek/getISOWeekYear compute correctly regardless of the host's
  // own timezone (Cloud Functions run in UTC).
  const localParts = formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ss");
  const localDate = new Date(localParts);

  const week = getISOWeek(localDate);
  const weekYear = getISOWeekYear(localDate);

  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}
