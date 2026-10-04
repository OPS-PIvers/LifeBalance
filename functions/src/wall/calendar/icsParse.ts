/**
 * Pure ICS → wall event expansion (docs/plans/wall-display-kiosk.md §4.5).
 *
 * Turns one calendar file into the `wallEvents` rows the wall shows inside a
 * date window: recurring series are expanded (RRULE, EXDATE, RECURRENCE-ID
 * overrides, cancelled occurrences), timed events are converted to the
 * household's time zone, and all-day events get one row per day they span.
 *
 * Time zones are resolved from each property's TZID with date-fns-tz (ICU),
 * NOT through ical.js's process-global TimezoneService: a scheduled run syncs
 * many households' feeds in one instance, and a registry shared between them
 * would let one feed's VTIMEZONE redefine another's zone. A TZID that isn't
 * an IANA name (Outlook writes "Central Standard Time") falls back to the
 * file's own VTIMEZONE block, evaluated locally.
 *
 * Free of firebase-admin, so it's unit-testable on fixtures.
 */
import ICAL from "ical.js";
import { createHash } from "crypto";
import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type WallEventSource = "feed" | "bill" | "holiday";

/** A `wallEvents/{id}` document as the server writes it. */
export interface WallEventRow {
  id: string;
  source: WallEventSource;
  feedId?: string;
  ownerKey: string;
  title: string;
  allDay: boolean;
  date: string; // yyyy-MM-dd in the household zone
  start?: string; // ISO with offset, timed only
  end?: string;
  location?: string;
}

export interface ExpandOptions {
  feedId: string;
  ownerKey: string;
  source: "feed" | "holiday";
  /** Household IANA zone; timed events land on this zone's dates. */
  timeZone: string;
  /** Inclusive yyyy-MM-dd bounds, in the household zone. */
  windowStart: string;
  windowEnd: string;
  maxRows?: number;
}

export interface ExpandResult {
  rows: WallEventRow[];
  /** True when the row cap cut the feed short. */
  truncated: boolean;
}

export const MAX_ROWS_PER_FEED = 2000;
/** Steps one series may take through its recurrence before giving up. */
const MAX_SERIES_STEPS = 20_000;
/** An all-day event longer than this is clipped (a "semester" block). */
const MAX_ALL_DAY_SPAN_DAYS = 62;
const MAX_TEXT = 200;

export class IcsParseError extends Error {}

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTimezone = InstanceType<typeof ICAL.Timezone>;

/** Windows zone names Outlook/Exchange write in TZID, for the common US zones. */
const WINDOWS_ZONES: Record<string, string> = {
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
};

const ianaCache = new Map<string, boolean>();
export function isIanaZone(zone: string): boolean {
  const hit = ianaCache.get(zone);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    ok = true;
  } catch {
    ok = false;
  }
  ianaCache.set(zone, ok);
  return ok;
}

