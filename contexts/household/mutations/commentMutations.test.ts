import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Firestore mock --------------------------------------------------------
// Mirrors hooks/useHabitActions.test.tsx's mock shape: captures every batch
// set/update/delete call so tests can assert the atomic comment+count batch.

interface CapturedWrite {
  ref: { __path: string };
  data?: Record<string, unknown>;
}

let capturedSets: CapturedWrite[] = [];
let capturedUpdates: CapturedWrite[] = [];
let capturedDeletes: CapturedWrite[] = [];
let commitCount = 0;
let commitShouldThrow = false;

const incrementMock = vi.fn((n: number) => ({ __increment: n }));

vi.mock('firebase/firestore', () => {
  return {
    // doc() has two overloads exercised here: doc(db, path, id) for a known
    // id, and doc(collectionRef) for an auto-id new doc under that collection
    // (the `collection(...)` mock below returns a ref carrying `__path`).
    doc: vi.fn((first: unknown, path?: string, id?: string) => {
      const firstRef = first as { __path?: string } | undefined;
      if (firstRef?.__path !== undefined && path === undefined) {
        return { __path: `${firstRef.__path}/__autoId` };
      }
      return { __path: id ? `${path}/${id}` : (path ?? '__autoId') };
    }),
    collection: vi.fn((_db: unknown, path: string) => {
      const ref: { __path: string; withConverter: () => typeof ref } = {
        __path: path,
        withConverter: () => ref,
      };
      return ref;
    }),
    increment: (n: number) => incrementMock(n),
    query: vi.fn((base: unknown) => base),
    orderBy: vi.fn(),
    getDocs: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedSets.push({ ref, data });
      },
      update: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedUpdates.push({ ref, data });
      },
      delete: (ref: { __path: string }) => {
        capturedDeletes.push({ ref });
      },
      commit: vi.fn(async () => {
        if (commitShouldThrow) {
          throw Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
          });
        }
        commitCount++;
      }),
    })),
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import {
  makeAddTransactionComment,
  makeDeleteTransactionComment,
  makeGetTransactionComments,
  MAX_COMMENT_LENGTH,
} from './commentMutations';
import toast from 'react-hot-toast';
import { getDocs } from 'firebase/firestore';

const toastErrorMock = vi.mocked(toast.error);
const getDocsMock = vi.mocked(getDocs);

const HOUSEHOLD_ID = 'house1';
const TXN_ID = 'tx1';
const db = {} as never;

beforeEach(() => {
  capturedSets = [];
  capturedUpdates = [];
  capturedDeletes = [];
  commitCount = 0;
  commitShouldThrow = false;
  incrementMock.mockClear();
  toastErrorMock.mockClear();
  getDocsMock.mockReset();
});

