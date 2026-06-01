import { describe, it, expect } from 'vitest';
import {
  mapSectionToCategory,
  parseIngredientString,
  weeklyPlanMealToMeal,
  mapWeeklyPlan,
  subtotal,
  grandTotal,
  groupItemsByStore,
} from './weeklyPlanMapper';
import { WeeklyPlan } from '@/types/weeklyPlan';

describe('mapSectionToCategory', () => {
  it('maps known sections to grocery categories', () => {
    expect(mapSectionToCategory('meat')).toBe('Meat');
    expect(mapSectionToCategory('PRODUCE')).toBe('Produce');
    expect(mapSectionToCategory('frozen')).toBe('Frozen');
  });

  it('falls back to Uncategorized for unknown/missing sections', () => {
    expect(mapSectionToCategory(undefined)).toBe('Uncategorized');
    expect(mapSectionToCategory('mystery')).toBe('Uncategorized');
  });
});

describe('parseIngredientString', () => {
  it('splits a leading quantity from the name', () => {
    expect(parseIngredientString('2 lb chicken thighs')).toEqual({ name: 'chicken thighs', quantity: '2 lb' });
    expect(parseIngredientString('2 onions')).toEqual({ name: 'onions', quantity: '2' });
    expect(parseIngredientString('1/2 cup rice')).toEqual({ name: 'rice', quantity: '1/2 cup' });
  });

  it('keeps the whole string as the name when there is no quantity', () => {
    expect(parseIngredientString('Kosher salt')).toEqual({ name: 'Kosher salt', quantity: '' });
  });
});

describe('weeklyPlanMealToMeal', () => {
  it('flattens prep+cook into instructions and derives tags', () => {
    const meal = weeklyPlanMealToMeal({
      name: 'Soy-Garlic Chicken',
      cuisine: 'Korean',
      effort: 'Low',
      blurb: 'Weeknight winner',
      ingredients: ['2 lb chicken thighs', 'Kosher salt'],
      prep: [{ t: 'Pat dry', min: 5, det: ['Use paper towels'] }],
      cook: [{ t: 'Sear', min: 8 }],
    });

    expect(meal.name).toBe('Soy-Garlic Chicken');
    expect(meal.description).toBe('Weeknight winner');
    expect(meal.tags).toEqual(['Korean', 'Low']);
    expect(meal.instructions).toEqual(['Pat dry: Use paper towels', 'Sear']);
    expect(meal.ingredients).toEqual([
      { name: 'chicken thighs', quantity: '2 lb' },
      { name: 'Kosher salt', quantity: '' },
    ]);
    expect(meal.rating).toBe(0);
  });
});

const samplePlan: WeeklyPlan = {
  weekOf: '2026-06-01',
  schemaVersion: 2,
  stores: {
    tj: { name: "Trader Joe's", why: 'Produce' },
    target: { name: 'Target', why: 'Pantry' },
  },
  storeOrder: ['tj', 'target'],
  meals: [
    { name: 'Meal A', ingredients: ['1 onion'], cook: [{ t: 'Cook', min: 20 }] },
    { name: 'Meal B', ingredients: ['2 lb beef'], cook: [{ t: 'Grill', min: 15 }] },
  ],
  items: [
    { n: 'Onion', q: '1', sec: 'produce', store: 'tj', p: 0.8 },
    { n: 'Ground beef', q: '2 lb', sec: 'meat', store: 'tj', p: 9.5 },
    { n: 'Olive oil', sec: 'pantry', store: 'target', p: 6, staple: true },
  ],
};

describe('mapWeeklyPlan', () => {
  it('schedules dinners on consecutive days from startDate', () => {
    const mapped = mapWeeklyPlan(samplePlan, { startDate: '2026-06-01' });
    expect(mapped.meals).toHaveLength(2);
    expect(mapped.planItems).toEqual([
      { mealIndex: 0, date: '2026-06-01', type: 'dinner' },
      { mealIndex: 1, date: '2026-06-02', type: 'dinner' },
    ]);
  });

  it('defaults startDate to plan.weekOf', () => {
    const mapped = mapWeeklyPlan(samplePlan);
    expect(mapped.planItems[0].date).toBe('2026-06-01');
  });

  it('builds shopping items from the consolidated list with store names', () => {
    const mapped = mapWeeklyPlan(samplePlan);
    expect(mapped.shoppingItems).toHaveLength(3);
    expect(mapped.shoppingItems[0]).toMatchObject({
      name: 'Onion',
      category: 'Produce',
      quantity: '1',
      store: "Trader Joe's",
      isPurchased: false,
      order: 0,
    });
    expect(mapped.shoppingItems[1].category).toBe('Meat');
  });
});

describe('money helpers', () => {
  it('totals prices', () => {
    expect(subtotal(samplePlan.items)).toBeCloseTo(16.3);
    expect(grandTotal(samplePlan)).toBeCloseTo(16.3);
  });

  it('groups items by store honoring storeOrder', () => {
    const groups = groupItemsByStore(samplePlan);
    expect(groups.map(g => g.key)).toEqual(['tj', 'target']);
    expect(groups[0].name).toBe("Trader Joe's");
    expect(groups[0].items).toHaveLength(2);
    expect(subtotal(groups[0].items)).toBeCloseTo(10.3);
    expect(groups[1].items).toHaveLength(1);
  });
});
