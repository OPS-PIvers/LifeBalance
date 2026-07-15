import { describe, it, expect } from 'vitest';
import { Meal } from '@/types/schema';
import {
  isNotCookedIn30Days,
  isNeverTried,
  isFavorite,
  SMART_COLLECTIONS,
  getSmartCollection,
} from '@/utils/recipeCollections';

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    name: 'Test Meal',
    description: '',
    ingredients: [],
    tags: [],
    instructions: [],
    recipeUrl: '',
    ...overrides,
  } as Meal;
}

const TODAY = '2026-07-14';

describe('isNotCookedIn30Days', () => {
  it('is true when lastCooked is absent', () => {
    expect(isNotCookedIn30Days(makeMeal(), TODAY)).toBe(true);
  });

  it('is true when lastCooked is exactly 30 days ago', () => {
    expect(isNotCookedIn30Days(makeMeal({ lastCooked: '2026-06-14' }), TODAY)).toBe(true);
  });

  it('is false when lastCooked is within 30 days', () => {
    expect(isNotCookedIn30Days(makeMeal({ lastCooked: '2026-07-01' }), TODAY)).toBe(false);
  });

  it('is true when lastCooked is well over 30 days ago', () => {
    expect(isNotCookedIn30Days(makeMeal({ lastCooked: '2025-01-01' }), TODAY)).toBe(true);
  });
});

describe('isNeverTried', () => {
  it('is true when lastCooked is absent', () => {
    expect(isNeverTried(makeMeal())).toBe(true);
  });

  it('is false when lastCooked is set', () => {
    expect(isNeverTried(makeMeal({ lastCooked: '2026-01-01' }))).toBe(false);
  });
});

describe('isFavorite', () => {
  it('is false when rating is absent', () => {
    expect(isFavorite(makeMeal())).toBe(false);
  });

  it('is false when rating is below 4', () => {
    expect(isFavorite(makeMeal({ rating: 3 }))).toBe(false);
  });

  it('is true when rating is 4', () => {
    expect(isFavorite(makeMeal({ rating: 4 }))).toBe(true);
  });

  it('is true when rating is 5', () => {
    expect(isFavorite(makeMeal({ rating: 5 }))).toBe(true);
  });
});

describe('SMART_COLLECTIONS / getSmartCollection', () => {
  it('exposes exactly the three documented collections', () => {
    expect(SMART_COLLECTIONS.map((c) => c.id)).toEqual(['not-cooked-30d', 'never-tried', 'favorites']);
  });

  it('resolves a collection by id', () => {
    expect(getSmartCollection('favorites').label).toBe('Favorites');
  });

  it('throws for an unknown id', () => {
    expect(() => getSmartCollection('bogus' as never)).toThrow();
  });
});
