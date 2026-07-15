import { Meal } from '@/types/schema';

/**
 * F-MEALS-03 — pure, client-side allergen matching for the recipe warning
 * badge. No AI call: a simple case-insensitive substring match of each
 * flagged allergen against the meal's name, description, and ingredient
 * names — the name/description are always included (not just as a
 * fallback) since a partial/incomplete ingredient list shouldn't suppress
 * an allergen that's still visible in the recipe's title or blurb.
 *
 * Deliberately conservative (substring, not word-boundary) — a false
 * positive just shows a "double-check" badge, while a false negative could
 * let a real allergen through silently.
 */

/** Case/whitespace-normalized allergen strings ready for substring matching. */
const normalizeAllergen = (allergen: string): string => allergen.trim().toLowerCase();

/**
 * Returns the subset of `allergens` that appear as a substring of the
 * meal's name, description, or any ingredient name — i.e. the allergens
 * this meal should be flagged for. Empty/blank allergen entries are
 * ignored. Returns `[]` when nothing matches or `allergens` is empty.
 */
export const matchAllergens = (meal: Pick<Meal, 'name' | 'description' | 'ingredients'>, allergens: string[] | undefined): string[] => {
  const flagged = (allergens ?? []).map(normalizeAllergen).filter(Boolean);
  if (flagged.length === 0) return [];

  const haystacks = [
    meal.name,
    meal.description ?? '',
    ...(meal.ingredients ?? []).map(ing => ing.name)
  ].map(s => s.toLowerCase());

  return flagged.filter(allergen => haystacks.some(text => text.includes(allergen)));
};

/** Convenience boolean wrapper around {@link matchAllergens}. */
export const mealMatchesAnyAllergen = (meal: Pick<Meal, 'name' | 'description' | 'ingredients'>, allergens: string[] | undefined): boolean =>
  matchAllergens(meal, allergens).length > 0;
