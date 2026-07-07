import { parseISO, isBefore, addDays } from 'date-fns';
import { ToDo } from '@/types/schema';

/**
 * Eisenhower matrix quadrants for the To-Dos page.
 * - Urgency is DERIVED from completeByDate with the exact same window as the
 *   list view's "Immediate" section (overdue | today | tomorrow), so the two
 *   arrangements always agree on what is urgent.
 * - Importance is the explicit human-set ToDo.isImportant flag (absent = false).
 */
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'later';

/** Render order: most actionable first. */
export const QUADRANT_ORDER: readonly Quadrant[] = ['do', 'schedule', 'delegate', 'later'];

/**
 * Urgent = overdue, due today, or due tomorrow — i.e. due strictly before the
 * day after tomorrow. Pure math against the `today` parameter (the caller's
 * local start-of-day; ToDosPage's midnight-refreshed currentDate) rather than
 * date-fns isToday/isTomorrow, which read the real clock and would make the
 * function untestable with a fixed date.
 */
export function isUrgent(todo: ToDo, today: Date): boolean {
  const due = parseISO(todo.completeByDate);
  return isBefore(due, addDays(today, 2));
}

export function quadrantForTodo(todo: ToDo, today: Date): Quadrant {
  const urgent = isUrgent(todo, today);
  const important = todo.isImportant === true;
  if (urgent && important) return 'do';
  if (important) return 'schedule';
  if (urgent) return 'delegate';
  return 'later';
}
