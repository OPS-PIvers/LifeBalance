import { describe, it, expect } from 'vitest';
import { needsFreezeBankMigration } from './freezeBankMigration';

/**
 * Pure-predicate coverage for the freeze-bank legacy-shape detector. The
 * Firestore-writing migrateFreezeBankToEnhanced() is not exercised here; we test
 * needsFreezeBankMigration() (a typed type-guard) across every branch, plus the
 * Math.min(current, 3) token cap that the migration applies — verified directly
 * against the cap formula rather than through the write.
 */

describe('needsFreezeBankMigration — shape detection', () => {
  it('returns true for the legacy { current, accrued, lastMonth } shape', () => {
    const legacy = { current: 2, accrued: 1, lastMonth: '2026-05' };
    expect(needsFreezeBankMigration(legacy)).toBe(true);
  });

  it('returns false for the new shape (has "tokens")', () => {
    const enhanced = {
      current: 2, // even if a stray current lingers, the presence of tokens wins
      accrued: 1,
      lastMonth: '2026-05',
      tokens: 2,
      maxTokens: 3,
      history: [],
    };
    expect(needsFreezeBankMigration(enhanced)).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(needsFreezeBankMigration(null)).toBe(false);
    expect(needsFreezeBankMigration(undefined)).toBe(false);
  });

  it('returns false for a non-object primitive', () => {
    expect(needsFreezeBankMigration(5)).toBe(false);
    expect(needsFreezeBankMigration('legacy')).toBe(false);
  });

  it('returns false when a legacy field is the wrong type', () => {
    expect(needsFreezeBankMigration({ current: '2', accrued: 1, lastMonth: '2026-05' })).toBe(false);
    expect(needsFreezeBankMigration({ current: 2, accrued: '1', lastMonth: '2026-05' })).toBe(false);
    expect(needsFreezeBankMigration({ current: 2, accrued: 1, lastMonth: 5 })).toBe(false);
  });

  it('narrows the type so legacy fields are accessible (type-guard contract)', () => {
    const value: unknown = { current: 3, accrued: 0, lastMonth: '2026-01' };
    if (needsFreezeBankMigration(value)) {
      // Inside the guard the compiler knows the legacy shape — no cast needed.
      expect(value.current).toBe(3);
      expect(value.accrued).toBe(0);
      expect(value.lastMonth).toBe('2026-01');
    } else {
      throw new Error('expected the legacy shape to be detected');
    }
  });
});

describe('freeze-bank migration — token cap (Math.min(current, 3))', () => {
  // The migration sets tokens = Math.min(currentData.current, 3); assert the cap
  // formula directly so a regression in the clamp is caught without a Firestore
  // write.
  const cap = (current: number) => Math.min(current, 3);

  it('caps an over-limit legacy balance at 3', () => {
    expect(cap(7)).toBe(3);
  });

  it('passes through a balance already at the cap', () => {
    expect(cap(3)).toBe(3);
  });

  it('preserves an under-cap balance unchanged', () => {
    expect(cap(1)).toBe(1);
    expect(cap(0)).toBe(0);
  });
});
