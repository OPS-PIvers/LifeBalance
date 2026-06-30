import type { YearlyGoal } from '@/types/schema';

/**
 * A yearly goal is "On Track" when the number of months completed so far is
 * within 2 of the required total — i.e. it's still achievable given the months
 * remaining. The 2-month grace window matches the dashboard status pill, and was
 * previously hand-inlined (the magic `requiredMonths - 2`) in multiple widgets.
 */
export function isYearlyGoalOnTrack(
  goal: Pick<YearlyGoal, 'successfulMonths' | 'requiredMonths'>
): boolean {
  return goal.successfulMonths.length >= goal.requiredMonths - 2;
}
