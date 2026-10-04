import { describe, expect, it } from 'vitest';
import type { GroceryCatalogItem, Meal, MealPlanItem, ShoppingItem, Store, ToDo } from '@/types/schema';
import {
  NO_STORE,
  catalogSuggestions,
  dueDateFor,
  groupShoppingByStore,
  groupTodos,
  ingredientStatus,
  mealWeek,
  newShoppingItem,
  recipeFor,
  sortShopping,
  withoutId,
} from './wallLists';

const T = '2026-10-03';
const todo = (id: string, date: string, extra: Partial<ToDo> = {}): ToDo =>
  ({ id, text: id, completeByDate: date, isCompleted: false, ...extra }) as ToDo;

describe('groupTodos', () => {
  const list = [
    todo('late', '2026-10-01'),
    todo('today', T, { assignedTo: 'p' }),
    todo('done today', T, { isCompleted: true, completedAt: '2026-10-03T18:00:00Z' }),
    todo('done before', T, { isCompleted: true, completedAt: '2026-10-02T18:00:00Z' }),
    todo('fri', '2026-10-09', { assignedTo: 'l' }),
    todo('too far', '2026-10-10'),
  ];

  it('groups Overdue / Today / This week and counts open items', () => {
    const groups = groupTodos(list, T, 'America/Chicago');
    expect(groups.map(g => [g.title, g.items.map(t => t.id), g.open])).toEqual([
      ['Overdue', ['late'], 1],
      ['Today', ['done today', 'today'], 1],
      ['This week', ['fri'], 1],
    ]);
  });

  it('filters by person, with family meaning unassigned', () => {
    expect(groupTodos(list, T, 'America/Chicago', 'l').flatMap(g => g.items.map(t => t.id))).toEqual(['fri']);
    expect(groupTodos(list, T, 'America/Chicago', 'family').flatMap(g => g.items.map(t => t.id))).toEqual(['late', 'done today']);
  });
});

describe('sortShopping', () => {
  it('uses the manual order, then the name', () => {
    const items = [
      { id: 'b', name: 'Bread', order: 2 },
      { id: 'a', name: 'Apples' },
      { id: 'm', name: 'Milk', order: 1 },
    ] as ShoppingItem[];
    expect(sortShopping(items).map(i => i.id)).toEqual(['m', 'b', 'a']);
  });
});

describe('groupShoppingByStore', () => {
  it('orders the household’s stores by visit order, then others, then no store; checked items go to the cart', () => {
    const stores = [
      { id: '1', name: 'Target', order: 2 },
      { id: '2', name: 'Cub Foods', order: 1 },
    ] as Store[];
    const items = [
      { id: 'a', name: 'Milk', store: 'Cub Foods', isPurchased: false },
      { id: 'b', name: 'Eggs', store: 'Cub Foods', isPurchased: true },
      { id: 'c', name: 'Batteries', store: 'Target', isPurchased: false },
      { id: 'd', name: 'Coffee', store: 'Costco', isPurchased: false },
      { id: 'e', name: 'Stamps', isPurchased: false },
    ] as ShoppingItem[];
    const groups = groupShoppingByStore(items, stores);
    expect(groups.map(g => [g.store, g.open.map(i => i.id), g.cart.map(i => i.id)])).toEqual([
      ['Cub Foods', ['a'], ['b']],
      ['Target', ['c'], []],
      ['Costco', ['d'], []],
      [NO_STORE, ['e'], []],
    ]);
  });
});

describe('add sheet helpers', () => {
  const catalog = [
    { id: '1', name: 'Avocados', category: 'Produce', defaultStore: 'Cub Foods', defaultQuantity: '2', purchaseCount: 9 },
    { id: '2', name: 'Avocado oil', category: 'Pantry', purchaseCount: 2 },
    { id: '3', name: 'Guacamole', category: 'Deli', purchaseCount: 5 },
    { id: '4', name: 'Milk', category: 'Dairy', purchaseCount: 30 },
  ] as GroceryCatalogItem[];

  it('suggests prefix matches first, most bought first', () => {
    expect(catalogSuggestions(catalog, 'avo').map(c => c.name)).toEqual(['Avocados', 'Avocado oil']);
    expect(catalogSuggestions(catalog, 'mol').map(c => c.name)).toEqual(['Guacamole']);
    expect(catalogSuggestions(catalog, '  ')).toEqual([]);
  });

  it('fills a new item from the catalog, honoring an explicit store choice', () => {
    expect(newShoppingItem('avocados', catalog, null)).toEqual({
      name: 'Avocados', category: 'Produce', isPurchased: false, source: 'manual', quantity: '2', store: 'Cub Foods',
    });
    expect(newShoppingItem('Avocados', catalog, NO_STORE).store).toBeUndefined();
    expect(newShoppingItem('Avocados', catalog, 'Target').store).toBe('Target');
    expect(newShoppingItem(' Birthday card ', catalog, null)).toEqual({ name: 'Birthday card', category: 'Other', isPurchased: false, source: 'manual' });
  });

  it('turns due chips into dates (This week = by Saturday)', () => {
    expect(dueDateFor('today', '2026-10-07')).toBe('2026-10-07');
    expect(dueDateFor('tomorrow', '2026-10-07')).toBe('2026-10-08');
    expect(dueDateFor('week', '2026-10-07')).toBe('2026-10-10');
    expect(dueDateFor('week', '2026-10-10')).toBe('2026-10-10');
  });

  it('strips the id for an undo re-add', () => {
    expect(withoutId({ id: 'x', name: 'Milk' })).toEqual({ name: 'Milk' });
  });
});

describe('meals', () => {
  const plan = [
    { id: '1', date: '2026-10-03', type: 'dinner', mealId: 'm1', mealName: 'Tacos', isCooked: false },
    { id: '2', date: '2026-10-03', type: 'breakfast', mealName: 'Pancakes', isCooked: false },
    { id: '3', date: '2026-10-05', type: 'dinner', mealName: 'Roast chicken', isCooked: false },
    { id: '4', date: '2026-10-11', type: 'dinner', mealName: 'Too far', isCooked: false },
  ] as MealPlanItem[];
  const meals = [
    { id: 'm1', name: 'Tacos', tags: [], ingredients: [{ name: 'Tortillas' }, { name: 'Salsa' }] },
    { id: 'm2', name: 'Roast chicken', tags: [], ingredients: [] },
  ] as Meal[];

  it('lays out seven days from today', () => {
    const week = mealWeek(plan, '2026-10-03');
    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ dinner: { mealName: 'Tacos' }, breakfast: { mealName: 'Pancakes' } });
    expect(week[1]?.dinner).toBeUndefined();
    expect(week.some(d => d.dinner?.mealName === 'Too far')).toBe(false);
  });

  it('finds the recipe by id, else by name, and flags what is already on the list', () => {
    expect(recipeFor(plan[0]!, meals)?.id).toBe('m1');
    expect(recipeFor(plan[2]!, meals)?.id).toBe('m2');
    const list = [
      { id: 's', name: 'tortillas', isPurchased: false },
      { id: 't', name: 'Salsa', isPurchased: true },
    ] as ShoppingItem[];
    expect(ingredientStatus(meals[0]!, list).map(s => [s.ingredient.name, s.onList])).toEqual([
      ['Tortillas', true],
      ['Salsa', false],
    ]);
  });
});
