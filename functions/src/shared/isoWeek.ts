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

/**
 * The ISO week identifier of a plain `yyyy-MM-dd` LOCAL date string.
 *
 * The timezone-aware `isoWeekId` above answers "which week is it right now
 * over there?"; this answers "which week does this calendar day belong to?",
 * which is what the weekly ceremony needs once generation moved to Monday
 * morning: the recap covers the week that ENDED on the previous Sunday, and
 * naming it after the generating instant would label it with the brand-new
 * week instead of the one it describes.
 *
 * Parsed with an explicit midnight time component so the string is read as a
 * LOCAL date (a bare "2026-07-05" is parsed as UTC), which is what date-fns'
 * ISO-week helpers then read the fields of.
 */
export function isoWeekIdForDate(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00`);
  const week = getISOWeek(date);
  const weekYear = getISOWeekYear(date);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}
