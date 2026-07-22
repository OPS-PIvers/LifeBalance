// Flat-list ordering for the To-Dos page. The default 'important' mode is the
// owner-locked spec: important (starred) tasks first; within each of the
// starred/unstarred groups, overdue first, then ascending due date, then
// undated last. Ties keep their existing order (Array.prototype.sort is stable
// per ES2019).
//
// Note: ascending yyyy-MM-dd string order already puts overdue dates ahead of
// today/future ones, so "overdue first, then ascending due date" is a single
// lexicographic comparison. Within the same day, timed to-dos come first in
// time order via compareDueTimes (untimed pairs compare equal → stable).

import type { ToDo } from '@/types/schema';
import { compareDueTimes } from '@/utils/todoTime';

/**
 * Sort modes for the flat active list (mirrors the Shopping list's sort menu):
 * - 'important' — starred first, then due date (the default, owner-locked)
 * - 'due'       — pure due-date order, stars ignored
 * - 'added'     — newest created first
 */
export type TodoSortMode = 'important' | 'due' | 'added';

export const TODO_SORT_MODES: readonly TodoSortMode[] = ['important', 'due', 'added'];

export const TODO_SORT_LABELS: Record<TodoSortMode, string> = {
  important: 'Important first',
  due: 'Due date',
  added: 'Recently added',
};

// Undated last; otherwise overdue → ascending due date → same-day time order.
function compareByDue(a: ToDo, b: ToDo): number {
  // Schema requires completeByDate, but be defensive about legacy/blank
  // values rather than sorting '' first.
  const aDate = a.completeByDate || '';
  const bDate = b.completeByDate || '';
  if (aDate === '' && bDate === '') return 0;
  if (aDate === '') return 1;
  if (bDate === '') return -1;
  return aDate.localeCompare(bDate) || compareDueTimes(a, b);
}

/** Returns a NEW array of the given to-dos in flat-list display order. */
export function sortFlatTodos(todos: readonly ToDo[], mode: TodoSortMode = 'important'): ToDo[] {
  return [...todos].sort((a, b) => {
    if (mode === 'added') {
      // Newest first; missing createdAt sorts last. ISO strings compare
      // lexicographically in time order.
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    }
    if (mode === 'important') {
      // Starred group first. `isImportant` is optional — only explicit true stars.
      const starDiff =
        Number(b.isImportant === true) - Number(a.isImportant === true);
      if (starDiff !== 0) return starDiff;
    }
    return compareByDue(a, b);
  });
}
