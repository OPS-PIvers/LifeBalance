// Flat-list ordering for the To-Dos page (owner-locked spec): important
// (starred) tasks first; within each of the starred/unstarred groups, overdue
// first, then ascending due date, then undated last. Ties keep their existing
// order (Array.prototype.sort is stable per ES2019).
//
// Note: ascending yyyy-MM-dd string order already puts overdue dates ahead of
// today/future ones, so "overdue first, then ascending due date" is a single
// lexicographic comparison. Within the same day, timed to-dos come first in
// time order via compareDueTimes (untimed pairs compare equal → stable).

import type { ToDo } from '@/types/schema';
import { compareDueTimes } from '@/utils/todoTime';

/** Returns a NEW array of the given to-dos in flat-list display order. */
export function sortFlatTodos(todos: readonly ToDo[]): ToDo[] {
  return [...todos].sort((a, b) => {
    // Starred group first. `isImportant` is optional — only explicit true stars.
    const starDiff =
      Number(b.isImportant === true) - Number(a.isImportant === true);
    if (starDiff !== 0) return starDiff;

    // Undated last within the group. (Schema requires completeByDate, but be
    // defensive about legacy/blank values rather than sorting '' first.)
    const aDate = a.completeByDate || '';
    const bDate = b.completeByDate || '';
    if (aDate === '' && bDate === '') return 0;
    if (aDate === '') return 1;
    if (bDate === '') return -1;

    return aDate.localeCompare(bDate) || compareDueTimes(a, b);
  });
}
