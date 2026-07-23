import { Subtask } from '@/types/schema';

/**
 * Pure helpers for the F-TODO-08 subtask checklist. Subtasks live as a plain
 * array field on the parent `ToDo`; these functions produce new arrays (never
 * mutate) so callers can hand the result straight to `updateToDo`/`addToDo`.
 */

/**
 * Generates a stable, collision-resistant id for a new subtask. Uses
 * `crypto.randomUUID` where available (browsers, modern jsdom) and falls back to
 * a timestamp+random string so it stays usable in any environment.
 */
export function newSubtaskId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Creates a new, incomplete subtask from a text label. Returns null for blank text. */
export function makeSubtask(text: string): Subtask | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { id: newSubtaskId(), text: trimmed, isDone: false };
}

export interface SubtaskProgress {
  done: number;
  total: number;
  /** Fraction 0..1 (0 when there are no subtasks). */
  fraction: number;
  /** True when there is at least one subtask and all are done. */
  allDone: boolean;
}

/** Computes completion progress for a (possibly undefined) subtask list. */
export function subtaskProgress(subtasks: Subtask[] | undefined): SubtaskProgress {
  const list = subtasks ?? [];
  const total = list.length;
  const done = list.reduce((n, s) => (s.isDone ? n + 1 : n), 0);
  return {
    done,
    total,
    fraction: total > 0 ? done / total : 0,
    allDone: total > 0 && done === total,
  };
}

/** Returns a new array with the given subtask's `isDone` flipped. */
export function toggleSubtask(subtasks: Subtask[] | undefined, id: string): Subtask[] {
  return (subtasks ?? []).map(s => (s.id === id ? { ...s, isDone: !s.isDone } : s));
}

/**
 * Returns a new array with the given subtask's `isDone` set to an EXPLICIT value
 * (idempotent, unlike `toggleSubtask`). This is the merge primitive for inline
 * subtask edits: a completion/undo path applies the caller's intended state to
 * ITS OWN freshest read of the array by id, so a concurrent add/toggle of a
 * DIFFERENT subtask from another device survives instead of being clobbered by a
 * stale whole-array snapshot. Absent id → array returned unchanged.
 */
export function setSubtaskDone(subtasks: Subtask[] | undefined, id: string, done: boolean): Subtask[] {
  return (subtasks ?? []).map(s => (s.id === id ? { ...s, isDone: done } : s));
}

/** Returns a new array with the subtask removed. */
export function removeSubtask(subtasks: Subtask[] | undefined, id: string): Subtask[] {
  return (subtasks ?? []).filter(s => s.id !== id);
}

/** Returns a new array with the subtask's text updated (trimmed). No-op for a blank result. */
export function updateSubtaskText(
  subtasks: Subtask[] | undefined,
  id: string,
  text: string,
): Subtask[] {
  const trimmed = text.trim();
  if (!trimmed) return subtasks ?? [];
  return (subtasks ?? []).map(s => (s.id === id ? { ...s, text: trimmed } : s));
}

/**
 * Appends a new subtask built from `text`. Returns the original array unchanged
 * when the text is blank.
 */
export function appendSubtask(subtasks: Subtask[] | undefined, text: string): Subtask[] {
  const created = makeSubtask(text);
  if (!created) return subtasks ?? [];
  return [...(subtasks ?? []), created];
}

/**
 * Builds a fresh subtask list from AI-suggested (or pasted) text lines. Blank
 * lines are dropped and each surviving line becomes an incomplete subtask.
 */
export function subtasksFromTexts(texts: string[]): Subtask[] {
  return texts
    .map(makeSubtask)
    .filter((s): s is Subtask => s !== null);
}

/**
 * Whether a caught error looks like a Firestore permission rejection. Used so the
 * subtask feature can degrade gracefully while the `subtasks` field is not yet on
 * the firestore.rules whitelist: the write is rejected with `permission-denied`,
 * and callers show a specific "not available yet" message instead of a generic
 * failure.
 */
export function isPermissionDeniedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.includes('permission-denied')) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.toLowerCase().includes('permission');
}

/** User-facing toast message for a failed subtask write. */
export function subtaskWriteErrorMessage(error: unknown): string {
  return isPermissionDeniedError(error)
    ? "Subtasks aren't available yet — try again later."
    : 'Failed to update subtask';
}
