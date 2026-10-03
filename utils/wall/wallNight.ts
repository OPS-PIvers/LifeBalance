/**
 * Night window for the wall display (docs/plans/wall-display-kiosk.md §4.8).
 * Pure: the caller supplies `now` and the household's IANA time zone, so the
 * answer doesn't depend on the iPad's own clock settings.
 */

/** 'HH:mm' 24-hour bounds. `start` is inclusive, `end` exclusive. */
export interface NightWindow {
  start: string;
  end: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for an 'HH:mm' string, or null when malformed. */
export function parseHhmm(value: string): number | null {
  const match = HHMM_RE.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes after local midnight in `timeZone` (0–1439). */
export function minutesInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  // Some engines still report midnight as "24" under h23.
  return (hour % 24) * 60 + minute;
}

/**
 * True inside the night window. Handles windows that cross midnight
 * (22:00–06:00) as well as same-day ones (13:00–15:00). Equal or malformed
 * bounds mean "no night", so a bad setting can never black out the wall.
 */
export function isNight(now: Date, night: NightWindow, timeZone: string): boolean {
  const start = parseHhmm(night.start);
  const end = parseHhmm(night.end);
  if (start === null || end === null || start === end) return false;
  const minute = minutesInZone(now, timeZone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
