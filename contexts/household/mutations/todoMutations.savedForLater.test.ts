/**
 * Unit tests for the "Saved for later" to-do mutations —
 * `addSavedForLaterTodo` (park a thought from scratch), `setTodoSavedForLater`
 * (park / un-park an existing to-do) and `promoteTodo` (promote WITH triage).
 *
 * `firebase/firestore` is mocked locally so these are pure logic tests:
 * `updateDoc` calls are captured with their target path and patch payload, and
 * `addDoc` calls with their collection path and document body. Both flag
 * mutations are thin wrappers around the existing write paths (reused, not
 * reimplemented), so the assertions are about WHAT lands in the single write.
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
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  increment: vi.fn((n: number) => ({ __increment: n })),
  arrayUnion: vi.fn((v: unknown) => ({ __arrayUnion: v })),
  arrayRemove: vi.fn((v: unknown) => ({ __arrayRemove: v })),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  runTransaction: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => '__serverTimestamp'),
  Timestamp: { fromDate: vi.fn((d: Date) => d) },
  updateDoc: vi.fn(async (ref: { __path: string }, data: Record<string, unknown>) => {
    capturedUpdates.push({ ref, data });
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { addDoc } from 'firebase/firestore';
import { makeAddToDo, makeTodoCrudMutations } from './todoMutations';
import { getLocalDateString } from '@/utils/dateHelpers';
import toast from 'react-hot-toast';

const db = {} as never;
const user = { uid: 'user-1' } as never;

function lastAddDocCall(): [{ __path: string }, Record<string, unknown>] {
  const call = vi.mocked(addDoc).mock.calls.at(-1);
  if (!call) throw new Error('addDoc was never called');
  return call as unknown as [{ __path: string }, Record<string, unknown>];
}

beforeEach(() => {
  capturedUpdates = [];
  vi.mocked(addDoc).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('addSavedForLaterTodo', () => {
  it('creates a parked to-do stamped with the LOCAL date as an inert placeholder', async () => {
    const { addSavedForLaterTodo } = makeAddToDo({ db, householdId: 'h1', user });
    await addSavedForLaterTodo('Look into a bike rack');

    expect(addDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = lastAddDocCall();
    expect(ref.__path).toBe('households/h1/todos');
    expect(data).toMatchObject({
      text: 'Look into a bike rack',
      isCompleted: false,
      savedForLater: true,
      // getLocalDateString(), never the UTC day — the placeholder is a LOCAL
      // calendar date like every other completeByDate in the app.
      completeByDate: getLocalDateString(),
      createdBy: 'user-1',
    });
  });

  it('classifies nothing — a parked item is explicitly not committed work', async () => {
    const { addSavedForLaterTodo } = makeAddToDo({ db, householdId: 'h1', user });
    await addSavedForLaterTodo('Research a bread machine');

    const [, data] = lastAddDocCall();
    expect('assignedTo' in data).toBe(false);
    expect('category' in data).toBe(false);
    expect('isImportant' in data).toBe(false);
    expect('dueTime' in data).toBe(false);
  });

  it('throws when there is no household / user (propagated from addToDo)', async () => {
    const { addSavedForLaterTodo } = makeAddToDo({ db, householdId: null, user });
    await expect(addSavedForLaterTodo('Nope')).rejects.toThrow(
      'User not authenticated or household not selected',
    );
    expect(addDoc).not.toHaveBeenCalled();
  });
});

describe('setTodoSavedForLater', () => {
  it('parks an existing to-do by writing ONLY the flag', async () => {
    const { setTodoSavedForLater } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await setTodoSavedForLater('todo-1', true);

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe('households/h1/todos/todo-1');
    // Crucially NOT completeByDate: an existing to-do already has a real date,
    // and overwriting it with the placeholder would destroy information the user
    // gets back on promotion anyway. Also means updateToDo does NOT re-arm the
    // reminder here (no scheduling field is touched).
    expect(capturedUpdates[0]?.data).toEqual({ savedForLater: true });
  });

  it('un-parks without triage (the undo of a park) with the same single write', async () => {
    const { setTodoSavedForLater } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await setTodoSavedForLater('todo-2', false);

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.data).toEqual({ savedForLater: false });
  });

  it('does not toast — the caller owns both messages (the row offers undo)', async () => {
    const { setTodoSavedForLater } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await setTodoSavedForLater('todo-3', true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('throws when no household is selected (propagated from updateToDo)', async () => {
    const { setTodoSavedForLater } = makeTodoCrudMutations({ db, householdId: null });
    await expect(setTodoSavedForLater('todo-4', true)).rejects.toThrow('Household not selected');
    expect(capturedUpdates).toHaveLength(0);
  });
});

describe('promoteTodo', () => {
  it('clears savedForLater AND applies the full classification in ONE write', async () => {
    const { promoteTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await promoteTodo('todo-1', {
      completeByDate: '2026-08-12',
      assignedTo: 'member-9',
      category: 'Home',
      isImportant: true,
    });

    // One write is the requirement, not an optimisation: a split would let a
    // to-do reach the active list unclassified — still carrying its inert
    // placeholder date — if the second write failed.
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe('households/h1/todos/todo-1');
    expect(capturedUpdates[0]?.data).toEqual({
      completeByDate: '2026-08-12',
      assignedTo: 'member-9',
      category: 'Home',
      isImportant: true,
      savedForLater: false,
      // updateToDo re-arms the reminder because completeByDate is present.
      reminderSentAt: null,
    });
  });

  it('promotes with only a due date — assignee/category/importance stay unset', async () => {
    const { promoteTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await promoteTodo('todo-2', { completeByDate: '2026-08-13' });

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.data).toEqual({
      completeByDate: '2026-08-13',
      savedForLater: false,
      reminderSentAt: null,
    });
  });

  it('sanitizes an explicitly-cleared optional field to null rather than dropping it', async () => {
    const { promoteTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await promoteTodo('todo-3', {
      completeByDate: '2026-08-14',
      assignedTo: undefined,
      category: undefined,
    });

    // Absent and null are equivalent for both fields (see the ToDo.category
    // schema comment) — what matters is the write lands at all.
    expect(capturedUpdates[0]?.data).toMatchObject({
      completeByDate: '2026-08-14',
      assignedTo: null,
      category: null,
      savedForLater: false,
    });
  });

  it('does not toast — the triage sheet owns the message and must survive a failed write', async () => {
    const { promoteTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await promoteTodo('todo-4', { completeByDate: '2026-08-15' });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('throws when no household is selected — nothing is half-promoted', async () => {
    const { promoteTodo } = makeTodoCrudMutations({ db, householdId: null });
    await expect(promoteTodo('todo-5', { completeByDate: '2026-08-16' })).rejects.toThrow(
      'Household not selected',
    );
    expect(capturedUpdates).toHaveLength(0);
  });
});
