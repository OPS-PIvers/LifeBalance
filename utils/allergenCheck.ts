import { Meal } from '@/types/schema';

/**
 * F-MEALS-03 — pure, client-side allergen matching for the recipe warning
 * badge. No AI call: a simple case-insensitive substring match of each
 * flagged allergen against the meal's ingredient names (and, as a fallback,
 * its free-text name/description) so a manually-added recipe still gets
 * flagged even when it has no structured ingredient list yet.
 *
 * Deliberately conservative (substring, not word-boundary) — a false
 * positive just shows a "double-check" badge, while a false negative could
 * let a real allergen through silently.
 */

/** Case/whitespace-normalized allergen strings ready for substring matching. */
const normalizeAllergen = (allergen: string): string => allergen.trim().toLowerCase();

/**
 * Returns the subset of `allergens` that appear as a substring of any
 * ingredient name (or, if the meal has no ingredients, the meal's name/
 * description) — i.e. the allergens this meal should be flagged for.
 * Empty/blank allergen entries are ignored. Returns `[]` when nothing matches
 * or `allergens` is empty.
 */
export const matchAllergens = (meal: Pick<Meal, 'name' | 'description' | 'ingredients'>, allergens: string[] | undefined): string[] => {
  const flagged = (allergens ?? []).map(normalizeAllergen).filter(Boolean);
  if (flagged.length === 0) return [];

  const haystacks = meal.ingredients && meal.ingredients.length > 0
    ? meal.ingredients.map(ing => ing.name.toLowerCase())
    : [meal.name, meal.description ?? ''].map(s => s.toLowerCase());

  return flagged.filter(allergen => haystacks.some(text => text.includes(allergen)));
};

/** Convenience boolean wrapper around {@link matchAllergens}. */
export const mealMatchesAnyAllergen = (meal: Pick<Meal, 'name' | 'description' | 'ingredients'>, allergens: string[] | undefined): boolean =>
  matchAllergens(meal, allergens).length > 0;
