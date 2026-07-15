import { Meal, MealPlanItem } from '@/types/schema';

const MEAL_TYPE_ORDER: Record<MealPlanItem['type'], number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

const MEAL_TYPE_LABEL: Record<MealPlanItem['type'], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** One day's worth of plan items, grouped and ordered breakfast → snack, for formatting/rendering. */
export interface FormattedMealDay {
  /** yyyy-MM-dd */
  date: string;
  /** e.g. "Monday, Jul 14" */
  label: string;
  items: { type: MealPlanItem['type']; typeLabel: string; mealName: string }[];
}

/**
 * Groups a flat list of MealPlanItems (already filtered to the target week) by
 * date, resolving each item's display name from the linked Meal when present
 * (falling back to the item's own snapshot `mealName`), and orders meal types
 * breakfast → lunch → dinner → snack within each day.
 *
 * `dayLabels` maps each `yyyy-MM-dd` date in the week to a display label (e.g.
 * "Monday, Jul 14") — callers already have a date-formatting utility (date-fns)
 * in scope, so this stays a pure string-keyed function with no date library
 * dependency of its own.
 */
export const groupMealPlanByDay = (
  items: MealPlanItem[],
  mealsById: Map<string, Meal>,
  dayLabels: Map<string, string>
): FormattedMealDay[] => {
  const byDate = new Map<string, MealPlanItem[]>();
  items.forEach(item => {
    const existing = byDate.get(item.date);
    if (existing) {
      existing.push(item);
    } else {
      byDate.set(item.date, [item]);
    }
  });

  return [...dayLabels.entries()]
    .filter(([date]) => byDate.has(date))
    .map(([date, label]) => {
      const dayItems = (byDate.get(date) ?? [])
        .slice()
        .sort((a, b) => MEAL_TYPE_ORDER[a.type] - MEAL_TYPE_ORDER[b.type])
        .map(item => ({
          type: item.type,
          typeLabel: MEAL_TYPE_LABEL[item.type],
          mealName: (item.mealId && mealsById.get(item.mealId)?.name) || item.mealName,
        }));
      return { date, label, items: dayItems };
    });
};

/**
 * Plain-text rendering of a week's meal plan, mirroring
 * `formatShoppingListForShare`'s shape for `navigator.share()`/clipboard use.
 * Days with no planned meals are omitted.
 */
export const formatMealPlanForShare = (days: FormattedMealDay[]): string => {
  const populated = days.filter(day => day.items.length > 0);
  if (populated.length === 0) return '';

  const lines: string[] = ['Meal Plan', ''];
  populated.forEach(day => {
    lines.push(day.label);
    day.items.forEach(item => {
      lines.push(`${item.typeLabel}: ${item.mealName}`);
    });
    lines.push('');
  });

  return lines.join('\n').trim();
};
