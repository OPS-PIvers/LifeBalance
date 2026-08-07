/**
 * Habit category vocabulary — the ONE place the habit-category rules live.
 *
 * Habit categories are household-OWNED DATA, exactly like to-do categories:
 * `Household.habitCategories` is the stored vocabulary and the habit form's chip
 * picker renders it, not a hardcoded list. `DEFAULT_HABIT_CATEGORIES` survives
 * for exactly two jobs:
 *
 * 1. it is SEEDED into a brand-new household's doc (see
 *    `services/householdService.createHousehold`), so the starter categories are
 *    real, editable, deletable rows rather than source code a manage drawer
 *    could never touch; and
 * 2. it is the last-resort fallback for a household that has neither a stored
 *    vocabulary nor a single habit — without it that household would open an
 *    EMPTY picker on a required field.
 *
 * Everything else derives from `habitCategoryVocabulary` below.
 */

/**
 * Starter categories for a brand-new household, and the fallback for a
 * household with no vocabulary and no habits at all. NOT prepended to the
 * picker: doing that is what made every household's chip row noise, since a
 * built-in nobody uses can't be deleted (it isn't data).
 */
export const DEFAULT_HABIT_CATEGORIES = ['Health', 'Finance', 'Personal', 'Home', 'Work'];

/**
 * Where a habit lands when its category is deleted.
 *
 * `Habit.category` is REQUIRED — `firestore.rules` rejects an absent/empty one
 * (`isValidString(... 'category' ...)`) and `pages/Habits.tsx` groups the Track
 * tab by the raw string, so a blank value would render a heading with no name.
 * So, unlike `deleteTodoCategory` (which `deleteField()`s an OPTIONAL field),
 * deleting a habit category REASSIGNS its habits here.
 */
export const UNCATEGORIZED_HABIT_CATEGORY = 'Uncategorized';

/**
 * Longest category name that can actually be used.
 *
 * 🛡️ This is NOT a cosmetic cap — it MIRRORS `firestore.rules`, which validates
 * every habit write with `isValidString(request.resource.data.get('category',
 * null), 50)`. The vocabulary array itself has no such rule, so without this
 * check a longer name saves happily into `habitCategories`, renders as a
 * perfectly normal chip, and then makes every habit write that selects it fail
 * permission-denied — a category that looks fine and silently cannot be used.
 * If the rules limit ever changes, change it here in the same commit.
 */
export const MAX_HABIT_CATEGORY_LENGTH = 50;

/** Category comparison key: trimmed + lowercased ('' for absent/blank). */
export const habitCategoryKey = (value: string | undefined): string =>
  (value ?? '').trim().toLowerCase();

/**
 * The categories a household actually has, case-insensitively de-duplicated and
 * in a stable order: the stored vocabulary first, then any category a habit is
 * really using, then `extra` (the habit being edited, whose own category must
 * always be selectable).
 *
 * The in-use pass is a BACKFILL-ON-READ (the same idiom as the bucket-colour
 * migration): `habitCategories` was append-only and several real categories were
 * never recorded in it, which meant a new habit could not be created into them
 * at all. Deriving them from the habits themselves heals that with no migration
 * write. Nothing is ever hidden by this function — a stored category with zero
 * habits still comes back, because removing one is a deliberate act performed in
 * the manage drawer, not a side effect of the last habit leaving it.
 *
 * Returns an EMPTY list when the household genuinely has nothing; callers that
 * must offer a choice (the habit form's picker) fall back to
 * `DEFAULT_HABIT_CATEGORIES`, while callers that manage the real rows (the
 * drawer) show their empty state instead of offering undeletable phantoms.
 */
export function habitCategoryVocabulary(
  storedCategories: readonly string[] | undefined,
  habits: readonly { category: string }[] | undefined,
  extra?: string | undefined,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined): void => {
    const value = (raw ?? '').trim();
    const key = habitCategoryKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  };

  for (const category of storedCategories ?? []) push(category);
  for (const habit of habits ?? []) push(habit.category);
  push(extra);

  return result;
}
