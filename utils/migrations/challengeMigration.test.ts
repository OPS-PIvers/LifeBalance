import { describe, it, expect } from 'vitest';
import {
  needsChallengeMigration,
  getEffectiveTargetValue,
  getEffectiveTargetType,
} from './challengeMigration';
import { Challenge } from '@/types/schema';

/**
 * Pure-predicate coverage for the challenge schema migration helpers. The
 * Firestore-writing migrateChallengesToEnhancedSchema() is intentionally NOT
 * exercised here — only the branch logic of the three pure functions that decide
 * whether/how a legacy challenge maps onto the enhanced schema.
 */

// Build a Challenge with only the fields a given test cares about. The cast is
// scoped to the factory so individual tests stay readable.
const challenge = (overrides: Partial<Challenge>): Challenge =>
  ({ id: 'c1', title: 'C', relatedHabitIds: [], status: 'active', ...overrides } as Challenge);

describe('needsChallengeMigration', () => {
  it('needs migration when both targetType and targetValue are missing (legacy doc)', () => {
    expect(needsChallengeMigration(challenge({}))).toBe(true);
  });

  it('needs migration when targetType is present but targetValue is missing', () => {
    expect(needsChallengeMigration(challenge({ targetType: 'count' }))).toBe(true);
  });

  it('needs migration when targetValue is present but targetType is missing', () => {
    expect(needsChallengeMigration(challenge({ targetValue: 50 }))).toBe(true);
  });

  it('needs migration when targetValue is 0 (falsy) even with a targetType', () => {
    // !0 === true, so a stored 0 trips the migration guard.
    expect(needsChallengeMigration(challenge({ targetType: 'count', targetValue: 0 }))).toBe(true);
  });

  it('does NOT need migration once both fields are set to truthy values', () => {
    expect(
      needsChallengeMigration(challenge({ targetType: 'percentage', targetValue: 80 })),
    ).toBe(false);
  });
});

describe('getEffectiveTargetValue', () => {
  it('prefers targetValue when present', () => {
    expect(getEffectiveTargetValue(challenge({ targetValue: 60, targetTotalCount: 999 }))).toBe(60);
  });

  it('falls back to the legacy targetTotalCount when targetValue is absent', () => {
    expect(getEffectiveTargetValue(challenge({ targetTotalCount: 42 }))).toBe(42);
  });

  it('defaults to 100 when neither field is set', () => {
    expect(getEffectiveTargetValue(challenge({}))).toBe(100);
  });

  it('uses ?? semantics: targetValue of 0 is honored, not skipped', () => {
    // Nullish-coalescing keeps a real 0 (unlike the falsy `||` used elsewhere).
    expect(getEffectiveTargetValue(challenge({ targetValue: 0, targetTotalCount: 200 }))).toBe(0);
  });
});

describe('getEffectiveTargetType', () => {
  it('returns the stored type when set', () => {
    expect(getEffectiveTargetType(challenge({ targetType: 'percentage' }))).toBe('percentage');
  });

  it('defaults to "count" when the type is missing', () => {
    expect(getEffectiveTargetType(challenge({}))).toBe('count');
  });
});
