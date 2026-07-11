import { type QueryDocumentSnapshot } from 'firebase/firestore';
import { Transaction, ToDo, Meal, MealPlanItem } from '@/types/schema';

/**
 * Merge two lists of documents by `id`, keeping `primary` entries when an id
 * appears in both. Used to combine a live (windowed) listener result with
 * on-demand "load older" pages without ever showing duplicates.
 */
export function mergeById<T extends { id: string }>(primary: T[], secondary: T[]): T[] {
  if (secondary.length === 0) return primary;
  if (primary.length === 0) return secondary;
  const seen = new Set(primary.map(p => p.id));
  return [...primary, ...secondary.filter(s => !seen.has(s.id))];
}

/**
 * Meal ids referenced by meal-plan entries that are neither in the loaded
 * `meals` list nor already requested. Used by the provider to resolve meals
 * that fall outside the bounded live meals window by id, so the meal plan
 * never shows a broken reference. Duplicates collapse to one id.
 */
export function collectMissingMealIds(
  mealPlan: Pick<MealPlanItem, 'mealId'>[],
  meals: Pick<Meal, 'id'>[],
  requested: ReadonlySet<string>
): string[] {
  const known = new Set(meals.map(m => m.id));
  const missing = new Set<string>();
  for (const item of mealPlan) {
    const id = item.mealId;
    if (id && !known.has(id) && !requested.has(id)) missing.add(id);
  }
  return [...missing];
}

/**
 * Map a typed transaction snapshot to a Transaction.
 * The converter attached via .withConverter(transactionConverter) already handles
 * id injection and Timestamp normalisation; this shim delegates to it so all
 * call sites (windowed listener + pagination helpers) share one code path.
 */
export function mapTransactionDoc(d: QueryDocumentSnapshot<Transaction>): Transaction {
  return d.data();
}

/**
 * Map a typed to-do snapshot to a ToDo.
 * The converter attached via .withConverter(todoConverter) already handles
 * id injection and Timestamp normalisation.
 */
export function mapTodoDoc(d: QueryDocumentSnapshot<ToDo>): ToDo {
  return d.data();
}
