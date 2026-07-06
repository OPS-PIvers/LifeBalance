import { CalendarItem } from '@/types/schema';
import { addWeeks, addMonths, parseISO, format, isBefore, isAfter, isSameDay, differenceInCalendarWeeks, differenceInCalendarMonths, startOfDay } from 'date-fns';

const MONDAY = 1;
const MAX_ITERATIONS = 1000;
const RECURRING_SEPARATOR = '_instance_';

/**
 * Generates a consistent synthetic ID for a recurring instance.
 */
export function generateRecurringId(templateId: string, date: string): string {
  return `${templateId}${RECURRING_SEPARATOR}${date}`;
}

/**
 * Checks if an ID is a synthetic recurring instance ID.
 */
export function isRecurringId(id: string): boolean {
  return id.includes(RECURRING_SEPARATOR);
}

/**
 * Parses a synthetic recurring ID into its components.
 * Returns null if the ID format is invalid.
 */
export function parseRecurringId(id: string): { templateId: string; date: string } | null {
  const parts = id.split(RECURRING_SEPARATOR);
  if (parts.length < 2) return null;

  // Handle case where template ID might contain the separator (unlikely but possible)
  // The date is always the last part
  const date = parts.pop();
  const templateId = parts.join(RECURRING_SEPARATOR);

  if (!date || !templateId) return null;

  return { templateId, date };
}

/**
 * Computes occurrence number `n` (0-based) directly from the original anchor date.
 * Monthly occurrences MUST be derived from the anchor rather than by compounding
 * addMonths on the previous (month-end-clamped) occurrence: date-fns clamps
 * Jan 31 + 1 month to Feb 28, and compounding from that loses the anchor day
 * forever (Feb 28 -> Mar 28 -> ...). Deriving from the anchor clamps each month
 * independently (Jan 31 -> Feb 28 -> Mar 31 -> Apr 30) and guarantees the same
 * occurrence gets the same date (and synthetic ID) regardless of window start,
 * which paid-instance suppression in expandCalendarItems relies on.
 */
function getOccurrenceDate(originalDate: Date, n: number, frequency: string): Date {
  switch (frequency) {
    case 'weekly':
      return addWeeks(originalDate, n);
    case 'bi-weekly':
      return addWeeks(originalDate, n * 2);
    case 'monthly':
      return addMonths(originalDate, n);
    default:
      return originalDate; // Should not happen if validated
  }
}

/**
 * Calculates the index of the first occurrence that can fall on or after the
 * range start. Implements "jump" logic to skip years of iterations. May
 * undershoot by one period (the generation loop filters dates before the
 * range start) but never overshoots past a valid occurrence.
 */
function calculateStartIndex(originalDate: Date, rangeStart: Date, frequency: string): number {
  // Only jump if we are behind
  if (!isBefore(originalDate, rangeStart)) return 0;

  if (frequency === 'weekly') {
    const weeksDiff = Math.floor(differenceInCalendarWeeks(rangeStart, originalDate, { weekStartsOn: MONDAY }));
    return Math.max(weeksDiff, 0);
  }
  if (frequency === 'bi-weekly') {
    const weeksDiff = Math.floor(differenceInCalendarWeeks(rangeStart, originalDate, { weekStartsOn: MONDAY }));
    return Math.max(Math.floor(weeksDiff / 2), 0);
  }
  if (frequency === 'monthly') {
    return Math.max(differenceInCalendarMonths(rangeStart, originalDate), 0);
  }
  return 0;
}

/**
 * Rolls a recurring template's anchor date forward to the first occurrence on
 * or after `today`. Used when a recurring template's schedule (date/frequency)
 * is EDITED: applying the new schedule to past months would re-generate old
 * occurrences whose paid/deleted suppression records still carry the OLD
 * dates, resurrecting already-paid bills as unpaid overdue items. Anchoring at
 * the next on-or-after-today occurrence makes schedule edits forward-only.
 *
 * For monthly anchors on days 29–31, month-end-clamped occurrences (e.g.
 * Jan 31 → Feb 28) are skipped as new anchors — writing a clamped date would
 * permanently lose the intended day-of-month — so the anchor advances to the
 * next month that actually contains that day.
 *
 * Returns the anchor unchanged if it is already on/after `today` or the
 * frequency is unknown.
 */
export function rollRecurringAnchorForward(
  anchor: string,
  frequency: string,
  today: string
): string {
  if (frequency !== 'weekly' && frequency !== 'bi-weekly' && frequency !== 'monthly') {
    return anchor;
  }
  if (anchor >= today) return anchor;

  const originalDate = startOfDay(parseISO(anchor));
  const todayDate = startOfDay(parseISO(today));
  const anchorDay = originalDate.getDate();

  // calculateStartIndex may undershoot by one period; the loop corrects.
  let n = calculateStartIndex(originalDate, todayDate, frequency);
  for (let i = 0; i < MAX_ITERATIONS; i++, n++) {
    const candidate = getOccurrenceDate(originalDate, n, frequency);
    const notClamped = frequency !== 'monthly' || candidate.getDate() === anchorDay;
    if (!isBefore(candidate, todayDate) && notClamped) {
      return format(candidate, 'yyyy-MM-dd');
    }
  }
  return anchor;
}

