import type { ToDo, WallEvent } from '@/types/schema';
import { eventsOn } from './wallSelectors';
import { wallTimeText, zonedDateString, zonedParts } from './wallTime';

/**
 * Pure selectors for the wall's calendar screens (docs/plans/wall-display-kiosk.md
 * §3 "Calendar", §4.9). Dates are yyyy-MM-dd strings in the household zone;
 * timed events carry ISO instants and are placed in that zone here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Calendar arithmetic on yyyy-MM-dd strings (UTC noon avoids DST edges). */
export function addDaysTo(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
}

export function weekdayName(date: string): string {
  return WEEKDAYS[weekdayOf(date)] ?? '';
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** "Wednesday, October 7". */
export function longDateText(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${weekdayName(date)}, ${monthName(m ?? 1)} ${d ?? ''}`;
}

/** Fractional hours since local midnight (zoned), e.g. 15.5 for 3:30 pm. */
export function zonedHours(iso: string, timeZone?: string): number {
  const p = zonedParts(new Date(iso), timeZone);
  return p.hour + p.minute / 60;
}

/** "3:30" for an event's start, with the wall's am/pm rule. */
export function eventTimeText(iso: string | undefined, timeZone?: string): string {
  if (!iso) return '';
  const p = zonedParts(new Date(iso), timeZone);
  return wallTimeText(p.hour, p.minute);
}

/** Muted all-day lines get an icon: bills a receipt, holidays a flag. */
export function isMutedLine(e: WallEvent): boolean {
  return e.source === 'bill' || e.source === 'holiday';
}

// ---------------------------------------------------------------------------
// Today panel
// ---------------------------------------------------------------------------

export interface TodayRow {
  event: WallEvent;
  time: string;
  /** Already over: rendered faded. */
  past: boolean;
}

export interface TodayTimeline {
  /** All-day lines (bills, holidays, all-day feed events), muted ones last. */
  allDay: WallEvent[];
  rows: TodayRow[];
  /**
   * Where the amber "now" line goes: before rows[nowIndex]. `rows.length`
   * puts it after the last row; null hides it (nothing left to come, or no
   * timed events at all).
   */
  nowIndex: number | null;
}

export function todayTimeline(events: readonly WallEvent[], today: string, now: Date, timeZone?: string): TodayTimeline {
  const day = eventsOn(events, today);
  const nowMs = now.getTime();
  const timed = day.filter(e => !e.allDay && e.start);
  const rows: TodayRow[] = timed.map(event => {
    const end = Date.parse(event.end ?? event.start ?? '');
    return { event, time: eventTimeText(event.start, timeZone), past: Number.isFinite(end) && end <= nowMs };
  });
  const firstUpcoming = timed.findIndex(e => Date.parse(e.start ?? '') > nowMs);
  // Only mark "now" when it falls between events: before the first one
  // there's nothing past to separate, after the last there's nothing ahead.
  const nowIndex = firstUpcoming > 0 ? firstUpcoming : null;
  const allDay = day.filter(e => e.allDay).sort((a, b) => Number(isMutedLine(a)) - Number(isMutedLine(b)));
  return { allDay, rows, nowIndex };
}

/** Without an end time, an event counts as running for an hour. */
const DEFAULT_EVENT_MS = 60 * 60 * 1000;

export interface TodayFocus {
  /** The hero: the event running now, else the next one to start. */
  lead: TodayRow | null;
  /** True when `lead` has already started. */
  leadIsNow: boolean;
  /** The rest of today after the hero, in start order. */
  later: TodayRow[];
  /** Already over, for the faint "Earlier:" line. */
  earlier: TodayRow[];
}

/**
 * The Week lead's split of today (docs/DECISIONS.md "Wall redesign"): one
 * hero, the rest of the day, and what's already over.
 */
export function todayFocus(timeline: TodayTimeline, now: Date): TodayFocus {
  const nowMs = now.getTime();
  const over = (r: TodayRow) => {
    const start = Date.parse(r.event.start ?? '');
    const end = Date.parse(r.event.end ?? '');
    return Number.isFinite(end) ? end <= nowMs : Number.isFinite(start) && start + DEFAULT_EVENT_MS <= nowMs;
  };
  const earlier = timeline.rows.filter(over);
  const live = timeline.rows.filter(r => !over(r));
  const lead = live[0] ?? null;
  const leadIsNow = !!lead && Date.parse(lead.event.start ?? '') <= nowMs;
  return { lead, leadIsNow, later: live.slice(1), earlier };
}

/** "in 45 min", "in 1 hr 45 min", "in 3 hr": how long until `startMs`. */
export function untilText(startMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.ceil((startMs - nowMs) / 60000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours} hr ${rest} min` : `in ${hours} hr`;
}

/**
 * The Today panel's "Due today" checklist: open overdue and due-today
 * to-dos, plus the ones ticked off today so a tap shows as done instead of
 * vanishing mid-glance.
 */
export function dueTodayChecklist(todos: readonly ToDo[], today: string, timeZone?: string): ToDo[] {
  return todos
    .filter(t => {
      if (t.completeByDate > today) return false;
      if (!t.isCompleted) return true;
      return !!t.completedAt && zonedDateString(new Date(t.completedAt), timeZone) === today;
    })
    .sort((a, b) => a.completeByDate.localeCompare(b.completeByDate) || a.text.localeCompare(b.text));
}

// ---------------------------------------------------------------------------
// Coming up
// ---------------------------------------------------------------------------

export interface ComingUpDay {
  date: string;
  /** "Sun". */
  weekday: string;
  dayOfMonth: number;
  /** "Tomorrow", "Next week" (the first day a week or more out), or null. */
  rel: string | null;
  muted: WallEvent[];
  /** All-day feed events, then timed events in start order. */
  events: WallEvent[];
}

/**
 * The next `days` days after today, skipping empty ones unless `keepEmpty`
 * (the panel's Week list shows every day, so a free day reads as free).
 */
export function groupComingUp(events: readonly WallEvent[], today: string, days = 14, keepEmpty = false): ComingUpDay[] {
  const out: ComingUpDay[] = [];
  let nextWeekLabelled = false;
  for (let i = 1; i <= days; i++) {
    const date = addDaysTo(today, i);
    const day = eventsOn(events, date);
    if (day.length === 0 && !keepEmpty) continue;
    let rel: string | null = null;
    if (i === 1) rel = 'Tomorrow';
    else if (i >= 7 && !nextWeekLabelled) {
      rel = 'Next week';
      nextWeekLabelled = true;
    }
    out.push({
      date,
      weekday: weekdayName(date).slice(0, 3),
      dayOfMonth: Number(date.slice(8, 10)),
      rel,
      muted: day.filter(isMutedLine),
      events: day.filter(e => !isMutedLine(e)),
    });
  }
  return out;
}

/**
 * A Coming up day as the panel draws it: untimed items (all-day events,
 * bills, holidays) fold into one quiet line under the heading, and only
 * timed events get rows. Nothing untimed pretends to have a time.
 */
export function splitComingUpDay(day: ComingUpDay): { untimed: WallEvent[]; timed: WallEvent[] } {
  return {
    untimed: [...day.events.filter(e => e.allDay), ...day.muted],
    timed: day.events.filter(e => !e.allDay),
  };
}

// ---------------------------------------------------------------------------
// Day view
// ---------------------------------------------------------------------------

export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 22;

function eventHours(event: WallEvent, date: string, timeZone?: string): { startH: number; endH: number } {
  const startH = zonedHours(event.start ?? '', timeZone);
  let endH = event.end ? zonedHours(event.end, timeZone) : startH + 1;
  if (event.end && zonedDateString(new Date(event.end), timeZone) !== date) endH = 24;
  return { startH, endH };
}

function isOutsideDayHours(event: WallEvent, date: string, timeZone?: string): boolean {
  const { startH, endH } = eventHours(event, date, timeZone);
  return startH >= DAY_END_HOUR || endH <= DAY_START_HOUR;
}

/**
 * Timed events that start and end outside 7 am–10 pm (an early flight, a late
 * show): Day view lists them, with their times, in the all-day strip rather
 * than drawing them at a slot that doesn't match.
 */
export function outsideDayHours(events: readonly WallEvent[], date: string, timeZone?: string): WallEvent[] {
  return eventsOn(events, date).filter(e => !e.allDay && e.start && isOutsideDayHours(e, date, timeZone));
}

export interface DayBlock {
  event: WallEvent;
  /** Hours from DAY_START_HOUR, clamped to the visible range. */
  top: number;
  height: number;
  /** Side-by-side placement within its overlap cluster. */
  col: number;
  cols: number;
  /** Columns it covers: it widens into free columns to its right. */
  span: number;
  /** Index of its overlap cluster, so a tap can list everything happening alongside it. */
  cluster: number;
}

/**
 * Timed events of one day placed on the 7 am–10 pm timeline. Overlapping
 * events form a cluster and sit side by side in the fewest columns; each then
 * widens into any columns to its right that nothing else uses while it runs
 * (so one long event beside two short ones isn't stuck at a third of the
 * width). An event partly outside the window is clipped at the edge (its label
 * keeps the real times); one entirely outside it is left to `outsideDayHours`.
 */
export function layoutDayBlocks(events: readonly WallEvent[], date: string, timeZone?: string): DayBlock[] {
  const span = DAY_END_HOUR - DAY_START_HOUR;
  const timed = eventsOn(events, date)
    .filter(e => !e.allDay && e.start && !isOutsideDayHours(e, date, timeZone))
    .map(event => {
      const hours = eventHours(event, date, timeZone);
      const startH = hours.startH;
      // A zero/negative span still gets a visible half hour.
      const endH = hours.endH <= startH ? startH + 0.5 : hours.endH;
      const top = Math.min(Math.max(startH - DAY_START_HOUR, 0), span - 0.5);
      const bottom = Math.min(Math.max(endH - DAY_START_HOUR, top + 0.5), span);
      return { event, top, height: bottom - top };
    });

  timed.sort((a, b) => a.top - b.top || b.height - a.height);
  const blocks: DayBlock[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = 0;
  let clusterIndex = 0;
  const flush = () => {
    const colEnds: number[] = [];
    const placed = cluster.map(item => {
      let col = colEnds.findIndex(end => end <= item.top);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = item.top + item.height;
      return { item, col };
    });
    const overlaps = (a: (typeof timed)[number], b: (typeof timed)[number]) => a.top < b.top + b.height && b.top < a.top + a.height;
    for (const { item, col } of placed) {
      let width = 1;
      while (col + width < colEnds.length && !placed.some(o => o.col === col + width && overlaps(o.item, item))) width++;
      blocks.push({ event: item.event, top: item.top, height: item.height, col, cols: colEnds.length, span: width, cluster: clusterIndex });
    }
    clusterIndex++;
    cluster = [];
  };
  for (const item of timed) {
    if (cluster.length > 0 && item.top >= clusterEnd) flush();
    clusterEnd = cluster.length === 0 ? item.top + item.height : Math.max(clusterEnd, item.top + item.height);
    cluster.push(item);
  }
  if (cluster.length > 0) flush();
  return blocks;
}

/** Day view's stand-in for events that don't fit: "+N more" in the last column. */
export interface DayOverflow {
  top: number;
  height: number;
  col: number;
  cols: number;
  cluster: number;
  events: WallEvent[];
}

/** Most events Day view draws side by side; past that, a column is narrower than a title. */
export const DAY_MAX_COLS = 3;

/**
 * Caps a cluster at `max` columns. Every event that would land in the last
 * column or beyond folds into "+N more" chips there, one per run of
 * overlapping hidden events; the rest draw as usual, widening into the last
 * column only while no chip sits there.
 */
export function capDayColumns(blocks: readonly DayBlock[], max = DAY_MAX_COLS): { blocks: DayBlock[]; more: DayOverflow[] } {
  const kept: DayBlock[] = [];
  const hidden = new Map<number, DayBlock[]>();
  for (const b of blocks) {
    if (b.cols <= max || b.col < max - 1) kept.push(b);
    else hidden.set(b.cluster, [...(hidden.get(b.cluster) ?? []), b]);
  }
  const more: DayOverflow[] = [];
  for (const [cluster, list] of hidden) {
    const sorted = [...list].sort((a, b) => a.top - b.top);
    let run: DayOverflow | null = null;
    for (const b of sorted) {
      if (run && b.top < run.top + run.height) {
        run.height = Math.max(run.height, b.top + b.height - run.top);
        run.events.push(b.event);
      } else {
        run = { top: b.top, height: b.height, col: max - 1, cols: max, cluster, events: [b.event] };
        more.push(run);
      }
    }
  }
  const shown = kept.map(b => {
    if (b.cols <= max) return b;
    const chipAlongside = more.some(m => m.cluster === b.cluster && m.top < b.top + b.height && b.top < m.top + m.height);
    const span = Math.min(b.span, (chipAlongside ? max - 1 : max) - b.col);
    return { ...b, cols: max, span };
  });
  return { blocks: shown, more };
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

export const MONTH_LINES_PER_DAY = 3;

export interface MonthCell {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  /** Up to three lines: muted all-day first, then everything else. */
  lines: WallEvent[];
  /** "+N more". */
  more: number;
}

/** The weeks (Sunday first) covering the month of `anyDayInMonth`. */
export function monthCells(anyDayInMonth: string, events: readonly WallEvent[], today: string): MonthCell[] {
  const first = `${anyDayInMonth.slice(0, 7)}-01`;
  const month = first.slice(0, 7);
  const start = addDaysTo(first, -weekdayOf(first));
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDaysTo(start, i);
    // Stop after the week that holds the month's last day.
    if (i % 7 === 0 && i > 0 && date.slice(0, 7) !== month) break;
    const day = eventsOn(events, date);
    const ordered = [...day.filter(isMutedLine), ...day.filter(e => !isMutedLine(e))];
    cells.push({
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      inMonth: date.slice(0, 7) === month,
      isToday: date === today,
      lines: ordered.slice(0, MONTH_LINES_PER_DAY),
      more: Math.max(0, ordered.length - MONTH_LINES_PER_DAY),
    });
  }
  return cells;
}
