/**
 * Maps a WeeklyPlan (the `weekly-meals` `week.json` interchange shape) into
 * LifeBalance's native models so a generated or imported plan can be written
 * into the meal plan + shopping list. Pure functions — fully unit-testable.
 */
import { addDays, format, parseISO } from 'date-fns';
import { Meal, MealIngredient, MealPlanItem, ShoppingItem } from '@/types/schema';
import {
  WeeklyPlan,
  WeeklyPlanMeal,
  WeeklyPlanGroceryItem,
  WeeklyPlanStep,
} from '@/types/weeklyPlan';

/** Maps a `week.json` grocery section onto a LifeBalance grocery category. */
const SECTION_TO_CATEGORY: Record<string, string> = {
  meat: 'Meat',
  seafood: 'Meat',
  produce: 'Produce',
  dairy: 'Dairy',
  frozen: 'Frozen',
  pantry: 'Pantry',
  bakery: 'Pantry',
  snacks: 'Snacks',
  snack: 'Snacks',
  beverages: 'Beverages',
  beverage: 'Beverages',
  drinks: 'Beverages',
  household: 'Household',
};

export const mapSectionToCategory = (sec?: string): string => {
  if (!sec) return 'Uncategorized';
  return SECTION_TO_CATEGORY[sec.trim().toLowerCase()] ?? 'Uncategorized';
};

/**
 * Splits a display-form ingredient string ("2 lb chicken thighs") into a
 * {name, quantity} pair. Falls back to the whole string as the name when no
 * leading quantity is detected ("Kosher salt").
 */
export const parseIngredientString = (raw: string): MealIngredient => {
  const value = raw.trim();
  // Leading number / fraction / unicode fraction, with an optional unit word.
  const match = /^([\d./¼½¾⅓⅔⅛]+\s*[a-zA-Z]*\.?)\s+(.+)$/.exec(value);
  if (match) {
    return { name: match[2].trim(), quantity: match[1].trim() };
  }
  return { name: value, quantity: '' };
};

/** Renders a prep/cook step as a single instruction line. */
const stepToInstruction = (s: WeeklyPlanStep): string => {
  const title = s.t?.trim() || '';
  if (s.det && s.det.length) {
    return `${title}: ${s.det.map(d => d.trim()).filter(Boolean).join('; ')}`;
  }
  return title;
};

/** Converts a single WeeklyPlan meal into a LifeBalance Meal (sans id). */
export const weeklyPlanMealToMeal = (meal: WeeklyPlanMeal): Omit<Meal, 'id'> => {
  const instructions = [
    ...(meal.prep ?? []).map(stepToInstruction),
    ...(meal.cook ?? []).map(stepToInstruction),
  ].filter(Boolean);

  const tags = [meal.cuisine, meal.effort]
    .map(t => (t ? t.trim() : ''))
    .filter((t): t is string => !!t);

  return {
    name: meal.name,
    description: meal.blurb || '',
    ingredients: (meal.ingredients ?? []).map(parseIngredientString),
    instructions,
    recipeUrl: '',
    tags,
    rating: 0,
  };
};

export interface MappedPlanItem {
  /** Index into the mapped `meals` array (meals have no id until persisted). */
  mealIndex: number;
  date: string;
  type: MealPlanItem['type'];
}

export interface MappedWeeklyPlan {
  meals: Omit<Meal, 'id'>[];
  planItems: MappedPlanItem[];
  shoppingItems: Omit<ShoppingItem, 'id'>[];
}

/**
 * Maps an entire WeeklyPlan into LifeBalance models.
 *
 * Meals carry no dates in `week.json` (the rule is "cook them in order"), so
 * dinners are scheduled on consecutive days starting at `startDate`. The
 * shopping list is built from the consolidated `items[]` (not per-meal
 * ingredients) to preserve the deduped, store-aware grocery list.
 *
 * @param plan - The plan to map.
 * @param opts.startDate - "YYYY-MM-DD" date for the first dinner (defaults to
 *   `plan.weekOf`).
 */
export const mapWeeklyPlan = (
  plan: WeeklyPlan,
  opts?: { startDate?: string },
): MappedWeeklyPlan => {
  const startDate = opts?.startDate || plan.weekOf;
  const baseDate = parseISO(startDate);

  const meals = (plan.meals ?? []).map(weeklyPlanMealToMeal);

  const planItems: MappedPlanItem[] = (plan.meals ?? []).map((_meal, i) => ({
    mealIndex: i,
    date: format(addDays(baseDate, i), 'yyyy-MM-dd'),
    type: 'dinner',
  }));

  const shoppingItems: Omit<ShoppingItem, 'id'>[] = (plan.items ?? [])
    .filter(it => it && it.n && it.n.trim())
    .map((it, idx) => {
      const storeName = it.store ? plan.stores?.[it.store]?.name || it.store : undefined;
      const item: Omit<ShoppingItem, 'id'> = {
        name: it.n.trim(),
        category: mapSectionToCategory(it.sec),
        quantity: it.q || '',
        isPurchased: false,
        order: idx,
      };
      if (storeName) item.store = storeName;
      if (it.note) item.notes = it.note;
      return item;
    });

  return { meals, planItems, shoppingItems };
};

// --- Shopping list money helpers (mirror the web app's subtotals) ----------

export const itemPrice = (it: WeeklyPlanGroceryItem): number =>
  typeof it.p === 'number' && Number.isFinite(it.p) ? it.p : 0;

/** Sum of prices for a set of grocery items. */
export const subtotal = (items: WeeklyPlanGroceryItem[]): number =>
  items.reduce((acc, it) => acc + itemPrice(it), 0);

/** Grand total across the whole plan's grocery list. */
export const grandTotal = (plan: WeeklyPlan): number => subtotal(plan.items ?? []);

/** Groups grocery items by their store key, preserving `storeOrder`. */
export const groupItemsByStore = (
  plan: WeeklyPlan,
): { key: string; name: string; why?: string; items: WeeklyPlanGroceryItem[] }[] => {
  const items = plan.items ?? [];
  const seen = new Set<string>();
  const order: string[] = [];

  // Honor explicit storeOrder first, then any stores encountered in items.
  (plan.storeOrder ?? []).forEach(k => {
    if (!seen.has(k)) { seen.add(k); order.push(k); }
  });
  items.forEach(it => {
    const k = it.store || 'other';
    if (!seen.has(k)) { seen.add(k); order.push(k); }
  });

  return order
    .map(key => ({
      key,
      name: plan.stores?.[key]?.name || (key === 'other' ? 'Other' : key),
      why: plan.stores?.[key]?.why,
      items: items.filter(it => (it.store || 'other') === key),
    }))
    .filter(group => group.items.length > 0);
};
