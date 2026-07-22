import { ToDo } from '@/types/schema';
import { subtaskProgress } from '@/utils/subtasks';

/**
 * Habit Automations (PRD #1065): a habit-LINKED to-do can't be completed until
 * every subtask is done — the habit should only fire when the work is truly
 * finished. This is the SINGLE SOURCE OF TRUTH for that rule so every completion
 * path (the row checkbox, multi-select Complete, the Action Queue swipe/bulk
 * approve) enforces it identically, not just the row's disabled-checkbox UX.
 */

export interface TodoSubtaskGate {
  /** True when completion must be refused (linked habit + unfinished subtasks). */
  blocked: boolean;
  /** Remaining unfinished subtasks (0 when not blocked / no subtasks). */
  stepsLeft: number;
}

/** Pure predicate: should completing this to-do be blocked by unfinished subtasks? */
export function evaluateTodoSubtaskGate(
  todo: Pick<ToDo, 'linkedHabitId' | 'subtasks'>,
): TodoSubtaskGate {
  const total = todo.subtasks?.length ?? 0;
  const { done } = subtaskProgress(todo.subtasks);
  const stepsLeft = total - done;
  const blocked = Boolean(todo.linkedHabitId) && total > 0 && stepsLeft > 0;
  return { blocked, stepsLeft: blocked ? stepsLeft : 0 };
}

/**
 * Typed refusal thrown by `completeToDo` when the subtask gate blocks a
 * habit-linked to-do. Call sites recognize it (via `isTodoSubtasksIncompleteError`)
 * and surface a "n steps left" message instead of a generic failure; bulk paths
 * skip the item and report it separately.
 */
export class TodoSubtasksIncompleteError extends Error {
  readonly code = 'todo-subtasks-incomplete' as const;
  readonly todoId: string;
  readonly title: string;
  readonly stepsLeft: number;

  constructor(todoId: string, title: string, stepsLeft: number) {
    super(`"${title}" has ${stepsLeft} step${stepsLeft === 1 ? '' : 's'} left`);
    this.name = 'TodoSubtasksIncompleteError';
    this.todoId = todoId;
    this.title = title;
    this.stepsLeft = stepsLeft;
  }
}

/**
 * Narrows an unknown caught value to the subtask-gate refusal. Matches both the
 * instance and the structural `code` (an error crossing an async/settled
 * boundary can lose its prototype), so call sites reliably distinguish an
 * expected refusal from a real failure.
 */
export function isTodoSubtasksIncompleteError(
  error: unknown,
): error is TodoSubtasksIncompleteError {
  if (error instanceof TodoSubtasksIncompleteError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'todo-subtasks-incomplete'
  );
}
