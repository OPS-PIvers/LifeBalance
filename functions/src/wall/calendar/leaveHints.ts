/**
 * When to leave for an event, as the event itself says it
 * (docs/plans/wall-display-kiosk.md §12 "Alerts").
 *
 * The wall counts down to leave time. Without help that is the start minus
 * the live route, which gets you there exactly as it starts. An event can say
 * better, and these are read at sync time so the description itself never
 * leaves the server:
 *
 * - Apple Calendar's own Travel Time field (`X-APPLE-TRAVEL-DURATION`).
 * - A line in the description: "leave at 5:15" / "leave by 5:15" (a set time),
 *   "20 min drive" / "drive: 20 min" (the trip), "arrive 15 min early" /
 *   "be there by 4:45" (how early to get there).
 *
 * Free of firebase-admin, so it's unit-testable.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export interface LeaveHints {
  /** A set leave time (ISO with offset): it wins over any trip math. */
  leaveAt?: string;
  /** The trip, in minutes, in place of the measured route. */
  travelMin?: number;
  /** Minutes to arrive before the start, in place of the wall's default. */
  earlyMin?: number;
}

/** A stated leave time this far before the start, at most, is believed. */
const LEAVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_TRAVEL_MIN = 300;
const MAX_EARLY_MIN = 120;
const MAX_DESCRIPTION = 5000;

/** "PT30M", "PT1H15M", "-PT30M" (Apple writes it unsigned), or null. */
export function isoDurationMinutes(raw: unknown): number | null {
  const text = typeof raw === "string" ? raw : raw != null && typeof (raw as { toString?: unknown }).toString === "function" ? String(raw) : "";
  const m = /^-?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(text.trim());
  if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
  const min = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.ceil(Number(m[4] ?? 0) / 60);
  return min >= 1 && min <= MAX_TRAVEL_MIN ? min : null;
}

/** Calendar descriptions arrive as HTML (Google) or text with escapes: plain words, one space apart. */
function plainText(description: string): string {
  return description
    .slice(0, MAX_DESCRIPTION)
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
}

// "1 hr 15 min", "1h15m", "20 minutes", "20min", "90 mins"
const DURATION = String.raw`(?:(\d{1,2})\s*(?:h|hrs?|hours?)\b\s*(?:and\s+)?)?(?:(\d{1,3})\s*(?:m|mins?|minutes?)\b)?`;
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;

function durationOf(hours: string | undefined, minutes: string | undefined): number | null {
  if (!hours && !minutes) return null;
  return Number(hours ?? 0) * 60 + Number(minutes ?? 0);
}

/** The first match of `pattern` (built around DURATION, groups 1–2) that has a number in it. */
function firstDuration(text: string, pattern: string): number | null {
  for (const m of text.matchAll(new RegExp(pattern, "g"))) {
    const min = durationOf(m[1], m[2]);
    if (min !== null) return min;
  }
  return null;
}

/**
 * A clock time in the description as an instant before `startMs` on the
 * event's day. "5:15" with no am/pm is whichever of 5:15 AM / PM falls in the
 * hours before the start; a bare hour ("leave at 5") counts too.
 */
function timeBefore(hourText: string, minuteText: string | undefined, meridiem: string | undefined, startMs: number, timeZone: string): number | null {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (hour < 0 || hour > 23 || minute > 59) return null;
  const date = formatInTimeZone(new Date(startMs), timeZone, "yyyy-MM-dd");
  const at = (h: number): number => fromZonedTime(`${date}T${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, timeZone).getTime();
  const fits = (ms: number): boolean => ms < startMs && startMs - ms <= LEAVE_WINDOW_MS;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.startsWith("p");
    hour = (hour % 12) + (pm ? 12 : 0);
    const ms = at(hour);
    return fits(ms) ? ms : null;
  }
  // 24-hour times (17:15) are what they say; otherwise the latest fit wins.
  const options = hour > 12 || hour === 0 ? [hour] : [hour % 12 + 12, hour % 12];
  for (const h of options) {
    const ms = at(h);
    if (fits(ms)) return ms;
  }
  return null;
}

/** What an event's description says about leaving. `startMs` is the occurrence's start. */
export function parseLeaveHints(description: string | null | undefined, startMs: number, timeZone: string): LeaveHints {
  if (!description || !Number.isFinite(startMs)) return {};
  const text = plainText(description);
  const hints: LeaveHints = {};

  // "leave at 5:15", "leave by 5:15 pm", "leave home at 5", "leave the house by 17:15", "depart at 5:15"
  const leave = new RegExp(String.raw`\b(?:leave|leaving|depart|head out|out the door)(?:\s+(?:home|the house))?\s+(?:at|by|@)\s*${TIME}(?![\d:])`).exec(text);
  if (leave?.[1]) {
    const ms = timeBefore(leave[1], leave[2], leave[3], startMs, timeZone);
    if (ms !== null) hints.leaveAt = formatInTimeZone(new Date(ms), timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  // "20 min drive", "a 1 hr 15 min drive", "25 minutes away" — or "drive: 20 min", "travel time 20 minutes"
  const trip =
    firstDuration(text, String.raw`${DURATION}\s+(?:drive|walk|ride|bike ride|trip|commute|away)\b`) ??
    firstDuration(text, String.raw`\b(?:drive time|drive|travel time|travel|commute|walk)\s*(?:is|of|:|-|=)?\s*(?:about|~|approx\.?)?\s*${DURATION}`);
  if (trip !== null && trip >= 1 && trip <= MAX_TRAVEL_MIN) hints.travelMin = trip;

  // "arrive 15 min early", "be there 10 minutes early", "15 min early" — or "arrive by 4:45", "be there at 4:45"
  const earlyMin = firstDuration(text, String.raw`${DURATION}\s+(?:early|before(?: it starts| the start| start)?)\b`);
  if (earlyMin !== null && earlyMin <= MAX_EARLY_MIN) {
    hints.earlyMin = earlyMin;
  } else {
    const arrive = new RegExp(String.raw`\b(?:arrive|arrival|be there|get there|check[ -]?in|warm[ -]?ups?)\s*(?:at|by|@|:)\s*${TIME}(?![\d:])`).exec(text);
    if (arrive?.[1]) {
      const ms = timeBefore(arrive[1], arrive[2], arrive[3], startMs, timeZone);
      const min = ms === null ? null : Math.round((startMs - ms) / 60_000);
      if (min !== null && min <= MAX_EARLY_MIN) hints.earlyMin = min;
    }
  }
  return hints;
}
