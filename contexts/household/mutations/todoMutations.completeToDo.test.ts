/**
 * Unit tests for `completeToDo`, in particular its `savedForLater` guard: a
 * parked to-do is explicitly NOT committed work (see `ToDo.savedForLater`)
 * and must never be completed — doing so would let it reach
 * `{savedForLater: true, isCompleted: true}`, a state `savedForLaterTodos`
 * (contexts/FirebaseHouseholdContext.tsx) deliberately never filters out, so
 * the item would become an orphaned zombie invisible to every exposed slice.
 * Also covers `toggleTodoSubtask`'s auto-complete escalation, which routes
 * through the same `completeToDo` and must inherit the same refusal.
 *
 * `firebase/firestore` is mocked locally (mirrors the pattern in
 * `todoMutations.test.ts`'s `makeUncompleteToDo` suite): refs carry their
 * `__path`, the batch records its `update`/`set` calls, and `getDoc` is
 * driven with fake todo docs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCompleteToDo, makeToggleTodoSubtask } from './todoMutations';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { HouseholdMember, ToDo, Subtask } from '@/types/schema';

interface Ref { __path: string; withConverter: (c: unknown) => Ref }
interface BatchOp {
  op: 'update' | 'set';
  ref: Ref;
  data: Record<string, unknown>;
}

let batchOps: BatchOp[] = [];
const commitMock = vi.fn(async () => {});
const getDocMock = vi.fn<(ref: unknown) => unknown>();

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string): Record<string, unknown> => ({
    __path: path,
    withConverter: () => makeRef(path),
  });
  return {
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(id ? `${path}/${id}` : path)),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    getDoc: (ref: unknown) => getDocMock(ref),
    getDocs: vi.fn(async () => ({ docs: [] })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    query: vi.fn((col: unknown, ..._clauses: unknown[]) => col),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    increment: vi.fn((n: number) => ({ __increment: n })),
    arrayUnion: vi.fn((v: unknown) => ({ __arrayUnion: v })),
    arrayRemove: vi.fn((v: unknown) => ({ __arrayRemove: v })),
    writeBatch: vi.fn(() => ({
      update: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'update', ref, data }); },
      set: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'set', ref, data }); },
      delete: vi.fn(),
      commit: () => commitMock(),
    })),
    runTransaction: async (_db: unknown, cb: (txn: unknown) => Promise<unknown>) => {
      const transaction = {
        get: (ref: unknown) => getDocMock(ref),
        update: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'update', ref, data }); },
      };
      return cb(transaction);
    },
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    Timestamp: class {},
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

const db = {} as never;
const householdId = 'hh-1';

const PARENT: HouseholdMember = {
  uid: 'parent_1', displayName: 'Parent', role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
};
const membersRef = { current: [PARENT] };

const baseTodo = (overrides: Partial<ToDo>): ToDo => ({
  id: 'todo-1',
  text: 'Feed the cat',
  completeByDate: getLocalDateString(),
  isCompleted: false,
  createdBy: 'parent_1',
  createdAt: '2026-07-01T00:00:00',
  ...overrides,
});

const mockTodoDoc = (todo: ToDo | undefined) => {
  getDocMock.mockResolvedValue({ data: () => todo });
};

beforeEach(() => {
  batchOps = [];
  commitMock.mockClear();
  getDocMock.mockReset();
});

describe('makeCompleteToDo', () => {
  it('refuses to complete a saved-for-later to-do — no batch write happens', async () => {
    mockTodoDoc(baseTodo({ id: 'todo-1', savedForLater: true }));
    const { completeToDo } = makeCompleteToDo({ db, householdId, membersRef });

    await expect(completeToDo('todo-1')).rejects.toThrow('saved for later');

    // Guard against a vacuous "throws but still wrote" fix — nothing must
    // have been staged or committed.
    expect(commitMock).not.toHaveBeenCalled();
    expect(batchOps).toHaveLength(0);
  });

  it('positive control: completes a normal (non-parked) to-do via the batch', async () => {
    mockTodoDoc(baseTodo({ id: 'todo-2', savedForLater: false }));
    const { completeToDo } = makeCompleteToDo({ db, householdId, membersRef });

    // This is the control proving the guard above isn't vacuous: with the
    // flag false, the exact same call DOES complete and commit.
    await expect(completeToDo('todo-2')).resolves.toBeUndefined();

    expect(commitMock).toHaveBeenCalledTimes(1);
    const completionUpdate = batchOps.find(
      (op) => op.op === 'update' && op.ref.__path === 'households/hh-1/todos/todo-2'
    );
    expect(completionUpdate?.data).toMatchObject({ isCompleted: true });
  });

  it('an absent savedForLater flag behaves like false (also completable)', async () => {
    mockTodoDoc(baseTodo({ id: 'todo-3' })); // no savedForLater key at all
    const { completeToDo } = makeCompleteToDo({ db, householdId, membersRef });

    await expect(completeToDo('todo-3')).resolves.toBeUndefined();
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('is idempotent (already-completed short-circuit) even when also parked', async () => {
    // isCompleted is checked first, so an already-completed+parked doc (which
    // the guard prevents arising going forward) still no-ops rather than
    // throwing — it must never be able to re-fire points.
    mockTodoDoc(baseTodo({ id: 'todo-4', savedForLater: true, isCompleted: true }));
    const { completeToDo } = makeCompleteToDo({ db, householdId, membersRef });

    await expect(completeToDo('todo-4')).resolves.toBeUndefined();
    expect(commitMock).not.toHaveBeenCalled();
  });
});

describe('makeToggleTodoSubtask — auto-complete escalation inherits the guard', () => {
  const subtasks: Subtask[] = [{ id: 'sub-1', text: 'Buy food', isDone: false }];

  it('propagates the saved-for-later refusal when the last subtask would escalate to completion', async () => {
    mockTodoDoc(baseTodo({ id: 'todo-5', savedForLater: true, subtasks }));
    const { toggleTodoSubtask } = makeToggleTodoSubtask({ db, householdId, membersRef });

    await expect(toggleTodoSubtask('todo-5', 'sub-1')).rejects.toThrow('saved for later');
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('positive control: escalates and completes a normal to-do on the last subtask', async () => {
    mockTodoDoc(baseTodo({ id: 'todo-6', savedForLater: false, subtasks }));
    const { toggleTodoSubtask } = makeToggleTodoSubtask({ db, householdId, membersRef });

    const result = await toggleTodoSubtask('todo-6', 'sub-1');

    expect(result.autoCompleted).toBe(true);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});
