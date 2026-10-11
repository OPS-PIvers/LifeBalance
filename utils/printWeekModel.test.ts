import { describe, it, expect } from 'vitest';
import { buildPrintWeek, PrintWeekDate } from './printWeekModel';
import { Meal, MealPlanItem, ShoppingItem } from '@/types/schema';

const weekDates: PrintWeekDate[] = [
  { date: '2026-10-05', weekday: 'Mon', dayOfMonth: '5' },
  { date: '2026-10-06', weekday: 'Tue', dayOfMonth: '6' },
  { date: '2026-10-07', weekday: 'Wed', dayOfMonth: '7' },
];

const meal = (id: string, name: string, ingredients: string[]): Meal => ({
  id,
  name,
  tags: [],
  ingredients: ingredients.map(n => ({ name: n, quantity: '1' })),
});

const plan = (id: string, date: string, mealId: string | undefined, mealName: string, type: MealPlanItem['type'] = 'dinner'): MealPlanItem => ({
  id,
  date,
  mealId,
  mealName,
  type,
  isCooked: false,
});

const item = (name: string, isPurchased = false, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: name,
  name,
  category: 'Produce',
  isPurchased,
  ...extra,
});

describe('buildPrintWeek', () => {
  it('splits ingredients into still-to-buy (on the unpurchased list) and on hand (everything else)', () => {
    const mealsById = new Map([['m1', meal('m1', 'Tacos', ['Tortillas', 'Ground beef', 'Salsa', 'Cheese'])]]);
    const week = buildPrintWeek(
      weekDates,
      [plan('p1', '2026-10-05', 'm1', 'Tacos')],
      mealsById,
      // Case/whitespace-insensitive match; a purchased row counts as on hand.
      [item(' ground BEEF '), item('Salsa'), item('Cheese', true)]
    );

    const tacos = week.days[0]?.meals[0];
    expect(tacos?.toBuy.map(i => i.name)).toEqual(['Ground beef', 'Salsa']);
    expect(tacos?.onHand.map(i => i.name)).toEqual(['Tortillas', 'Cheese']);
  });

  it('keeps every day of the week, empty ones included, and orders meal types', () => {
    const week = buildPrintWeek(
      weekDates,
      [plan('p1', '2026-10-06', undefined, 'Pizza night'), plan('p2', '2026-10-06', undefined, 'Oatmeal', 'breakfast')],
      new Map(),
      []
    );
    expect(week.days.map(d => d.weekday)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(week.days[0]?.meals).toEqual([]);
    expect(week.days[1]?.meals.map(m => m.mealName)).toEqual(['Oatmeal', 'Pizza night']);
    expect(week.days[1]?.meals[1]?.toBuy).toEqual([]);
  });

  it('lists only unpurchased items, flattened in category order per store', () => {
    const mealsById = new Map([['m1', meal('m1', 'Nachos', ['Salsa', 'salsa'])]]);
    const week = buildPrintWeek(
      weekDates,
      [plan('p1', '2026-10-07', 'm1', 'Nachos')],
      mealsById,
      [item('Salsa'), item('Windex', false, { category: 'Household' }), item('Milk', true)]
    );

    // Duplicate ingredient within one meal is listed once.
    expect(week.days[2]?.meals[0]?.toBuy).toHaveLength(1);
    expect(week.shopping).toEqual([
      { storeLabel: 'OTHER', items: [{ name: 'Windex', quantity: undefined }, { name: 'Salsa', quantity: undefined }] },
    ]);
  });

  it('prefers the linked recipe name over the plan snapshot', () => {
    const week = buildPrintWeek(
      weekDates,
      [plan('p1', '2026-10-05', 'm1', 'Old name')],
      new Map([['m1', meal('m1', 'New name', [])]]),
      []
    );
    expect(week.days[0]?.meals[0]?.mealName).toBe('New name');
  });
});
