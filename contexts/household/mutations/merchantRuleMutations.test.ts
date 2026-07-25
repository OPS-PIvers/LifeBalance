/**
 * Unit tests for merchantRuleMutations.ts (F-MONEY-14, write side).
 *
 * The three things only this module can be held to:
 *  - the MAX_MERCHANT_RULES cap is evaluated against the array read INSIDE the
 *    transaction, not a stale caller copy;
 *  - `undefined` NEVER reaches a write payload (Firestore rejects it) and an
 *    edit that empties a field genuinely removes the key rather than leaving the
 *    previous value behind;
 *  - `createdAt` / `matchCount` / `lastMatchedAt` survive an edit.
 *
 * `firebase/firestore` is mocked locally (no real Firestore), with the
 * transaction driven against `currentRules` — the authoritative server-side
 * value at read time — and every `txn.update` payload captured for assertions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';

import { MAX_MERCHANT_RULES, type MerchantRule } from '@/types/schema';

import { buildMerchantRuleFields, makeMerchantRuleMutations } from './merchantRuleMutations';

const updateMock = vi.fn();

/** What the mocked transaction's snapshot reports for `merchantRules`. */
let currentRules: unknown = [];
/** Set false to model a household doc that no longer exists. */
let householdExists = true;

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string) => ({ __path: path });
  return {
    doc: vi.fn((_db: unknown, path: string, id: string) => makeRef(`${path}/${id}`)),
    runTransaction: async (_db: unknown, cb: (txn: unknown) => Promise<void>) => {
      const txn = {
        get: async (ref: { __path: string }) => ({
          exists: () => householdExists,
          data: () => ({ merchantRules: currentRules }),
          __path: ref.__path,
        }),
        update: (ref: { __path: string }, patch: Record<string, unknown>) => updateMock(ref, patch),
      };
      await cb(txn);
    },
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const db = {} as never;
const householdId = 'household-1';
const mutations = () => makeMerchantRuleMutations({ db, householdId });

/** The `merchantRules` array handed to the single `txn.update` call. */
function writtenRules(): MerchantRule[] {
  expect(updateMock).toHaveBeenCalledTimes(1);
  const [, patch] = updateMock.mock.calls[0] as [unknown, Record<string, unknown>];
  return patch.merchantRules as MerchantRule[];
}

/** Every key path in `value` whose value is literally `undefined`. */
function undefinedKeyPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => undefinedKeyPaths(entry, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      entry === undefined ? [`${path}.${key}`] : undefinedKeyPaths(entry, `${path}.${key}`),
    );
  }
  return [];
}

const EXISTING: MerchantRule = {
  id: 'r1',
  pattern: 'APPLE.COM',
  name: 'iCloud storage',
  category: 'Entertainment',
  billId: 'bill-9',
  exempt: true,
  amount: 2.99,
  createdAt: '2026-07-01T00:00:00.000Z',
  lastMatchedAt: '2026-07-20T00:00:00.000Z',
  matchCount: 12,
};

beforeEach(() => {
  updateMock.mockReset();
  currentRules = [];
  householdExists = true;
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
  (toast.success as ReturnType<typeof vi.fn>).mockClear();
});

