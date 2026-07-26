import { describe, it, expect } from 'vitest';
import { buildPrintWeekHtml } from './printWeekHtml';
import { FormattedMealDay } from '@/utils/mealPlanFormatter';
import { GroupedShoppingStore } from '@/utils/shoppingListFormatter';
import { ShoppingItem } from '@/types/schema';

describe('buildPrintWeekHtml', () => {
  it('renders meal days and shopping stores with escaped content', () => {
    const mealDays: FormattedMealDay[] = [
      {
        date: '2026-07-13',
        label: 'Monday, Jul 13',
        items: [{ type: 'dinner', typeLabel: 'Dinner', mealName: 'Mac & Cheese' }],
      },
    ];
    const shoppingStores: GroupedShoppingStore[] = [
      {
        storeLabel: 'SAFEWAY',
        categories: [
          { display: 'Dairy', items: [{ id: '1', name: 'Milk', category: 'Dairy', isPurchased: false, quantity: '1 gal' }] },
        ],
      },
    ];

    const html = buildPrintWeekHtml('Jul 13 - Jul 19', mealDays, shoppingStores);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Mac &amp; Cheese');
    expect(html).toContain('Monday, Jul 13');
    expect(html).toContain('SAFEWAY');
    expect(html).toContain('Milk');
    expect(html).toContain('1 gal');
    expect(html).toContain('Jul 13 - Jul 19');
  });

  it('renders a legacy numeric quantity without throwing', () => {
    // ShoppingItem.quantity is typed `string`, but some Firestore docs hold a
    // raw number (written by the quickAdd Cloud Function before the
    // quantity-handling fix; shoppingItemConverter does a blind cast with no
    // coercion). A numeric quantity is truthy, so it reaches escapeHtml —
    // this must not throw `value.replace is not a function`. The `unknown`
    // round-trip cast (rather than `any`) simulates that legacy shape without
    // a lint suppression.
    const legacyItem = {
      id: '1',
      name: 'Milk',
      category: 'Dairy',
      isPurchased: false,
      quantity: 2,
    } as unknown as ShoppingItem;
    const shoppingStores: GroupedShoppingStore[] = [
      {
        storeLabel: 'SAFEWAY',
        categories: [{ display: 'Dairy', items: [legacyItem] }],
      },
    ];

    let html = '';
    expect(() => {
      html = buildPrintWeekHtml('Jul 13 - Jul 19', [], shoppingStores);
    }).not.toThrow();

    expect(html).toContain('Milk');
    expect(html).toContain('(2)');
  });

  it('shows empty-state copy when there are no meals or shopping items', () => {
    const html = buildPrintWeekHtml('Jul 13 - Jul 19', [], []);
    expect(html).toContain('No meals planned this week.');
    expect(html).toContain('Shopping list is empty.');
  });

  it('omits days with no planned items from the output', () => {
    const mealDays: FormattedMealDay[] = [
      { date: '2026-07-13', label: 'Monday, Jul 13', items: [] },
      {
        date: '2026-07-14',
        label: 'Tuesday, Jul 14',
        items: [{ type: 'lunch', typeLabel: 'Lunch', mealName: 'Salad' }],
      },
    ];
    const html = buildPrintWeekHtml('Jul 13 - Jul 19', mealDays, []);
    expect(html).not.toContain('Monday, Jul 13');
    expect(html).toContain('Tuesday, Jul 14');
  });
});
