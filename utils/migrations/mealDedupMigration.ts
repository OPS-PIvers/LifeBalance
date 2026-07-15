import { writeBatch, doc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Meal } from '@/types/schema';
import toast from 'react-hot-toast';

/**
 * Duplicate-recipe cleanup (owner-approved 2026-07-05).
 *
 * Recipes whose names differ only by case/spacing/punctuation ("Hello Fresh"
 * vs "HelloFresh") are merged into one: the most complete copy survives,
 * missing fields are filled from the others, and meal-plan history is
 * re-pointed at the survivor before the losers are deleted.
 */

/** Case/whitespace/punctuation-insensitive identity key for a recipe name. */
export function normalizeMealName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Groups of 2+ meals that normalize to the same name. */
export function findDuplicateMealGroups(meals: Meal[]): Meal[][] {
  const byKey = new Map<string, Meal[]>();
  for (const meal of meals) {
    const key = normalizeMealName(meal.name || '');
    if (!key) continue;
    const group = byKey.get(key);
    if (group) group.push(meal);
    else byKey.set(key, [meal]);
  }
  return Array.from(byKey.values()).filter(g => g.length > 1);
}

export function needsMealDedup(meals: Meal[]): boolean {
  return findDuplicateMealGroups(meals).length > 0;
}

/** Completeness score used to pick the surviving copy of a duplicate group. */
function completeness(meal: Meal): number {
  let score = 0;
  if (meal.ingredients?.length) score += 2;
  if (meal.instructions?.length) score += 1;
  if (meal.description) score += 1;
  if (meal.recipeUrl) score += 1;
  if (meal.rating && meal.rating > 0) score += 1;
  if (meal.tags?.length) score += 1;
  return score;
}

export interface MealMergePlan {
  survivor: Meal;
  /** Field patch to apply to the survivor (fields filled from the losers). */
  patch: Partial<Meal>;
  loserIds: string[];
}

/**
 * Decide the survivor and merged fields for one duplicate group.
 * Survivor = highest completeness, ties broken by most recent lastCooked,
 * then stable input order. Content fields keep the survivor's value when
 * present and otherwise come from the most complete loser that has one;
 * rating/lastCooked take the max and tags the union.
 */
export function planMealMerge(group: Meal[]): MealMergePlan {
  const ranked = group
    .slice()
    .sort(
      (a, b) =>
        completeness(b) - completeness(a) ||
        (b.lastCooked || '').localeCompare(a.lastCooked || '')
    );
  // A duplicate group always has 2+ members; ranked[0] provably exists.
  const survivor = ranked[0]!;
  const losers = ranked.slice(1);

  const patch: Partial<Meal> = {};
  for (const loser of losers) {
    if (!survivor.description && !patch.description && loser.description) patch.description = loser.description;
    if (!survivor.recipeUrl && !patch.recipeUrl && loser.recipeUrl) patch.recipeUrl = loser.recipeUrl;
    if (!survivor.ingredients?.length && !patch.ingredients && loser.ingredients?.length) patch.ingredients = loser.ingredients;
    if (!survivor.instructions?.length && !patch.instructions && loser.instructions?.length) patch.instructions = loser.instructions;
    if (
      typeof survivor.estimatedCost !== 'number' &&
      typeof patch.estimatedCost !== 'number' &&
      typeof loser.estimatedCost === 'number'
    ) {
      patch.estimatedCost = loser.estimatedCost;
    }
  }

  const maxRating = Math.max(survivor.rating || 0, ...losers.map(m => m.rating || 0));
  if (maxRating > (survivor.rating || 0)) patch.rating = maxRating;

  const maxLastCooked = [survivor.lastCooked, ...losers.map(m => m.lastCooked)]
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  if (maxLastCooked && maxLastCooked !== survivor.lastCooked) patch.lastCooked = maxLastCooked;

  const tagSet = new Set(survivor.tags || []);
  let tagsChanged = false;
  for (const loser of losers) {
    for (const tag of loser.tags || []) {
      const dupTag = Array.from(tagSet).some(t => t.toLowerCase() === tag.toLowerCase());
      if (!dupTag) {
        tagSet.add(tag);
        tagsChanged = true;
      }
    }
  }
  if (tagsChanged) patch.tags = Array.from(tagSet);

  return { survivor, patch, loserIds: losers.map(m => m.id) };
}

