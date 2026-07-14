import { describe, it, expect } from 'vitest';
import { calculateWeeklyMealCost } from './mealCost';
import { Meal, MealPlanItem } from '@/types/schema';

const meal = (overrides: Partial<Meal>): Meal => ({
  id: 'm1',
  name: 'Test Meal',
  ingredients: [],
  tags: [],
  ...overrides,
});

const planItem = (overrides: Partial<MealPlanItem>): MealPlanItem => ({
  id: 'p1',
  date: '2026-07-13',
  mealName: 'Test Meal',
  type: 'dinner',
  isCooked: false,
  ...overrides,
});

describe('calculateWeeklyMealCost', () => {
  it('averages and totals only meals that have a cost, skipping the rest', () => {
    const meals: Meal[] = [
      meal({ id: 'a', estimatedCost: 40 }),
      meal({ id: 'b', estimatedCost: 47 }),
      meal({ id: 'c' }), // no cost — skipped
    ];
    const mealPlan: MealPlanItem[] = [
      planItem({ id: 'p1', date: '2026-07-13', mealId: 'a' }),
      planItem({ id: 'p2', date: '2026-07-14', mealId: 'b' }),
      planItem({ id: 'p3', date: '2026-07-15', mealId: 'c' }),
    ];

    const result = calculateWeeklyMealCost(mealPlan, meals, '2026-07-13', '2026-07-19');

    expect(result.total).toBe(87);
    expect(result.average).toBe(43.5);
    expect(result.countWithCost).toBe(2);
    expect(result.countTotal).toBe(3);
  });

  it('returns a null average and zero total when no planned meal has a cost', () => {
    const meals: Meal[] = [meal({ id: 'a' })];
    const mealPlan: MealPlanItem[] = [planItem({ id: 'p1', date: '2026-07-13', mealId: 'a' })];

    const result = calculateWeeklyMealCost(mealPlan, meals, '2026-07-13', '2026-07-19');

    expect(result.total).toBe(0);
    expect(result.average).toBeNull();
    expect(result.countWithCost).toBe(0);
    expect(result.countTotal).toBe(1);
  });

  it('ignores meal-plan items with no linked meal (one-off meals)', () => {
    const meals: Meal[] = [];
    const mealPlan: MealPlanItem[] = [
      planItem({ id: 'p1', date: '2026-07-13', mealId: undefined, mealName: 'Takeout' }),
    ];

    const result = calculateWeeklyMealCost(mealPlan, meals, '2026-07-13', '2026-07-19');

    expect(result.total).toBe(0);
    expect(result.average).toBeNull();
    expect(result.countWithCost).toBe(0);
    expect(result.countTotal).toBe(1);
  });

  it('filters by meal type (dinner only, ignoring breakfast/lunch/snack)', () => {
    const meals: Meal[] = [meal({ id: 'a', estimatedCost: 10 }), meal({ id: 'b', estimatedCost: 20 })];
    const mealPlan: MealPlanItem[] = [
      planItem({ id: 'p1', date: '2026-07-13', mealId: 'a', type: 'dinner' }),
      planItem({ id: 'p2', date: '2026-07-13', mealId: 'b', type: 'breakfast' }),
    ];

    const result = calculateWeeklyMealCost(mealPlan, meals, '2026-07-13', '2026-07-19', 'dinner');

    expect(result.total).toBe(10);
    expect(result.countTotal).toBe(1);
  });

  it('excludes meal-plan items outside the week window', () => {
    const meals: Meal[] = [meal({ id: 'a', estimatedCost: 10 })];
    const mealPlan: MealPlanItem[] = [
      planItem({ id: 'p1', date: '2026-07-06', mealId: 'a' }), // prior week
      planItem({ id: 'p2', date: '2026-07-20', mealId: 'a' }), // next week
    ];

    const result = calculateWeeklyMealCost(mealPlan, meals, '2026-07-13', '2026-07-19');

    expect(result.countTotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it('avoids floating-point drift when summing many costs', () => {
    const meals: Meal[] = [
      meal({ id: 'a', estimatedCost: 0.1 }),
      meal({ id: 'b', estimatedCost: 0.2 }),
    ];
    const mealPlan: MealPlanItem[] = [
      planItem({ id: 'p1', date: '2026-07-13', mealId: 'a' }),
      planItem({ id: 'p2', date: '2026-07-14', mealId: 'b' }),
    ];

    const result = calculateWeeklyMealCost(mealPlan, meals, '2026-07-13', '2026-07-19');

    expect(result.total).toBe(0.3);
  });
});
