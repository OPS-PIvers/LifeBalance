import { Habit } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { isHabitPaused, isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';

/**
 * "Day complete" peak-end moment (impeccable r5).
 *
 * Pure trigger logic for the end-of-day celebration: completing your LAST due
 * daily habit is the emotional peak of the habit loop, so this decides when the
 * moment should fire. Kept dependency-light and injectable (`today`, `storage`)
 * so the decision is fully unit-testable — see `dayComplete.test.ts`.
 *
 * "Due today" is deliberately NARROWER than the PulseStrip consistency count
 * (which includes negative/archived/paused daily habits): this trigger scopes
 * to habits you can actually *finish today*, so the celebration can fire even
 * while, e.g., an untriggered negative habit still shows on the Track tab:
 *   - `period === 'daily'` — weekly habits are due sometime this week, not today,
 *     so they never gate the daily moment;
 *   - `type === 'positive'` — a negative habit (e.g. "late-night snack") is never
 *     "done"; counting it would make the day impossible to complete;
 *   - not a kid chore (`assignedTo` unset) — matches the parent tracker;
 *   - not archived, not on a planned pause.
 */

/** Minimal habit shape the day-complete logic reads (tests pass partials). */
export type DayCompleteHabit = Pick<Habit, 'period' | 'type' | 'completedDates'> &
  Partial<Pick<Habit, 'assignedTo' | 'archivedAt' | 'pausedUntil'>>;

/** A positive daily habit the user can finish today (not assigned/archived/paused). */
export const isDueToday = (habit: DayCompleteHabit, today: string): boolean =>
  habit.period === 'daily' &&
  habit.type === 'positive' &&
  !habit.assignedTo &&
  !habit.archivedAt &&
  !isHabitPaused(habit, today);

export interface DayCompleteStatus {
  /** Positive daily habits due today. */
  total: number;
  /** How many of those are completed today. */
  done: number;
  /** True iff there is at least one due habit AND every due habit is done. */
  isComplete: boolean;
}

/**
 * Derive the day's completion status from the habit list. `total === 0` (no due
 * daily habits) is never "complete" — there is no day to finish.
 */
export const getDayCompleteStatus = (
  habits: DayCompleteHabit[],
  today: string = getLocalDateString(),
): DayCompleteStatus => {
  const due = habits.filter((h) => isDueToday(h, today));
  const done = due.filter((h) => isHabitCompletedInCurrentPeriod(h, today)).length;
  return { total: due.length, done, isComplete: due.length > 0 && done === due.length };
};

/**
 * localStorage key namespacing the "already celebrated" flag per local day, so
 * the moment fires at most once per device per day — and, crucially, does NOT
 * re-fire if the user undoes the completing toggle and re-completes it.
 */
export const DAY_COMPLETE_STORAGE_PREFIX = 'lifebalance:day-complete-celebrated:';

export const dayCompleteStorageKey = (today: string): string =>
  `${DAY_COMPLETE_STORAGE_PREFIX}${today}`;

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** Has the day-complete moment already fired on this device today? Never throws. */
export const hasDayCompleteFired = (
  today: string,
  storage: ReadableStorage | null | undefined,
): boolean => {
  if (!storage) return false;
  try {
    return storage.getItem(dayCompleteStorageKey(today)) === '1';
  } catch {
    // Private-mode / disabled storage → treat as "not fired" (fail-open shows
    // the moment at most once more; it can never spam because a single successful
    // write below latches it).
    return false;
  }
};

/** Latch today's moment as fired. Swallows quota/permission errors. */
export const markDayCompleteFired = (
  today: string,
  storage: WritableStorage | null | undefined,
): void => {
  if (!storage) return;
  try {
    storage.setItem(dayCompleteStorageKey(today), '1');
  } catch {
    /* storage full / denied — nothing we can do, just skip the latch */
  }
};

/**
 * The single pure predicate the hook consults: fire iff the day just BECAME
 * complete (a false→true transition), and it hasn't already fired today.
 *
 * - `wasComplete` false → true is the transition; re-completing after an undo
 *   passes the transition check but is stopped by `hasDayCompleteFired`.
 * - staying complete across renders (`wasComplete` already true) never re-fires.
 */
export const shouldFireDayComplete = (params: {
  wasComplete: boolean;
  status: DayCompleteStatus;
  today: string;
  storage: ReadableStorage | null | undefined;
}): boolean =>
  params.status.isComplete &&
  !params.wasComplete &&
  !hasDayCompleteFired(params.today, params.storage);
