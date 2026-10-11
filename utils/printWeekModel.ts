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
  /** Short weekday, e.g. "Mon". */
  weekday: string;
  /** Day of month, e.g. "5". */
  dayOfMonth: string;
}

export interface PrintMeal {
  typeLabel: string;
  mealName: string;
  /** Ingredients still on the (unpurchased) shopping list. */
  toBuy: MealIngredient[];
  /** Ingredients not on the unpurchased list — already in the house, or bought. */
  onHand: MealIngredient[];
}

export interface PrintDay extends PrintWeekDate {
  meals: PrintMeal[];
}

export interface PrintShoppingStore {
  storeLabel: string;
  /** Category-sorted, so an aisle's items sit together without a subheading. */
  items: { name: string; quantity?: string | number }[];
}

export interface PrintWeek {
  days: PrintDay[];
  shopping: PrintShoppingStore[];
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
          (onListKeys.has(key) ? toBuy : onHand).push(ingredient);
        });
        return { typeLabel: MEAL_TYPE_LABEL[item.type], mealName: meal?.name || item.mealName, toBuy, onHand };
      });
    return { ...weekDate, meals };
  });

  const shopping = groupShoppingListByStore(unpurchased).map(store => ({
    storeLabel: store.storeLabel,
    items: store.categories.flatMap(category =>
      category.items.map(item => ({ name: item.name, quantity: item.quantity }))
    ),
  }));

  return { days, shopping };
};
