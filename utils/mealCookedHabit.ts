import { Habit } from '@/types/schema';
import { isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';

/**
 * F-MEALS-04: pure decision logic for whether marking a meal-plan item cooked
 * (or un-cooked) should auto-toggle the household's linked "cook at home"
 * habit (`Household.mealCookedHabitId`).
 *
 * `toggleHabit` (see hooks/useHabitActions.tsx) always operates on TODAY —
 * it has no date parameter — so this only fires when the plan item's date is
 * today; a meal cooked/planned for a different day can't retroactively credit
 * or uncredit the habit, and we'd rather no-op than silently touch the wrong
 * day. Toggling is also skipped when the habit is already in the desired
 * completion state, since `toggleHabit` is a flip (not an idempotent set) and
 * calling it when already-matching would flip it the WRONG way.
 */
export interface MealCookedHabitDecision {
  habitId: string;
  direction: 'up' | 'down';
}

export const decideMealCookedHabitToggle = (params: {
  mealCookedHabitId: string | null | undefined;
  habits: Pick<Habit, 'id' | 'period' | 'completedDates'>[];
  planItemDate: string;
  today: string;
  isCooked: boolean;
}): MealCookedHabitDecision | null => {
  const { mealCookedHabitId, habits, planItemDate, today, isCooked } = params;

  if (!mealCookedHabitId) return null;
  if (planItemDate !== today) return null;

  const habit = habits.find(h => h.id === mealCookedHabitId);
  if (!habit) return null;

  const isCompleted = isHabitCompletedInCurrentPeriod(habit, today);

  if (isCooked && !isCompleted) return { habitId: habit.id, direction: 'up' };
  if (!isCooked && isCompleted) return { habitId: habit.id, direction: 'down' };
  return null;
};