describe('buildMerchantRuleFields', () => {
  it('omits every absent optional key rather than setting it to undefined', () => {
    const fields = buildMerchantRuleFields({ pattern: 'SAFEWAY' });

    expect(fields).toEqual({ pattern: 'SAFEWAY' });
    expect(Object.keys(fields)).toEqual(['pattern']);
    expect('name' in fields).toBe(false);
    expect('amount' in fields).toBe(false);
    expect(undefinedKeyPaths(fields)).toEqual([]);
  });

  it('drops a whitespace-only optional (an emptied form field is "not set")', () => {
    const fields = buildMerchantRuleFields({
      pattern: '  SAFEWAY  ',
      name: '   ',
      category: '',
      billId: '  ',
    });

    expect(fields).toEqual({ pattern: 'SAFEWAY' });
  });

  it('keeps provided values, trimmed, and rounds the amount to cents', () => {
    const fields = buildMerchantRuleFields({
      pattern: 'APPLE.COM',
      name: '  Apple  ',
      category: 'Entertainment',
      billId: 'bill-9',
      amount: 2.994,
      exempt: true,
    });

    expect(fields).toEqual({
      pattern: 'APPLE.COM',
      name: 'Apple',
      category: 'Entertainment',
      billId: 'bill-9',
      amount: 2.99,
      exempt: true,
    });
  });

  it('keeps an amount of 0 (the Apple Pay pre-auth stub is a real qualifier)', () => {
    expect(buildMerchantRuleFields({ pattern: 'X', amount: 0 }).amount).toBe(0);
  });

  it('drops a non-finite amount instead of writing NaN', () => {
    expect('amount' in buildMerchantRuleFields({ pattern: 'X', amount: Number.NaN })).toBe(false);
  });

  it('omits exempt when false — absent and false mean the same thing downstream', () => {
    expect('exempt' in buildMerchantRuleFields({ pattern: 'X', exempt: false })).toBe(false);
  });
});

