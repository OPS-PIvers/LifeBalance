import { CalendarItem } from '@/types/schema';
import { addDays, addWeeks, addMonths, parseISO, format, isBefore, isAfter, isSameDay } from 'date-fns';

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
  const originalDate = parseISO(item.date);
  let currentDate = originalDate;

  // Generate instances within the range
  // Limit to 100 instances to prevent infinite loops
  let iterationCount = 0;
  const maxIterations = 100;

  while (
    (isSameDay(currentDate, rangeEnd) || isBefore(currentDate, rangeEnd)) &&
    iterationCount < maxIterations
  ) {
    // Only add if within range
    if (isSameDay(currentDate, rangeStart) || isAfter(currentDate, rangeStart)) {
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
