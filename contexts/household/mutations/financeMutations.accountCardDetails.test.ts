/**
 * Unit tests for makeAccountMutations().setAccountCardDetails (CARD-1) — the
 * card-owner map is written verbatim EXCEPT that it's pruned to only the
 * cards surviving into the final cardLast4s list, so a card removed in the
 * same save (or dropped for failing digit-cleaning) never leaves an orphaned
 * owner entry behind. `firebase/firestore` is mocked locally (no real
 * Firestore calls) so this is a pure logic test, mirroring the pattern in
 * savingsGoalMutations.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { makeAccountMutations } from './financeMutations';

const updateDocMock = vi.fn();

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string) => ({ __path: path });
  return {
    doc: vi.fn((_db: unknown, path: string, id: string) => makeRef(`${path}/${id}`)),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    updateDoc: (...args: unknown[]) => updateDocMock(...args),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
    deleteField: vi.fn(() => '__deleteField'),
    writeBatch: vi.fn(),
    increment: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const db = {} as never;
const householdId = 'household-1';

describe('makeAccountMutations.setAccountCardDetails — card-owner pruning', () => {
  beforeEach(() => {
    updateDocMock.mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it('writes the owner map verbatim (normalized) when every owned card survives', async () => {
    const { setAccountCardDetails } = makeAccountMutations({ db, householdId, user: null });
    await setAccountCardDetails('acc1', {
      cardLast4s: ['1111', '2222'],
      cardOwners: { '1111': 'uid-paul', '2222': 'uid-jen' },
    });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.cardOwners).toEqual({ '1111': 'uid-paul', '2222': 'uid-jen' });
  });

  it('drops an owner tag for a card that was removed in this same save', async () => {
    const { setAccountCardDetails } = makeAccountMutations({ db, householdId, user: null });
    await setAccountCardDetails('acc1', {
      // Only 1111 survives; 2222 (still keyed in cardOwners) was removed.
      cardLast4s: ['1111'],
      cardOwners: { '1111': 'uid-paul', '2222': 'uid-jen' },
    });
    const [, patch] = updateDocMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.cardOwners).toEqual({ '1111': 'uid-paul' });
  });

  it('clears cardOwners (deleteField) when no card ends up with an owner', async () => {
    const { setAccountCardDetails } = makeAccountMutations({ db, householdId, user: null });
    await setAccountCardDetails('acc1', {
      cardLast4s: ['1111'],
      cardOwners: {},
    });
    const [, patch] = updateDocMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.cardOwners).toBe('__deleteField');
  });

  it('clears cardOwners when the details omit it entirely (legacy call sites)', async () => {
    const { setAccountCardDetails } = makeAccountMutations({ db, householdId, user: null });
    await setAccountCardDetails('acc1', { cardLast4s: ['1111'] });
    const [, patch] = updateDocMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.cardOwners).toBe('__deleteField');
  });

  it('normalizes a messy owner-map key the same way cardLast4s digits are cleaned', async () => {
    const { setAccountCardDetails } = makeAccountMutations({ db, householdId, user: null });
    await setAccountCardDetails('acc1', {
      cardLast4s: ['...8899'],
      cardOwners: { '...8899': 'uid-paul' },
    });
    const [, patch] = updateDocMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.cardLast4s).toEqual(['8899']);
    expect(patch.cardOwners).toEqual({ '8899': 'uid-paul' });
  });
});
