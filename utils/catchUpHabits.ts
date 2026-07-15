import { Habit } from '@/types/schema';

/**
 * F-HABITS-09: pure selection logic for the "Catch up yesterday" bulk action.
 * A habit is eligible when it's a positive, shared/unassigned habit (kid
 * chores are `assignedTo`-gated and excluded from the parent tracker
 * entirely — callers pass the already-filtered parent-visible habit list)
 * that was completed yesterday but hasn't been touched yet today.
 *
 * Kept separate from `habitLogic.ts` since it's pure list-filtering, not
 * scoring/streak math.
 */
export function getCatchUpEligibleHabits(habits: Habit[], today: string, yesterday: string): Habit[] {
  return habits.filter(
    (h) =>
      h.type === 'positive' &&
      h.completedDates.includes(yesterday) &&
      !h.completedDates.includes(today)
  );
}
