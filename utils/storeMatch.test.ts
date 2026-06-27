import { describe, it, expect } from 'vitest';
import { normalizeStoreName, findExistingStore } from './storeMatch';

describe('normalizeStoreName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeStoreName('  Trader  Joes ')).toBe('trader joes');
  });
  it('drops apostrophes and periods so possessive/abbreviated variants match', () => {
    expect(normalizeStoreName("Trader Joe's")).toBe('trader joes');
    expect(normalizeStoreName("Sam's Club")).toBe('sams club');
    expect(normalizeStoreName("B.J.'s")).toBe('bjs');
  });
  it('treats other punctuation as a separator', () => {
    expect(normalizeStoreName('Stop-N-Shop')).toBe('stop n shop');
  });
  it('returns empty string for blank/nullish input', () => {
    expect(normalizeStoreName(undefined)).toBe('');
    expect(normalizeStoreName(null)).toBe('');
    expect(normalizeStoreName('   ')).toBe('');
  });
});

describe('findExistingStore', () => {
  const stores = [
    { id: '1', name: 'Costco' },
    { id: '2', name: "Trader Joe's" },
  ];

  it('matches an existing store case/punctuation-insensitively (returns canonical)', () => {
    expect(findExistingStore('trader joes', stores)?.name).toBe("Trader Joe's");
    expect(findExistingStore('COSTCO', stores)?.id).toBe('1');
  });
  it('returns undefined for a genuinely new store', () => {
    expect(findExistingStore('Safeway', stores)).toBeUndefined();
  });
  it('returns undefined for empty input', () => {
    expect(findExistingStore('', stores)).toBeUndefined();
    expect(findExistingStore(undefined, stores)).toBeUndefined();
  });
});
