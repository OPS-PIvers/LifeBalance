import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({
    __path: `${path}/${id}`,
    withConverter: function () { return this; },
  })),
  setDoc: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { setDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { makeHalfPlanMutations } from './halfPlanMutations';

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
