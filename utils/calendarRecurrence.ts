import { CalendarItem } from '@/types/schema';
import { addWeeks, addMonths, parseISO, format, isBefore, isAfter, isSameDay, differenceInCalendarWeeks, differenceInCalendarMonths, addDays, startOfDay } from 'date-fns';

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
  // Instead of iterating from originalDate (which could be years ago),
  // calculate the first occurrence on or after rangeStart.

  let currentDate = originalDate;

  // If the original date is before the range start, jump forward
  if (isBefore(originalDate, start)) {
    if (item.frequency === 'weekly') {
      const weeksDiff = Math.floor(differenceInCalendarWeeks(start, originalDate, { weekStartsOn: 1 }));
      // Jump to roughly the right week, then adjust
      // We use floor to ensure we don't overshoot
      if (weeksDiff > 0) {
        currentDate = addWeeks(originalDate, weeksDiff);
      }
    } else if (item.frequency === 'bi-weekly') {
      const weeksDiff = Math.floor(differenceInCalendarWeeks(start, originalDate, { weekStartsOn: 1 }));
      // Ensure we jump by even number of weeks
      const jumps = Math.floor(weeksDiff / 2);
      if (jumps > 0) {
        currentDate = addWeeks(originalDate, jumps * 2);
      }
    } else if (item.frequency === 'monthly') {
      const monthsDiff = differenceInCalendarMonths(start, originalDate);
      if (monthsDiff > 0) {
        currentDate = addMonths(originalDate, monthsDiff);
      }
    }

    // The jump might have landed us slightly before start, or on it.
    // Loop will handle moving to the exact next valid occurrence if needed.
    // If we overshot (unlikely with floor/diff logic but possible with day alignment),
    // the loop condition won't execute or will exit early.
  }

  // Generate instances within the range
  // Limit to 1000 instances to prevent infinite loops (increased from 100 due to better starting point)
  let iterationCount = 0;
  const maxIterations = 1000;

  while (
    (isSameDay(currentDate, end) || isBefore(currentDate, end)) &&
    iterationCount < maxIterations
  ) {
    // Only add if within range (inclusive)
    if (isSameDay(currentDate, start) || isAfter(currentDate, start)) {
      instances.push({
        ...item,
        id: `${item.id}-${format(currentDate, 'yyyy-MM-dd')}`, // Unique ID for each instance
        date: format(currentDate, 'yyyy-MM-dd'),
      });
    }

    // Move to next occurrence based on frequency
    switch (item.frequency) {
      case 'weekly':
        currentDate = addWeeks(currentDate, 1);
        break;
      case 'bi-weekly':
        currentDate = addWeeks(currentDate, 2);
        break;
      case 'monthly':
        currentDate = addMonths(currentDate, 1);
        break;
      default:
        // Safety break for unknown frequency
        iterationCount = maxIterations;
        break;
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
    if (!paidDatesMap.has(paidInstance.parentRecurringId!)) {
      paidDatesMap.set(paidInstance.parentRecurringId!, new Set());
    }
    paidDatesMap.get(paidInstance.parentRecurringId!)!.add(paidInstance.date);
  }

  for (const deletedInstance of deletedInstances) {
    if (!deletedDatesMap.has(deletedInstance.parentRecurringId!)) {
      deletedDatesMap.set(deletedInstance.parentRecurringId!, new Set());
    }
    deletedDatesMap.get(deletedInstance.parentRecurringId!)!.add(deletedInstance.date);
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
