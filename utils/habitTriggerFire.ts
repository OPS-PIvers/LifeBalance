import { parseISO, isSameWeek } from 'date-fns';
import { Habit } from '@/types/schema';
import {
  processToggleHabit,
  isHabitStale,
  pointsForHabitOnDate,
  streakForHabit,
} from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';

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
  /** New live-period counter (absolute — write only in the `resetCount` case). */
  count: number;
  /** New lifetime counter (absolute; prefer the `totalCountDelta` increment). */
  totalCount: number;
  /**
   * Signed change to the live-period counter, to be written as a Firestore
   * `increment()` delta so a stale-cache device can't clobber a concurrent
   * writer (mirrors habitDeltaUpdate). IGNORE this and write `count` ABSOLUTELY
   * when `resetCount` is true — see that field.
   */
  countDelta: number;
  /** Signed change to the lifetime counter, to be written as `increment()`. */
  totalCountDelta: number;
  /**
   * True only on a stale-habit lazy-reset ('up' fire on a habit whose counter
   * belongs to a previous period): the reset-then-increment collapses to an
   * ABSOLUTE write of `count` (= 0 + delta), which must NOT go through
   * `increment()` because the stored counter is prior-period garbage the reset
   * discards outright. In every other case write `increment(countDelta)`.
   */
  resetCount: boolean;
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
  // An ARCHIVED habit must never fire: the automation is a no-op and the to-do
  // completes normally (a reverse is still allowed so an already-credited fire
  // can be undone). Guarded here AND in fireLinkedHabitInBatch (defense in
  // depth) so no caller can accidentally re-animate a retired habit.
  if (direction === 'up' && habit.archivedAt) return null;

  // Lazy-reset parity with toggleHabit: an 'up' fire on a stale habit acts as
  // if the counter were 0 (the overnight auto-reset never ran). A 'down'
  // reverse leaves the counter untouched — processToggleHabit handles the
  // decrement and its count-0 guard.
  const didReset = direction === 'up' && isHabitStale(habit);
  const effectiveHabit: Habit = didReset
    ? { ...habit, count: 0, lastUpdated: new Date().toISOString() }
    : habit;

  const result = processToggleHabit(effectiveHabit, direction);
  if (!result) return null;

  const prevDates = effectiveHabit.completedDates;
  const nextDates = result.updatedHabit.completedDates ?? prevDates;
  const addedDate = nextDates.find(d => !prevDates.includes(d));
  const removedDate = prevDates.find(d => !nextDates.includes(d));

  const count = result.updatedHabit.count ?? effectiveHabit.count;
  const totalCount = result.updatedHabit.totalCount ?? effectiveHabit.totalCount;

  return {
    count,
    totalCount,
    // Deltas are measured against the REAL stored habit (not the zeroed
    // effectiveHabit) so a non-reset fire increments the actual counter. In the
    // reset case the caller writes `count` absolutely and ignores countDelta.
    countDelta: count - habit.count,
    totalCountDelta: totalCount - habit.totalCount,
    resetCount: didReset,
    streakDays: result.updatedHabit.streakDays ?? effectiveHabit.streakDays,
    ...(addedDate !== undefined ? { addedDate } : {}),
    ...(removedDate !== undefined ? { removedDate } : {}),
    pointsChange: result.pointsChange,
    multiplier: result.multiplier,
  };
}

/**
 * Compute the REVERSE delta for restoring a to-do that previously fired `habit`.
 *
 * Unlike a plain `computeHabitTriggerFire(habit, 'down')` — which keys on TODAY
 * and only ever strips today's completion — this reverses the EXACT date the
 * fire added (`completionDate`, derived from the to-do's `completedAt`). So
 * restoring a to-do completed on a PRIOR day removes that day's completion
 * (`arrayRemove`) and debits the points credited THEN (historical multiplier via
 * `pointsForHabitOnDate`/`streakEndingOnForHabit`, matching how the fire scored
 * them) instead of corrupting the current period's counter, streak, and points.
 *
 * @param completionDate yyyy-MM-dd the fire added (the local date of the to-do's
 *                       `completedAt`). When it falls in the current period the
 *                       reversal is identical to the manual same-day down toggle.
 * @param today          caller-local yyyy-MM-dd; injectable for deterministic
 *                       boundary tests.
 * @returns the reverse delta, or `null` when there is nothing to reverse (the
 *          habit is already at count 0 for a same-period restore, or the date is
 *          no longer a completion — e.g. it was already restored).
 */
export function computeHabitTriggerReverse(
  habit: Habit,
  completionDate: string,
  today: string = getLocalDateString(),
): HabitFireDelta | null {
  const inCurrentPeriod =
    habit.period === 'weekly'
      ? isSameWeek(parseISO(completionDate), parseISO(today), { weekStartsOn: 1 })
      : completionDate === today;

  // Same-period restore: the fire's effect is still described by the live
  // counter, so the manual same-day 'down' toggle is its exact inverse (it keys
  // on today, which equals completionDate here — count/points/date all match).
  if (inCurrentPeriod) {
    return computeHabitTriggerFire(habit, 'down');
  }

  // Prior-period restore: the current counter belongs to a LATER period and
  // must be left untouched (mirrors processStaleDownToggle, but keyed to the
  // to-do's exact completion date instead of "the most recent prior day").
  // Nothing to reverse if that day is no longer a completion.
  if (!habit.completedDates.includes(completionDate)) return null;

  // Reverse exactly what the fire credited on that date: the historical,
  // streak-multiplied points for that completion (0 for a no-points fire).
  const earned = pointsForHabitOnDate(habit, completionDate, today);
  const nextDates = habit.completedDates.filter(d => d !== completionDate);
  const streakDays = streakForHabit({ ...habit, completedDates: nextDates });

  return {
    // Untouched — the live counter belongs to the current period, not the
    // prior period this reversal is undoing.
    count: habit.count,
    countDelta: 0,
    // The fire incremented the lifetime counter; disavow that one completion.
    totalCount: Math.max(0, habit.totalCount - 1),
    // -1, but floored so a lifetime counter already at 0 isn't driven negative.
    totalCountDelta: Math.max(0, habit.totalCount - 1) - habit.totalCount,
    resetCount: false,
    streakDays,
    removedDate: completionDate,
    pointsChange: -earned,
    multiplier: 1.0,
  };
}
