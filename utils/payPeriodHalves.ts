import { addMonths, differenceInCalendarDays, endOfMonth, format, parseISO } from 'date-fns';

/**
 * One "half": half a calendar month, the 1st–15th or the 16th–last day. This
 * is how the household budgets (each month of their sheet is two halves).
 * Its id is its first day (`yyyy-MM-01` or `yyyy-MM-16`), which is also the
 * HalfPlan id.
 *
 * Bills fall in a half by due date. A paycheck FUNDS a half: the one whose
 * first day it lands closest to, so the paycheck that arrives the 27th–30th
 * pays for the 1st–15th that follows, and the one around the 15th pays for
 * the 16th–end (see `fundedHalfId`). The paycheck schedule itself can be
 * anything: twice a month, shifted for weekends, every other week.
 */
export interface PayHalf {
  id: string;
  /** First day, inclusive. */
  start: string;
  /** Last day, inclusive. */
  end: string;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** The half a date falls in. */
export function halfOf(date: string): PayHalf {
  const d = parseISO(date);
  const month = date.slice(0, 7);
  return d.getDate() <= 15
    ? { id: `${month}-01`, start: `${month}-01`, end: `${month}-15` }
    : { id: `${month}-16`, start: `${month}-16`, end: iso(endOfMonth(d)) };
}

/** Every half from the first month to the last (yyyy-MM, inclusive), in order. */
export function halvesBetween(firstMonth: string, lastMonth: string): PayHalf[] {
  const halves: PayHalf[] = [];
  for (let m = parseISO(`${firstMonth}-01`); format(m, 'yyyy-MM') <= lastMonth; m = addMonths(m, 1)) {
    const month = format(m, 'yyyy-MM');
    halves.push(halfOf(`${month}-01`), halfOf(`${month}-16`));
  }
  return halves;
}

/**
 * The half a paycheck (or any income) pays for: the half whose first day the
 * date is closest to. Sep 27 and Sep 30 fund Oct 1–15; Oct 14 and Oct 16 fund
 * Oct 16–31; a bonus on Oct 8 funds the half it sits in.
 */
export function fundedHalfId(date: string): string {
  const d = parseISO(date);
  const month = date.slice(0, 7);
  const next = format(addMonths(parseISO(`${month}-01`), 1), 'yyyy-MM');
  const prev = format(addMonths(parseISO(`${month}-01`), -1), 'yyyy-MM');
  const starts = [`${prev}-16`, `${month}-01`, `${month}-16`, `${next}-01`];
  let best = starts[0] ?? date;
  let bestGap = Infinity;
  for (const start of starts) {
    const gap = Math.abs(differenceInCalendarDays(parseISO(start), d));
    if (gap < bestGap) {
      best = start;
      bestGap = gap;
    }
  }
  return best;
}

/** A half's date span for headings, e.g. "Oct 1 – 15" or "Oct 16 – 31". */
export function halfTitle(half: { start: string; end: string }): string {
  const start = parseISO(half.start);
  const end = parseISO(half.end);
  return `${format(start, 'MMM d')} – ${format(end, start.getMonth() === end.getMonth() ? 'd' : 'MMM d')}`;
}
