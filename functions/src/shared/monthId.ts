import { formatInTimeZone } from "date-fns-tz";

/**
 * Computes the calendar month identifier (e.g. "2026-06") for an instant,
 * evaluated IN the given IANA timezone. Mirrors `isoWeek.ts`'s approach: the
 * instant is formatted directly into the timezone's local `yyyy-MM`, so a
 * household with members in different timezones near a month boundary gets a
 * stable month id.
 */
export function monthId(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM");
}

/**
 * The calendar month immediately BEFORE the month containing `date` (in the
 * given timezone), as a "yyyy-MM" id. The monthly money recap generated on the
 * 1st covers the month that just completed, so this is the recap's month id.
 */
export function priorMonthId(date: Date, timezone: string): string {
  const [y, m] = monthId(date, timezone).split("-").map(Number);
  const year = y ?? 1970;
  const month = m ?? 1; // 1-12
  const priorYear = month === 1 ? year - 1 : year;
  const priorMonth = month === 1 ? 12 : month - 1;
  return `${priorYear}-${String(priorMonth).padStart(2, "0")}`;
}

/** The month id one before `month` ("yyyy-MM" → "yyyy-MM"). */
export function subtractOneMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const year = y ?? 1970;
  const mo = m ?? 1;
  const priorYear = mo === 1 ? year - 1 : year;
  const priorMonth = mo === 1 ? 12 : mo - 1;
  return `${priorYear}-${String(priorMonth).padStart(2, "0")}`;
}

/** Inclusive first/last `yyyy-MM-dd` day of a "yyyy-MM" month. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const year = y ?? 1970;
  const mo = m ?? 1;
  const start = `${month}-01`;
  // Day 0 of the next month is the last day of THIS month.
  const lastDay = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}
