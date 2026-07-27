// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  sortShoppingItems,
  shoppingGroupLabel,
  readStoredShoppingSortMode,
  isShoppingSortMode,
  SHOPPING_SORT_STORAGE_KEY,
} from './shoppingSort';
import { ShoppingItem } from '@/types/schema';

const item = (overrides: Partial<ShoppingItem> & { name: string }): ShoppingItem => ({
  id: overrides.name,
  category: 'Uncategorized',
  isPurchased: false,
  ...overrides,
});

const CATEGORY_ORDER = ['Produce', 'Dairy', 'Meat', 'Pantry', 'Frozen', 'Uncategorized'];

describe('sortShoppingItems', () => {
  it('entry mode sorts by order field with name fallback, missing order last', () => {
    const items = [
      item({ name: 'Zucchini', order: 2 }),
      item({ name: 'Apples' }), // no order → last
      item({ name: 'Bread', order: 1 }),
      item({ name: 'Milk', order: 2 }),
    ];
    expect(sortShoppingItems(items, 'entry').map(i => i.name)).toEqual([
      'Bread', 'Milk', 'Zucchini', 'Apples',
    ]);
  });

  it('does not mutate the input array', () => {
    const items = [item({ name: 'B', order: 2 }), item({ name: 'A', order: 1 })];
    const result = sortShoppingItems(items, 'entry');
    expect(items.map(i => i.name)).toEqual(['B', 'A']);
    expect(result.map(i => i.name)).toEqual(['A', 'B']);
  });

  it('alpha mode sorts by name case-insensitively', () => {
    const items = [
      item({ name: 'bananas' }),
      item({ name: 'Apples' }),
      item({ name: 'Cherries' }),
    ];
    expect(sortShoppingItems(items, 'alpha').map(i => i.name)).toEqual([
      'Apples', 'bananas', 'Cherries',
    ]);
  });

  it('store mode groups by store alphabetically with storeless items last', () => {
    const items = [
      item({ name: 'Paper towels' }), // no store
      item({ name: 'Milk', store: 'Target' }),
      item({ name: 'Apples', store: 'Costco' }),
      item({ name: 'Bread', store: 'costco' }), // case-insensitive same store
    ];
    expect(sortShoppingItems(items, 'store').map(i => i.name)).toEqual([
      'Apples', 'Bread', 'Milk', 'Paper towels',
    ]);
  });

  it('store mode uses storeOrder map for visit order when provided (F-MEALS-07)', () => {
    const items = [
      item({ name: 'Apples', store: 'Costco' }),
      item({ name: 'Milk', store: 'Target' }),
      item({ name: 'Bread', store: 'Aldi' }),
    ];
    const storeOrder = new Map([
      ['target', 0],
      ['aldi', 1],
      ['costco', 2],
    ]);
    expect(sortShoppingItems(items, 'store', [], storeOrder).map(i => i.name)).toEqual([
      'Milk', 'Bread', 'Apples',
    ]);
  });

  it('store mode sorts ordered stores before unordered ones, then alphabetically within each group', () => {
    const items = [
      item({ name: 'Eggs', store: 'Whole Foods' }), // not in storeOrder
      item({ name: 'Milk', store: 'Target' }),
      item({ name: 'Apples', store: 'Costco' }),
    ];
    const storeOrder = new Map([['target', 5]]);
    expect(sortShoppingItems(items, 'store', [], storeOrder).map(i => i.name)).toEqual([
      'Milk', 'Apples', 'Eggs',
    ]);
  });

  it('section mode follows the category walk order, then name', () => {
    const items = [
      item({ name: 'Ice cream', category: 'Frozen' }),
      item({ name: 'Chicken', category: 'Meat' }),
      item({ name: 'Milk', category: 'Dairy' }),
      item({ name: 'Apples', category: 'Produce' }),
      item({ name: 'Bananas', category: 'Produce' }),
    ];
    expect(sortShoppingItems(items, 'section', CATEGORY_ORDER).map(i => i.name)).toEqual([
      'Apples', 'Bananas', 'Milk', 'Chicken', 'Ice cream',
    ]);
  });

  it('section mode puts unknown categories after known ones, grouped alphabetically', () => {
    const items = [
      item({ name: 'Batteries', category: 'Electronics' }),
      item({ name: 'Apples', category: 'Produce' }),
      item({ name: 'Dog food', category: 'Pet' }),
      item({ name: 'Cat food', category: 'Pet' }),
    ];
    expect(sortShoppingItems(items, 'section', CATEGORY_ORDER).map(i => i.name)).toEqual([
      'Apples', 'Batteries', 'Cat food', 'Dog food',
    ]);
  });

  it('section mode treats empty category as Uncategorized', () => {
    const items = [
      item({ name: 'Mystery', category: '' }),
      item({ name: 'Apples', category: 'Produce' }),
    ];
    expect(sortShoppingItems(items, 'section', CATEGORY_ORDER).map(i => i.name)).toEqual([
      'Apples', 'Mystery',
    ]);
  });
});

describe('shoppingGroupLabel', () => {
  it('returns store name / fallback in store mode', () => {
    expect(shoppingGroupLabel(item({ name: 'Milk', store: 'Target' }), 'store')).toBe('Target');
    expect(shoppingGroupLabel(item({ name: 'Milk' }), 'store')).toBe('No store');
  });

  it('returns category / fallback in section mode', () => {
    expect(shoppingGroupLabel(item({ name: 'Milk', category: 'Dairy' }), 'section')).toBe('Dairy');
    expect(shoppingGroupLabel(item({ name: 'Milk', category: '' }), 'section')).toBe('Uncategorized');
  });

  it('returns null for flat modes', () => {
    expect(shoppingGroupLabel(item({ name: 'Milk' }), 'entry')).toBeNull();
    expect(shoppingGroupLabel(item({ name: 'Milk' }), 'alpha')).toBeNull();
  });
});

describe('readStoredShoppingSortMode', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to entry when nothing stored', () => {
    expect(readStoredShoppingSortMode()).toBe('entry');
  });

  it('returns a stored valid mode', () => {
    localStorage.setItem(SHOPPING_SORT_STORAGE_KEY, 'section');
    expect(readStoredShoppingSortMode()).toBe('section');
  });

  it('falls back to entry on an invalid stored value', () => {
    localStorage.setItem(SHOPPING_SORT_STORAGE_KEY, 'bogus');
    expect(readStoredShoppingSortMode()).toBe('entry');
  });
});

describe('isShoppingSortMode', () => {
  it('accepts valid modes and rejects others', () => {
    expect(isShoppingSortMode('alpha')).toBe(true);
    expect(isShoppingSortMode('store')).toBe(true);
    expect(isShoppingSortMode('bogus')).toBe(false);
    expect(isShoppingSortMode(null)).toBe(false);
  });
});
