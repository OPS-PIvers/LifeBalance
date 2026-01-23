import { describe, it, expect } from 'vitest';
import { formatShoppingListForShare } from './shoppingListFormatter';
import { ShoppingItem } from '@/types/schema';

describe('formatShoppingListForShare', () => {
  it('returns empty string for empty list', () => {
    expect(formatShoppingListForShare([])).toBe('');
  });

  it('formats a simple list correctly', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Apples', category: 'Produce', isPurchased: false },
      { id: '2', name: 'Milk', category: 'Dairy', isPurchased: false }
    ];
    const expected = `🛒 Shopping List

Dairy:
- Milk

Produce:
- Apples`;
    expect(formatShoppingListForShare(items)).toBe(expected);
  });

  it('includes quantity and store', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Bread', category: 'Bakery', quantity: '2 loaves', store: 'BakeryShop', isPurchased: false }
    ];
    const expected = `🛒 Shopping List

Bakery:
- [BakeryShop] Bread (2 loaves)`;
    expect(formatShoppingListForShare(items)).toBe(expected);
  });

  it('handles uncategorized items', () => {
    const items: ShoppingItem[] = [
      { id: '1', name: 'Unknown Item', category: '', isPurchased: false }
    ];
    const expected = `🛒 Shopping List

Uncategorized:
- Unknown Item`;
    expect(formatShoppingListForShare(items)).toBe(expected);
  });

  it('sorts categories alphabetically', () => {
     const items: ShoppingItem[] = [
      { id: '1', name: 'B', category: 'Zebra', isPurchased: false },
      { id: '2', name: 'A', category: 'Apple', isPurchased: false }
    ];
    const result = formatShoppingListForShare(items);
    expect(result.indexOf('Apple:')).toBeLessThan(result.indexOf('Zebra:'));
  });
});
