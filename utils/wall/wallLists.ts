import type { ShoppingItem, ToDo } from '@/types/schema';
import { addDaysTo } from './wallCalendar';
import { zonedDateString } from './wallTime';

/**
 * Pure selectors for the wall's lists (docs/plans/wall-display-kiosk.md §3
 * "Lists and meals"). Dates are yyyy-MM-dd in the household zone.
 */

export type TodoGroupKey = 'overdue' | 'today' | 'week';

export interface TodoGroup {
  key: TodoGroupKey;
  title: string;
  items: ToDo[];
  open: number;
}

const GROUP_TITLES: Record<TodoGroupKey, string> = { overdue: 'Overdue', today: 'Today', week: 'This week' };

/** 'family' matches unassigned to-dos; 'all' matches everything. */
export function matchesPerson(todo: ToDo, person: string): boolean {
  if (person === 'all') return true;
  if (person === 'family') return !todo.assignedTo;
  return todo.assignedTo === person;
}

/**
 * Overdue / Today / This week (the next six days). A to-do ticked off today
 * stays in its group, shown done, so a tap doesn't make it vanish; older
 * completed ones are gone.
 */
export function groupTodos(todos: readonly ToDo[], today: string, timeZone?: string, person = 'all'): TodoGroup[] {
  const weekEnd = addDaysTo(today, 6);
  const buckets: Record<TodoGroupKey, ToDo[]> = { overdue: [], today: [], week: [] };
  for (const t of todos) {
    if (!matchesPerson(t, person)) continue;
    if (t.isCompleted && !(t.completedAt && zonedDateString(new Date(t.completedAt), timeZone) === today)) continue;
    const d = t.completeByDate;
    if (d < today) buckets.overdue.push(t);
    else if (d === today) buckets.today.push(t);
    else if (d <= weekEnd) buckets.week.push(t);
  }
  return (Object.keys(buckets) as TodoGroupKey[])
    .map(key => ({
      key,
      title: GROUP_TITLES[key],
      items: buckets[key].sort((a, b) => a.completeByDate.localeCompare(b.completeByDate) || a.text.localeCompare(b.text)),
      open: buckets[key].filter(t => !t.isCompleted).length,
    }))
    .filter(g => g.items.length > 0);
}

/** Shopping items in the list's own order (manual `order`, then name). */
export function sortShopping(items: readonly ShoppingItem[]): ShoppingItem[] {
  return [...items].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)
  );
}
