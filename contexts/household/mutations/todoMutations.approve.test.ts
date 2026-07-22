/**
 * Unit tests for approveTodo (Layer 3a of the capture-review feature — see
 * utils/captureReview.ts). `firebase/firestore` is mocked locally so these
 * are pure logic tests: `updateDoc` calls are captured with their target
 * path and patch payload. approveTodo is a thin wrapper around the existing
 * `updateToDo` field-patch mutation (reused, not reimplemented) — these tests
 * assert it goes through the same write path with `needsReview: false`
 * merged in.
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

import { makeTodoCrudMutations } from './todoMutations';
import toast from 'react-hot-toast';

const db = {} as never;

beforeEach(() => {
  capturedUpdates = [];
  vi.mocked(toast.success).mockClear();
});

describe('approveTodo', () => {
  it('clears needsReview via updateToDo when no overrides are given', async () => {
    const { approveTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await approveTodo('todo-1');

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe('households/h1/todos/todo-1');
    expect(capturedUpdates[0]?.data).toEqual({ needsReview: false });
    expect(toast.success).toHaveBeenCalledWith('Added to list');
  });

  it('persists edited overrides alongside clearing needsReview, in the same write', async () => {
    const { approveTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await approveTodo('todo-2', {
      text: 'Buy dog food',
      completeByDate: '2026-08-01',
      assignedTo: 'member-9',
      isImportant: true,
    });

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.data).toEqual({
      text: 'Buy dog food',
      completeByDate: '2026-08-01',
      assignedTo: 'member-9',
      isImportant: true,
      needsReview: false,
      // completeByDate is in the overrides, so updateToDo re-arms the
      // reminder (see the next test) — included here too since this write
      // touches the same field.
      reminderSentAt: null,
    });
  });

  it('re-arms the reminder (reminderSentAt: null) when the override touches completeByDate — the same behavior updateToDo gives every other caller', async () => {
    const { approveTodo } = makeTodoCrudMutations({ db, householdId: 'h1' });
    await approveTodo('todo-3', { completeByDate: '2026-08-05' });

    expect(capturedUpdates[0]?.data).toMatchObject({
      completeByDate: '2026-08-05',
      reminderSentAt: null,
      needsReview: false,
    });
  });

  it('throws when no household is selected (propagated from updateToDo)', async () => {
    const { approveTodo } = makeTodoCrudMutations({ db, householdId: null });
    await expect(approveTodo('todo-4')).rejects.toThrow('Household not selected');
    expect(capturedUpdates).toHaveLength(0);
  });
});
