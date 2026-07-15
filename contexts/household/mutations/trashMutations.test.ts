/**
 * Unit tests for trashMutations.ts (F-XCUT-03 — unified soft-delete/restore).
 *
 * `firebase/firestore` is mocked locally so these are pure logic tests: each
 * ref carries its `__path`, batches record their `set`/`delete` calls, and the
 * listener's `onSnapshot` is driven synchronously with a fake snapshot. Covers
 * the soft-delete batch (mirror + delete), the pre-rules permission-denied
 * hard-delete fallback, the "already gone" short-circuit, restore, purge, and
 * the listener's doc mapping + graceful-degradation error path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { softDeleteDoc, restoreTrashedItem, purgeTrashedItem, attachTrashListener } from './trashMutations';
import type { TrashedItem } from '@/utils/trash';

interface Ref { __path: string }
interface BatchOp { op: 'set' | 'delete'; ref: Ref; data?: Record<string, unknown> }

let batchOps: BatchOp[] = [];
let committedCount = 0;
const commitMock = vi.fn(async () => { committedCount += 1; });
const deleteDocMock = vi.fn(async (_ref: unknown) => {});
const getDocMock = vi.fn<(ref: unknown) => unknown>();
let snapshotHandler: ((snap: unknown) => void) | null = null;
let errorHandler: ((err: unknown) => void) | null = null;
const unsubscribeMock = vi.fn();

vi.mock('firebase/firestore', () => {
  class Timestamp {
    constructor(private readonly d: Date) {}
    toDate() { return this.d; }
    static fromDate(d: Date) { return new Timestamp(d); }
  }
  return {
    doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: `${path}/${id}` })),
    collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
    getDoc: (ref: unknown) => getDocMock(ref),
    deleteDoc: (ref: unknown) => deleteDocMock(ref),
    writeBatch: vi.fn(() => ({
      set: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'set', ref, data }); },
      delete: (ref: Ref) => { batchOps.push({ op: 'delete', ref }); },
      commit: () => commitMock(),
    })),
    onSnapshot: vi.fn((_q: unknown, onNext: (snap: unknown) => void, onError: (err: unknown) => void) => {
      snapshotHandler = onNext;
      errorHandler = onError;
      return unsubscribeMock;
    }),
    query: vi.fn((ref: Ref) => ref),
    orderBy: vi.fn(() => '__orderBy'),
    limit: vi.fn(() => '__limit'),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    Timestamp,
  };
});

// Grab the mocked Timestamp for constructing snapshot data.
import { Timestamp } from 'firebase/firestore';

const db = {} as never;
const householdId = 'household-1';

beforeEach(() => {
  batchOps = [];
  committedCount = 0;
  commitMock.mockClear();
  deleteDocMock.mockClear();
  getDocMock.mockReset();
  snapshotHandler = null;
  errorHandler = null;
  unsubscribeMock.mockClear();
});

describe('softDeleteDoc', () => {
  it('mirrors the source doc into trash and deletes the original in one batch', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ text: 'Buy milk', done: false }) });
    await softDeleteDoc({ db, householdId, deletedBy: 'user-9' }, 'todo', 'todo-1');

    expect(committedCount).toBe(1);
    expect(deleteDocMock).not.toHaveBeenCalled();
    const setOp = batchOps.find((o) => o.op === 'set');
    const delOp = batchOps.find((o) => o.op === 'delete');
    expect(setOp?.ref.__path).toBe('households/household-1/trash/todo_todo-1');
    expect(setOp?.data?.domain).toBe('todo');
    expect(setOp?.data?.originalId).toBe('todo-1');
    expect(setOp?.data?.deletedBy).toBe('user-9');
    expect((setOp?.data?.data as Record<string, unknown>).text).toBe('Buy milk');
    expect(delOp?.ref.__path).toBe('households/household-1/todos/todo-1');
  });

  it('defaults deletedBy to null when unknown', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Eggs' }) });
    await softDeleteDoc({ db, householdId }, 'shoppingItem', 'item-2');
    const setOp = batchOps.find((o) => o.op === 'set');
    expect(setOp?.data?.deletedBy).toBeNull();
    expect(setOp?.ref.__path).toBe('households/household-1/trash/shoppingItem_item-2');
  });

  it('short-circuits (no batch) when the source doc is already gone', async () => {
    getDocMock.mockResolvedValue({ exists: () => false, data: () => ({}) });
    await softDeleteDoc({ db, householdId }, 'habit', 'habit-3');
    expect(committedCount).toBe(0);
    expect(deleteDocMock).not.toHaveBeenCalled();
  });

  it('falls back to a plain hard delete when the trash write is permission-denied (pre-rules)', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ text: 'x' }) });
    commitMock.mockImplementationOnce(async () => { throw { code: 'permission-denied' }; });
    await softDeleteDoc({ db, householdId }, 'todo', 'todo-4');
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
    const [ref] = deleteDocMock.mock.calls[0] as unknown as [Ref];
    expect(ref.__path).toBe('households/household-1/todos/todo-4');
  });

  it('rethrows a non-permission error', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ text: 'x' }) });
    commitMock.mockImplementationOnce(async () => { throw new Error('network down'); });
    await expect(softDeleteDoc({ db, householdId }, 'todo', 'todo-5')).rejects.toThrow('network down');
    expect(deleteDocMock).not.toHaveBeenCalled();
  });

  it('throws when no household is selected', async () => {
    await expect(softDeleteDoc({ db, householdId: null }, 'todo', 'todo-6')).rejects.toThrow('Household not selected');
  });
});

const sampleItem: TrashedItem = {
  id: 'meal_meal-1',
  domain: 'meal',
  originalId: 'meal-1',
  data: { name: 'Tacos', tags: ['dinner'] },
  deletedAt: '2026-07-14T00:00:00.000Z',
  deletedBy: 'user-1',
};

describe('restoreTrashedItem', () => {
  it('re-creates the original doc and deletes the trash mirror atomically', async () => {
    await restoreTrashedItem({ db, householdId }, sampleItem);
    expect(committedCount).toBe(1);
    const setOp = batchOps.find((o) => o.op === 'set');
    const delOp = batchOps.find((o) => o.op === 'delete');
    expect(setOp?.ref.__path).toBe('households/household-1/meals/meal-1');
    expect(setOp?.data).toEqual({ name: 'Tacos', tags: ['dinner'] });
    expect(delOp?.ref.__path).toBe('households/household-1/trash/meal_meal-1');
  });

  it('throws when no household is selected', async () => {
    await expect(restoreTrashedItem({ db, householdId: null }, sampleItem)).rejects.toThrow('Household not selected');
  });
});

describe('purgeTrashedItem', () => {
  it('hard-deletes the trash doc by id', async () => {
    await purgeTrashedItem({ db, householdId }, sampleItem);
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
    const [ref] = deleteDocMock.mock.calls[0] as unknown as [Ref];
    expect(ref.__path).toBe('households/household-1/trash/meal_meal-1');
  });

  it('throws when no household is selected', async () => {
    await expect(purgeTrashedItem({ db, householdId: null }, sampleItem)).rejects.toThrow('Household not selected');
  });
});

describe('attachTrashListener', () => {
  it('maps snapshot docs to typed TrashedItems (Timestamp → ISO), skipping unknown domains', () => {
    const setTrashedItems = vi.fn();
    const unsub = attachTrashListener({ db, householdId, setTrashedItems });
    expect(unsub).toBe(unsubscribeMock);

    const when = new Date('2026-07-14T12:00:00.000Z');
    snapshotHandler?.({
      docs: [
        {
          id: 'todo_todo-1',
          data: () => ({ domain: 'todo', originalId: 'todo-1', data: { text: 'Milk' }, deletedAt: Timestamp.fromDate(when), deletedBy: 'u1' }),
        },
        {
          id: 'bogus_x',
          data: () => ({ domain: 'not-a-domain', originalId: 'x', data: {}, deletedAt: when.toISOString() }),
        },
      ],
    });

    expect(setTrashedItems).toHaveBeenCalledTimes(1);
    const items = (setTrashedItems.mock.calls[0] as unknown as [TrashedItem[]])[0];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'todo_todo-1',
      domain: 'todo',
      originalId: 'todo-1',
      deletedAt: when.toISOString(),
      deletedBy: 'u1',
    });
  });

  it('falls back to defaults for malformed originalId/deletedAt/deletedBy', () => {
    const setTrashedItems = vi.fn();
    attachTrashListener({ db, householdId, setTrashedItems });
    snapshotHandler?.({
      docs: [
        { id: 'habit_h1', data: () => ({ domain: 'habit', deletedAt: 42, deletedBy: 99 }) },
      ],
    });
    const items = (setTrashedItems.mock.calls[0] as unknown as [TrashedItem[]])[0];
    const first = items[0] as TrashedItem;
    expect(first.originalId).toBe('habit_h1'); // falls back to snap.id
    expect(first.data).toEqual({});
    expect(first.deletedBy).toBeNull();
    expect(first.deletedAt).toBe(new Date(0).toISOString());
  });

  it('degrades to an empty trash on a listener error (pre-rules permission-denied)', () => {
    const setTrashedItems = vi.fn();
    attachTrashListener({ db, householdId, setTrashedItems });
    errorHandler?.({ code: 'permission-denied' });
    expect(setTrashedItems).toHaveBeenCalledWith([]);
  });
});
