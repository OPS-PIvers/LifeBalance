import { Meal, MealIngredient, MealPlanItem, ShoppingItem } from '@/types/schema';
import { groupShoppingListByStore } from '@/utils/shoppingListFormatter';
import { normalizeToKey } from '@/utils/stringNormalizer';

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

/** One calendar day of the printed week, as the caller formats it. */
export interface PrintWeekDate {
  /** yyyy-MM-dd */
  date: string;
  /** Short weekday, e.g. "Mon" — also used to tag shopping items. */
  weekday: string;
  /** Day of month, e.g. "5". */
  dayOfMonth: string;
}

export interface PrintMeal {
  typeLabel: string;
  mealName: string;
  /** True when the plan item links to a saved recipe that lists ingredients. */
  hasIngredients: boolean;
  /** Ingredients still on the (unpurchased) shopping list. */
  toBuy: MealIngredient[];
  /** Ingredients not on the unpurchased list — already in the house, or bought. */
  onHand: MealIngredient[];
}

export interface PrintDay extends PrintWeekDate {
  meals: PrintMeal[];
}

export interface PrintShoppingItem {
  name: string;
  quantity?: string | number;
  /** Weekdays whose planned meals call for this item, in week order. */
  forDays: string[];
}

export interface PrintShoppingStore {
  storeLabel: string;
  categories: { display: string; items: PrintShoppingItem[] }[];
}

export interface PrintWeek {
  days: PrintDay[];
  shopping: PrintShoppingStore[];
  mealCount: number;
  toBuyCount: number;
}

/**
 * Builds everything the printed week shows from live household data.
 *
 * "Have vs. still need" is DERIVED from the shopping list rather than stored on
 * the meal: adding a meal (or "Shop for week") puts only the ingredients you
 * don't have onto the list, so an ingredient whose name is on the UNPURCHASED
 * list is still to buy, and anything else — never added, or added and since
 * checked off — is on hand. Matching uses the same `normalizeToKey` the
 * add-to-list flows dedupe by, so the sheet agrees with what those flows did.
 */
export const buildPrintWeek = (
  weekDates: PrintWeekDate[],
  planItems: MealPlanItem[],
  mealsById: Map<string, Meal>,
  shoppingList: ShoppingItem[]
): PrintWeek => {
  const unpurchased = shoppingList.filter(item => !item.isPurchased);
  const onListKeys = new Set(unpurchased.map(item => normalizeToKey(item.name)));
  const daysByKey = new Map<string, string[]>();

  const days = weekDates.map(weekDate => {
    const meals = planItems
      .filter(item => item.date === weekDate.date)
      .sort((a, b) => MEAL_TYPE_ORDER[a.type] - MEAL_TYPE_ORDER[b.type])
      .map((item): PrintMeal => {
        const meal = item.mealId ? mealsById.get(item.mealId) : undefined;
        const seen = new Set<string>();
        const toBuy: MealIngredient[] = [];
        const onHand: MealIngredient[] = [];
        (meal?.ingredients ?? []).forEach(ingredient => {
          const key = normalizeToKey(ingredient.name);
          if (!key || seen.has(key)) return;
          seen.add(key);
          if (onListKeys.has(key)) {
            toBuy.push(ingredient);
            const forDays = daysByKey.get(key) ?? [];
            if (!forDays.includes(weekDate.weekday)) forDays.push(weekDate.weekday);
            daysByKey.set(key, forDays);
          } else {
            onHand.push(ingredient);
          }
        });
        return {
          typeLabel: MEAL_TYPE_LABEL[item.type],
          mealName: meal?.name || item.mealName,
          hasIngredients: seen.size > 0,
          toBuy,
          onHand,
        };
      });
    return { ...weekDate, meals };
  });

  const shopping = groupShoppingListByStore(unpurchased).map(store => ({
    storeLabel: store.storeLabel,
    categories: store.categories.map(category => ({
      display: category.display,
      items: category.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        forDays: daysByKey.get(normalizeToKey(item.name)) ?? [],
      })),
    })),
  }));

  return {
    days,
    shopping,
    mealCount: days.reduce((sum, day) => sum + day.meals.length, 0),
    toBuyCount: unpurchased.length,
  };
};