/**
 * Generates recurring instances of a calendar item within a date range.
 * If the item is not recurring, returns just the original item.
 *
 * @param item - The calendar item (potentially recurring)
 * @param rangeStart - Start of the date range to generate instances for
 * @param rangeEnd - End of the date range to generate instances for
 * @returns Array of calendar item instances (original + generated recurring ones)
 */
export function generateRecurringInstances(
  item: CalendarItem,
  rangeStart: Date,
  rangeEnd: Date
): CalendarItem[] {
  // If not recurring, just return the original item if it falls in range
  if (!item.isRecurring || !item.frequency) {
    const itemDate = parseISO(item.date);
    const inRange =
      (isSameDay(itemDate, rangeStart) || isAfter(itemDate, rangeStart)) &&
      (isSameDay(itemDate, rangeEnd) || isBefore(itemDate, rangeEnd));
    return inRange ? [item] : [];
  }

  const instances: CalendarItem[] = [];
  const originalDate = startOfDay(parseISO(item.date));
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);

  // Optimization: Skip directly to the start of the range
  let occurrenceIndex = calculateStartIndex(originalDate, start, item.frequency);
  let currentDate = getOccurrenceDate(originalDate, occurrenceIndex, item.frequency);

  let iterationCount = 0;

  while (
    (isSameDay(currentDate, end) || isBefore(currentDate, end)) &&
    iterationCount < MAX_ITERATIONS
  ) {
    // Only add if within range (inclusive)
    if (isSameDay(currentDate, start) || isAfter(currentDate, start)) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      instances.push({
        ...item,
        id: generateRecurringId(item.id, dateStr), // Use consistent ID generation
        date: dateStr,
      });
    }

    const nextDate = getOccurrenceDate(originalDate, occurrenceIndex + 1, item.frequency);

    // Safety check to prevent infinite loop if date didn't change (e.g. unknown frequency)
    if (nextDate.getTime() === currentDate.getTime()) {
      iterationCount = MAX_ITERATIONS; // Break loop
    } else {
      currentDate = nextDate;
      occurrenceIndex++;
    }

    iterationCount++;
  }

  return instances;
}

/**
 * Expands all calendar items to include their recurring instances within a date range.
 * Excludes dates that have been paid as individual instances.
 *
 * @param items - Array of calendar items from the database
 * @param rangeStart - Start of the date range
 * @param rangeEnd - End of the date range
 * @returns Flattened array of all calendar items (original + recurring instances)
 */
export function expandCalendarItems(
  items: CalendarItem[],
  rangeStart: Date,
  rangeEnd: Date
): CalendarItem[] {
  const allInstances: CalendarItem[] = [];

  // Separate recurring templates from paid/deleted instances
  const recurringTemplates = items.filter(item => item.isRecurring && !item.parentRecurringId);
  const paidInstances = items.filter(item => item.isPaid && item.parentRecurringId);
  const deletedInstances = items.filter(item => item.isDeleted && item.parentRecurringId);
  const nonRecurringItems = items.filter(item => !item.isRecurring && !item.parentRecurringId);

  // Build sets of paid and deleted dates for each recurring template
  const paidDatesMap = new Map<string, Set<string>>();
  const deletedDatesMap = new Map<string, Set<string>>();

  for (const paidInstance of paidInstances) {
    if (paidInstance.parentRecurringId) {
      if (!paidDatesMap.has(paidInstance.parentRecurringId)) {
        paidDatesMap.set(paidInstance.parentRecurringId, new Set());
      }
      paidDatesMap.get(paidInstance.parentRecurringId)?.add(paidInstance.date);
    }
  }

  for (const deletedInstance of deletedInstances) {
    if (deletedInstance.parentRecurringId) {
      if (!deletedDatesMap.has(deletedInstance.parentRecurringId)) {
        deletedDatesMap.set(deletedInstance.parentRecurringId, new Set());
      }
      deletedDatesMap.get(deletedInstance.parentRecurringId)?.add(deletedInstance.date);
    }
  }

  // Generate recurring instances, excluding paid and deleted dates
  for (const template of recurringTemplates) {
    const instances = generateRecurringInstances(template, rangeStart, rangeEnd);
    const paidDates = paidDatesMap.get(template.id) || new Set();
    const deletedDates = deletedDatesMap.get(template.id) || new Set();

    // Filter out instances that have been paid or deleted
    const activeInstances = instances.filter(
      instance => !paidDates.has(instance.date) && !deletedDates.has(instance.date)
    );
    allInstances.push(...activeInstances);
  }

  // Add non-recurring items and paid instances that fall within the range.
  // (Deleted instances are never included regardless.)
  // We mirror the same inclusive-on-both-ends check used by generateRecurringInstances
  // for non-recurring items so the returned list consistently honours [rangeStart, rangeEnd].
  // Compare as 'yyyy-MM-dd' strings: lexicographic order matches chronological
  // order for this format, so this is faster and immune to timezone/DST shifts.
  const startStr = format(rangeStart, 'yyyy-MM-dd');
  const endStr = format(rangeEnd, 'yyyy-MM-dd');

  const isInRange = (dateStr: string): boolean =>
    dateStr >= startStr && dateStr <= endStr;

  allInstances.push(
    ...nonRecurringItems.filter(item => isInRange(item.date)),
    ...paidInstances.filter(item => isInRange(item.date)),
  );

  return allInstances;
}
