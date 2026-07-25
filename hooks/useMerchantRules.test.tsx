import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderHook } from '@testing-library/react';

import * as HouseholdContext from '@/contexts/FirebaseHouseholdContext';
import type { Household, MerchantRule } from '@/types/schema';

import { useMerchantRules } from './useMerchantRules';

/**
 * Covers the accessor's two contracts. The matching itself lives in
 * `utils/merchantRules.ts` and is tested there — what only this hook can be held
 * to is (a) fail-open behaviour when a household has no rules, and (b) the
 * CONTENT-stable memo identity that keeps consumers' memos alive across the
 * household-doc rewrites that ordinary traffic (points updates) causes.
 */

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: vi.fn(),
}));

const RULE: MerchantRule = {
  id: 'r1',
  pattern: 'APPLE.COM',
  name: 'iCloud storage',
  createdAt: '2026-07-01T00:00:00.000Z',
};

/** Set the household doc, mimicking the listener's fresh-object-per-snapshot behaviour. */
function setRules(rules: MerchantRule[] | undefined) {
  (HouseholdContext.useHouseholdCore as Mock).mockReturnValue({
    // A NEW settings object each call, exactly as coreListeners.ts produces.
    householdSettings: { id: 'h1', ...(rules ? { merchantRules: rules } : {}) } as Household,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setRules(undefined);
});

describe('useMerchantRules — fail-open', () => {
  it('returns the raw merchant when the household has no rules at all', () => {
    setRules(undefined);
    const { result } = renderHook(() => useMerchantRules());

    expect(result.current.rules).toEqual([]);
    expect(result.current.displayNameFor({ merchant: 'APPLE.COM/BILL 866-712-7753 CA' }))
      .toBe('APPLE.COM/BILL 866-712-7753 CA');
    expect(result.current.ruleFor({ merchant: 'APPLE.COM/BILL' })).toBeNull();
  });

  it('returns the raw merchant when the rules array is present but empty', () => {
    setRules([]);
    const { result } = renderHook(() => useMerchantRules());

    expect(result.current.displayNameFor({ merchant: 'APPLE.COM/BILL' })).toBe('APPLE.COM/BILL');
  });
});

describe('useMerchantRules — resolution', () => {
  it('renames a matching descriptor and exposes the winning rule', () => {
    setRules([RULE]);
    const { result } = renderHook(() => useMerchantRules());

    expect(result.current.displayNameFor({ merchant: 'APPLE.COM/BILL 866-712-7753 CA' }))
      .toBe('iCloud storage');
    expect(result.current.ruleFor({ merchant: 'APPLE.COM/BILL' })?.id).toBe('r1');
  });

  it('leaves a non-matching descriptor alone', () => {
    setRules([RULE]);
    const { result } = renderHook(() => useMerchantRules());

    expect(result.current.displayNameFor({ merchant: 'SAFEWAY 1234' })).toBe('SAFEWAY 1234');
    expect(result.current.ruleFor({ merchant: 'SAFEWAY 1234' })).toBeNull();
  });

  it('offers both the raw descriptor and the friendly name as search terms', () => {
    setRules([RULE]);
    const { result } = renderHook(() => useMerchantRules());

    expect(result.current.searchTermsFor({ merchant: 'APPLE.COM/BILL 866-712-7753 CA' }))
      .toEqual(['APPLE.COM/BILL 866-712-7753 CA', 'iCloud storage']);
  });
});

describe('useMerchantRules — memo identity is content-stable', () => {
  it('keeps the SAME displayNameFor across a re-render whose rules are an equal but new array', () => {
    setRules([RULE]);
    const { result, rerender } = renderHook(() => useMerchantRules());
    const first = result.current.displayNameFor;

    // A household-doc write unrelated to rules (e.g. a points update): the
    // listener hands us a fresh settings object holding a fresh, EQUAL array.
    setRules([{ ...RULE }]);
    rerender();

    expect(result.current.displayNameFor).toBe(first);
  });

  it('produces a NEW displayNameFor when a rule actually changes', () => {
    setRules([RULE]);
    const { result, rerender } = renderHook(() => useMerchantRules());
    const first = result.current.displayNameFor;

    setRules([{ ...RULE, name: 'Apple' }]);
    rerender();

    expect(result.current.displayNameFor).not.toBe(first);
    expect(result.current.displayNameFor({ merchant: 'APPLE.COM/BILL' })).toBe('Apple');
  });

  it('produces a NEW displayNameFor when a rule is added', () => {
    setRules([RULE]);
    const { result, rerender } = renderHook(() => useMerchantRules());
    const first = result.current.displayNameFor;

    setRules([RULE, { id: 'r2', pattern: 'AMERICAN EXPRESS', name: 'AmEx payment', createdAt: '2026-07-02T00:00:00.000Z' }]);
    rerender();

    expect(result.current.displayNameFor).not.toBe(first);
  });
});
