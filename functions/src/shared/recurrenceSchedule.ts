import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  format,
  getDaysInMonth,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from "date-fns";

/**
 * Server copy of the schedule math in utils/calendarRecurrence.ts for series
 * that are semi-monthly (twice a month on fixed days) or carry a weekend
 * shift. Plain weekly / bi-weekly / monthly series keep each caller's existing
 * loop. The duplication is forced (functions source can't import `@/`) and is
 * held together by recurrenceSchedule.parity.test.ts, which runs both copies
 * over the same fixtures — change them together.
 */

export type WeekendShift = "before" | "after";

export interface RecurrenceSchedule {
  semiMonthlyDays?: number[];
  weekendShift?: WeekendShift;
}

const MAX_ITERATIONS = 1000;
const MONDAY = 1;
const WEEKEND_SHIFT_PAD_DAYS = 3;

/** Reads the schedule fields off an untyped Firestore doc, dropping bad values. */
export function readRecurrenceSchedule(data: Record<string, unknown>): RecurrenceSchedule {
  const days = data.semiMonthlyDays;
  const shift = data.weekendShift;
  return {
    semiMonthlyDays:
      Array.isArray(days) && days.every((d) => typeof d === "number") ? days : undefined,
    weekendShift: shift === "before" || shift === "after" ? shift : undefined,
  };
}

/** Whether a series must be expanded through this module. */
export function usesScheduledPath(frequency: string, schedule: RecurrenceSchedule): boolean {
  return frequency === "semi-monthly" || schedule.weekendShift !== undefined;
}

export function semiMonthlyDaysFor(anchor: string, stored?: number[]): [number, number] {
  if (
    stored?.length === 2 &&
    stored.every((d) => Number.isInteger(d) && d >= 1 && d <= 31) &&
    stored[0] !== stored[1]
  ) {
    const [a = 1, b = 16] = [...stored].sort((x, y) => x - y);
    return [a, b];
  }
  const anchorDay = parseISO(anchor).getDate();
  return anchorDay <= 15 ? [anchorDay, anchorDay + 15] : [anchorDay - 15, anchorDay];
}

export function shiftForWeekend(date: Date, shift: WeekendShift | undefined): Date {
  if (!shift) return date;
  const day = date.getDay();
  if (day === 6) return shift === "before" ? subDays(date, 1) : addDays(date, 2);
  if (day === 0) return shift === "before" ? subDays(date, 2) : addDays(date, 1);
  return date;
}

function plainOccurrence(anchor: Date, n: number, frequency: string): Date | null {
  switch (frequency) {
    case "weekly":
      return addWeeks(anchor, n);
    case "bi-weekly":
      return addWeeks(anchor, n * 2);
    case "monthly":
      return addMonths(anchor, n);
    default:
      return null;
  }
}

function plainStartIndex(anchor: Date, from: Date, frequency: string): number {
  if (!isBefore(anchor, from)) return 0;
  if (frequency === "weekly" || frequency === "bi-weekly") {
    const weeks = Math.floor(differenceInCalendarWeeks(from, anchor, { weekStartsOn: MONDAY }));
    return Math.max(frequency === "weekly" ? weeks : Math.floor(weeks / 2), 0);
  }
  if (frequency === "monthly") {
    return Math.max(differenceInCalendarMonths(from, anchor), 0);
  }
  return 0;
}

function nominalDates(
  anchorStr: string,
  frequency: string,
  schedule: RecurrenceSchedule,
  from: Date,
  to: Date
): Date[] {
  const anchor = startOfDay(parseISO(anchorStr));
  const out: Date[] = [];
  if (frequency === "semi-monthly") {
    const days = semiMonthlyDaysFor(anchorStr, schedule.semiMonthlyDays);
    let month = startOfMonth(isBefore(anchor, from) ? from : anchor);
    for (let i = 0; i < MAX_ITERATIONS && !isAfter(month, to); i++) {
      const lastDay = getDaysInMonth(month);
      const seen = new Set<number>();
      for (const d of days) {
        const day = Math.min(d, lastDay);
        if (seen.has(day)) continue;
        seen.add(day);
        const date = new Date(month.getFullYear(), month.getMonth(), day);
        if (!isBefore(date, anchor) && !isBefore(date, from) && !isAfter(date, to)) {
          out.push(date);
        }
      }
      month = addMonths(month, 1);
    }
    return out;
  }
  let n = plainStartIndex(anchor, from, frequency);
  for (let i = 0; i < MAX_ITERATIONS; i++, n++) {
    const date = plainOccurrence(anchor, n, frequency);
    if (!date || isAfter(date, to)) break;
    if (!isBefore(date, from)) out.push(date);
  }
  return out;
}

/**
 * Occurrences within [rangeStart, rangeEnd] after the weekend shift, each with
 * the nominal date it was scheduled for (yyyy-MM-dd strings).
 */
export function scheduledOccurrences(
  anchorStr: string,
  frequency: string,
  schedule: RecurrenceSchedule,
  rangeStart: Date,
  rangeEnd: Date
): { date: string; nominalDate: string }[] {
  const pad = schedule.weekendShift ? WEEKEND_SHIFT_PAD_DAYS : 0;
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  const out: { date: string; nominalDate: string }[] = [];
  const seen = new Set<string>();
  for (const nominal of nominalDates(anchorStr, frequency, schedule, subDays(start, pad), addDays(end, pad))) {
    const actual = shiftForWeekend(nominal, schedule.weekendShift);
    if (isBefore(actual, start) || isAfter(actual, end)) continue;
    const date = format(actual, "yyyy-MM-dd");
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, nominalDate: format(nominal, "yyyy-MM-dd") });
  }
  return out;
}
