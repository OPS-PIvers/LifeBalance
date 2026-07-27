import { addWeeks, addMonths, parseISO, format, isBefore, isValid, startOfDay } from 'date-fns';
import type { Subtask, ToDo } from '@/types/schema';

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
  // Habit Automations (PRD #1065): a linked recurring chore keeps its habit
  // link on every spawned instance, so the automation persists without
  // re-linking each occurrence.
  if (completed.linkedHabitId !== undefined) next.linkedHabitId = completed.linkedHabitId;
  // F-TODO-16: the category defines the chore as much as its text does — a
  // spawned instance that dropped it landed straight in the "needs a category"
  // triage banner every week.
  if (completed.category !== undefined) next.category = completed.category;
  // F-TODO-08: a repeating chore SET keeps its checklist, freshly unchecked —
  // without this the next instance spawned with no steps at all.
  if (completed.subtasks !== undefined) next.subtasks = resetSubtasks(completed.subtasks);
  // The auto-reschedule preference belongs to the chore, not to one occurrence.
  if (completed.resetWhenExpired !== undefined) next.resetWhenExpired = completed.resetWhenExpired;
  return next;
}

/** Returns a copy of `subtasks` with every step unchecked. */
function resetSubtasks(subtasks: Subtask[]): Subtask[] {
  return subtasks.map(sub => (sub.isDone ? { ...sub, isDone: false } : sub));
}

/**
 * "Auto-reschedule" (`ToDo.resetWhenExpired`): a repeating chore whose due date
 * has passed unfinished is not really *overdue* — it should roll forward to the
 * next occurrence of its cadence, with the checklist reset so a fresh period
 * starts clean.
 *
 * Returns the patch to apply (`{ completeByDate, subtasks? }`), or `null` when
 * the to-do isn't eligible. The `subtasks` key is included ONLY when at least
 * one step was actually done, so an already-clean checklist produces no
 * pointless write.
 *
 * Both dates are local `yyyy-MM-dd`, so the lexical `<` compare is
 * chronological (the convention used across this repo — see
 * hooks/useActionQueue.ts).
 *
 * @param todo  the candidate to-do
 * @param today caller-local "today" (yyyy-MM-dd) — pass getLocalDateString()
 */
export function computeExpiredTodoRoll(
  todo: ToDo,
  today: string,
): { completeByDate: string; subtasks?: Subtask[] } | null {
  if (todo.resetWhenExpired !== true) return null;
  const frequency = todo.recurrence?.frequency;
  if (!isTodoFrequency(frequency)) return null;
  if (todo.isCompleted) return null;
  // A held-for-review capture isn't on anyone's list yet — don't move it.
  if (todo.needsReview === true) return null;
  // Never write garbage from a malformed stored date — validate before the
  // lexical compare, which is only chronological for well-formed yyyy-MM-dd.
  if (!todo.completeByDate || !isValid(parseISO(todo.completeByDate))) return null;
  if (!isValid(parseISO(today))) return null;
  if (todo.completeByDate >= today) return null;

  const roll: { completeByDate: string; subtasks?: Subtask[] } = {
    completeByDate: computeNextTodoDueDate(todo.completeByDate, frequency, today),
  };
  if (todo.subtasks?.some(sub => sub.isDone)) {
    roll.subtasks = resetSubtasks(todo.subtasks);
  }
  return roll;
}