describe('addMerchantRule', () => {
  it('appends a rule with a generated id and createdAt', async () => {
    currentRules = [EXISTING];
    await mutations().addMerchantRule({ pattern: 'SAFEWAY', name: 'Groceries' });

    const rules = writtenRules();
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual(EXISTING);
    expect(rules[1]?.pattern).toBe('SAFEWAY');
    expect(rules[1]?.name).toBe('Groceries');
    expect(typeof rules[1]?.id).toBe('string');
    expect(rules[1]?.id).not.toBe('');
    expect(Date.parse(rules[1]?.createdAt ?? '')).not.toBeNaN();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('never puts an undefined value in the write payload', async () => {
    currentRules = [];
    await mutations().addMerchantRule({ pattern: 'SAFEWAY' });

    expect(undefinedKeyPaths(writtenRules())).toEqual([]);
  });

  it('appends onto the array read INSIDE the transaction, not a stale caller copy', async () => {
    // Model a concurrent add: the partner's rule is already on the server.
    currentRules = [EXISTING, { ...EXISTING, id: 'r2', pattern: 'PARTNER RULE' }];
    await mutations().addMerchantRule({ pattern: 'SAFEWAY' });

    const rules = writtenRules();
    expect(rules).toHaveLength(3);
    expect(rules.map(r => r.id).slice(0, 2)).toEqual(['r1', 'r2']);
  });

  it('rejects (toast, no write) once the cap is reached', async () => {
    currentRules = Array.from({ length: MAX_MERCHANT_RULES }, (_, i) => ({
      ...EXISTING,
      id: `r${i}`,
    }));

    await expect(mutations().addMerchantRule({ pattern: 'SAFEWAY' })).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      String(MAX_MERCHANT_RULES),
    );
  });

  it('still allows the very last slot below the cap', async () => {
    currentRules = Array.from({ length: MAX_MERCHANT_RULES - 1 }, (_, i) => ({
      ...EXISTING,
      id: `r${i}`,
    }));

    await mutations().addMerchantRule({ pattern: 'SAFEWAY' });
    expect(writtenRules()).toHaveLength(MAX_MERCHANT_RULES);
  });

  it('rejects a blank pattern before opening a transaction', async () => {
    await expect(mutations().addMerchantRule({ pattern: '   ' })).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('treats a corrupted/legacy non-array merchantRules value as empty', async () => {
    currentRules = 'not-an-array';
    await mutations().addMerchantRule({ pattern: 'SAFEWAY' });

    expect(writtenRules()).toHaveLength(1);
  });

  it('does nothing at all without a household', async () => {
    const { addMerchantRule } = makeMerchantRuleMutations({ db, householdId: null });
    await expect(addMerchantRule({ pattern: 'SAFEWAY' })).resolves.toBeUndefined();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('updateMerchantRule', () => {
  it('preserves createdAt, matchCount and lastMatchedAt across an edit', async () => {
    currentRules = [EXISTING];
    await mutations().updateMerchantRule('r1', { pattern: 'APPLE.COM', name: 'Apple' });

    const [edited] = writtenRules();
    expect(edited?.createdAt).toBe(EXISTING.createdAt);
    expect(edited?.matchCount).toBe(12);
    expect(edited?.lastMatchedAt).toBe('2026-07-20T00:00:00.000Z');
    expect(edited?.id).toBe('r1');
    expect(edited?.name).toBe('Apple');
  });

  it('CLEARS an optional field by removing the key, not by keeping the old value', async () => {
    currentRules = [EXISTING];
    // The user emptied name/category/billId/amount and unticked exempt.
    await mutations().updateMerchantRule('r1', { pattern: 'APPLE.COM', name: '' });

    const [edited] = writtenRules();
    expect(edited).toEqual({
      id: 'r1',
      pattern: 'APPLE.COM',
      createdAt: EXISTING.createdAt,
      lastMatchedAt: EXISTING.lastMatchedAt,
      matchCount: 12,
    });
    for (const key of ['name', 'category', 'billId', 'amount', 'exempt']) {
      expect(key in (edited as object)).toBe(false);
    }
    expect(undefinedKeyPaths(writtenRules())).toEqual([]);
  });

  it('leaves sibling rules byte-identical', async () => {
    const sibling: MerchantRule = {
      id: 'r2',
      pattern: 'AMERICAN EXPRESS',
      name: 'AmEx payment',
      createdAt: '2026-07-02T00:00:00.000Z',
    };
    currentRules = [EXISTING, sibling];
    await mutations().updateMerchantRule('r1', { pattern: 'APPLE', name: 'Apple' });

    const rules = writtenRules();
    expect(rules).toHaveLength(2);
    expect(rules[1]).toEqual(sibling);
  });

  it('omits bookkeeping keys entirely when the stored rule never had them', async () => {
    currentRules = [{ id: 'r3', pattern: 'X', createdAt: '2026-07-03T00:00:00.000Z' }];
    await mutations().updateMerchantRule('r3', { pattern: 'Y' });

    const [edited] = writtenRules();
    expect('matchCount' in (edited as object)).toBe(false);
    expect('lastMatchedAt' in (edited as object)).toBe(false);
    expect(undefinedKeyPaths(writtenRules())).toEqual([]);
  });

  it('rejects (toast, no write) when the rule was deleted by the other member', async () => {
    currentRules = [EXISTING];
    await expect(
      mutations().updateMerchantRule('gone', { pattern: 'APPLE.COM' }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank pattern', async () => {
    currentRules = [EXISTING];
    await expect(mutations().updateMerchantRule('r1', { pattern: '' })).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('deleteMerchantRule', () => {
  it('writes the array without the deleted rule, leaving the rest untouched', async () => {
    const sibling: MerchantRule = {
      id: 'r2',
      pattern: 'AMERICAN EXPRESS',
      createdAt: '2026-07-02T00:00:00.000Z',
    };
    currentRules = [EXISTING, sibling];
    await mutations().deleteMerchantRule('r1');

    expect(writtenRules()).toEqual([sibling]);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('succeeds WITHOUT a write when the rule is already gone', async () => {
    currentRules = [EXISTING];
    await expect(mutations().deleteMerchantRule('gone')).resolves.toBeUndefined();

    expect(updateMock).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});

describe('failure handling', () => {
  it('toasts and rethrows when the household doc is missing', async () => {
    householdExists = false;
    await expect(mutations().deleteMerchantRule('r1')).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('toasts and rethrows a genuine write failure so the editor can stay open', async () => {
    currentRules = [EXISTING];
    updateMock.mockImplementationOnce(() => {
      throw new Error('permission-denied');
    });
    await expect(mutations().addMerchantRule({ pattern: 'SAFEWAY' })).rejects.toThrow(
      'permission-denied',
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('always targets the household doc (rules live on it, not a subcollection)', async () => {
    currentRules = [EXISTING];
    await mutations().deleteMerchantRule('r1');
    const [ref] = updateMock.mock.calls[0] as [{ __path: string }];
    expect(ref.__path).toBe('households/household-1');
  });
});