/**
 * Merge form input over an existing recipe (save-time duplicate guard):
 * non-empty form fields win; empty ones keep the existing recipe's data so
 * re-saving a bare name never wipes ingredients/instructions.
 */
export function mergeFormIntoMeal(existing: Meal, form: Partial<Meal>): Meal {
  return {
    ...existing,
    name: form.name || existing.name,
    description: form.description || existing.description,
    ingredients: form.ingredients?.length ? form.ingredients : existing.ingredients,
    instructions: form.instructions?.length ? form.instructions : existing.instructions,
    recipeUrl: form.recipeUrl || existing.recipeUrl,
    estimatedCost: form.estimatedCost ?? existing.estimatedCost,
    tags: form.tags?.length ? form.tags : existing.tags,
  };
}

/**
 * Execute the merges: patch survivors, re-point meal-plan items, delete losers.
 *
 * Plan items are looked up with direct Firestore queries (chunked `where in`)
 * rather than the in-memory mealPlan, because the live listener only holds a
 * windowed slice of plan history.
 */
export async function migrateDuplicateMeals(householdId: string, meals: Meal[]): Promise<void> {
  try {
    const groups = findDuplicateMealGroups(meals);
    if (groups.length === 0) return;

    const plans = groups.map(planMealMerge);
    const allLoserToSurvivor = new Map<string, string>();
    for (const plan of plans) {
      for (const loserId of plan.loserIds) allLoserToSurvivor.set(loserId, plan.survivor.id);
    }

    const survivorNameById = new Map(plans.map(p => [p.survivor.id, p.survivor.name]));

    // Find every plan item referencing a merged-away meal ('in' max 30 per query).
    const loserIds = Array.from(allLoserToSurvivor.keys());
    const planItemRepoints: { id: string; mealId: string; mealName: string }[] = [];
    for (let i = 0; i < loserIds.length; i += 30) {
      const chunk = loserIds.slice(i, i + 30);
      const snap = await getDocs(
        query(collection(db, `households/${householdId}/mealPlan`), where('mealId', 'in', chunk))
      );
      snap.forEach(d => {
        const mealId = d.data().mealId as string;
        const survivorId = allLoserToSurvivor.get(mealId);
        if (survivorId) {
          planItemRepoints.push({ id: d.id, mealId: survivorId, mealName: survivorNameById.get(survivorId) || '' });
        }
      });
    }

    // Batch all writes (survivor patches + repoints + deletes), chunked at 500.
    type Write =
      | { kind: 'update'; path: string; data: Record<string, unknown> }
      | { kind: 'delete'; path: string };
    const writes: Write[] = [];
    for (const plan of plans) {
      if (Object.keys(plan.patch).length > 0) {
        writes.push({ kind: 'update', path: `households/${householdId}/meals/${plan.survivor.id}`, data: plan.patch });
      }
      for (const loserId of plan.loserIds) {
        writes.push({ kind: 'delete', path: `households/${householdId}/meals/${loserId}` });
      }
    }
    for (const repoint of planItemRepoints) {
      writes.push({
        kind: 'update',
        path: `households/${householdId}/mealPlan/${repoint.id}`,
        data: repoint.mealName ? { mealId: repoint.mealId, mealName: repoint.mealName } : { mealId: repoint.mealId },
      });
    }

    for (let i = 0; i < writes.length; i += 500) {
      const batch = writeBatch(db);
      for (const w of writes.slice(i, i + 500)) {
        if (w.kind === 'update') batch.update(doc(db, w.path), w.data);
        else batch.delete(doc(db, w.path));
      }
      await batch.commit();
    }

    const mergedCount = loserIds.length;
    console.log(`[MealDedup] Merged ${mergedCount} duplicate recipes across ${groups.length} groups`);
    toast.success(`Merged ${mergedCount} duplicate recipe${mergedCount === 1 ? '' : 's'} in your cookbook.`);
  } catch (error) {
    // Log-and-continue like the other client migrations — never crash the app.
    console.error('[MealDedup] Failed to merge duplicate recipes:', error);
  }
}
