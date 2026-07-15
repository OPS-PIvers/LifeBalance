import { Habit, HabitSubmission } from '@/types/schema';
import { streakForHabit } from '@/utils/habitLogic';

/**
 * Habit-history repair (2026-07-15 incident): rebuild a habit's
 * `completedDates` from its stored submission docs after a stale-cache device
 * wholesale-overwrote the array (see the arrayRemove fix in
 * FirebaseHouseholdContext.checkHabitResets).
 *
 * Submissions are the surviving source of truth: they are per-event documents
 * in `habits/{id}/submissions` that no reset path ever touches. A date counts
 * as complete when:
 *   - incremental habit: any submission exists on that date, or
 *   - threshold habit: the date's summed submission counts reach targetCount
 * — mirroring the `marksDateComplete` rule in useHabitActions.
 *
 * The repair is strictly ADDITIVE: it returns only the dates missing from the
 * current array (for an `arrayUnion` write), so re-running is idempotent and
 * days logged via the toggle path (which leave no submissions) are never
 * removed. Toggle-only days lost in the incident cannot be reconstructed from
 * submissions; those are re-entered by hand via the day editor.
 */
export interface HabitRepairPlan {
  /** Dates proven complete by submissions but absent from completedDates. */
  missingDates: string[];
  /** Streak recomputed over the merged (existing ∪ missing) history. */
  streakDays: number;
}

export const computeHabitHistoryRepair = (
  habit: Pick<
    Habit,
    'scoringType' | 'targetCount' | 'completedDates' | 'period' | 'frozenDates' | 'pausedUntil'
  >,
  submissions: Pick<HabitSubmission, 'date' | 'count'>[]
): HabitRepairPlan | null => {
  if (submissions.length === 0) return null;

  const countsByDate = new Map<string, number>();
  for (const s of submissions) {
    countsByDate.set(s.date, (countsByDate.get(s.date) ?? 0) + s.count);
  }

  const target = Math.max(1, habit.targetCount ?? 1);
  const existing = new Set(habit.completedDates);
  const missingDates: string[] = [];
  for (const [date, total] of countsByDate) {
    const complete = habit.scoringType === 'incremental' || total >= target;
    if (complete && !existing.has(date)) missingDates.push(date);
  }

  if (missingDates.length === 0) return null;

  missingDates.sort();
  const merged = [...habit.completedDates, ...missingDates];
  return {
    missingDates,
    streakDays: streakForHabit({
      period: habit.period,
      completedDates: merged,
      frozenDates: habit.frozenDates,
      pausedUntil: habit.pausedUntil,
    }),
  };
};
