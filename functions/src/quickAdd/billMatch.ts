/**
 * Server-side bill matching for the quickAddBillPay endpoint.
 *
 * Ports the CORE of the client's recurring-calendar expansion
 * (`utils/calendarRecurrence.ts`) plus a title-matching layer, so a voice
 * command ("Hey Siri, I paid rent") can find the matching UPCOMING unpaid
 * calendar bill and pay it. The app root can't be imported across the pnpm
 * workspace boundary, so this is a focused re-implementation — keep it in sync
 * with `utils/calendarRecurrence.ts` (occurrence-from-anchor math, paid/deleted
 * suppression, synthetic-instance IDs) and `functions/src/quickAdd/habitProcessor.ts`
 * (fuzzy title matching).
 *
 * Everything here is PURE (no Firestore, no I/O) and unit-tested.
 */

import {
  addWeeks,
  addMonths,
  parseISO,
  format,
  isBefore,
  isAfter,
  isSameDay,
  differenceInCalendarWeeks,
  differenceInCalendarMonths,
  startOfDay,
} from "date-fns";

const MONDAY = 1;
const MAX_ITERATIONS = 1000;
const RECURRING_SEPARATOR = "_instance_";

/** Minimal calendar-item shape the matcher needs (mirrors CalendarItem). */
export interface BillCalendarItem {
  id: string;
  title: string;
  amount: number;
  date: string; // YYYY-MM-DD
  type: "income" | "expense";
  isPaid: boolean;
  isRecurring?: boolean;
  frequency?: "weekly" | "bi-weekly" | "monthly";
  parentRecurringId?: string;
  isDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// Synthetic recurring-instance IDs (mirror utils/calendarRecurrence.ts)
// ---------------------------------------------------------------------------

/** Generates a consistent synthetic ID for a recurring instance. */
export function generateRecurringId(templateId: string, date: string): string {
  return `${templateId}${RECURRING_SEPARATOR}${date}`;
}

/** Whether an ID is a synthetic recurring-instance ID. */
export function isRecurringId(id: string): boolean {
  return id.includes(RECURRING_SEPARATOR);
}

/** Parses a synthetic recurring ID into its components (null when invalid). */
export function parseRecurringId(
  id: string
): { templateId: string; date: string } | null {
  const parts = id.split(RECURRING_SEPARATOR);
  if (parts.length < 2) return null;
  const date = parts.pop();
  const templateId = parts.join(RECURRING_SEPARATOR);
  if (!date || !templateId) return null;
  return { templateId, date };
}

// ---------------------------------------------------------------------------
// Occurrence math (mirror utils/calendarRecurrence.ts)
// ---------------------------------------------------------------------------

function getOccurrenceDate(
  originalDate: Date,
  n: number,
  frequency: string
): Date {
  switch (frequency) {
    case "weekly":
      return addWeeks(originalDate, n);
    case "bi-weekly":
      return addWeeks(originalDate, n * 2);
    case "monthly":
      return addMonths(originalDate, n);
    default:
      return originalDate;
  }
}

function calculateStartIndex(
  originalDate: Date,
  rangeStart: Date,
  frequency: string
): number {
  if (!isBefore(originalDate, rangeStart)) return 0;
  if (frequency === "weekly") {
    const weeksDiff = Math.floor(
      differenceInCalendarWeeks(rangeStart, originalDate, { weekStartsOn: MONDAY })
    );
    return Math.max(weeksDiff, 0);
  }
  if (frequency === "bi-weekly") {
    const weeksDiff = Math.floor(
      differenceInCalendarWeeks(rangeStart, originalDate, { weekStartsOn: MONDAY })
    );
    return Math.max(Math.floor(weeksDiff / 2), 0);
  }
  if (frequency === "monthly") {
    return Math.max(differenceInCalendarMonths(rangeStart, originalDate), 0);
  }
  return 0;
}

/** Generates recurring instances of a single item within [rangeStart, rangeEnd]. */
function generateRecurringInstances(
  item: BillCalendarItem,
  rangeStart: Date,
  rangeEnd: Date
): BillCalendarItem[] {
  if (!item.isRecurring || !item.frequency) {
    const itemDate = parseISO(item.date);
    const inRange =
      (isSameDay(itemDate, rangeStart) || isAfter(itemDate, rangeStart)) &&
      (isSameDay(itemDate, rangeEnd) || isBefore(itemDate, rangeEnd));
    return inRange ? [item] : [];
  }

  const instances: BillCalendarItem[] = [];
  const originalDate = startOfDay(parseISO(item.date));
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);

  let occurrenceIndex = calculateStartIndex(originalDate, start, item.frequency);
  let currentDate = getOccurrenceDate(originalDate, occurrenceIndex, item.frequency);

