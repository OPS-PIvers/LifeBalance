import { addDays, format, parseISO } from 'date-fns';
import type { CalendarItem } from '@/types/schema';
import type { PayHalf } from '@/utils/payPeriodHalves';

/** Every date of a half, first to last (the sheet gives each day a row). */
export function halfDates(half: Pick<PayHalf, 'start' | 'end'>): string[] {
  const dates: string[] = [];
  for (let d = parseISO(half.start); format(d, 'yyyy-MM-dd') <= half.end; d = addDays(d, 1)) {
    dates.push(format(d, 'yyyy-MM-dd'));
  }
  return dates;
}

/** The half's bills keyed by due date. */
export function billsByDate(bills: CalendarItem[]): Map<string, CalendarItem[]> {
  const byDate = new Map<string, CalendarItem[]>();
  for (const bill of bills) byDate.set(bill.date, [...(byDate.get(bill.date) ?? []), bill]);
  return byDate;
}

/** One block of the phone's "due days only" list. */
export type PhoneBlock =
  | { kind: 'day'; date: string; bills: CalendarItem[] }
  /** A run of days with nothing due, shown as one thin line. */
  | { kind: 'quiet'; from: string; to: string };

/**
 * The phone layout: each day that has a bill gets a block, and every run of
 * days with nothing due collapses into one `quiet` line. `alwaysShow` keeps a
 * day as its own block even when empty (today, or a day a bill is being added
 * to).
 */
export function phoneBlocks(
  half: Pick<PayHalf, 'start' | 'end'>,
  bills: CalendarItem[],
  alwaysShow: ReadonlySet<string> = new Set()
): PhoneBlock[] {
  const byDate = billsByDate(bills);
  const blocks: PhoneBlock[] = [];
  let quiet: string[] = [];
  const flush = () => {
    const from = quiet[0];
    const to = quiet[quiet.length - 1];
    if (from && to) blocks.push({ kind: 'quiet', from, to });
    quiet = [];
  };
  for (const date of halfDates(half)) {
    const due = byDate.get(date) ?? [];
    if (due.length === 0 && !alwaysShow.has(date)) {
      quiet.push(date);
      continue;
    }
    flush();
    blocks.push({ kind: 'day', date, bills: due });
  }
  flush();
  return blocks;
}

/** "Oct 8–12" for a quiet run, "Oct 4" for a single day. */
export function quietLabel(from: string, to: string): string {
  const start = format(parseISO(from), 'MMM d');
  return from === to ? start : `${start}–${format(parseISO(to), 'd')}`;
}

/** "1st", "2nd", "23rd" — for "+ Add to the 1st". */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}
