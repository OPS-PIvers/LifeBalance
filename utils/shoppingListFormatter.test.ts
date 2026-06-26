import { describe, it, expect } from 'vitest';
import { formatShoppingListForShare } from './shoppingListFormatter';
import { ShoppingItem } from '@/types/schema';

describe('formatShoppingListForShare', () => {
  it('returns empty string for empty list', () => {
    expect(formatShoppingListForShare([])).toBe('');
  });

  it('groups by store, then by category, with checkbox bullets', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Apples', category: 'Produce', store: 'Safeway', isPurchased: false },
      { id: '2', name: 'Milk', category: 'Dairy', store: 'Safeway', isPurchased: false }
    ];
    const expected = `🛒 Shopping List

SAFEWAY

Dairy:
☐ Milk

Produce:
☐ Apples`;
    expect(formatShoppingListForShare(items)).toBe(expected);
  });

  it('includes quantity', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Bread', category: 'Bakery', quantity: '2 loaves', store: 'BakeryShop', isPurchased: false }
    ];
    const expected = `🛒 Shopping List

BAKERYSHOP

Bakery:
☐ Bread (2 loaves)`;
    expect(formatShoppingListForShare(items)).toBe(expected);
  });

  it('puts items without a store under an "Other" section, shown last', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Batteries', category: '', isPurchased: false },
      { id: '2', name: 'Bananas', category: 'Produce', store: 'Costco', isPurchased: false }
    ];
    const result = formatShoppingListForShare(items);
    expect(result).toContain('COSTCO');
    expect(result).toContain('OTHER');
    expect(result).toContain('Uncategorized:');
    expect(result.indexOf('COSTCO')).toBeLessThan(result.indexOf('OTHER'));
  });

  it('sorts stores alphabetically', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'B', category: 'Misc', store: 'Zebra Mart', isPurchased: false },
      { id: '2', name: 'A', category: 'Misc', store: 'Apple Store', isPurchased: false }
    ];
    const result = formatShoppingListForShare(items);
    expect(result.indexOf('APPLE STORE')).toBeLessThan(result.indexOf('ZEBRA MART'));
  });

  it('merges store and category case variants into one section', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Apples', category: 'Produce', store: 'Safeway', isPurchased: false },
      { id: '2', name: 'Bananas', category: 'produce', store: 'safeway', isPurchased: false }
    ];
    const result = formatShoppingListForShare(items);
    // Only one SAFEWAY header and one Produce category despite mixed casing.
    expect(result.match(/SAFEWAY/g)?.length).toBe(1);
    expect(result.match(/Produce:/gi)?.length).toBe(1);
    expect(result).toContain('☐ Apples');
    expect(result).toContain('☐ Bananas');
  });

  it('sorts categories alphabetically within a store', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'B', category: 'Zebra', store: 'Target', isPurchased: false },
      { id: '2', name: 'A', category: 'Apple', store: 'Target', isPurchased: false }
    ];
    const result = formatShoppingListForShare(items);
    expect(result.indexOf('Apple:')).toBeLessThan(result.indexOf('Zebra:'));
  });
});
