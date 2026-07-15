import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Shape of the calendarItems docs the bill-facing jobs care about. Recurring
 * bills are stored as a single TEMPLATE doc whose `date` is the original anchor
 * occurrence and is never advanced — future occurrences are derived from it
 * (see utils/calendarRecurrence.ts client-side). Paying or deleting a single
 * occurrence writes a separate INSTANCE doc carrying `parentRecurringId` plus
 * `isPaid`/`isDeleted`, rather than mutating the template.
 *
 * Extracted from index.ts so both `sendbillreminders` (index.ts) and the daily
 * briefing engine (dailyBriefing/) can share one source of truth without a
 * circular import through index.ts. index.ts re-exports these for consumers
 * (and tests) that imported them from there.
 */
export interface BillCalendarItem {
  id: string;
  date: string;
  isRecurring?: boolean;
  frequency?: string;
  isPaid?: boolean;
  isDeleted?: boolean;
  parentRecurringId?: string;
  amount?: number;
}

/**
 * Whether a recurring series anchored at `anchorDateStr` has an occurrence
 * exactly on `targetDateStr`. Monthly occurrences are derived from the anchor
 * with independent month-end clamping (Jan 31 -> Feb 28 -> Mar 31), matching
 * the client's getOccurrenceDate in utils/calendarRecurrence.ts.
 */
function recurrenceFallsOn(
  anchorDateStr: string,
  frequency: string,
  targetDateStr: string
): boolean {
  // Lexicographic order matches chronological order for yyyy-MM-dd strings.
  if (targetDateStr < anchorDateStr) return false;
  if (targetDateStr === anchorDateStr) return true;

  const anchor = parseISO(anchorDateStr);
  const target = parseISO(targetDateStr);

  if (frequency === "weekly" || frequency === "bi-weekly") {
    const dayDiff = differenceInCalendarDays(target, anchor);
    return dayDiff % (frequency === "weekly" ? 7 : 14) === 0;
  }
  if (frequency === "monthly") {
    const monthDiff =
      (target.getFullYear() - anchor.getFullYear()) * 12 +
      (target.getMonth() - anchor.getMonth());
    if (monthDiff <= 0) return false;
    return format(addMonths(anchor, monthDiff), "yyyy-MM-dd") === targetDateStr;
  }
  // Unknown frequency: only the anchor date itself matches.
  return false;
}

/**
 * Server-side port of the client's recurring-calendar expansion
 * (expandCalendarItems in utils/calendarRecurrence.ts), specialized to answer
 * "which bills are due on exactly this date?". Expands recurring templates to
 * the target date and suppresses occurrences already covered by a paid or
 * per-occurrence-deleted instance doc; non-recurring bills match on their
 * stored date when still unpaid.
 */
export function findBillsDueOnDate(
  items: BillCalendarItem[],
  targetDateStr: string
): BillCalendarItem[] {
  // Dates already covered by a paid/deleted instance doc, keyed by template id.
  const coveredDates = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.parentRecurringId && (item.isPaid || item.isDeleted)) {
      const dates = coveredDates.get(item.parentRecurringId) ?? new Set<string>();
      dates.add(item.date);
      coveredDates.set(item.parentRecurringId, dates);
    }
  }

  return items.filter((item) => {
    // Instance docs only exist to mark an occurrence paid/deleted — never due.
    if (item.parentRecurringId || item.isDeleted) return false;
    if (item.isRecurring && item.frequency) {
      return (
        recurrenceFallsOn(item.date, item.frequency, targetDateStr) &&
        !coveredDates.get(item.id)?.has(targetDateStr)
      );
    }
    return !item.isPaid && item.date === targetDateStr;
  });
}
