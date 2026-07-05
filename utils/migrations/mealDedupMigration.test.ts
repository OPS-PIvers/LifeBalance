import { describe, it, expect } from 'vitest';
import {
  normalizeMealName,
  findDuplicateMealGroups,
  needsMealDedup,
  planMealMerge,
  mergeFormIntoMeal,
} from './mealDedupMigration';
import { Meal } from '@/types/schema';

const meal = (overrides: Partial<Meal> & { id: string; name: string }): Meal => ({
  ingredients: [],
  instructions: [],
  tags: [],
  rating: 0,
  ...overrides,
});

describe('normalizeMealName', () => {
  it('ignores case, spacing, and punctuation', () => {
    expect(normalizeMealName('Hello Fresh')).toBe('hellofresh');
    expect(normalizeMealName('HelloFresh')).toBe('hellofresh');
    expect(normalizeMealName('hello-fresh!')).toBe('hellofresh');
  });

  it('distinguishes genuinely different names', () => {
    expect(normalizeMealName('Lasagna')).not.toBe(normalizeMealName('Lasagna Soup'));
  });
});

describe('findDuplicateMealGroups', () => {
  it('groups meals whose names normalize identically', () => {
    const meals = [
      meal({ id: '1', name: 'Hello Fresh' }),
      meal({ id: '2', name: 'HelloFresh' }),
      meal({ id: '3', name: 'Lasagna' }),
    ];
    const groups = findDuplicateMealGroups(meals);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map(m => m.id).sort()).toEqual(['1', '2']);
  });

  it('returns no groups when names are unique', () => {
    expect(findDuplicateMealGroups([meal({ id: '1', name: 'A' }), meal({ id: '2', name: 'B' })])).toEqual([]);
    expect(needsMealDedup([meal({ id: '1', name: 'A' })])).toBe(false);
  });

  it('ignores empty/punctuation-only names rather than grouping them together', () => {
    const meals = [meal({ id: '1', name: '—' }), meal({ id: '2', name: ' ' })];
    expect(findDuplicateMealGroups(meals)).toEqual([]);
  });
});

describe('planMealMerge', () => {
  it('keeps the most complete copy and deletes the rest', () => {
    const sparse = meal({ id: 'sparse', name: 'Hello Fresh' });
    const complete = meal({
      id: 'complete',
      name: 'HelloFresh',
      ingredients: [{ name: 'Chicken', quantity: '1' }],
      description: 'Box meal',
    });
    const plan = planMealMerge([sparse, complete]);
    expect(plan.survivor.id).toBe('complete');
    expect(plan.loserIds).toEqual(['sparse']);
  });

  it('fills survivor gaps from losers and takes max rating / latest lastCooked / tag union', () => {
    const survivor = meal({
      id: 'a',
      name: 'Hello Fresh',
      ingredients: [{ name: 'Chicken', quantity: '1' }],
      instructions: ['Cook it'],
      rating: 2,
      lastCooked: '2026-06-01T00:00:00.000Z',
      tags: ['Easy'],
    });
    const loser = meal({
      id: 'b',
      name: 'HelloFresh',
      description: 'Box meal',
      recipeUrl: 'https://example.com',
      rating: 4,
      lastCooked: '2026-07-01T00:00:00.000Z',
      tags: ['easy', 'Quick'],
    });
    const plan = planMealMerge([survivor, loser]);
    expect(plan.survivor.id).toBe('a');
    expect(plan.patch.description).toBe('Box meal');
    expect(plan.patch.recipeUrl).toBe('https://example.com');
    expect(plan.patch.rating).toBe(4);
    expect(plan.patch.lastCooked).toBe('2026-07-01T00:00:00.000Z');
    // 'easy' is a case-duplicate of 'Easy' and must not be added twice
    expect(plan.patch.tags).toEqual(['Easy', 'Quick']);
    expect(plan.patch.ingredients).toBeUndefined(); // survivor already has them
  });

  it('emits an empty patch when the survivor already has everything', () => {
    const full = meal({
      id: 'a',
      name: 'Hello Fresh',
      ingredients: [{ name: 'Chicken', quantity: '1' }],
      instructions: ['Cook'],
      description: 'Box',
      recipeUrl: 'https://x.com',
      rating: 5,
      lastCooked: '2026-07-01T00:00:00.000Z',
      tags: ['Easy'],
    });
    const empty = meal({ id: 'b', name: 'HelloFresh' });
    expect(planMealMerge([full, empty]).patch).toEqual({});
  });

  it('breaks completeness ties by most recent lastCooked', () => {
    const older = meal({ id: 'old', name: 'Hello Fresh', lastCooked: '2026-01-01T00:00:00.000Z' });
    const newer = meal({ id: 'new', name: 'HelloFresh', lastCooked: '2026-06-01T00:00:00.000Z' });
    expect(planMealMerge([older, newer]).survivor.id).toBe('new');
  });
});

describe('mergeFormIntoMeal', () => {
  const existing = meal({
    id: 'x',
    name: 'Hello Fresh',
    ingredients: [{ name: 'Chicken', quantity: '1' }],
    instructions: ['Cook it'],
    description: 'Box meal',
    recipeUrl: 'https://x.com',
    tags: ['Easy'],
    rating: 4,
  });

  it('keeps existing content when the form fields are empty', () => {
    const merged = mergeFormIntoMeal(existing, { name: 'HelloFresh', ingredients: [], instructions: [], tags: [] });
    expect(merged.name).toBe('HelloFresh');
    expect(merged.ingredients).toEqual(existing.ingredients);
    expect(merged.instructions).toEqual(existing.instructions);
    expect(merged.description).toBe('Box meal');
    expect(merged.rating).toBe(4);
  });

  it('lets non-empty form fields win', () => {
    const merged = mergeFormIntoMeal(existing, {
      description: 'Updated',
      ingredients: [{ name: 'Beef', quantity: '2' }],
    });
    expect(merged.description).toBe('Updated');
    expect(merged.ingredients).toEqual([{ name: 'Beef', quantity: '2' }]);
  });
});
