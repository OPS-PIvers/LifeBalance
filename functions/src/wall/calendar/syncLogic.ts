/**
 * Pure pieces of the wall calendar sync (docs/plans/wall-display-kiosk.md §4.5):
 * the date window, the bills projection, staleness, and the event-index diff.
 *
 * The event index is what keeps a 15-minute sync cheap. For each set of rows
 * (one feed, or the bills), the server-only secret doc stores a compact
 * `id → content hash` index of what it last wrote. A sync recomputes the rows,
 * diffs them against that index, and writes only the changes, so an unchanged
 * feed costs one doc read and no `wallEvents` reads at all.
 */
import { createHash } from "crypto";
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, subMonths } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { findBillsDueOnDate, type BillCalendarItem } from "../../shared/bills";
import { eventRowId, isIanaZone, type WallEventRow } from "./icsParse";

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const MANUAL_SYNC_COOLDOWN_MS = 2 * 60 * 1000;
export const MAX_FEEDS_PER_HOUSEHOLD = 20;
export const DEFAULT_WALL_TIME_ZONE = "America/Chicago";
export const HOLIDAYS_FEED_ID = "holidays";
/** Google's public US holidays calendar. */
export const US_HOLIDAYS_ICS_URL =
  "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics";
/** `calendarFeedSecrets/{id}` doc that holds the bills' event index (server-only collection). */
export const BILLS_INDEX_ID = "_bills";

export interface WallWindow {
  start: string; // yyyy-MM-dd
  end: string;
}

/** First day of the previous month through the end of the month three months out, in `timeZone`. */
export function wallWindow(now: Date, timeZone: string): WallWindow {
  const today = parseISO(formatInTimeZone(now, timeZone, "yyyy-MM-dd"));
  return {
    start: format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"),
    end: format(endOfMonth(addMonths(today, 3)), "yyyy-MM-dd"),
  };
}

export function resolveTimeZone(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.includes("/") && isIanaZone(c)) return c;
  }
  return DEFAULT_WALL_TIME_ZONE;
}

/**
 * Identifies what a feed's rows were computed against. When it changes (the
 * window rolled into a new month, the zone or owner changed), a 304 from the
 * feed server isn't enough: the rows must be recomputed.
 */
export function syncKey(window: WallWindow, timeZone: string, ownerKey: string): string {
  return `${window.start}|${window.end}|${timeZone}|${ownerKey}`;
}

export interface BillItem extends BillCalendarItem {
  title?: string;
  type?: string;
}

/**
 * The wall's bill lines: one all-day row per unpaid expense occurrence in the
 * window. Title and date only. Amounts, accounts and buckets never leave the
 * finance collections, because a display can read `wallEvents`.
 */
export function projectBillRows(items: BillItem[], window: WallWindow): WallEventRow[] {
  // Instance docs (paid/deleted occurrences) carry no type of their own; keep
  // them so they still suppress their template's occurrence.
  const relevant = items.filter((i) => i.parentRecurringId || i.type === "expense");
  const titles = new Map(relevant.map((i) => [i.id, typeof i.title === "string" ? i.title.trim().slice(0, 200) : ""]));
  const rows: WallEventRow[] = [];
  for (let day = parseISO(window.start); ; day = addDays(day, 1)) {
    const date = format(day, "yyyy-MM-dd");
    if (date > window.end) break;
    for (const bill of findBillsDueOnDate(relevant, date)) {
      rows.push({
        id: eventRowId("bill", bill.id, date),
        source: "bill",
        ownerKey: "family",
        title: titles.get(bill.id) || "Bill",
        allDay: true,
        date,
      });
    }
  }
  return rows;
}

/** Hash of the fields a wall shows, so unchanged rows aren't rewritten. */
export function rowHash(row: WallEventRow): string {
  const { id: _id, ...rest } = row;
  const ordered = Object.keys(rest)
    .sort()
    .map((k) => [k, (rest as Record<string, unknown>)[k]]);
  return createHash("sha1").update(JSON.stringify(ordered)).digest("base64").slice(0, 12);
}

export type EventIndex = Record<string, string>;

export function parseEventIndex(raw: unknown): EventIndex | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const index: EventIndex = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") index[k] = v;
    return index;
  } catch {
    return null;
  }
}

export interface EventDiff {
  upserts: WallEventRow[];
  deletes: string[];
  index: EventIndex;
}

export function diffEvents(previous: EventIndex, rows: WallEventRow[]): EventDiff {
  const index: EventIndex = {};
  const upserts: WallEventRow[] = [];
  for (const row of rows) {
    const hash = rowHash(row);
    index[row.id] = hash;
    if (previous[row.id] !== hash) upserts.push(row);
  }
  const deletes = Object.keys(previous).filter((id) => !(id in index));
  return { upserts, deletes, index };
}

/** Whether a feed should flip to stale now (and its admins be told once). */
export function shouldMarkStale(lastSuccessAtMs: number | null, createdAtMs: number | null, alreadyStale: boolean, now: number): boolean {
  if (alreadyStale) return false;
  const since = lastSuccessAtMs ?? createdAtMs;
  return since !== null && now - since > STALE_AFTER_MS;
}

/** Strips undefined fields: Firestore rejects them. */
export function toEventDoc(row: WallEventRow): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
}
