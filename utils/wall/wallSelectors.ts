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
      // Instants, not strings: two feeds may write different UTC offsets.
      return Date.parse(a.start ?? '') - Date.parse(b.start ?? '') || a.title.localeCompare(b.title);
    });
}

/**
 * The night screen's preview of tomorrow: its first two timed events, and
 * its all-day events (bills left out: nobody needs one at bedtime).
 */
export function tomorrowPreview(events: readonly WallEvent[], date: string): { timed: WallEvent[]; allDay: WallEvent[] } {
  const day = eventsOn(events, date);
  return { timed: day.filter(e => !e.allDay).slice(0, 2), allDay: day.filter(e => e.allDay && e.source !== 'bill') };
}
