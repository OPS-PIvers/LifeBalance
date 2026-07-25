import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import * as HouseholdContext from '@/contexts/FirebaseHouseholdContext';
import type { Household, MerchantRule } from '@/types/schema';

import { useMerchantRules } from './useMerchantRules';

/**
 * Covers the accessor's contracts. The matching itself lives in
 * `utils/merchantRules.ts` and the writes in
 * `contexts/household/mutations/merchantRuleMutations.ts`, both tested there —
 * what only this hook can be held to is (a) fail-open behaviour when a household
 * has no rules, (b) the CONTENT-stable memo identity that keeps consumers' memos
 * alive across the household-doc rewrites that ordinary traffic (points updates)
 * causes, and (c) that the new `saving` state cannot invalidate (b).
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

const addMerchantRule = vi.fn(async () => {});
const updateMerchantRule = vi.fn(async () => {});
const deleteMerchantRule = vi.fn(async () => {});

/** Set the household doc, mimicking the listener's fresh-object-per-snapshot behaviour. */
function setRules(rules: MerchantRule[] | undefined) {
  (HouseholdContext.useHouseholdCore as Mock).mockReturnValue({
    // A NEW settings object each call, exactly as coreListeners.ts produces.
    householdSettings: { id: 'h1', ...(rules ? { merchantRules: rules } : {}) } as Household,
    addMerchantRule,
    updateMerchantRule,
    deleteMerchantRule,
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

describe('useMerchantRules — authoring', () => {
  it('forwards each draft to the matching household mutation', async () => {
    setRules([RULE]);
    const { result } = renderHook(() => useMerchantRules());

    await act(async () => {
      await result.current.addRule({ pattern: 'SAFEWAY', name: 'Groceries' });
      await result.current.updateRule('r1', { pattern: 'APPLE.COM', name: 'Apple' });
      await result.current.deleteRule('r1');
    });

    expect(addMerchantRule).toHaveBeenCalledWith({ pattern: 'SAFEWAY', name: 'Groceries' });
    expect(updateMerchantRule).toHaveBeenCalledWith('r1', { pattern: 'APPLE.COM', name: 'Apple' });
    expect(deleteMerchantRule).toHaveBeenCalledWith('r1');
  });

  it('flags `saving` while a write is in flight and clears it after', async () => {
    setRules([RULE]);
    let release: (() => void) | undefined;
    addMerchantRule.mockImplementationOnce(
      () => new Promise<void>(resolve => { release = resolve; }),
    );

    const { result } = renderHook(() => useMerchantRules());
    expect(result.current.saving).toBe(false);

    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.addRule({ pattern: 'SAFEWAY' }); });
    await waitFor(() => expect(result.current.saving).toBe(true));

    await act(async () => { release?.(); await pending; });
    expect(result.current.saving).toBe(false);
  });

  it('clears `saving` and rethrows when the mutation rejects, so a form can stay open', async () => {
    setRules([RULE]);
    addMerchantRule.mockRejectedValueOnce(new Error('rule-cap-reached'));

    const { result } = renderHook(() => useMerchantRules());
    await act(async () => {
      await expect(result.current.addRule({ pattern: 'SAFEWAY' })).rejects.toThrow('rule-cap-reached');
    });

    expect(result.current.saving).toBe(false);
  });

  it('keeps displayNameFor stable across a save — the read helpers are memoized apart from `saving`', async () => {
    // The regression this guards: folding the whole API into one memo would
    // re-create displayNameFor whenever `saving` flipped, and
    // useDashboardTransactionStats memoizes its O(n) pass on that identity.
    setRules([RULE]);
    const { result } = renderHook(() => useMerchantRules());
    const first = result.current.displayNameFor;
    const firstRules = result.current.rules;

    await act(async () => { await result.current.addRule({ pattern: 'SAFEWAY' }); });

    expect(result.current.saving).toBe(false);
    expect(result.current.displayNameFor).toBe(first);
    expect(result.current.rules).toBe(firstRules);
  });

  it('keeps the write callbacks stable across an unrelated household-doc rewrite', () => {
    setRules([RULE]);
    const { result, rerender } = renderHook(() => useMerchantRules());
    const firstAdd = result.current.addRule;

    setRules([{ ...RULE }]);
    rerender();

    expect(result.current.addRule).toBe(firstAdd);
  });
});
