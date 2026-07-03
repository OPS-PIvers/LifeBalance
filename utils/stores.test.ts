import { describe, it, expect } from 'vitest';
import { resolveStoreName } from './stores';

const stores = [{ name: 'Costco' }, { name: 'Whole Foods' }];

describe('resolveStoreName', () => {
  it('returns the canonical name on an exact match', () => {
    expect(resolveStoreName(stores, 'Costco')).toBe('Costco');
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(resolveStoreName(stores, '  costco ')).toBe('Costco');
    expect(resolveStoreName(stores, 'WHOLE FOODS')).toBe('Whole Foods');
  });

  it('returns the store\'s stored casing, not the input casing', () => {
    expect(resolveStoreName(stores, 'whole foods')).toBe('Whole Foods');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveStoreName(stores, 'Trader Joe\'s')).toBeUndefined();
  });

  it('returns undefined for an empty/whitespace merchant', () => {
    expect(resolveStoreName(stores, '')).toBeUndefined();
    expect(resolveStoreName(stores, '   ')).toBeUndefined();
  });

  it('does not partial-match a substring of a store name', () => {
    expect(resolveStoreName(stores, 'Cost')).toBeUndefined();
  });
});
