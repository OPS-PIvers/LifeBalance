/**
 * F-TODO-16 — unit tests for the to-do category mutations.
 *
 * `firebase/firestore` is mocked locally (same convention as
 * todoMutations.test.ts) so these are pure logic tests: refs carry their
 * `__path`, each `writeBatch` records its own ops, and `getDocs` is driven with
 * fake to-do docs. Covers the chunking boundary, case-insensitive matching,
 * the merge-on-collision rule, the deleteField() clear, the no-op guards, and
 * the rethrow contract (these mutations toast nothing and re-throw, so callers
 * can't report success for a write that never landed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  chunkForBatches,
  FIRESTORE_BATCH_LIMIT,
  makeUpdateTodoCategories,
  makeTodoCategoryEditMutations,
} from './todoMutations';
import type { ToDo } from '@/types/schema';

interface Ref { __path: string; withConverter: (c: unknown) => Ref }
interface BatchRecord { ops: Array<{ ref: Ref; data: Record<string, unknown> }> }

const batches: BatchRecord[] = [];
const commitMock = vi.fn(async () => {});
const updateDocMock = vi.fn(async () => {});
const getDocsDocs = { current: [] as ToDo[] };

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string): Record<string, unknown> => ({
    __path: path,
    withConverter: () => makeRef(path),
  });
  return {
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(id ? `${path}/${id}` : path)),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    getDoc: vi.fn(),
    getDocs: vi.fn(async () => ({
      docs: getDocsDocs.current.map(t => ({
        ref: makeRef(`households/hh-1/todos/${t.id}`),
        data: () => t,
      })),
    })),
    addDoc: vi.fn(),
    updateDoc: (...args: unknown[]) => updateDocMock(...(args as [])),
    deleteDoc: vi.fn(),
    deleteField: vi.fn(() => ({ __deleteField: true })),
    query: vi.fn((col: unknown, ..._clauses: unknown[]) => col),
    where: vi.fn(),
    orderBy: vi.fn((field: string) => ({ __orderBy: field })),
    limit: vi.fn(),
    startAfter: vi.fn(),
    increment: vi.fn((n: number) => ({ __increment: n })),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    writeBatch: vi.fn(() => {
      const record: BatchRecord = { ops: [] };
      batches.push(record);
      return {
        update: (ref: Ref, data: Record<string, unknown>) => { record.ops.push({ ref, data }); },
        set: vi.fn(),
        delete: vi.fn(),
        commit: () => commitMock(),
      };
    }),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    Timestamp: class {},
  };
});

// `vi.mock` factories are hoisted above module-scope consts, so the toast spies
// have to be hoisted too if the tests want to assert on them.
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), toastMock),
}));

const db = {} as never;
const householdId = 'hh-1';

const todo = (id: string, category?: string): ToDo => ({
  id,
  text: id,
  completeByDate: '2026-07-21',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...(category === undefined ? {} : { category }),
});

beforeEach(() => {
  batches.length = 0;
  getDocsDocs.current = [];
  commitMock.mockClear();
  updateDocMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

const categoryUpdates = () =>
  batches.flatMap(b => b.ops.map(op => ({ id: op.ref.__path.split('/').pop(), data: op.data })));

describe('chunkForBatches', () => {
  it('keeps a sub-limit list in one chunk', () => {
    expect(chunkForBatches([1, 2, 3])).toEqual([[1, 2, 3]]);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkForBatches([])).toEqual([]);
  });

  it('splits exactly at the 500-op Firestore boundary', () => {
    const exactly500 = Array.from({ length: FIRESTORE_BATCH_LIMIT }, (_, i) => i);
    expect(chunkForBatches(exactly500)).toHaveLength(1);

    const overBy1 = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) => i);
    const chunks = chunkForBatches(overBy1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(FIRESTORE_BATCH_LIMIT);
    expect(chunks[1]).toEqual([FIRESTORE_BATCH_LIMIT]);
  });

  it('honours an explicit chunk size and rejects a non-positive one', () => {
    expect(chunkForBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunkForBatches([1], 0)).toThrow();
  });
});

describe('updateTodoCategories', () => {
  it('writes the list to the household doc and toasts NOTHING (callers own the message)', async () => {
    const { updateTodoCategories } = makeUpdateTodoCategories({ db, householdId });
    await updateTodoCategories(['Home', 'Work']);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['Home', 'Work'] });
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('is a no-op without a household', async () => {
    const { updateTodoCategories } = makeUpdateTodoCategories({ db, householdId: null });
    await updateTodoCategories(['Home']);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  // The whole point of the rethrow: a caller that awaits this must be able to
  // tell a failed write from a successful one (it previously always resolved,
  // so callers reported success on top of the mutation's error toast).
  it('RE-THROWS a failed write instead of swallowing it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateDocMock.mockRejectedValueOnce(new Error('permission-denied'));
    const { updateTodoCategories } = makeUpdateTodoCategories({ db, householdId });

    await expect(updateTodoCategories(['Home'])).rejects.toThrow('permission-denied');
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('renameTodoCategory', () => {
  const make = (todoCategories: string[]) =>
    makeTodoCategoryEditMutations({ db, householdId, todoCategories });

  it('rewrites every matching to-do (active and completed) and updates the list', async () => {
    getDocsDocs.current = [
      todo('a', 'Home'),
      { ...todo('b', 'Home'), isCompleted: true },
      todo('c', 'Work'),
    ];
    await make(['Home', 'Work']).renameTodoCategory('Home', 'House');

    expect(categoryUpdates()).toEqual([
      { id: 'a', data: { category: 'House' } },
      { id: 'b', data: { category: 'House' } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['House', 'Work'] });
  });

  it('matches case-insensitively so a typo fix actually rewrites tasks', async () => {
    getDocsDocs.current = [todo('a', 'home'), todo('b', 'HOME')];
    await make(['home']).renameTodoCategory('home', 'Home');

    expect(categoryUpdates()).toEqual([
      { id: 'a', data: { category: 'Home' } },
      { id: 'b', data: { category: 'Home' } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['Home'] });
  });

  it('MERGES into an existing category rather than creating a case-variant duplicate', async () => {
    getDocsDocs.current = [todo('a', 'Errands'), todo('b', 'Chores')];
    await make(['Errands', 'Chores']).renameTodoCategory('Errands', 'chores');

    // Tasks adopt the EXISTING spelling, not the typed one.
    expect(categoryUpdates()).toEqual([{ id: 'a', data: { category: 'Chores' } }]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['Chores'] });
  });

  it('adds the target to the list when the old name lived only on to-dos', async () => {
    getDocsDocs.current = [todo('a', 'Legacy')];
    await make(['Home']).renameTodoCategory('Legacy', 'Archive');

    expect(categoryUpdates()).toEqual([{ id: 'a', data: { category: 'Archive' } }]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['Home', 'Archive'] });
  });

  it('chunks the rewrites into 500-op batches', async () => {
    getDocsDocs.current = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) =>
      todo(`t${i}`, 'Home'),
    );
    await make(['Home']).renameTodoCategory('Home', 'House');

    expect(batches).toHaveLength(2);
    expect(batches[0]?.ops).toHaveLength(FIRESTORE_BATCH_LIMIT);
    expect(batches[1]?.ops).toHaveLength(1);
    expect(commitMock).toHaveBeenCalledTimes(2);
  });

  it('RE-THROWS when the vocabulary write fails, and toasts nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocsDocs.current = [todo('a', 'Home')];
    updateDocMock.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(make(['Home']).renameTodoCategory('Home', 'House')).rejects.toThrow(
      'permission-denied',
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // The mutation's doc comment claims a part-way failure is safe to retry
  // because the to-do rewrites commit BEFORE the vocabulary list. This is that
  // claim, executed: the failed run leaves the old name listed, and the retry
  // re-queries by the old name so it only touches what is left.
  it('converges on retry when one chunk of the rewrite fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const all = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) => todo(`t${i}`, 'Home'));
    getDocsDocs.current = all;
    // First chunk commits, second is rejected.
    commitMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('unavailable'));

    await expect(make(['Home']).renameTodoCategory('Home', 'House')).rejects.toThrow('unavailable');
    // Vocabulary untouched — 'Home' is still listed, so the tasks the first
    // chunk did NOT reach are still reachable through the UI.
    expect(updateDocMock).not.toHaveBeenCalled();

    // Retry: Firestore now only returns the to-dos still carrying 'Home' (the
    // first chunk was rewritten to 'House' and no longer matches).
    batches.length = 0;
    commitMock.mockClear();
    getDocsDocs.current = all.slice(FIRESTORE_BATCH_LIMIT);
    await make(['Home']).renameTodoCategory('Home', 'House');

    expect(batches).toHaveLength(1);
    expect(batches[0]?.ops).toHaveLength(1);
    expect(categoryUpdates()).toEqual([
      { id: `t${FIRESTORE_BATCH_LIMIT}`, data: { category: 'House' } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['House'] });
    errorSpy.mockRestore();
  });

  it('is a no-op for a blank new name, an unchanged name, or no household', async () => {
    getDocsDocs.current = [todo('a', 'Home')];
    await make(['Home']).renameTodoCategory('Home', '   ');
    await make(['Home']).renameTodoCategory('Home', 'Home');
    await makeTodoCategoryEditMutations({ db, householdId: null, todoCategories: ['Home'] })
      .renameTodoCategory('Home', 'House');

    expect(batches).toHaveLength(0);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('deleteTodoCategory', () => {
  const make = (todoCategories: string[]) =>
    makeTodoCategoryEditMutations({ db, householdId, todoCategories });

  it('removes the field with deleteField() and drops the list entry', async () => {
    getDocsDocs.current = [
      todo('a', 'Home'),
      { ...todo('b', 'home'), isCompleted: true },
      todo('c', 'Work'),
    ];
    await make(['Home', 'Work']).deleteTodoCategory('Home');

    const updates = categoryUpdates();
    expect(updates.map(u => u.id)).toEqual(['a', 'b']);
    for (const update of updates) {
      expect(update.data['category']).toEqual({ __deleteField: true });
    }
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ todoCategories: ['Work'] });
  });

  it('chunks the clears into 500-op batches', async () => {
    getDocsDocs.current = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) =>
      todo(`t${i}`, 'Home'),
    );
    await make(['Home']).deleteTodoCategory('Home');

    expect(batches).toHaveLength(2);
    expect(batches[0]?.ops).toHaveLength(FIRESTORE_BATCH_LIMIT);
    expect(batches[1]?.ops).toHaveLength(1);
  });

  it('RE-THROWS a failed clear instead of resolving, and toasts nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocsDocs.current = [todo('a', 'Home')];
    commitMock.mockRejectedValueOnce(new Error('unavailable'));

    await expect(make(['Home']).deleteTodoCategory('Home')).rejects.toThrow('unavailable');
    // The vocabulary entry survives, so the category is still there to retry.
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('is a no-op for a blank name or no household', async () => {
    getDocsDocs.current = [todo('a', 'Home')];
    await make(['Home']).deleteTodoCategory('  ');
    await makeTodoCategoryEditMutations({ db, householdId: null, todoCategories: ['Home'] })
      .deleteTodoCategory('Home');

    expect(batches).toHaveLength(0);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
