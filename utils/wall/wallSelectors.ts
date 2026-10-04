import type { ToDo, WallEvent } from '@/types/schema';

/**
 * Pure selectors for wall screens (docs/plans/wall-display-kiosk.md §4.9).
 * Dates are yyyy-MM-dd strings in the household zone.
 */

/** Open to-dos that are overdue or due today (the rail badge and "Due today"). */
export function dueTodayTodos(todos: readonly ToDo[], today: string): ToDo[] {
  return todos
    .filter(t => !t.isCompleted && t.completeByDate <= today)
    .sort((a, b) => a.completeByDate.localeCompare(b.completeByDate) || a.text.localeCompare(b.text));
}

/** Timed events in start order; all-day lines (bills, holidays) first. */
export function eventsOn(events: readonly WallEvent[], date: string): WallEvent[] {
  return events
    .filter(e => e.date === date)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title);
    });
}

/**
 * The night screen's "Tomorrow 10:00 · Farmers market": the first timed
 * event of `date`, else its first all-day event that isn't a bill.
 */
export function firstEventOn(events: readonly WallEvent[], date: string): WallEvent | null {
  const day = eventsOn(events, date);
  return day.find(e => !e.allDay) ?? day.find(e => e.source !== 'bill') ?? null;
}
