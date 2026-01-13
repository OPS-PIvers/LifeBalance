import { CalendarItem } from '@/types/schema';
import { addWeeks, addMonths, parseISO, format, isBefore, isAfter, isSameDay, differenceInCalendarWeeks, differenceInCalendarMonths, startOfDay } from 'date-fns';

const MONDAY = 1;
const MAX_ITERATIONS = 1000;

/**
 * Calculates the first occurrence date on or after the range start.
 * Implements "jump" logic to skip years of iterations.
 */
function calculateStartDate(originalDate: Date, rangeStart: Date, frequency: string): Date {
  let currentDate = originalDate;

  // Only jump if we are behind
  if (isBefore(originalDate, rangeStart)) {
    if (frequency === 'weekly') {
      const weeksDiff = Math.floor(differenceInCalendarWeeks(rangeStart, originalDate, { weekStartsOn: MONDAY }));
      if (weeksDiff > 0) {
        currentDate = addWeeks(originalDate, weeksDiff);
      }
    } else if (frequency === 'bi-weekly') {
      const weeksDiff = Math.floor(differenceInCalendarWeeks(rangeStart, originalDate, { weekStartsOn: MONDAY }));
      const jumps = Math.floor(weeksDiff / 2);
      if (jumps > 0) {
        currentDate = addWeeks(originalDate, jumps * 2);
      }
    } else if (frequency === 'monthly') {
      const monthsDiff = differenceInCalendarMonths(rangeStart, originalDate);
      if (monthsDiff > 0) {
        currentDate = addMonths(originalDate, monthsDiff);
      }
    }
  }

  return currentDate;
}

/**
 * Advances the date by one period based on frequency.
 */
function getNextOccurrence(currentDate: Date, frequency: string): Date {
  switch (frequency) {
    case 'weekly':
      return addWeeks(currentDate, 1);
    case 'bi-weekly':
      return addWeeks(currentDate, 2);
    case 'monthly':
      return addMonths(currentDate, 1);
    default:
      return currentDate; // Should not happen if validated
  }
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
  let currentDate = calculateStartDate(originalDate, start, item.frequency);

  let iterationCount = 0;

  while (
    (isSameDay(currentDate, end) || isBefore(currentDate, end)) &&
    iterationCount < MAX_ITERATIONS
  ) {
    // Only add if within range (inclusive)
    if (isSameDay(currentDate, start) || isAfter(currentDate, start)) {
      instances.push({
        ...item,
        id: `${item.id}-${format(currentDate, 'yyyy-MM-dd')}`, // Unique ID for each instance
        date: format(currentDate, 'yyyy-MM-dd'),
      });
    }

    const nextDate = getNextOccurrence(currentDate, item.frequency);

    // Safety check to prevent infinite loop if date didn't change (e.g. unknown frequency)
    if (nextDate.getTime() === currentDate.getTime()) {
      iterationCount = MAX_ITERATIONS; // Break loop
    } else {
      currentDate = nextDate;
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

  // Add non-recurring items and paid instances (deleted instances should not show)
  allInstances.push(...nonRecurringItems, ...paidInstances);

  return allInstances;
}
