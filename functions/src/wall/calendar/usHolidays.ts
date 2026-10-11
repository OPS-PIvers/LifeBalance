/**
 * The wall's built-in US holidays, computed here rather than fetched.
 *
 * The feed used to be Google's public holidays calendar, but Google rate-limits
 * that URL from Cloud Functions addresses (it answered 429 for hours at a
 * time), and the dates are pure arithmetic. The output is an ICS body so it
 * goes through the same `expandIcs` path, row ids and diffing as any feed.
 */
import type { WallWindow } from "./syncLogic";

interface Holiday {
  key: string;
  title: string;
  /** Month 1-12 and day for a fixed date. */
  date: (year: number) => { month: number; day: number };
  /** Federal holidays on a weekend get an observed weekday too. */
  observed?: boolean;
}

/** The `n`th `weekday` (0 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): { month: number; day: number } {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return { month, day: 1 + ((weekday - first + 7) % 7) + (n - 1) * 7 };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return { month, day: lastDay - ((last - weekday + 7) % 7) };
}

/** Gregorian Easter Sunday (the anonymous / Meeus algorithm). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const fixed = (month: number, day: number) => () => ({ month, day });

const HOLIDAYS: Holiday[] = [
  { key: "new-year", title: "New Year's Day", date: fixed(1, 1), observed: true },
  { key: "mlk", title: "Martin Luther King Jr. Day", date: (y) => nthWeekday(y, 1, 1, 3) },
  { key: "valentines", title: "Valentine's Day", date: fixed(2, 14) },
  { key: "presidents", title: "Presidents' Day", date: (y) => nthWeekday(y, 2, 1, 3) },
  { key: "st-patricks", title: "St. Patrick's Day", date: fixed(3, 17) },
  { key: "easter", title: "Easter Sunday", date: easterSunday },
  { key: "mothers", title: "Mother's Day", date: (y) => nthWeekday(y, 5, 0, 2) },
  { key: "memorial", title: "Memorial Day", date: (y) => nthWeekday(y, 5, 1, -1) },
  { key: "fathers", title: "Father's Day", date: (y) => nthWeekday(y, 6, 0, 3) },
  { key: "juneteenth", title: "Juneteenth", date: fixed(6, 19), observed: true },
  { key: "independence", title: "Independence Day", date: fixed(7, 4), observed: true },
  { key: "labor", title: "Labor Day", date: (y) => nthWeekday(y, 9, 1, 1) },
  { key: "indigenous", title: "Indigenous Peoples' Day", date: (y) => nthWeekday(y, 10, 1, 2) },
  { key: "halloween", title: "Halloween", date: fixed(10, 31) },
  { key: "veterans", title: "Veterans Day", date: fixed(11, 11), observed: true },
  { key: "thanksgiving", title: "Thanksgiving", date: (y) => nthWeekday(y, 11, 4, 4) },
  { key: "christmas-eve", title: "Christmas Eve", date: fixed(12, 24) },
  { key: "christmas", title: "Christmas Day", date: fixed(12, 25), observed: true },
  { key: "new-years-eve", title: "New Year's Eve", date: fixed(12, 31) },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface HolidayDate {
  uid: string;
  date: string; // yyyy-MM-dd
  title: string;
}

/** Every holiday (and observed weekday) dated inside the window, in date order. */
export function usHolidaysInWindow(window: WallWindow): HolidayDate[] {
  const first = Number(window.start.slice(0, 4));
  const last = Number(window.end.slice(0, 4));
  const out: HolidayDate[] = [];
  // A year early, so the observed Friday of next New Year's Day can fall on Dec 31.
  for (let year = first - 1; year <= last + 1; year++) {
    for (const h of HOLIDAYS) {
      const { month, day } = h.date(year);
      const date = new Date(Date.UTC(year, month - 1, day));
      out.push({ uid: `us-holiday-${h.key}-${year}`, date: ymd(date), title: h.title });
      const weekday = date.getUTCDay();
      if (h.observed && (weekday === 0 || weekday === 6)) {
        const shifted = new Date(date.getTime() + (weekday === 6 ? -1 : 1) * 86_400_000);
        out.push({ uid: `us-holiday-${h.key}-${year}-observed`, date: ymd(shifted), title: `${h.title} (observed)` });
      }
    }
  }
  return out
    .filter((h) => h.date >= window.start && h.date <= window.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** The holidays in the window as an ICS body, for `expandIcs`. */
export function usHolidaysIcs(window: WallWindow): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LifeBalance//US holidays//EN"];
  for (const h of usHolidaysInWindow(window)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${h.uid}`,
      `DTSTART;VALUE=DATE:${h.date.replace(/-/g, "")}`,
      `SUMMARY:${h.title}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
