import { describe, it, expect } from 'vitest';
import { groupMealPlanByDay, formatMealPlanForShare } from './mealPlanFormatter';
import { Meal, MealPlanItem } from '@/types/schema';

describe('groupMealPlanByDay', () => {
  const dayLabels = new Map([
    ['2026-07-13', 'Monday, Jul 13'],
    ['2026-07-14', 'Tuesday, Jul 14'],
  ]);

  it('groups items by date and orders meal types breakfast -> snack', () => {
    const items: MealPlanItem[] = [
      { id: '1', date: '2026-07-13', mealName: 'Toast', type: 'breakfast', isCooked: false },
      { id: '2', date: '2026-07-13', mealName: 'Pasta', type: 'dinner', isCooked: false },
      { id: '3', date: '2026-07-13', mealName: 'Salad', type: 'lunch', isCooked: false },
    ];
    const result = groupMealPlanByDay(items, new Map(), dayLabels);
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe('2026-07-13');
    expect(result[0]!.items.map(i => i.type)).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('resolves meal name from linked Meal, falling back to snapshot mealName', () => {
    const meal: Meal = { id: 'm1', name: 'Chicken Stir Fry', ingredients: [], tags: [] };
    const mealsById = new Map([['m1', meal]]);
    const items: MealPlanItem[] = [
      { id: '1', date: '2026-07-14', mealId: 'm1', mealName: 'stale snapshot', type: 'dinner', isCooked: false },
      { id: '2', date: '2026-07-14', mealName: 'One-off Snack', type: 'snack', isCooked: false },
    ];
    const result = groupMealPlanByDay(items, mealsById, dayLabels);
    const names = result[0]!.items.map(i => i.mealName);
    expect(names).toContain('Chicken Stir Fry');
    expect(names).toContain('One-off Snack');
  });

  it('omits days with no planned items and preserves dayLabels order', () => {
    const items: MealPlanItem[] = [
      { id: '1', date: '2026-07-14', mealName: 'Eggs', type: 'breakfast', isCooked: false },
    ];
    const result = groupMealPlanByDay(items, new Map(), dayLabels);
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe('2026-07-14');
  });
});

describe('formatMealPlanForShare', () => {
  it('returns empty string when no days have meals', () => {
    expect(formatMealPlanForShare([])).toBe('');
    expect(
      formatMealPlanForShare([{ date: '2026-07-13', label: 'Monday, Jul 13', items: [] }])
    ).toBe('');
  });

  it('renders day headers with type: meal name lines', () => {
    const result = formatMealPlanForShare([
      {
        date: '2026-07-13',
        label: 'Monday, Jul 13',
        items: [
          { type: 'breakfast', typeLabel: 'Breakfast', mealName: 'Toast' },
          { type: 'dinner', typeLabel: 'Dinner', mealName: 'Pasta' },
        ],
      },
    ]);
    expect(result).toBe(
      'Meal Plan\n\nMonday, Jul 13\nBreakfast: Toast\nDinner: Pasta'
    );
  });

  it('skips empty days between populated ones', () => {
    const result = formatMealPlanForShare([
      { date: '2026-07-13', label: 'Monday, Jul 13', items: [] },
      {
        date: '2026-07-14',
        label: 'Tuesday, Jul 14',
        items: [{ type: 'lunch', typeLabel: 'Lunch', mealName: 'Salad' }],
      },
    ]);
    expect(result).toBe('Meal Plan\n\nTuesday, Jul 14\nLunch: Salad');
  });
});
