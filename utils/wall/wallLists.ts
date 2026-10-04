import type { GroceryCatalogItem, Meal, MealIngredient, MealPlanItem, ShoppingItem, Store, ToDo } from '@/types/schema';
import { addDaysTo, weekdayOf } from './wallCalendar';
import { zonedDateString } from './wallTime';

/**
 * Pure selectors for the wall's lists (docs/plans/wall-display-kiosk.md §3
 * "Lists and meals"). Dates are yyyy-MM-dd in the household zone.
 */

export type TodoGroupKey = 'overdue' | 'today' | 'week';

export interface TodoGroup {
  key: TodoGroupKey;
  title: string;
  items: ToDo[];
  open: number;
}

const GROUP_TITLES: Record<TodoGroupKey, string> = { overdue: 'Overdue', today: 'Today', week: 'This week' };

/** 'family' matches unassigned to-dos; 'all' matches everything. */
export function matchesPerson(todo: ToDo, person: string): boolean {
  if (person === 'all') return true;
  if (person === 'family') return !todo.assignedTo;
  return todo.assignedTo === person;
}

/**
 * Overdue / Today / This week (the next six days). A to-do ticked off today
 * stays in its group, shown done, so a tap doesn't make it vanish; older
 * completed ones are gone.
 */
export function groupTodos(todos: readonly ToDo[], today: string, timeZone?: string, person = 'all'): TodoGroup[] {
  const weekEnd = addDaysTo(today, 6);
  const buckets: Record<TodoGroupKey, ToDo[]> = { overdue: [], today: [], week: [] };
  for (const t of todos) {
    if (!matchesPerson(t, person)) continue;
    if (t.isCompleted && !(t.completedAt && zonedDateString(new Date(t.completedAt), timeZone) === today)) continue;
    const d = t.completeByDate;
    if (d < today) buckets.overdue.push(t);
    else if (d === today) buckets.today.push(t);
    else if (d <= weekEnd) buckets.week.push(t);
  }
  return (Object.keys(buckets) as TodoGroupKey[])
    .map(key => ({
      key,
      title: GROUP_TITLES[key],
      items: buckets[key].sort((a, b) => a.completeByDate.localeCompare(b.completeByDate) || a.text.localeCompare(b.text)),
      open: buckets[key].filter(t => !t.isCompleted).length,
    }))
    .filter(g => g.items.length > 0);
}

/** Shopping items in the list's own order (manual `order`, then name). */
export function sortShopping(items: readonly ShoppingItem[]): ShoppingItem[] {
  return [...items].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

export const NO_STORE = 'No store';

export interface StoreGroup {
  store: string;
  open: ShoppingItem[];
  /** Checked items: "In the cart" under the store. */
  cart: ShoppingItem[];
}

/**
 * One list grouped by store (plan §3 "Shopping"): the household's stores in
 * their visit order, then any other store names, then items with no store.
 */
export function groupShoppingByStore(items: readonly ShoppingItem[], stores: readonly Store[]): StoreGroup[] {
  const known = [...stores].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)).map(s => s.name);
  const byStore = new Map<string, ShoppingItem[]>();
  for (const item of sortShopping(items)) {
    const key = item.store?.trim() || NO_STORE;
    byStore.set(key, [...(byStore.get(key) ?? []), item]);
  }
  const others = [...byStore.keys()].filter(k => k !== NO_STORE && !known.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...known, ...others, NO_STORE]
    .filter(store => byStore.has(store))
    .map(store => {
      const list = byStore.get(store) ?? [];
      return { store, open: list.filter(i => !i.isPurchased), cart: list.filter(i => i.isPurchased) };
    });
}

/** Catalog matches for the add sheet: name prefix first, then contains; most-bought first. */
export function catalogSuggestions(catalog: readonly GroceryCatalogItem[], query: string, limit = 6): GroceryCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byUse = (a: GroceryCatalogItem, b: GroceryCatalogItem) => b.purchaseCount - a.purchaseCount || a.name.localeCompare(b.name);
  const prefix = catalog.filter(c => c.name.toLowerCase().startsWith(q)).sort(byUse);
  const contains = catalog.filter(c => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)).sort(byUse);
  return [...prefix, ...contains].slice(0, limit);
}

/** Exact (case-insensitive) catalog entry for a typed name. */
export function catalogMatch(catalog: readonly GroceryCatalogItem[], name: string): GroceryCatalogItem | undefined {
  const n = name.trim().toLowerCase();
  return catalog.find(c => c.name.toLowerCase() === n);
}

const DEFAULT_CATEGORY = 'Other';

/**
 * A new shopping item from typed text: catalog category/quantity when known.
 * `store` null = the catalog's usual store; NO_STORE = deliberately none.
 */
export function newShoppingItem(
  name: string,
  catalog: readonly GroceryCatalogItem[],
  store: string | null,
  extra: Partial<ShoppingItem> = {}
): Omit<ShoppingItem, 'id'> {
  const match = catalogMatch(catalog, name);
  const chosenStore = store === NO_STORE ? undefined : (store ?? match?.defaultStore);
  return {
    name: match?.name ?? name.trim(),
    category: match?.category ?? DEFAULT_CATEGORY,
    isPurchased: false,
    source: 'manual',
    ...(match?.defaultQuantity ? { quantity: match.defaultQuantity } : {}),
    ...(chosenStore ? { store: chosenStore } : {}),
    ...extra,
  };
}

/** A copy of an item without its id, for re-adding on Undo. */
export function withoutId<T extends { id: string }>(item: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = item;
  return rest;
}

// ---------------------------------------------------------------------------
// To-do add sheet
// ---------------------------------------------------------------------------

export type DueChoice = 'today' | 'tomorrow' | 'week';

/** "This week" means by Saturday (today, if it's Saturday). */
export function dueDateFor(choice: DueChoice, today: string): string {
  if (choice === 'today') return today;
  if (choice === 'tomorrow') return addDaysTo(today, 1);
  return addDaysTo(today, 6 - weekdayOf(today));
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

export interface MealDay {
  date: string;
  dinner?: MealPlanItem;
  breakfast?: MealPlanItem;
  lunch?: MealPlanItem;
}

/** Today and the next six days of the meal plan. */
export function mealWeek(plan: readonly MealPlanItem[], today: string): MealDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysTo(today, i);
    const of = (type: MealPlanItem['type']) => plan.find(m => m.date === date && m.type === type);
    const day: MealDay = { date };
    const dinner = of('dinner');
    const breakfast = of('breakfast');
    const lunch = of('lunch');
    if (dinner) day.dinner = dinner;
    if (breakfast) day.breakfast = breakfast;
    if (lunch) day.lunch = lunch;
    return day;
  });
}

/** The saved recipe behind a plan entry: by id, else by exact name. */
export function recipeFor(entry: MealPlanItem, meals: readonly Meal[]): Meal | undefined {
  return (entry.mealId ? meals.find(m => m.id === entry.mealId) : undefined) ?? meals.find(m => m.name === entry.mealName);
}

const normalize = (s: string) => s.trim().toLowerCase();

/** Each ingredient, flagged when an unchecked item of the same name is already on the list. */
export function ingredientStatus(meal: Meal, shoppingList: readonly ShoppingItem[]): { ingredient: MealIngredient; onList: boolean }[] {
  const open = new Set(shoppingList.filter(i => !i.isPurchased).map(i => normalize(i.name)));
  return meal.ingredients.map(ingredient => ({ ingredient, onList: open.has(normalize(ingredient.name)) }));
}
