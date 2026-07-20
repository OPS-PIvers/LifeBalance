import { addWeeks, addMonths, parseISO, format, isBefore, startOfDay } from 'date-fns';
import type { ToDo } from '@/types/schema';

// F-TODO-01 — date math for recurring to-dos. Kept as a tiny, pure,
// unit-tested module (like utils/calendarRecurrence.ts) so the atomic
// completion+spawn path in makeCompleteToDo stays trivial and testable.

export type TodoFrequency = 'weekly' | 'bi-weekly' | 'monthly';

export const TODO_FREQUENCIES: readonly TodoFrequency[] = ['weekly', 'bi-weekly', 'monthly'] as const;

/** User-facing labels for the recurrence picker. */
export const TODO_FREQUENCY_LABELS: Record<TodoFrequency, string> = {
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  monthly: 'Monthly',
};

export function isTodoFrequency(value: unknown): value is TodoFrequency {
  return value === 'weekly' || value === 'bi-weekly' || value === 'monthly';
}

/** Advance a `yyyy-MM-dd` date by exactly one period of `frequency`. */
function advanceOnce(date: Date, frequency: TodoFrequency): Date {
  switch (frequency) {
    case 'weekly':
      return addWeeks(date, 1);
    case 'bi-weekly':
      return addWeeks(date, 2);
    case 'monthly':
      // date-fns clamps month-end (Jan 31 -> Feb 28) — acceptable for a due date.
      return addMonths(date, 1);
  }
}

/**
 * Computes the due date (`yyyy-MM-dd`) of the NEXT occurrence when a recurring
 * to-do is completed. Advances one period from the current due date, then keeps
 * advancing until the result is not before `today` — so completing an overdue
 * chore still spawns a next instance in the future rather than another
 * already-past one.
 *
 * @param currentDueDate the completed instance's `completeByDate` (yyyy-MM-dd)
 * @param frequency      recurrence cadence
 * @param today          caller-local "today" (yyyy-MM-dd) — pass getLocalDateString()
 */
export function computeNextTodoDueDate(
  currentDueDate: string,
  frequency: TodoFrequency,
  today: string,
): string {
  const todayStart = startOfDay(parseISO(today));
  let next = advanceOnce(startOfDay(parseISO(currentDueDate)), frequency);
  // Bounded guard against pathological inputs; monthly over ~80y is < 1000.
  for (let i = 0; i < 1000 && isBefore(next, todayStart); i++) {
    next = advanceOnce(next, frequency);
  }
  return format(next, 'yyyy-MM-dd');
}

/**
 * Builds the next-instance to-do payload for a completed recurring to-do.
 * Returns `null` when the to-do is not recurring (caller then skips the spawn).
 * Carries forward everything that defines the chore (text, assignee, priority,
 * notes, importance, points, recurrence) and resets completion state.
 */
export function buildNextRecurringTodo(
  completed: ToDo,
  today: string,
): Omit<ToDo, 'id' | 'createdAt' | 'createdBy'> | null {
  const recurrence = completed.recurrence;
  if (!recurrence || !isTodoFrequency(recurrence.frequency)) {
    return null;
  }
  const next: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'> = {
    text: completed.text,
    completeByDate: computeNextTodoDueDate(completed.completeByDate, recurrence.frequency, today),
    assignedTo: completed.assignedTo,
    isCompleted: false,
    recurrence: {
      frequency: recurrence.frequency,
      // Chain root: reuse the existing root if this instance already has one,
      // otherwise anchor the chain on the instance being completed.
      parentRecurringId: recurrence.parentRecurringId ?? completed.id,
    },
  };
  // Carry forward optional fields only when set (keeps the doc minimal and
  // avoids writing `undefined`, which the sanitizer would strip anyway).
  if (completed.priority !== undefined) next.priority = completed.priority;
  if (completed.notes !== undefined) next.notes = completed.notes;
  if (completed.source !== undefined) next.source = completed.source;
  if (completed.isImportant !== undefined) next.isImportant = completed.isImportant;
  if (completed.points !== undefined) next.points = completed.points;
  // F-TODO-14: a recurring timed chore keeps its time and reminder on every
  // spawned instance. reminderSentAt is deliberately NOT carried — the fresh
  // instance's reminder is re-armed.
  if (completed.dueTime !== undefined) next.dueTime = completed.dueTime;
  if (completed.reminderMinutesBefore !== undefined) {
    next.reminderMinutesBefore = completed.reminderMinutesBefore;
  }
  return next;
}
