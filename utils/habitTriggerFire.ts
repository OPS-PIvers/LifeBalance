import { Habit } from '@/types/schema';
import { processToggleHabit, isHabitStale } from '@/utils/habitLogic';

/**
 * Habit Automations (PRD #1065) — translating an automated trigger (a linked
 * to-do completing/restoring, a transaction chip, a geo confirm) into the field
 * deltas needed to fire the habit EXACTLY like one manual tap.
 *
 * "Fires like one manual tap" is the invariant: this reuses the same
 * `processToggleHabit` scoring/streak/multiplier logic the interactive toggle
 * uses (see hooks/useHabitActions.tsx `toggleHabit`), including the lazy-reset
 * of a STALE habit (a habit whose counter belongs to a previous period is
 * treated as count 0 before an 'up' fire, matching the toggle path).
 *
 * The returned shape is plain data — no Firestore `FieldValue`s — so the caller
 * writes the `completedDates` change as a server-side `arrayUnion`/`arrayRemove`
 * DELTA (`addedDate`/`removedDate`), never the whole array, matching the
 * project's "never wholesale-overwrite completion history" rule. Pure and
 * unit-testable; no Firestore, no side effects.
 */
export interface HabitFireDelta {
  /** New live-period counter. */
  count: number;
  /** New lifetime counter. */
  totalCount: number;
  /** Recomputed period-aware streak. */
  streakDays: number;
  /** Date newly added to completedDates (write as arrayUnion), if any. */
  addedDate?: string;
  /** Date newly removed from completedDates (write as arrayRemove), if any. */
  removedDate?: string;
  /** Signed points delta to apply to the points target (may be 0). */
  pointsChange: number;
  /** The streak multiplier that produced pointsChange (1.0 / 1.5 / 2.0). */
  multiplier: number;
}

/**
 * Compute the fire (`'up'`) or reverse (`'down'`) delta for firing `habit` from
 * an automated trigger. Returns `null` when the toggle is a no-op (e.g. a
 * `'down'` reverse of a habit already at count 0), mirroring
 * `processToggleHabit`.
 */
export function computeHabitTriggerFire(
  habit: Habit,
  direction: 'up' | 'down',
): HabitFireDelta | null {
  // Lazy-reset parity with toggleHabit: an 'up' fire on a stale habit acts as
  // if the counter were 0 (the overnight auto-reset never ran). A 'down'
  // reverse leaves the counter untouched — processToggleHabit handles the
  // decrement and its count-0 guard.
  const effectiveHabit: Habit =
    direction === 'up' && isHabitStale(habit)
      ? { ...habit, count: 0, lastUpdated: new Date().toISOString() }
      : habit;

  const result = processToggleHabit(effectiveHabit, direction);
  if (!result) return null;

  const prevDates = effectiveHabit.completedDates;
  const nextDates = result.updatedHabit.completedDates ?? prevDates;
  const addedDate = nextDates.find(d => !prevDates.includes(d));
  const removedDate = prevDates.find(d => !nextDates.includes(d));

  return {
    count: result.updatedHabit.count ?? effectiveHabit.count,
    totalCount: result.updatedHabit.totalCount ?? effectiveHabit.totalCount,
    streakDays: result.updatedHabit.streakDays ?? effectiveHabit.streakDays,
    ...(addedDate !== undefined ? { addedDate } : {}),
    ...(removedDate !== undefined ? { removedDate } : {}),
    pointsChange: result.pointsChange,
    multiplier: result.multiplier,
  };
}
