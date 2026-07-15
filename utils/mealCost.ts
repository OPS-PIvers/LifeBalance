/**
 * Weekly meal-cost rollup (F-MEALS-01).
 *
 * Zero-friction cost tracking: a single optional `Meal.estimatedCost` (decimal
 * dollars) set on the recipe itself — no per-ingredient costing, no receipt
 * linking. This util sums/averages that cost across a week's planned meals of
 * a given type (dinners by default), skipping meals without a cost rather
 * than blocking or treating them as $0. Entirely informational — never wired
 * into `safeToSpendCalculator.ts` or bucket math.
 */
import { Meal, MealPlanItem } from '@/types/schema';
import { sumMoney, roundMoney } from '@/utils/money';

export interface WeeklyMealCostSummary {
  /** Sum of `estimatedCost` across planned meals (of `mealType`) in the week that have a cost set. */
  total: number;
  /** `total / countWithCost`, or null when no planned meal in the week has a cost. */
  average: number | null;
  /** Number of planned meals (of `mealType`) in the week that have a cost set. */
  countWithCost: number;
  /** Total number of planned meals (of `mealType`) in the week, cost or not. */
  countTotal: number;
}

/**
 * Roll up estimated cost for planned meals of `mealType` (default `'dinner'`)
 * whose date falls in `[weekStartDate, weekEndDate]` (inclusive, `yyyy-MM-dd`
 * strings). Meals without a linked `Meal` doc, or whose linked `Meal` has no
 * `estimatedCost`, are skipped rather than treated as $0.
 */
export function calculateWeeklyMealCost(
  mealPlan: MealPlanItem[],
  meals: Meal[],
  weekStartDate: string,
  weekEndDate: string,
  mealType: MealPlanItem['type'] = 'dinner'
): WeeklyMealCostSummary {
  const mealsById = new Map(meals.map(m => [m.id, m]));

  const weekItems = mealPlan.filter(
    item => item.type === mealType && item.date >= weekStartDate && item.date <= weekEndDate
  );

  const costs: number[] = [];
  for (const item of weekItems) {
    const linkedMeal = item.mealId ? mealsById.get(item.mealId) : undefined;
    if (typeof linkedMeal?.estimatedCost === 'number' && !Number.isNaN(linkedMeal.estimatedCost)) {
      costs.push(linkedMeal.estimatedCost);
    }
  }

  const total = sumMoney(costs);

  return {
    total,
    average: costs.length > 0 ? roundMoney(total / costs.length) : null,
    countWithCost: costs.length,
    countTotal: weekItems.length,
  };
}