  let iterationCount = 0;
  while (
    (isSameDay(currentDate, end) || isBefore(currentDate, end)) &&
    iterationCount < MAX_ITERATIONS
  ) {
    if (isSameDay(currentDate, start) || isAfter(currentDate, start)) {
      const dateStr = format(currentDate, "yyyy-MM-dd");
      instances.push({
        ...item,
        id: generateRecurringId(item.id, dateStr),
        date: dateStr,
      });
    }
    const nextDate = getOccurrenceDate(
      originalDate,
      occurrenceIndex + 1,
      item.frequency
    );
    if (nextDate.getTime() === currentDate.getTime()) {
      iterationCount = MAX_ITERATIONS;
    } else {
      currentDate = nextDate;
      occurrenceIndex++;
    }
    iterationCount++;
  }
  return instances;
}

/**
 * Expands all calendar items to include recurring instances within a date
 * range, excluding paid/deleted individual instances. Port of
 * `expandCalendarItems`.
 */
export function expandCalendarItems(
  items: BillCalendarItem[],
  rangeStart: Date,
  rangeEnd: Date
): BillCalendarItem[] {
  const allInstances: BillCalendarItem[] = [];

  const recurringTemplates = items.filter(
    (i) => i.isRecurring && !i.parentRecurringId
  );
  const paidInstances = items.filter((i) => i.isPaid && i.parentRecurringId);
  const deletedInstances = items.filter((i) => i.isDeleted && i.parentRecurringId);
  const nonRecurringItems = items.filter(
    (i) => !i.isRecurring && !i.parentRecurringId
  );

  const paidDatesMap = new Map<string, Set<string>>();
  const deletedDatesMap = new Map<string, Set<string>>();

  for (const paid of paidInstances) {
    if (paid.parentRecurringId) {
      if (!paidDatesMap.has(paid.parentRecurringId)) {
        paidDatesMap.set(paid.parentRecurringId, new Set());
      }
      paidDatesMap.get(paid.parentRecurringId)?.add(paid.date);
    }
  }
  for (const del of deletedInstances) {
    if (del.parentRecurringId) {
      if (!deletedDatesMap.has(del.parentRecurringId)) {
        deletedDatesMap.set(del.parentRecurringId, new Set());
      }
      deletedDatesMap.get(del.parentRecurringId)?.add(del.date);
    }
  }

  for (const template of recurringTemplates) {
    const instances = generateRecurringInstances(template, rangeStart, rangeEnd);
    const paidDates = paidDatesMap.get(template.id) || new Set();
    const deletedDates = deletedDatesMap.get(template.id) || new Set();
    const activeInstances = instances.filter(
      (instance) =>
        !paidDates.has(instance.date) && !deletedDates.has(instance.date)
    );
    allInstances.push(...activeInstances);
  }

  const startStr = format(rangeStart, "yyyy-MM-dd");
  const endStr = format(rangeEnd, "yyyy-MM-dd");
  const isInRange = (dateStr: string): boolean =>
    dateStr >= startStr && dateStr <= endStr;

  allInstances.push(
    ...nonRecurringItems.filter((i) => isInRange(i.date)),
    ...paidInstances.filter((i) => isInRange(i.date))
  );

  return allInstances;
}

// ---------------------------------------------------------------------------
// Title matching + bill selection
// ---------------------------------------------------------------------------

/** Lowercased + trimmed title (mirrors normalizeHabitTitle). */
export function normalizeBillTitle(title: string): string {
  return title.toLowerCase().trim();
}

/**
 * Finds the unpaid EXPENSE bill best matching `title` within a due-date window.
 *
 * @param items    raw calendar items straight from Firestore
 * @param title    the spoken/typed bill name
 * @param today    yyyy-MM-dd anchor ("today" in the caller's local timezone)
 * @param windowStartDays how many days BEFORE today to include (overdue bills)
 * @param windowEndDays   how many days AFTER today to include (upcoming bills)
 *
 * Matching precedence (mirrors fuzzyMatchHabit): exact title → contains →
 * starts-with. Among items sharing the winning precedence tier, the one with
 * the EARLIEST due date wins (pay the most-overdue/soonest bill first). Returns
 * null when nothing matches.
 */
export function findBillToPay(
  items: BillCalendarItem[],
  title: string,
  today: string,
  windowStartDays = 45,
  windowEndDays = 45
): BillCalendarItem | null {
  const search = normalizeBillTitle(title);
  if (!search) return null;

  const todayDate = startOfDay(parseISO(today));
  const rangeStart = startOfDay(
    new Date(todayDate.getTime() - windowStartDays * 24 * 60 * 60 * 1000)
  );
  const rangeEnd = startOfDay(
    new Date(todayDate.getTime() + windowEndDays * 24 * 60 * 60 * 1000)
  );

  const expanded = expandCalendarItems(items, rangeStart, rangeEnd).filter(
    (i) => i.type === "expense" && !i.isPaid
  );
  if (expanded.length === 0) return null;

  // Earliest due date first, so ties within a precedence tier resolve to the
  // soonest/most-overdue bill.
  const byDate = [...expanded].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const exact = byDate.find((i) => normalizeBillTitle(i.title) === search);
  if (exact) return exact;

  const contains = byDate.find((i) =>
    normalizeBillTitle(i.title).includes(search)
  );
  if (contains) return contains;

  const startsWith = byDate.find((i) =>
    normalizeBillTitle(i.title).startsWith(search)
  );
  if (startsWith) return startsWith;

  return null;
}
