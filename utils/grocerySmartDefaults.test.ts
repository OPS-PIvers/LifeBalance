import { describe, it, expect } from 'vitest';
import { suggestItemDefaults, parseQuantity, formatQuantity } from '@/utils/grocerySmartDefaults';
import { GroceryCatalogItem } from '@/types/schema';

const catalog: GroceryCatalogItem[] = [
  { id: '1', name: 'Cheddar Cheese', category: 'Dairy', defaultQuantity: '1 block', defaultStore: 'Costco', purchaseCount: 5 },
  { id: '2', name: 'Athletic Socks', category: 'Uncategorized', purchaseCount: 1 },
  { id: '3', name: 'Milk', category: 'Dairy', defaultQuantity: '1 gallon', purchaseCount: 12 },
  { id: '4', name: 'Cheese Sticks', category: 'Snacks', purchaseCount: 2 },
];

describe('suggestItemDefaults', () => {
  it('returns exact history match with source history', () => {
    const result = suggestItemDefaults('cheddar cheese', catalog);
    expect(result).toEqual({
      category: 'Dairy',
      quantity: '1 block',
      store: 'Costco',
      source: 'history',
    });
  });

  it('exact match is case-insensitive', () => {
    const result = suggestItemDefaults('MILK', catalog);
    expect(result?.category).toBe('Dairy');
    expect(result?.source).toBe('history');
  });

  it('prefers exact history over preset map', () => {
    // "cheese" alone would hit the preset map, but "Cheddar Cheese" exact match should win.
    const result = suggestItemDefaults('Cheddar Cheese', catalog);
    expect(result?.source).toBe('history');
    expect(result?.store).toBe('Costco');
  });

  it('partial history match picks highest purchaseCount among token overlaps', () => {
    // "cheese" overlaps with "Cheddar Cheese" (count 5) and "Cheese Sticks" (count 2).
    const result = suggestItemDefaults('cheese', catalog);
    expect(result?.source).toBe('history');
    expect(result?.category).toBe('Dairy');
  });

  it('ignores Uncategorized catalog entries for partial match', () => {
    const result = suggestItemDefaults('socks', catalog);
    // Athletic Socks is Uncategorized so should not be treated as a suggestion;
    // "socks" is not in the preset map either.
    expect(result).toBeNull();
  });

  it('does not false-match short tokens like sock against Athletic Socks', () => {
    const result = suggestItemDefaults('sock', catalog);
    expect(result).toBeNull();
  });

  it('falls back to preset map when no history matches', () => {
    const result = suggestItemDefaults('bananas', catalog);
    expect(result).toEqual({ category: 'Produce', source: 'preset' });
  });

  it('preset match is whole-word token based, case-insensitive', () => {
    const result = suggestItemDefaults('Frozen Waffles', catalog);
    expect(result?.category).toBe('Frozen');
    expect(result?.source).toBe('preset');
  });

  it('returns null for unknown items with no history and no preset match', () => {
    const result = suggestItemDefaults('gadget widget', catalog);
    expect(result).toBeNull();
  });

  it('returns null for empty/whitespace input', () => {
    expect(suggestItemDefaults('', catalog)).toBeNull();
    expect(suggestItemDefaults('   ', catalog)).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('parses count + unit', () => {
    expect(parseQuantity('2 lbs')).toEqual({ count: 2, unit: 'lbs' });
  });

  it('parses count-only strings', () => {
    expect(parseQuantity('3')).toEqual({ count: 3, unit: '' });
  });

  it('parses decimal counts', () => {
    expect(parseQuantity('1.5 lbs')).toEqual({ count: 1.5, unit: 'lbs' });
  });

  it('parses leading-dot decimals', () => {
    expect(parseQuantity('.5 lbs')).toEqual({ count: 0.5, unit: 'lbs' });
    expect(parseQuantity('.25')).toEqual({ count: 0.25, unit: '' });
  });

  it('handles undefined/empty as default 1 with empty unit', () => {
    expect(parseQuantity(undefined)).toEqual({ count: 1, unit: '' });
    expect(parseQuantity('')).toEqual({ count: 1, unit: '' });
  });

  it('treats non-numeric-leading text as the unit with count 1', () => {
    expect(parseQuantity('dozen')).toEqual({ count: 1, unit: 'dozen' });
  });
});

describe('formatQuantity', () => {
  it('formats count + unit', () => {
    expect(formatQuantity({ count: 2, unit: 'lbs' })).toBe('2 lbs');
  });

  it('formats count-only as just the number', () => {
    expect(formatQuantity({ count: 3, unit: '' })).toBe('3');
  });

  it('returns empty string for the default 1/no-unit case', () => {
    expect(formatQuantity({ count: 1, unit: '' })).toBe('');
  });

  it('round-trips parse -> format', () => {
    expect(formatQuantity(parseQuantity('2 lbs'))).toBe('2 lbs');
    expect(formatQuantity(parseQuantity('3'))).toBe('3');
    expect(formatQuantity(parseQuantity(''))).toBe('');
  });

  it('formats a text-only unit with count 1', () => {
    expect(formatQuantity({ count: 1, unit: 'dozen' })).toBe('1 dozen');
  });
});
