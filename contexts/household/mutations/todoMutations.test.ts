/**
 * Unit tests for the uncompleteToDo mutation (points-integrity counterpart of
 * completeToDo). `firebase/firestore` is mocked locally so these are pure
 * logic tests: refs carry their `__path`, the batch records its `update`
 * calls, and `getDoc` is driven with fake todo docs. Covers the atomic
 * restore+reversal batch for a managed-kid assignee, the flip-only write for
 * a non-kid assignee, the already-active double-reversal guard, and the
 * not-found error path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeUncompleteToDo } from './todoMutations';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { HouseholdMember, ToDo } from '@/types/schema';

interface Ref { __path: string; withConverter: (c: unknown) => Ref }
interface BatchOp {
  op: 'update' | 'delete';
  ref: Ref;
  data?: Record<string, unknown>;
}

let batchOps: BatchOp[] = [];
const commitMock = vi.fn(async () => {});
const getDocMock = vi.fn<(ref: unknown) => unknown>();
// Candidate docs `getDocs` returns for the recurring-spawn reconciliation
// query in uncompleteToDo — each entry becomes a fake QueryDocumentSnapshot
// with a `.ref` (used for batch.delete) and `.data()` returning the ToDo.
const getDocsCandidates = { current: [] as ToDo[] };

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string): Record<string, unknown> => ({
    __path: path,
    withConverter: () => makeRef(path),
  });
  return {
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(id ? `${path}/${id}` : path)),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    getDoc: (ref: unknown) => getDocMock(ref),
    getDocs: vi.fn(async () => ({
      docs: getDocsCandidates.current.map(t => ({
        ref: makeRef(`households/hh-1/todos/${t.id}`),
        data: () => t,
      })),
    })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    query: vi.fn((col: unknown, ..._clauses: unknown[]) => col),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    increment: vi.fn((n: number) => ({ __increment: n })),
    writeBatch: vi.fn(() => ({
      update: (ref: Ref, data: Record<string, unknown>) => { batchOps.push({ op: 'update', ref, data }); },
      set: vi.fn(),
      delete: (ref: Ref) => { batchOps.push({ op: 'delete', ref }); },
      commit: () => commitMock(),
    })),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    Timestamp: class {},
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

const db = {} as never;
const householdId = 'hh-1';

const KID: HouseholdMember = {
  uid: 'kid_1', displayName: 'Kiddo', role: 'kid', isManaged: true,
  points: { daily: 10, weekly: 20, total: 30 },
};
const PARENT: HouseholdMember = {
  uid: 'parent_1', displayName: 'Parent', role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
};
const membersRef = { current: [KID, PARENT] };

const baseTodo = (overrides: Partial<ToDo>): ToDo => ({
  id: 'todo-1',
  text: 'Feed the cat',
  completeByDate: getLocalDateString(),
  assignedTo: 'kid_1',
  isCompleted: true,
  completedAt: `${getLocalDateString()}T12:00:00`,
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
  getDocsCandidates.current = [];
});

describe('makeUncompleteToDo', () => {
  it('throws when no household is selected', async () => {
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId: null, membersRef });
    await expect(uncompleteToDo('todo-1')).rejects.toThrow('Household not selected');
  });

  it('throws when the to-do does not exist', async () => {
    mockTodoDoc(undefined);
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
    await expect(uncompleteToDo('todo-1')).rejects.toThrow('To-Do not found');
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('is a no-op for an already-active to-do (double-reversal guard)', async () => {
    mockTodoDoc(baseTodo({ isCompleted: false, completedAt: undefined }));
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
    await uncompleteToDo('todo-1');
    expect(commitMock).not.toHaveBeenCalled();
    expect(batchOps).toHaveLength(0);
  });

  it('restores a kid-assigned to-do and reverses daily/weekly/total in ONE batch (same-day completion)', async () => {
    mockTodoDoc(baseTodo({ points: 7 }));
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
    await uncompleteToDo('todo-1');

    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(batchOps).toHaveLength(2);
    const todoOp = batchOps.find(o => o.ref.__path === 'households/hh-1/todos/todo-1');
    expect(todoOp?.data).toEqual({ isCompleted: false, completedAt: null });
    const memberOp = batchOps.find(o => o.ref.__path === 'households/hh-1/members/kid_1');
    expect(memberOp?.data).toEqual({
      'points.total': { __increment: -7 },
      'points.daily': { __increment: -7 },
      'points.weekly': { __increment: -7 },
    });
  });

  it('reverses only the lifetime total for a completion from a previous week', async () => {
    mockTodoDoc(baseTodo({ points: 5, completedAt: '2020-01-01T08:00:00' }));
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
    await uncompleteToDo('todo-1');

    const memberOp = batchOps.find(o => o.ref.__path === 'households/hh-1/members/kid_1');
    expect(memberOp?.data).toEqual({ 'points.total': { __increment: -5 } });
  });

  it('writes ONLY the todo flip for a non-kid assignee (no credit was given)', async () => {
    mockTodoDoc(baseTodo({ assignedTo: 'parent_1' }));
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
    await uncompleteToDo('todo-1');

    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(batchOps).toHaveLength(1);
    expect(batchOps[0]?.ref.__path).toBe('households/hh-1/todos/todo-1');
    expect(batchOps[0]?.data).toEqual({ isCompleted: false, completedAt: null });
  });

  it('writes ONLY the todo flip for an unknown assignee uid', async () => {
    mockTodoDoc(baseTodo({ assignedTo: 'ghost_99' }));
    const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
    await uncompleteToDo('todo-1');
    expect(batchOps).toHaveLength(1);
  });

  describe('recurring next-instance reconciliation (F-TODO-01 counterpart)', () => {
    it('deletes the spawned next instance in the SAME batch when restoring a recurring to-do', async () => {
      const restored = baseTodo({
        assignedTo: 'parent_1', // no points credit — isolates the spawn-delete assertion
        recurrence: { frequency: 'weekly' },
      });
      mockTodoDoc(restored);
      // The spawn's parentRecurringId chains back to the root (the restored
      // todo's own id, since it had no parentRecurringId of its own).
      getDocsCandidates.current = [{
        ...restored,
        id: 'todo-2',
        isCompleted: false,
        completedAt: undefined,
        recurrence: { frequency: 'weekly', parentRecurringId: 'todo-1' },
      }];
      const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
      await uncompleteToDo('todo-1');

      expect(commitMock).toHaveBeenCalledTimes(1);
      const deleteOp = batchOps.find(o => o.op === 'delete');
      expect(deleteOp?.ref.__path).toBe('households/hh-1/todos/todo-2');
      // Same batch as the flip — never a second commit.
      const flipOp = batchOps.find(o => o.op === 'update' && o.ref.__path === 'households/hh-1/todos/todo-1');
      expect(flipOp).toBeDefined();
    });

    it('leaves every candidate untouched when the spawn is ambiguous (2+ matches)', async () => {
      const restored = baseTodo({
        assignedTo: 'parent_1',
        recurrence: { frequency: 'weekly' },
      });
      mockTodoDoc(restored);
      getDocsCandidates.current = [
        { ...restored, id: 'todo-2', isCompleted: false, completedAt: undefined, recurrence: { frequency: 'weekly', parentRecurringId: 'todo-1' } },
        { ...restored, id: 'todo-3', isCompleted: false, completedAt: undefined, recurrence: { frequency: 'weekly', parentRecurringId: 'todo-1' } },
      ];
      const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
      await uncompleteToDo('todo-1');

      expect(batchOps.some(o => o.op === 'delete')).toBe(false);
      expect(batchOps).toHaveLength(1); // only the todo flip
    });

    it('leaves the next instance untouched when it was already completed', async () => {
      const restored = baseTodo({
        assignedTo: 'parent_1',
        recurrence: { frequency: 'weekly' },
      });
      mockTodoDoc(restored);
      // Already-completed candidates never appear in the `isCompleted == false`
      // query results, so this simulates the real Firestore filtering.
      getDocsCandidates.current = [];
      const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
      await uncompleteToDo('todo-1');

      expect(batchOps.some(o => o.op === 'delete')).toBe(false);
      expect(batchOps).toHaveLength(1);
    });

    it('does not touch a candidate whose text no longer matches (edited)', async () => {
      const restored = baseTodo({
        assignedTo: 'parent_1',
        recurrence: { frequency: 'weekly' },
      });
      mockTodoDoc(restored);
      getDocsCandidates.current = [{
        ...restored,
        id: 'todo-2',
        text: 'Something else entirely',
        isCompleted: false,
        completedAt: undefined,
        recurrence: { frequency: 'weekly', parentRecurringId: 'todo-1' },
      }];
      const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
      await uncompleteToDo('todo-1');

      expect(batchOps.some(o => o.op === 'delete')).toBe(false);
    });

    it('leaves non-recurring to-dos unchanged (no reconciliation query effect)', async () => {
      mockTodoDoc(baseTodo({ assignedTo: 'parent_1' })); // no `recurrence` field
      getDocsCandidates.current = [{
        id: 'todo-2',
        text: 'Feed the cat',
        completeByDate: getLocalDateString(),
        assignedTo: 'parent_1',
        isCompleted: false,
        completedAt: undefined,
        createdBy: 'parent_1',
        createdAt: '2026-07-01T00:00:00',
      }];
      const { uncompleteToDo } = makeUncompleteToDo({ db, householdId, membersRef });
      await uncompleteToDo('todo-1');

      expect(batchOps).toHaveLength(1); // only the todo flip
      expect(batchOps.some(o => o.op === 'delete')).toBe(false);
    });
  });
});
