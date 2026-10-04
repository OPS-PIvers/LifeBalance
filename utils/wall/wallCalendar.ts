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
 * The next `days` days after today, skipping empty ones. Every event shows
 * (one per line, never truncated): Coming up scrolls.
 */
export function groupComingUp(events: readonly WallEvent[], today: string, days = 14): ComingUpDay[] {
  const out: ComingUpDay[] = [];
  let nextWeekLabelled = false;
  for (let i = 1; i <= days; i++) {
    const date = addDaysTo(today, i);
    const day = eventsOn(events, date);
    if (day.length === 0) continue;
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
}

/**
 * Timed events of one day placed on the 7 am–10 pm timeline. Overlapping
 * events form a cluster and sit side by side in the fewest columns. An event
 * partly outside the window is clipped at the edge (its label keeps the real
 * times); one entirely outside it is left to `outsideDayHours`.
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
    for (const { item, col } of placed) {
      blocks.push({ event: item.event, top: item.top, height: item.height, col, cols: colEnds.length });
    }
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
