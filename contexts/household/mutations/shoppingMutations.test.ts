/**
 * Unit tests for approveShoppingItem (Layer 3a of the capture-review
 * feature — see utils/captureReview.ts). `firebase/firestore` is mocked
 * locally so these are pure logic tests: `updateDoc` calls are captured with
 * their target path and patch payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CapturedUpdate {
  ref: { __path: string };
  data: Record<string, unknown>;
}

let capturedUpdates: CapturedUpdate[] = [];

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: `${path}/${id}` })),
  collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  arrayUnion: vi.fn((v: unknown) => ({ __arrayUnion: v })),
  increment: vi.fn((n: number) => ({ __increment: n })),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => '__serverTimestamp'),
  updateDoc: vi.fn(async (ref: { __path: string }, data: Record<string, unknown>) => {
    capturedUpdates.push({ ref, data });
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

import { addDoc } from 'firebase/firestore';
import { makeShoppingListMutations } from './shoppingMutations';
import toast from 'react-hot-toast';

const db = {} as never;

beforeEach(() => {
  capturedUpdates = [];
  vi.mocked(addDoc).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('approveShoppingItem', () => {
  it('clears needsReview with a single updateDoc when no overrides are given', async () => {
    const { approveShoppingItem } = makeShoppingListMutations({ db, householdId: 'h1' });
    await approveShoppingItem('item-1');

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe('households/h1/shoppingList/item-1');
    expect(capturedUpdates[0]?.data).toEqual({ needsReview: false });
    expect(toast.success).toHaveBeenCalledWith('Added to shopping list');
  });

  it('persists edited overrides alongside clearing needsReview, in the same write', async () => {
    const { approveShoppingItem } = makeShoppingListMutations({ db, householdId: 'h1' });
    await approveShoppingItem('item-2', { name: 'Whole milk', quantity: '2', category: 'Dairy', store: 'Costco' });

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.data).toEqual({
      name: 'Whole milk',
      quantity: '2',
      category: 'Dairy',
      store: 'Costco',
      needsReview: false,
    });
  });

  it('sanitizes an emptied field to null (clearing) rather than dropping it', async () => {
    const { approveShoppingItem } = makeShoppingListMutations({ db, householdId: 'h1' });
    await approveShoppingItem('item-3', { store: '' });

    expect(capturedUpdates[0]?.data).toEqual({ store: null, needsReview: false });
  });

  it('is a no-op without a household id', async () => {
    const { approveShoppingItem } = makeShoppingListMutations({ db, householdId: null });
    await approveShoppingItem('item-4', { name: 'Eggs' });
    expect(capturedUpdates).toHaveLength(0);
  });
});

describe('setShoppingItemSavedForLater', () => {
  it('parks an item with a single-field write', async () => {
    const { setShoppingItemSavedForLater } = makeShoppingListMutations({ db, householdId: 'h1' });
    await setShoppingItemSavedForLater('item-1', true);

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe('households/h1/shoppingList/item-1');
    // Exactly one key: parking must not disturb name/category/store/quantity/
    // order — surviving them intact is the whole reason this is one flag rather
    // than a second collection.
    expect(capturedUpdates[0]?.data).toEqual({ savedForLater: true });
  });

  it('promotes a parked item back to the active list (the same single write)', async () => {
    const { setShoppingItemSavedForLater } = makeShoppingListMutations({ db, householdId: 'h1' });
    await setShoppingItemSavedForLater('item-2', false);

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.data).toEqual({ savedForLater: false });
  });

  it('does not toast — the caller owns both messages (the row offers undo)', async () => {
    const { setShoppingItemSavedForLater } = makeShoppingListMutations({ db, householdId: 'h1' });
    await setShoppingItemSavedForLater('item-3', true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('is a no-op without a household id', async () => {
    const { setShoppingItemSavedForLater } = makeShoppingListMutations({ db, householdId: null });
    await setShoppingItemSavedForLater('item-4', true);
    expect(capturedUpdates).toHaveLength(0);
  });
});

describe('addShoppingItem — parked creation', () => {
  it('carries savedForLater straight through to the created doc', async () => {
    // The parked section's own add bar creates through this path; no dedicated
    // add function exists because a shopping item has no required date to
    // fabricate (unlike a to-do — see addSavedForLaterTodo).
    const { addShoppingItem } = makeShoppingListMutations({ db, householdId: 'h1' });
    await addShoppingItem({
      name: 'Cast iron skillet',
      category: 'Household',
      isPurchased: false,
      savedForLater: true,
    });

    expect(addDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = vi.mocked(addDoc).mock.calls[0] as unknown as [
      { __path: string },
      Record<string, unknown>,
    ];
    expect(ref.__path).toBe('households/h1/shoppingList');
    expect(data).toMatchObject({ name: 'Cast iron skillet', savedForLater: true });
  });

  it('omits the flag entirely for an ordinary item (no migration, absent is the norm)', async () => {
    const { addShoppingItem } = makeShoppingListMutations({ db, householdId: 'h1' });
    await addShoppingItem({ name: 'Milk', category: 'Dairy', isPurchased: false });

    const [, data] = vi.mocked(addDoc).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect('savedForLater' in data).toBe(false);
  });
});