/** Maps a raw TZID onto an IANA zone, or null when it isn't one we know. */
export function normalizeTzid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tzid = raw.trim().replace(/^"|"$/g, "");
  if (!tzid) return null;
  if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid] ?? null;
  if (isIanaZone(tzid) && tzid.includes("/")) return tzid;
  // Vendor prefixes like "/mozilla.org/20050126_1/America/New_York".
  const tail = /([A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/.exec(tzid)?.[1];
  if (tail && isIanaZone(tail)) return tail;
  if (isIanaZone(tzid)) return tzid; // "UTC", "GMT"
  return null;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

function wallClock(t: IcalTime): string {
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

function dateOnly(t: IcalTime): string {
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
}

/** Everything needed to turn an occurrence's wall-clock time into an instant. */
interface ZoneContext {
  householdZone: string;
  vtimezones: Map<string, IcalTimezone>;
}

/**
 * The absolute instant of a DATE-TIME. `tzid` is the TZID parameter of the
 * property the time came from (the master's for expanded occurrences, the
 * override's for a RECURRENCE-ID override).
 */
function toInstant(t: IcalTime, tzid: string | null, ctx: ZoneContext): Date {
  if (t.zone?.tzid === "UTC") return new Date(`${wallClock(t)}Z`);
  const iana = normalizeTzid(tzid);
  if (iana) return fromZonedTime(wallClock(t), iana);
  const vtz = tzid ? ctx.vtimezones.get(tzid.trim().replace(/^"|"$/g, "")) : undefined;
  if (vtz) {
    const asUtc = Date.parse(`${wallClock(t)}Z`);
    return new Date(asUtc - vtz.utcOffset(t) * 1000);
  }
  // Floating time (no zone at all): it means "this wall-clock time wherever
  // you are", so read it in the household's zone.
  return fromZonedTime(wallClock(t), ctx.householdZone);
}

function tzidOf(component: IcalComponent, prop: "dtstart" | "dtend"): string | null {
  const value = component.getFirstProperty(prop)?.getParameter("tzid");
  return typeof value === "string" ? value : null;
}

function cleanText(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
}

function isCancelled(component: IcalComponent): boolean {
  const status = component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function isPrivate(component: IcalComponent): boolean {
  const cls = component.getFirstPropertyValue("class");
  return typeof cls === "string" && (cls.toUpperCase() === "PRIVATE" || cls.toUpperCase() === "CONFIDENTIAL");
}

export function eventRowId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex");
}

interface Occurrence {
  item: IcalEvent;
  start: IcalTime;
  end: IcalTime;
  /** Stable key for this occurrence within its series. */
  recurrenceKey: string;
}

/** Rows for one occurrence, clipped to the window. */
function rowsFor(occ: Occurrence, uid: string, opts: ExpandOptions, ctx: ZoneContext): WallEventRow[] {
  const component = occ.item.component;
  if (isCancelled(component)) return [];
  const hidden = isPrivate(component);
  const title = hidden ? "Busy" : cleanText(occ.item.summary) || "(No title)";
  const location = hidden ? "" : cleanText(occ.item.location);
  const base = {
    source: opts.source,
    feedId: opts.feedId,
    ownerKey: opts.ownerKey,
    title,
    ...(location ? { location } : {}),
  };

  if (occ.start.isDate) {
    const first = dateOnly(occ.start);
    // DTEND is exclusive for all-day events; a missing or non-advancing end means one day.
    const endExclusive = occ.end.isDate ? dateOnly(occ.end) : first;
    const rows: WallEventRow[] = [];
    let day = parseISO(first);
    for (let i = 0; i < MAX_ALL_DAY_SPAN_DAYS; i++) {
      const date = format(day, "yyyy-MM-dd");
      if (i > 0 && date >= endExclusive) break;
      if (date > opts.windowEnd) break;
      if (date >= opts.windowStart) {
        rows.push({ ...base, id: eventRowId(opts.feedId, uid, occ.recurrenceKey, date), allDay: true, date });
      }
      day = addDays(day, 1);
    }
    return rows;
  }

  const start = toInstant(occ.start, tzidOf(component, "dtstart"), ctx);
  const endTzid = component.hasProperty("dtend") ? tzidOf(component, "dtend") : tzidOf(component, "dtstart");
  let end = occ.end.isDate ? start : toInstant(occ.end, endTzid, ctx);
  if (end.getTime() < start.getTime()) end = start;
  const date = formatInTimeZone(start, ctx.householdZone, "yyyy-MM-dd");
  if (date < opts.windowStart || date > opts.windowEnd) return [];
  const iso = (d: Date): string => formatInTimeZone(d, ctx.householdZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return [
    {
      ...base,
      id: eventRowId(opts.feedId, uid, occ.recurrenceKey),
      allDay: false,
      date,
      start: iso(start),
      ...(end.getTime() > start.getTime() ? { end: iso(end) } : {}),
    },
  ];
}

/**
 * Upper bound for walking a series: the window end plus a month, so an
 * override that moves an occurrence from just past the window back into it
 * is still seen.
 */
function iterationLimit(windowEnd: string): string {
  return format(addDays(parseISO(windowEnd), 31), "yyyy-MM-dd");
}

/** Lower bound: an occurrence starting this early can't reach the window (span cap). */
function iterationFloor(windowStart: string): string {
  return format(addDays(parseISO(windowStart), -MAX_ALL_DAY_SPAN_DAYS), "yyyy-MM-dd");
}

/** Parses an ICS document and expands it into wall rows inside the window. */
export function expandIcs(text: string, opts: ExpandOptions): ExpandResult {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new IcsParseError("That link isn't a calendar file.");
  }
  let root: IcalComponent;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new IcsParseError("That calendar file couldn't be read.");
  }

  const ctx: ZoneContext = { householdZone: opts.timeZone, vtimezones: new Map() };
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      const zone = new ICAL.Timezone(vtz);
      if (zone.tzid) ctx.vtimezones.set(zone.tzid, zone);
    } catch {
      // A malformed VTIMEZONE only affects events that use it; they fall back to floating.
    }
  }

  // Group by UID: the master (no RECURRENCE-ID) plus its overrides.
  const masters = new Map<string, IcalEvent>();
  const overrides = new Map<string, IcalEvent[]>();
  for (const vevent of root.getAllSubcomponents("vevent")) {
    let event: IcalEvent;
    try {
      event = new ICAL.Event(vevent);
    } catch {
      continue;
    }
    if (!event.startDate) continue;
    const uid = event.uid || eventRowId("nouid", vevent.toString());
    if (event.isRecurrenceException()) {
      const list = overrides.get(uid) ?? [];
      list.push(event);
      overrides.set(uid, list);
    } else if (!masters.has(uid)) {
      masters.set(uid, event);
    }
  }

  const maxRows = opts.maxRows ?? MAX_ROWS_PER_FEED;
  const rows: WallEventRow[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const push = (more: WallEventRow[]): boolean => {
    for (const row of more) {
      if (seen.has(row.id)) continue;
      if (rows.length >= maxRows) {
        truncated = true;
        return false;
      }
      seen.add(row.id);
      rows.push(row);
    }
    return true;
  };

  const limit = iterationLimit(opts.windowEnd);
  const floor = iterationFloor(opts.windowStart);

  outer: for (const [uid, master] of masters) {
    for (const ex of overrides.get(uid) ?? []) {
      try {
        master.relateException(ex);
      } catch {
        // An override that doesn't belong to this series is ignored.
      }
    }
    overrides.delete(uid);

    if (!master.isRecurring()) {
      const occ = { item: master, start: master.startDate, end: master.endDate ?? master.startDate, recurrenceKey: "" };
      if (!push(rowsFor(occ, uid, opts, ctx))) break;
      continue;
    }

    let iterator: ReturnType<IcalEvent["iterator"]>;
    try {
      iterator = master.iterator();
    } catch {
      continue;
    }
    for (let step = 0; step < MAX_SERIES_STEPS; step++) {
      let next: IcalTime | null;
      try {
        next = iterator.next();
      } catch {
        break;
      }
      if (!next) break;
      const key = dateOnly(next);
      if (key > limit) break;
      if (key < floor) continue;
      const details = master.getOccurrenceDetails(next);
      const occ: Occurrence = {
        item: details.item,
        start: details.startDate,
        end: details.endDate ?? details.startDate,
        recurrenceKey: details.recurrenceId.toString(),
      };
      if (!push(rowsFor(occ, uid, opts, ctx))) break outer;
    }
  }

  // Overrides whose master isn't in the file (Google sometimes exports only
  // the moved instance of a shared series): show them as single events.
  if (!truncated) {
    for (const [uid, list] of overrides) {
      for (const ex of list) {
        const occ: Occurrence = {
          item: ex,
          start: ex.startDate,
          end: ex.endDate ?? ex.startDate,
          recurrenceKey: ex.recurrenceId?.toString() ?? "",
        };
        if (!push(rowsFor(occ, uid, opts, ctx))) break;
      }
    }
  }

  rows.sort((a, b) => (a.date === b.date ? (a.start ?? "").localeCompare(b.start ?? "") : a.date.localeCompare(b.date)));
  return { rows, truncated };
}