describe('makeAddTransactionComment', () => {
  it('batches a comment set + commentCount increment in ONE writeBatch commit', async () => {
    const { addTransactionComment } = makeAddTransactionComment({
      db, householdId: HOUSEHOLD_ID, user: { uid: 'uid-1' },
    });

    await addTransactionComment(TXN_ID, 'What was this for?');

    expect(commitCount).toBe(1);
    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]?.ref.__path).toBe(`households/${HOUSEHOLD_ID}/transactions/${TXN_ID}/comments/__autoId`);
    expect(capturedSets[0]?.data).toMatchObject({ authorUid: 'uid-1', text: 'What was this for?' });
    expect(typeof capturedSets[0]?.data?.createdAt).toBe('string');

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe(`households/${HOUSEHOLD_ID}/transactions/${TXN_ID}`);
    expect(incrementMock).toHaveBeenCalledWith(1);
    expect(capturedUpdates[0]?.data).toEqual({ commentCount: { __increment: 1 } });
  });

  it('trims whitespace before writing', async () => {
    const { addTransactionComment } = makeAddTransactionComment({
      db, householdId: HOUSEHOLD_ID, user: { uid: 'uid-1' },
    });

    await addTransactionComment(TXN_ID, '  padded text  ');

    expect(capturedSets[0]?.data?.text).toBe('padded text');
  });

  it('rejects an empty/whitespace-only comment without writing', async () => {
    const { addTransactionComment } = makeAddTransactionComment({
      db, householdId: HOUSEHOLD_ID, user: { uid: 'uid-1' },
    });

    await addTransactionComment(TXN_ID, '   ');

    expect(commitCount).toBe(0);
    expect(toastErrorMock).toHaveBeenCalledWith('Comment cannot be empty');
  });

  it('rejects a comment over MAX_COMMENT_LENGTH without writing', async () => {
    const { addTransactionComment } = makeAddTransactionComment({
      db, householdId: HOUSEHOLD_ID, user: { uid: 'uid-1' },
    });

    await addTransactionComment(TXN_ID, 'x'.repeat(MAX_COMMENT_LENGTH + 1));

    expect(commitCount).toBe(0);
    expect(toastErrorMock).toHaveBeenCalledWith(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  });

  it('no-ops without a householdId', async () => {
    const { addTransactionComment } = makeAddTransactionComment({
      db, householdId: null, user: { uid: 'uid-1' },
    });

    await addTransactionComment(TXN_ID, 'hello');

    expect(commitCount).toBe(0);
  });

  it('toasts and re-throws when the batch commit fails (e.g. pre-rules-deploy permission-denied)', async () => {
    commitShouldThrow = true;
    const { addTransactionComment } = makeAddTransactionComment({
      db, householdId: HOUSEHOLD_ID, user: { uid: 'uid-1' },
    });

    await expect(addTransactionComment(TXN_ID, 'hello')).rejects.toThrow();
    // Cause-specific copy: the permission-denied code surfaces as the
    // membership/re-sign-in hint from describeError, not a generic failure.
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("don't have permission")
    );
  });
});

describe('makeDeleteTransactionComment', () => {
  it('batches a comment delete + commentCount decrement in ONE writeBatch commit', async () => {
    const { deleteTransactionComment } = makeDeleteTransactionComment({ db, householdId: HOUSEHOLD_ID });

    await deleteTransactionComment(TXN_ID, 'comment-1');

    expect(commitCount).toBe(1);
    expect(capturedDeletes).toHaveLength(1);
    expect(capturedDeletes[0]?.ref.__path).toBe(`households/${HOUSEHOLD_ID}/transactions/${TXN_ID}/comments/comment-1`);

    expect(capturedUpdates).toHaveLength(1);
    expect(incrementMock).toHaveBeenCalledWith(-1);
    expect(capturedUpdates[0]?.data).toEqual({ commentCount: { __increment: -1 } });
  });
});

describe('makeGetTransactionComments', () => {
  it('is a one-shot getDocs fetch (not a listener) returning the mapped comments', async () => {
    // A converter-attached query's docs' data() already returns the fully
    // typed T (id included, per the FirestoreDataConverter contract) — this
    // fixture simulates that SDK behavior, mirroring the real
    // transactionCommentConverter.fromFirestore output shape.
    getDocsMock.mockResolvedValueOnce({
      docs: [
        { data: () => ({ id: 'c1', authorUid: 'uid-1', text: 'first', createdAt: '2026-01-01T00:00:00.000Z' }) },
      ],
    } as never);

    const { getTransactionComments } = makeGetTransactionComments({ db, householdId: HOUSEHOLD_ID });
    const result = await getTransactionComments(TXN_ID);

    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 'c1', authorUid: 'uid-1', text: 'first', createdAt: '2026-01-01T00:00:00.000Z' }]);
  });

  it('returns [] without a householdId (no getDocs call)', async () => {
    const { getTransactionComments } = makeGetTransactionComments({ db, householdId: null });
    const result = await getTransactionComments(TXN_ID);

    expect(result).toEqual([]);
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});
