import { describe, it, expect } from 'vitest';
import { parsePastedIngredientList, MAX_PASTE_IMPORT_ITEMS } from '@/utils/parsePastedIngredientList';

describe('parsePastedIngredientList', () => {
  it('returns an empty array for empty/whitespace input', () => {
    expect(parsePastedIngredientList('')).toEqual([]);
    expect(parsePastedIngredientList('   \n  \n ')).toEqual([]);
  });

  it('splits multi-line paste into items', () => {
    expect(parsePastedIngredientList('milk\neggs\nbread')).toEqual(['milk', 'eggs', 'bread']);
  });

  it('splits a single-line comma-separated paste into items', () => {
    expect(parsePastedIngredientList('milk, eggs, bread')).toEqual(['milk', 'eggs', 'bread']);
  });

  it('strips bullet, numbered, and checkbox markers', () => {
    expect(
      parsePastedIngredientList('- milk\n* eggs\n• bread\n1. butter\n2) cheese\n[ ] yogurt\n[x] flour')
    ).toEqual(['milk', 'eggs', 'bread', 'butter', 'cheese', 'yogurt', 'flour']);
  });

  it('drops blank lines', () => {
    expect(parsePastedIngredientList('milk\n\n\neggs\n   \nbread')).toEqual(['milk', 'eggs', 'bread']);
  });

  it('deduplicates case-insensitively, keeping first-seen casing', () => {
    expect(parsePastedIngredientList('Milk\nmilk\nMILK\neggs')).toEqual(['Milk', 'eggs']);
  });

  it('trims surrounding whitespace on each line', () => {
    expect(parsePastedIngredientList('  milk  \n  eggs  ')).toEqual(['milk', 'eggs']);
  });

  it('truncates to MAX_PASTE_IMPORT_ITEMS', () => {
    const lines = Array.from({ length: MAX_PASTE_IMPORT_ITEMS + 10 }, (_, i) => `item ${i}`);
    const result = parsePastedIngredientList(lines.join('\n'));
    expect(result).toHaveLength(MAX_PASTE_IMPORT_ITEMS);
    expect(result[0]).toBe('item 0');
  });

  it('does not comma-split a genuine multi-line paste even if a line has a comma', () => {
    expect(parsePastedIngredientList('2 cups flour, sifted\neggs')).toEqual(['2 cups flour, sifted', 'eggs']);
  });
});
