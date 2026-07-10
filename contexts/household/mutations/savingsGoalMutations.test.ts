/**
 * Unit tests for savingsGoalMutations.ts (Plan 24).
 *
 * Covers: cents-safe contribution math, the completedAt transition (set once
 * savedAmount reaches targetAmount, never re-cleared by a later contribution),
 * and rejection of non-positive contribution amounts. `firebase/firestore` is
 * mocked locally (no real Firestore calls) so this is a pure logic test.
 *
 * `contributeToGoal` runs inside a `runTransaction`, so the mock drives the
 * transaction callback with a snapshot whose `data()` is the CURRENT goal
 * (the authoritative value the real transaction reads), and records the
 * `txn.update` patch for assertions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { SavingsGoal } from '@/types/schema';
import { makeSavingsGoalMutations } from './savingsGoalMutations';

const updateMock = vi.fn();
const addDocMock = vi.fn();
const deleteDocMock = vi.fn();

// The goal the mocked transaction snapshot returns for `.data()`. Each test
// sets this to model the authoritative server-side value at read time.
let currentGoal: SavingsGoal | null = baseGoalInit();
function baseGoalInit(): SavingsGoal {
  return {
    id: 'goal-1',
    name: 'Christmas',
    targetAmount: 100,
    savedAmount: 90,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string) => ({ __path: path });
  return {
    doc: vi.fn((_db: unknown, path: string, id: string) => makeRef(`${path}/${id}`)),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    updateDoc: vi.fn(),
    addDoc: (...args: unknown[]) => addDocMock(...args),
    deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
    deleteField: vi.fn(() => '__deleteField'),
    runTransaction: async (_db: unknown, cb: (txn: unknown) => Promise<void>) => {
      const txn = {
        get: async (ref: { __path: string }) => ({
          exists: () => currentGoal !== null,
          data: () => currentGoal,
          __path: ref.__path,
        }),
        update: (ref: { __path: string }, patch: Record<string, unknown>) =>
          updateMock(ref, patch),
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

describe('makeSavingsGoalMutations.contributeToGoal', () => {
  beforeEach(() => {
    updateMock.mockClear();
    currentGoal = baseGoalInit();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it('adds the contribution to savedAmount in cents-safe math', async () => {
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 0.1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [ref, patch] = updateMock.mock.calls[0] as [{ __path: string }, Record<string, unknown>];
    expect(ref.__path).toBe('households/household-1/savingsGoals/goal-1');
    // 90 + 0.10 must be exactly 90.1, not a float-drift value like 90.09999999999999.
    expect(patch.savedAmount).toBe(90.1);
  });

  it('sets completedAt the moment savedAmount first reaches targetAmount', async () => {
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 10);
    const [, patch] = updateMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.savedAmount).toBe(100);
    expect(typeof patch.completedAt).toBe('string');
  });

  it('does NOT set completedAt when still below target', async () => {
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 5);
    const [, patch] = updateMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.savedAmount).toBe(95);
    expect(patch.completedAt).toBeUndefined();
  });

  it('does not re-set completedAt on a contribution after the goal is already complete', async () => {
    currentGoal = { ...baseGoalInit(), savedAmount: 100, completedAt: '2026-01-15T00:00:00.000Z' };
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 10);
    const [, patch] = updateMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.savedAmount).toBe(110);
    // completedAt is not in the patch at all (existing value preserved as-is).
    expect('completedAt' in patch).toBe(false);
  });

  it('computes the add from the value read INSIDE the transaction, not a stale caller value', async () => {
    // Model a concurrent write: the authoritative saved amount at read time is
    // 95 (another device already added 5), not the 90 a stale in-memory copy
    // would show. The add must build on 95.
    currentGoal = { ...baseGoalInit(), savedAmount: 95 };
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 3);
    const [, patch] = updateMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.savedAmount).toBe(98);
  });

  it('rejects a zero or negative contribution without writing', async () => {
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 0);
    await contributeToGoal('goal-1', -5);
    expect(updateMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('errors (without writing) when the goal no longer exists', async () => {
    currentGoal = null;
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 5);
    expect(updateMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('never touches the accounts or transactions collections (safeToSpend decoupling)', async () => {
    const { contributeToGoal } = makeSavingsGoalMutations({ db, householdId });
    await contributeToGoal('goal-1', 5);
    const [ref] = updateMock.mock.calls[0] as [{ __path: string }];
    expect(ref.__path).not.toMatch(/accounts|transactions/);
  });
});

describe('makeSavingsGoalMutations.addSavingsGoal / deleteSavingsGoal', () => {
  beforeEach(() => {
    addDocMock.mockClear();
    deleteDocMock.mockClear();
  });

  it('rounds targetAmount/savedAmount to cents on create', async () => {
    const { addSavingsGoal } = makeSavingsGoalMutations({ db, householdId });
    await addSavingsGoal({ name: 'Vacation', targetAmount: 500.005, savedAmount: 0 });
    const [, payload] = addDocMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.targetAmount).toBe(500.01);
    expect(payload.savedAmount).toBe(0);
  });

  it('deletes by id', async () => {
    const { deleteSavingsGoal } = makeSavingsGoalMutations({ db, householdId });
    await deleteSavingsGoal('goal-1');
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
    const [ref] = deleteDocMock.mock.calls[0] as [{ __path: string }];
    expect(ref.__path).toBe('households/household-1/savingsGoals/goal-1');
  });
});
