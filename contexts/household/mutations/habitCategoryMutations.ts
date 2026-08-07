import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { habitConverter } from '@/utils/firestoreConverters';
import { chunkForBatches } from '@/contexts/household/mutations/todoMutations';
import {
  habitCategoryKey,
  UNCATEGORIZED_HABIT_CATEGORY,
} from '@/utils/habitCategories';

/**
 * Every habit in the household, read through the converter and filtered to one
 * category key in memory (Firestore equality is case-sensitive; the stored
 * spelling is whatever the user typed). `orderBy('category')` asks Firestore for
 * "docs where this field exists" — every habit has one, since `Habit.category`
 * is required, so this is simply the whole (household-scale, unwindowed)
 * collection. Archived habits and kid chores are deliberately INCLUDED: they
 * carry the category too, and leaving them behind would resurrect the deleted
 * name through the vocabulary's in-use derivation.
 *
 * Mirrors `fetchTodosInCategory` in todoMutations.ts, including its O(N)-reads
 * cost note: rename and delete are rare, deliberate actions.
 */
async function fetchHabitsInCategory(db: Firestore, householdId: string, key: string) {
  const habitsCol = collection(db, `households/${householdId}/habits`).withConverter(habitConverter);
  const snap = await getDocs(query(habitsCol, orderBy('category')));
  return snap.docs.filter(d => habitCategoryKey(d.data().category) === key);
}

/** One habit document snapshot as `fetchHabitsInCategory` returns it. */
type HabitDocSnapshot = Awaited<ReturnType<typeof fetchHabitsInCategory>>[number];

/**
 * renameHabitCategory / deleteHabitCategory — the habit twins of
 * `makeTodoCategoryEditMutations`. Closures capture `householdId` and the
 * household's current `habitCategories` list (the next list is derived from it).
 *
 * Both rewrite EVERY matching habit — active, archived and assigned chores — in
 * chunked `writeBatch`es (Firestore caps a batch at 500 ops, see
 * `chunkForBatches`, shared with the to-do implementation so the boundary has
 * one definition).
 *
 * Ordering matters because multiple batches are not one atomic unit: the habit
 * rewrites commit FIRST and the household vocabulary list LAST. A failure part
 * way through therefore leaves the old name still listed rather than dropping a
 * category whose habits still point at it — and a retry CONVERGES, because the
 * re-run re-queries by the old name and so only touches the habits the failed
 * run hadn't rewritten yet (covered in habitCategoryMutations.test.ts).
 *
 * Toast Behavior: none here — both functions RE-THROW so their single caller
 * (HabitCategoryManagerDrawer) owns the success/failure message and can keep its
 * rename editor open when the write didn't land.
 */
export function makeHabitCategoryEditMutations(deps: {
  db: Firestore;
  householdId: string | null;
  habitCategories: string[];
}) {
  const { db, householdId, habitCategories } = deps;

  /**
   * Renames a category across the whole household.
   *
   * - Matching is case-INSENSITIVE, so a pure typo fix ('health' → 'Health')
   *   really does rewrite the habits instead of silently matching nothing.
   * - A no-op (resolves immediately, no writes) when the new name is blank or
   *   identical to the old one.
   * - If the new name collides case-insensitively with ANOTHER existing
   *   category, the rename MERGES into it: habits are rewritten to that
   *   category's stored spelling and the old entry is dropped from the list —
   *   never producing two vocabulary entries that differ only by case.
   *
   * @throws Re-throws any caught error (see the toast note above).
   */
  const renameHabitCategory = async (oldName: string, newName: string) => {
    if (!householdId) return;
    const trimmedNew = newName.trim();
    if (!trimmedNew || trimmedNew === oldName) return;

    const oldKey = habitCategoryKey(oldName);
    if (!oldKey) return; // nothing identifiable to rename

    // Merge target: an existing entry that collides with the new name (other
    // than the entry being renamed). Its stored spelling wins.
    const mergeTarget = habitCategories.find(
      c => habitCategoryKey(c) === habitCategoryKey(trimmedNew) && habitCategoryKey(c) !== oldKey,
    );
    const targetName = mergeTarget ?? trimmedNew;
    const targetKey = habitCategoryKey(targetName);

    // Rebuild the vocabulary in place (order preserved), replacing the renamed
    // entry and de-duping case-insensitively so a merge collapses to one entry.
    const nextCategories: string[] = [];
    const seen = new Set<string>();
    for (const category of habitCategories) {
      const value = habitCategoryKey(category) === oldKey ? targetName : category;
      const key = habitCategoryKey(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      nextCategories.push(value);
    }
    // The old name may live only on habits — which is the NORMAL case here, not
    // an edge one: `habitCategories` was append-only and never recorded several
    // of the categories habits actually use (the vocabulary heals those on read,
    // see utils/habitCategories.ts). Make sure the target ends up listed.
    if (!seen.has(targetKey)) nextCategories.push(targetName);

    try {
      const matching = await fetchHabitsInCategory(db, householdId, oldKey);
      for (const chunk of chunkForBatches(matching)) {
        const batch = writeBatch(db);
        for (const habitDoc of chunk) {
          batch.update(habitDoc.ref, { category: targetName });
        }
        await batch.commit();
      }
      await updateDoc(doc(db, `households/${householdId}`), {
        habitCategories: nextCategories,
      });
    } catch (error) {
      console.error('[renameHabitCategory] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  /**
   * Removes a category from the household vocabulary AND moves every habit that
   * used it to `UNCATEGORIZED_HABIT_CATEGORY`.
   *
   * 🛡️ This is where the habit path DIVERGES from `deleteTodoCategory`, which
   * clears the field with `deleteField()`. `Habit.category` is REQUIRED:
   * `firestore.rules` rejects a habit write whose category is absent or empty,
   * and `pages/Habits.tsx` groups the Track tab by the raw string, so a cleared
   * value would render a nameless heading. Reassigning is the only outcome that
   * keeps every habit valid AND visible — and the confirm dialog says so before
   * the user commits.
   *
   * Deleting "Uncategorized" itself only drops the list entry: rewriting those
   * habits to the value they already hold would be a pure no-op write.
   *
   * @throws Re-throws any caught error (see the toast note above).
   */
  const deleteHabitCategory = async (name: string) => {
    if (!householdId) return;
    const key = habitCategoryKey(name);
    if (!key) return;

    const nextCategories = habitCategories.filter(c => habitCategoryKey(c) !== key);
    const isFallback = key === habitCategoryKey(UNCATEGORIZED_HABIT_CATEGORY);

    try {
      const matching: HabitDocSnapshot[] = isFallback
        ? []
        : await fetchHabitsInCategory(db, householdId, key);
      for (const chunk of chunkForBatches(matching)) {
        const batch = writeBatch(db);
        for (const habitDoc of chunk) {
          batch.update(habitDoc.ref, { category: UNCATEGORIZED_HABIT_CATEGORY });
        }
        await batch.commit();
      }
      await updateDoc(doc(db, `households/${householdId}`), {
        habitCategories: nextCategories,
      });
    } catch (error) {
      console.error('[deleteHabitCategory] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  return { renameHabitCategory, deleteHabitCategory };
}
