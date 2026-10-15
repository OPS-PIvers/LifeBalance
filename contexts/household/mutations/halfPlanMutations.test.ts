import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({
    __path: `${path}/${id}`,
    withConverter: function () { return this; },
  })),
  setDoc: vi.fn(),
  increment: (n: number) => ({ __increment: n }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  writeBatch: vi.fn(() => batch),
}));

const batch = {
  set: vi.fn(),
  update: vi.fn(),
  commit: vi.fn(async () => {}),
};

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { makeHalfPlanMutations, makeSetAllocationDone } from './halfPlanMutations';
import type { Account, HalfPlan } from '@/types/schema';

const db = {} as never;

describe('makeHalfPlanMutations.saveHalfPlan', () => {
  beforeEach(() => {
    vi.mocked(setDoc).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('writes the whole plan at its payday id, cent-rounded and stamped with the author', async () => {
    const { saveHalfPlan } = makeHalfPlanMutations({ db, householdId: 'h1', user: { uid: 'paul' } });
    await saveHalfPlan({
      id: '2026-10-01',
      budgets: { gas: 120.004, grocery: 850 },
      allocations: [
        { id: 'a1', kind: 'card-extra', label: '  AmEx extra payment ', amount: 700.005, accountId: 'amex' },
        { id: 'a2', kind: 'from-savings', label: 'From savings', amount: -452.89, done: true },
      ],
    });
    const [ref, data] = vi.mocked(setDoc).mock.calls[0] ?? [];
    expect(ref).toMatchObject({ __path: 'households/h1/halfPlans/2026-10-01' });
    expect(data).toMatchObject({
      id: '2026-10-01',
      budgets: { gas: 120, grocery: 850 },
      allocations: [
        { id: 'a1', kind: 'card-extra', label: 'AmEx extra payment', amount: 700.01, accountId: 'amex' },
        { id: 'a2', kind: 'from-savings', label: 'From savings', amount: 452.89, done: true },
      ],
      updatedBy: 'paul',
    });
  });

  it('does nothing without a household or user', async () => {
    await makeHalfPlanMutations({ db, householdId: null, user: { uid: 'paul' } }).saveHalfPlan({ id: '2026-10-01', budgets: {}, allocations: [] });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('tells the user when the save fails and rethrows', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('offline'));
    const { saveHalfPlan } = makeHalfPlanMutations({ db, householdId: 'h1', user: { uid: 'paul' } });
    await expect(saveHalfPlan({ id: '2026-10-01', budgets: {}, allocations: [] })).rejects.toThrow('offline');
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('makeSetAllocationDone', () => {
  const accounts: Account[] = [
    { id: 'chk', name: 'Checking', type: 'checking', balance: 3000, lastUpdated: '' },
    { id: 'sav', name: 'Savings', type: 'savings', balance: 10000, lastUpdated: '' },
  ];
  const plan: HalfPlan = {
    id: '2026-10-16',
    budgets: {},
    allocations: [{ id: 'b1', kind: 'to-savings', label: 'To savings', amount: 900 }],
  };

  beforeEach(() => {
    batch.set.mockReset();
    batch.update.mockReset();
    batch.commit.mockClear();
    vi.mocked(toast.error).mockReset();
  });

  it('checks the line off and moves the money in one batch', async () => {
    const { setAllocationDone } = makeSetAllocationDone({ db, householdId: 'h1', user: { uid: 'paul' }, accounts, defaultAccountId: undefined });
    await setAllocationDone(plan, 'b1', true);
    expect(batch.set.mock.calls[0]?.[1]).toMatchObject({ allocations: [{ id: 'b1', done: true }] });
    expect(batch.update.mock.calls.map(([ref, data]) => [ref.__path, data.balance])).toEqual([
      ['households/h1/accounts/chk', { __increment: -900 }],
      ['households/h1/accounts/sav', { __increment: 900 }],
    ]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the line is already in that state, and writes nothing without a savings account', async () => {
    const { setAllocationDone } = makeSetAllocationDone({ db, householdId: 'h1', user: { uid: 'paul' }, accounts: accounts.slice(0, 1), defaultAccountId: undefined });
    await setAllocationDone(plan, 'b1', false);
    await setAllocationDone(plan, 'b1', true);
    expect(batch.commit).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Add a savings account first');
  });
});
