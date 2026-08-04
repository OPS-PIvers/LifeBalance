/**
 * Unit tests for `toggleShoppingItemPurchased`, in particular its
 * `savedForLater` guard: a parked item is explicitly NOT committed work (see
 * `ShoppingItem.savedForLater`) and must never be marked purchased — doing so
 * would let it reach `{savedForLater: true, isPurchased: true}`, a state
 * `savedForLaterShopping` (contexts/FirebaseHouseholdContext.tsx) deliberately
 * never filters out, so the item would become an orphaned zombie invisible to
 * every exposed slice. `firebase/firestore` is mocked locally so these are
 * pure logic tests: the writeBatch mock records its `update`/`set` calls and
 * `updateDoc` calls are captured directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShoppingItem, GroceryCatalogItem } from '@/types/schema';

interface Ref { __path: string }
interface BatchOp {
  op: 'update' | 'set';
  ref: Ref;
  data: Record<string, unknown>;
}

let batchOps: BatchOp[] = [];
const commitMock = vi.fn(async () => {});
let capturedUpdateDocCalls: Array<{ ref: Ref; data: Record<string, unknown> }> = [];

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: `${path}/${id}` })),
  collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  increment: vi.fn((n: number) => ({ __increment: n })),
  writeBatch: vi.fn(() => ({
    update: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'update', ref, data }); },
    set: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'set', ref, data }); },
    commit: () => commitMock(),
  })),
  updateDoc: vi.fn(async (ref: Ref, data: Record<string, unknown>) => {
    capturedUpdateDocCalls.push({ ref, data });
  }),
  serverTimestamp: vi.fn(() => '__serverTimestamp'),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

import { makeToggleShoppingItemPurchased } from './shoppingMutations';
import toast from 'react-hot-toast';

const db = {} as never;
const householdId = 'h1';

const baseItem = (overrides: Partial<ShoppingItem>): ShoppingItem => ({
  id: 'item-1',
  name: 'Milk',
  category: 'Dairy',
  isPurchased: false,
  ...overrides,
});

beforeEach(() => {
  batchOps = [];
  capturedUpdateDocCalls = [];
  commitMock.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('toggleShoppingItemPurchased', () => {
  it('refuses to purchase a saved-for-later item — no write happens', async () => {
    const item = baseItem({ id: 'parked-1', savedForLater: true });
    const { toggleShoppingItemPurchased } = makeToggleShoppingItemPurchased({
      db,
      householdId,
      shoppingList: [item],
      groceryCatalog: [],
    });

    await toggleShoppingItemPurchased('parked-1');

    // Guard against the fix being a no-op that "succeeds silently but writes
    // nothing" — assert BOTH that no purchase batch committed AND that the
    // caller is told the action was refused.
    expect(commitMock).not.toHaveBeenCalled();
    expect(batchOps).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('Cannot mark a saved-for-later item as purchased');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('positive control: purchases a normal (non-parked) item via the batch', async () => {
    const item = baseItem({ id: 'normal-1', savedForLater: false });
    const catalog: GroceryCatalogItem[] = [];
    const { toggleShoppingItemPurchased } = makeToggleShoppingItemPurchased({
      db,
      householdId,
      shoppingList: [item],
      groceryCatalog: catalog,
    });

    await toggleShoppingItemPurchased('normal-1');

    // This is the control proving the guard above isn't vacuous: with the
    // flag false (or absent), the exact same call DOES write.
    expect(commitMock).toHaveBeenCalledTimes(1);
    const purchaseUpdate = batchOps.find(
      (op) => op.op === 'update' && op.ref.__path === 'households/h1/shoppingList/normal-1'
    );
    expect(purchaseUpdate?.data).toEqual({ isPurchased: true });
    expect(toast.success).toHaveBeenCalledWith('Marked as purchased');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an absent savedForLater flag behaves like false (also purchasable)', async () => {
    const item = baseItem({ id: 'legacy-1' }); // no savedForLater key at all
    const { toggleShoppingItemPurchased } = makeToggleShoppingItemPurchased({
      db,
      householdId,
      shoppingList: [item],
      groceryCatalog: [],
    });

    await toggleShoppingItemPurchased('legacy-1');

    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('still allows un-purchasing (undo) — the guard only blocks the forward/purchase direction', async () => {
    // A parked+purchased item should never arise post-fix, but if one already
    // existed from before the fix shipped, the undo path (isPurchased already
    // true) must NOT be newly blocked by this guard — it is the recovery
    // route back to a normal state, mirroring how `uncompleteToDo` stays
    // untouched while only `completeToDo` gets the equivalent guard.
    const item = baseItem({ id: 'edge-1', isPurchased: true, savedForLater: true });
    const { toggleShoppingItemPurchased } = makeToggleShoppingItemPurchased({
      db,
      householdId,
      shoppingList: [item],
      groceryCatalog: [],
    });

    await toggleShoppingItemPurchased('edge-1');

    expect(toast.error).not.toHaveBeenCalled();
    expect(capturedUpdateDocCalls).toEqual([
      { ref: { __path: 'households/h1/shoppingList/edge-1' }, data: { isPurchased: false } },
    ]);
  });
});
