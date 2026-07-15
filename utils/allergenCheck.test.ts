import { describe, it, expect } from 'vitest';
import { matchAllergens, mealMatchesAnyAllergen } from '@/utils/allergenCheck';
import { Meal } from '@/types/schema';

const meal = (overrides: Partial<Meal> = {}): Meal => ({
  id: 'm1',
  name: 'Peanut Noodles',
  description: 'A quick noodle dish',
  ingredients: [{ name: 'Peanut butter' }, { name: 'Rice noodles' }, { name: 'Soy sauce' }],
  tags: [],
  ...overrides,
});

describe('matchAllergens', () => {
  it('returns matching allergens found in ingredient names (case-insensitive)', () => {
    expect(matchAllergens(meal(), ['Peanut', 'shellfish'])).toEqual(['peanut']);
  });

  it('matches a substring within a longer ingredient name', () => {
    expect(matchAllergens(meal({ ingredients: [{ name: 'Whole milk' }] }), ['dairy', 'milk'])).toEqual(['milk']);
  });

  it('returns empty array when no allergens are provided', () => {
    expect(matchAllergens(meal(), undefined)).toEqual([]);
    expect(matchAllergens(meal(), [])).toEqual([]);
  });

  it('ignores blank allergen entries', () => {
    expect(matchAllergens(meal(), ['  ', ''])).toEqual([]);
  });

  it('returns empty array when nothing matches', () => {
    expect(matchAllergens(meal(), ['shellfish', 'gluten'])).toEqual([]);
  });

  it('falls back to name/description when the meal has no ingredients', () => {
    const noIngredients = meal({ ingredients: [], name: 'Peanut Butter Cookies', description: '' });
    expect(matchAllergens(noIngredients, ['peanut'])).toEqual(['peanut']);
  });

  it('still matches name/description when ingredients are present but incomplete', () => {
    const incompleteList = meal({ ingredients: [{ name: 'Flour' }, { name: 'Sugar' }], name: 'Peanut Butter Cookies', description: '' });
    expect(matchAllergens(incompleteList, ['peanut'])).toEqual(['peanut']);
  });

  it('trims and lowercases allergen entries before matching', () => {
    expect(matchAllergens(meal(), [' PEANUT '])).toEqual(['peanut']);
  });
});

describe('mealMatchesAnyAllergen', () => {
  it('returns true when at least one allergen matches', () => {
    expect(mealMatchesAnyAllergen(meal(), ['peanut'])).toBe(true);
  });

  it('returns false when no allergens match', () => {
    expect(mealMatchesAnyAllergen(meal(), ['shellfish'])).toBe(false);
  });

  it('returns false for an undefined allergen list', () => {
    expect(mealMatchesAnyAllergen(meal(), undefined)).toBe(false);
  });
});
