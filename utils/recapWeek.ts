/**
 * ISO-week arithmetic for the CLIENT-SIDE recap derivation (ARCH-1). The
 * server (`functions/src/shared/isoWeek.ts`, protected — a parallel PR owns
 * it) computes the ISO week a Cloud Function's UTC clock falls in; this
 * module answers the client's version of the same question purely off
 * `yyyy-MM-dd` local date strings, using `getLocalDateString()`/browser-local
 * time like every other "today" computation in this app (see CLAUDE.md's
 * Dates section) rather than a member's stored server-side timezone.
 *
 * `shiftDay`/`weekDates` themselves already live in the protected
 * `utils/recapAssembly.ts` (CORE-1) and are reused here rather than
 * duplicated — importing them doesn't modify that file.
 */
import { startOfISOWeek } from 'date-fns';
import { getISOWeek, getISOWeekYear } from 'date-fns';
import { getLocalDateString, isoWeekStartDate } from '@/utils/dateHelpers';
import { shiftDay } from '@/utils/recapAssembly';

/**
 * The ISO week identifier (e.g. `"2026-W27"`) of a plain `yyyy-MM-dd` LOCAL
 * date string. Mirrors `functions/src/shared/isoWeek.ts`'s
 * `isoWeekIdForDate` exactly (same date-fns primitives), just kept as a
 * client-side copy since `functions/` is a separate, protected package.
 */
export function isoWeekIdForDate(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00`);
  const week = getISOWeek(date);
  const weekYear = getISOWeekYear(date);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

/** Inclusive `yyyy-MM-dd` Monday→Sunday bounds for one ISO week. */
export interface RecapWeekRange {
  isoWeek: string;
  /** yyyy-MM-dd — the Monday that opens the week. */
  weekStart: string;
  /** yyyy-MM-dd — the Sunday that closes the week. */
  weekEnd: string;
}

/**
 * Resolves an ISO week id into its Monday/Sunday bounds, or `null` for a
 * malformed/out-of-range id (mirrors `isoWeekStartDate`'s null contract —
 * see its doc comment for the exact validation it performs).
 */
export function weekRangeForIsoWeek(isoWeek: string): RecapWeekRange | null {
  const start = isoWeekStartDate(isoWeek);
  if (!start) return null;
  const weekStart = getLocalDateString(start);
  return { isoWeek, weekStart, weekEnd: shiftDay(weekStart, 6) };
}

/**
 * The ISO week `today` (a local `yyyy-MM-dd` string) falls in — the
 * IN-PROGRESS week, never offered by the archive or auto-open (only CLOSED
 * weeks are). Computed directly via `date-fns`' `startOfISOWeek` rather than
 * round-tripping through `weekRangeForIsoWeek` (which can return `null`) so
 * this never needs a non-null assertion: any real calendar date has a real
 * ISO week.
 */
export function currentWeekRange(today: string = getLocalDateString()): RecapWeekRange {
  const monday = startOfISOWeek(new Date(`${today}T00:00:00`));
  const weekStart = getLocalDateString(monday);
  return { isoWeek: isoWeekIdForDate(weekStart), weekStart, weekEnd: shiftDay(weekStart, 6) };
}

/**
 * The most recently CLOSED week as of `today` — the week immediately before
 * the current (in-progress) one. Unlike the server's Monday-only
 * `closedWeekFor` (which assumes it's always called at Monday 07:00 and just
 * subtracts one day from "today"), this is correct on ANY day of the week:
 * Wed → the week that ended last Sunday; the following Monday → the same
 * week, still correctly "just closed" for anyone who hasn't opened the app
 * yet. That's exactly the property the auto-open feature needs — "the first
 * app open after a week closes" can land on any day of the new week.
 */
export function lastClosedWeekRange(today: string = getLocalDateString()): RecapWeekRange {
  const current = currentWeekRange(today);
  const weekEnd = shiftDay(current.weekStart, -1);
  const weekStart = shiftDay(weekEnd, -6);
  return { isoWeek: isoWeekIdForDate(weekEnd), weekStart, weekEnd };
}

/**
 * The most recent `count` CLOSED weeks (newest first), starting at the last
 * closed week and stepping backward — the archive's offered horizon.
 */
export function pastClosedWeeks(count: number, today: string = getLocalDateString()): RecapWeekRange[] {
  const weeks: RecapWeekRange[] = [];
  let cursor = lastClosedWeekRange(today);
  for (let i = 0; i < count; i++) {
    weeks.push(cursor);
    cursor = { isoWeek: isoWeekIdForDate(shiftDay(cursor.weekEnd, -7)), weekStart: shiftDay(cursor.weekStart, -7), weekEnd: shiftDay(cursor.weekEnd, -7) };
  }
  return weeks;
}
