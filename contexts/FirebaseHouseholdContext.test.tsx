import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { format, startOfWeek, subDays } from 'date-fns';
import type {
  Account,
  BudgetBucket,
  CalendarItem,
  FreezeBank,
  GroceryCatalogItem,
  Habit,
  QuickStockList,
  ShoppingItem,
  Transaction,
} from '@/types/schema';

/**
 * Batch-write ATOMICITY tests for the critical multi-document mutations owned by
 * FirebaseHouseholdContext (the §2 "context batch-write atomicity" target):
 *   - updateTransactionCategory (transaction + related habits + points)
 *   - payCalendarItem           (calendar item + account balance + transaction)
 *   - useFreezeBankToken        (habit + token balance + patched-day points)
 *
 * The habit+points toggle/submission paths run through useHabitActions and are
 * already covered by hooks/useHabitActions.test.tsx; these tests lock the
 * remaining context-level batch mutations so they can never partially apply.
 *
 * Strategy: a hand-rolled firebase/firestore mock records every batch op (set /
 * update / delete) plus the number of writeBatch() instances created and the
 * number of commit() calls. Each mutation must produce EXACTLY ONE batch
 * containing ALL of its document writes — that is the atomicity invariant. State
 * is seeded by driving the captured onSnapshot callbacks the provider registers
 * on mount.
 */

// --- Captured batch ops --------------------------------------------------

interface CapturedOp {
  kind: 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
}

interface CapturedBatch {
  ops: CapturedOp[];
  committed: boolean;
}

let batches: CapturedBatch[] = [];

// Commit-failure controller (gap §1 rollback tests). When `failNextCommit` is
// set, the NEXT writeBatch().commit() rejects with `commitError` instead of
// resolving, simulating a Firestore write rejection so we can prove the mutation
// applied NO partial write outside the (failed) batch. Hoisted so the vi.mock
// factory below can read it. Reset to a clean state in beforeEach.
const { commitController } = vi.hoisted(() => ({
  commitController: { failNextCommit: false, commitError: new Error('commit rejected') },
}));

const incrementMock = vi.fn((n: number) => ({ __increment: n }));

// onSnapshot callbacks captured at mount, keyed by the ref/query path so a test
// can feed a snapshot into a specific listener to seed that slice of state.
type NextCb = (snapshot: unknown) => void;
const snapshotCallbacks = new Map<string, NextCb>();

function pathOf(ref: unknown): string {
  if (ref && typeof ref === 'object' && '__path' in ref) {
    return (ref as { __path: string }).__path;
  }
  return '__unknown';
}

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string) => ({
    __path: path,
    // collection(...).withConverter(conv) must keep carrying the path.
    withConverter: () => makeRef(path),
  });
  return {
    doc: vi.fn((dbOrRef: unknown, path?: string, id?: string) => {
      // doc(db, path, id?) — explicit path form.
      if (typeof path === 'string') {
        return makeRef(id ? `${path}/${id}` : path);
      }
      // doc(collectionRef) — auto-id form: keep the collection's path with a
      // synthetic id so set() ops can still be matched by their collection.
      if (dbOrRef && typeof dbOrRef === 'object' && '__path' in dbOrRef) {
        return makeRef(`${(dbOrRef as { __path: string }).__path}/__autoId`);
      }
      return makeRef('__autoId');
    }),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    query: vi.fn((ref: unknown) => ref),
    where: vi.fn(() => ({ __where: true })),
    orderBy: vi.fn(() => ({ __orderBy: true })),
    limit: vi.fn(() => ({ __limit: true })),
    startAfter: vi.fn(() => ({ __startAfter: true })),
    increment: (n: number) => incrementMock(n),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    deleteField: vi.fn(() => '__deleteField'),
    arrayUnion: vi.fn((...args: unknown[]) => ({ __arrayUnion: args })),
    arrayRemove: vi.fn((...args: unknown[]) => ({ __arrayRemove: args })),
    Timestamp: { fromDate: vi.fn(), now: vi.fn() },
    onSnapshot: vi.fn((ref: unknown, next: NextCb) => {
      snapshotCallbacks.set(pathOf(ref), next);
      return vi.fn(); // unsubscribe
    }),
    writeBatch: vi.fn(() => {
      const batch: CapturedBatch = { ops: [], committed: false };
      batches.push(batch);
      return {
        set: (ref: unknown, data: Record<string, unknown>) => {
          batch.ops.push({ kind: 'set', path: pathOf(ref), data });
        },
        update: (ref: unknown, data: Record<string, unknown>) => {
          batch.ops.push({ kind: 'update', path: pathOf(ref), data });
        },
        delete: (ref: unknown) => {
          batch.ops.push({ kind: 'delete', path: pathOf(ref) });
        },
        commit: vi.fn(async () => {
          // Simulate a rejected Firestore commit for the rollback tests. The
          // batch is left `committed=false` and NO ops are applied (the mock only
          // records ops in-memory; a real failed commit applies nothing), so a
          // test can assert the documents were never partially written.
          if (commitController.failNextCommit) {
            commitController.failNextCommit = false;
            throw commitController.commitError;
          }
          batch.committed = true;
        }),
      };
    }),
    addDoc: vi.fn(async () => ({ id: 'newDoc' })),
    updateDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    getDocs: vi.fn(async () => ({ docs: [], size: 0 })),
    getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
    setDoc: vi.fn(async () => undefined),
    runTransaction: vi.fn(),
  };
});

vi.mock('@/firebase.config', () => ({ db: {} }));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const AUTH_USER = { uid: 'user1', displayName: 'Tester', email: 't@e.com', photoURL: '' };
const HOUSEHOLD_ID = 'h1';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: AUTH_USER, householdId: HOUSEHOLD_ID }),
}));

// Plan 080e: addKidProfile reads getBillingEnabled() to decide whether the managed
// -kid cap is enforced (billing on) or skipped entirely (billing off — current prod
// state). It's the ONLY appConfig export the context imports. Mock it so both states
// are deterministic; the default (set in beforeEach) is `false`, matching the dormant
// behaviour every other test in this file relies on. (vitest hoists vi.mock/vi.hoisted.)
const { getBillingEnabledMock } = vi.hoisted(() => ({ getBillingEnabledMock: vi.fn() }));
vi.mock('@/services/appConfig', () => ({
  getBillingEnabled: getBillingEnabledMock,
}));

import {
  FirebaseHouseholdProvider,
  useFinance,
  useGamification,
  useHouseholdCore,
  useShopping,
} from './FirebaseHouseholdContext';
// Plan 080d reward CRUD writes through these single-doc APIs (not a batch), so we
// read their captured call args to assert path + payload. Plan 080e: addKidProfile
// writes the managed-kid member via setDoc(), so we assert it was/wasn't called.
import { addDoc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';

const addDocMock = vi.mocked(addDoc);
const updateDocMock = vi.mocked(updateDoc);
const deleteDocMock = vi.mocked(deleteDoc);
const setDocMock = vi.mocked(setDoc);

// --- Snapshot seeding helpers --------------------------------------------

function docSnap(id: string, data: object) {
  return { id, data: () => ({ ...data, id }) };
}

function emitCollection(path: string, docs: ReturnType<typeof docSnap>[]) {
  const cb = snapshotCallbacks.get(path);
  if (!cb) throw new Error(`No listener registered for collection "${path}"`);
  act(() => {
    cb({ docs, size: docs.length });
  });
}

function emitDoc(path: string, id: string, data: Record<string, unknown>) {
  const cb = snapshotCallbacks.get(path);
  if (!cb) throw new Error(`No listener registered for doc "${path}"`);
  act(() => {
    cb({ id, exists: () => true, data: () => data });
  });
}

// --- Consumer harness ----------------------------------------------------
// Captures the context value so tests can call the real mutations.

interface Captured {
  finance: ReturnType<typeof useFinance>;
  gamification: ReturnType<typeof useGamification>;
  core: ReturnType<typeof useHouseholdCore>;
  shopping: ReturnType<typeof useShopping>;
}

const captured: { value: Captured | null } = { value: null };

const Capture: React.FC = () => {
  const finance = useFinance();
  const gamification = useGamification();
  const core = useHouseholdCore();
  const shopping = useShopping();
  // Write to the module-scope holder from an effect (mutating it during render
  // is disallowed by the react-hooks/immutability lint rule).
  React.useEffect(() => {
    captured.value = { finance, gamification, core, shopping };
  });
  return null;
};

function renderProvider() {
  render(
    <FirebaseHouseholdProvider>
      <Capture />
    </FirebaseHouseholdProvider>
  );
}

const baseHabit = (overrides: Partial<Habit>): Habit => ({
  id: 'hb1',
  title: 'Read',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  scoringType: 'incremental',
  basePoints: 10,
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: new Date().toISOString(),
  ...overrides,
} as Habit);

const householdPath = `households/${HOUSEHOLD_ID}`;

function opsForPath(batch: CapturedBatch, path: string) {
  return batch.ops.filter(o => o.path === path);
}

beforeEach(() => {
  batches = [];
  snapshotCallbacks.clear();
  captured.value = null;
  commitController.failNextCommit = false;
  incrementMock.mockClear();
  addDocMock.mockClear();
  updateDocMock.mockClear();
  deleteDocMock.mockClear();
  setDocMock.mockClear();
  // Default: billing OFF (dormant prod state). The cap-enforcement tests opt in
  // per-test with mockResolvedValueOnce(true); every other test keeps this default
  // so addKidProfile's cap block is skipped exactly as it is in production.
  getBillingEnabledMock.mockReset();
  getBillingEnabledMock.mockResolvedValue(false);
});

describe('FirebaseHouseholdContext — updateTransactionCategory atomicity', () => {
  it('commits the transaction update, habit update, and points increment in ONE batch', async () => {
    renderProvider();

    // Seed: current user (members listener) + one related habit.
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', displayName: 'Tester', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', completedDates: [], count: 0 })),
    ]);
    // Emit the household doc so the transactions listener un-gates, then seed the
    // tx1 row updateTransactionCategory now requires (it reads the row to compute
    // the verified-only balance delta and bails if absent). Seed it as ALREADY
    // `verified` with an expense category so re-categorising to another expense
    // yields a zero balance delta — no checking-account op leaks into the batch,
    // keeping this test's tx+habit+points shape intact.
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/transactions`, [
      docSnap('tx1', { amount: 2500, category: 'Dining', status: 'verified' }),
    ]);

    expect(captured.value).not.toBeNull();

    await act(async () => {
      await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries', ['hb1']);
    });

    // Exactly one batch, committed.
    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    // The single batch contains the transaction update, the habit update, and
    // the household points increment — never split across multiple batches.
    const txOps = opsForPath(batch, `${householdPath}/transactions/tx1`);
    expect(txOps).toHaveLength(1);
    expect(txOps[0]!.data).toMatchObject({ category: 'Groceries', status: 'verified' });

    const habitOps = opsForPath(batch, `${householdPath}/habits/hb1`);
    expect(habitOps).toHaveLength(1);

    const pointsOps = opsForPath(batch, householdPath);
    expect(pointsOps).toHaveLength(1);
    // A positive incremental habit (basePoints 10, 1.0x first completion) credits +10.
    expect(pointsOps[0]!.data!['points.daily']).toEqual({ __increment: 10 });
    expect(pointsOps[0]!.data!['points.weekly']).toEqual({ __increment: 10 });
    expect(pointsOps[0]!.data!['points.total']).toEqual({ __increment: 10 });
  });

  it('still uses a single batch (transaction only) when no habits are related', async () => {
    renderProvider();
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    // Un-gate the transactions listener + seed the required tx1 row as an already
    // `verified` expense (zero re-categorise delta => no accounts op leaks),
    // preserving this test's "transaction op only" assertion.
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/transactions`, [
      docSnap('tx1', { amount: 2500, category: 'Dining', status: 'verified' }),
    ]);

    await act(async () => {
      await captured.value!.finance.updateTransactionCategory('tx1', 'Bills');
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);
    // Only the transaction op — no points op without related habits.
    expect(opsForPath(batch, `${householdPath}/transactions/tx1`)).toHaveLength(1);
    expect(opsForPath(batch, householdPath)).toHaveLength(0);
  });
});

// ===========================================================================
// VERIFIED-ONLY BALANCE MODEL (Plan 015 — "Option A").
//
// Invariant: the checking balance reflects a transaction's category-aware impact
// (income +amount / expense −amount) IF AND ONLY IF the transaction is
// `verified`. A pending_review transaction never touches the balance; on a
// pending→verified transition the impact is applied, on verified→pending it is
// reversed, and each transaction's impact lands on the balance exactly once over
// its lifetime while verified. The calculator's pendingSpend term covers pending
// spend, so debiting the balance for a pending capture would double-count it.
//
// These tests drive the real mutations through the captured-batch harness and
// assert exactly when (and by how much) the checking account is written.
// ===========================================================================
describe('FirebaseHouseholdContext — verified-only balance (Plan 015)', () => {
  const checking: Account = {
    id: 'acc1', name: 'Checking', type: 'checking', balance: 100000,
    lastUpdated: new Date().toISOString(),
  } as Account;

  // Seed the checking account + (optionally) some transactions, plus a household
  // doc so the transactions listener un-gates (loadedHouseholdId === householdId).
  function seed(transactions: Transaction[] = []) {
    emitCollection(`${householdPath}/accounts`, [docSnap('acc1', checking)]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    if (transactions.length > 0) {
      emitCollection(
        `${householdPath}/transactions`,
        transactions.map(t => docSnap(t.id, t)),
      );
    }
  }

  const baseTx = (overrides: Partial<Transaction>): Transaction => ({
    id: 'tx1',
    amount: 2500,
    merchant: 'Coffee',
    category: 'Dining',
    date: '2026-06-10',
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  } as Transaction);

  function accountOps(batch: CapturedBatch) {
    return opsForPath(batch, `${householdPath}/accounts/acc1`);
  }

  describe('addTransaction', () => {
    it('does NOT touch the checking balance for a pending_review expense (no double-count with pendingSpend)', async () => {
      renderProvider();
      seed();

      await act(async () => {
        await captured.value!.finance.addTransaction({
          amount: 2500, merchant: 'Coffee', category: 'Dining', date: '2026-06-10',
          status: 'pending_review', isRecurring: false, source: 'manual', autoCategorized: false,
        });
      });

      // One batch: the txn doc is written, but NO account op (pending => no debit).
      expect(batches).toHaveLength(1);
      const batch = batches[0]!;
      expect(batch.committed).toBe(true);
      const txSets = batch.ops.filter(
        o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
      );
      expect(txSets).toHaveLength(1);
      expect(txSets[0]!.data).toMatchObject({ status: 'pending_review', amount: 2500 });
      expect(accountOps(batch)).toHaveLength(0);
    });

    it('debits the checking balance −amount for a verified expense (preserved behavior), atomically', async () => {
      renderProvider();
      seed();

      await act(async () => {
        await captured.value!.finance.addTransaction({
          amount: 2500, merchant: 'Coffee', category: 'Dining', date: '2026-06-10',
          status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false,
        });
      });

      expect(batches).toHaveLength(1);
      const batch = batches[0]!;
      expect(batch.committed).toBe(true);
      // Txn doc + checking debit live in the SAME batch (atomic).
      const txSets = batch.ops.filter(
        o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
      );
      expect(txSets).toHaveLength(1);
      const accOps = accountOps(batch);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -2500 });
    });

    it('credits the checking balance +amount for a verified income transaction', async () => {
      renderProvider();
      seed();

      await act(async () => {
        await captured.value!.finance.addTransaction({
          amount: 5000, merchant: 'Paycheck', category: 'Income', date: '2026-06-10',
          status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false,
        });
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: 5000 });
    });
  });

  describe('updateTransactionCategory (the verify action)', () => {
    it('promoting a pending_review expense → verified debits checking −amount in the SAME batch', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'pending_review' })]);

      await act(async () => {
        await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries');
      });

      expect(batches).toHaveLength(1);
      const batch = batches[0]!;
      expect(batch.committed).toBe(true);
      // The transaction is verified + recategorized...
      const txOps = opsForPath(batch, `${householdPath}/transactions/tx1`);
      expect(txOps).toHaveLength(1);
      expect(txOps[0]!.data).toMatchObject({ category: 'Groceries', status: 'verified' });
      // ...and the checking debit lands in the SAME batch.
      const accOps = accountOps(batch);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -2500 });
    });

    it('still co-commits habit + points writes alongside the balance debit (one batch)', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'pending_review' })]);
      emitCollection(`${householdPath}/habits`, [
        docSnap('hb1', baseHabit({ id: 'hb1', completedDates: [], count: 0 })),
      ]);

      await act(async () => {
        await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries', ['hb1']);
      });

      expect(batches).toHaveLength(1);
      const batch = batches[0]!;
      // transaction + checking + habit + points, all atomic.
      expect(opsForPath(batch, `${householdPath}/transactions/tx1`)).toHaveLength(1);
      expect(accountOps(batch)).toHaveLength(1);
      expect(opsForPath(batch, `${householdPath}/habits/hb1`)).toHaveLength(1);
      expect(opsForPath(batch, householdPath)).toHaveLength(1);
      expect(opsForPath(batch, householdPath)[0]!.data!['points.total']).toEqual({ __increment: 10 });
    });

    it('verifying an already-verified expense (re-categorize, same sign) does NOT move the balance', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries');
      });

      const batch = batches[0]!;
      // Both old and new are verified expenses of the same amount => delta 0.
      expect(accountOps(batch)).toHaveLength(0);
    });

    it('verifying a pending_review INCOME transaction credits checking +amount', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 5000, category: 'Income', status: 'pending_review' })]);

      await act(async () => {
        // Keep the Income category; the status flip is what applies the impact.
        await captured.value!.finance.updateTransactionCategory('tx1', 'Income');
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: 5000 });
    });

    it('applies an amount override for a $0 needsAmount stub: debits the entered amount exactly once, in one batch', async () => {
      renderProvider();
      seed([baseTx({
        id: 'tx1', amount: 0, merchant: 'Shell', category: 'Uncategorized',
        status: 'pending_review', needsAmount: true,
      })]);

      await act(async () => {
        await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries', [], undefined, {
          amount: 4550,
          merchant: 'Shell Gas',
          date: '2026-06-12',
          clearNeedsAmount: true,
        });
      });

      expect(batches).toHaveLength(1);
      const batch = batches[0]!;
      expect(batch.committed).toBe(true);
      // The verify co-commits the inline edit (amount/merchant/date) + clears the
      // stub flag in the SAME transaction op.
      const txOps = opsForPath(batch, `${householdPath}/transactions/tx1`);
      expect(txOps).toHaveLength(1);
      expect(txOps[0]!.data).toMatchObject({
        category: 'Groceries',
        status: 'verified',
        amount: 4550,
        merchant: 'Shell Gas',
        date: '2026-06-12',
        needsAmount: false,
      });
      // The stub's stored amount was 0 (reverse 0), so the checking debit is the
      // entered amount, applied exactly once.
      const accOps = accountOps(batch);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -4550 });
    });

    it('explicit account clear (null): removes the accountId tag and routes the impact to checking', async () => {
      renderProvider();
      // Two accounts: checking (the fallback) + savings (the current tag).
      emitCollection(`${householdPath}/accounts`, [
        docSnap('acc1', checking),
        docSnap('acc2', {
          id: 'acc2', name: 'Savings', type: 'savings', balance: 50000,
          lastUpdated: new Date().toISOString(),
        } as Account),
      ]);
      emitDoc(householdPath, HOUSEHOLD_ID, {
        memberUids: ['user1'],
        points: { daily: 0, weekly: 0, total: 0 },
      });
      emitCollection(`${householdPath}/members`, [
        docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
      ]);
      emitCollection(`${householdPath}/transactions`, [
        docSnap('tx1', baseTx({
          id: 'tx1', amount: 2500, category: 'Dining',
          status: 'pending_review', accountId: 'acc2',
        })),
      ]);

      await act(async () => {
        // `null` = explicit clear of the savings tag.
        await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries', [], null);
      });

      const batch = batches[0]!;
      const txOps = opsForPath(batch, `${householdPath}/transactions/tx1`);
      expect(txOps).toHaveLength(1);
      expect(txOps[0]!.data).toMatchObject({ category: 'Groceries', status: 'verified' });
      // The stored tag is removed via deleteField() (mocked to '__deleteField').
      expect(txOps[0]!.data!['accountId']).toBe('__deleteField');
      // The verify impact lands on checking (the fallback), not savings.
      const accOps = accountOps(batch);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -2500 });
      // Savings (the old tag) is not written — a pending row's reverse delta is 0.
      expect(opsForPath(batch, `${householdPath}/accounts/acc2`)).toHaveLength(0);
    });
  });

  describe('updateTransaction', () => {
    it('changing a pending_review txn amount does NOT move the balance', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'pending_review' })]);

      await act(async () => {
        await captured.value!.finance.updateTransaction('tx1', { amount: 4000 });
      });

      const batch = batches[0]!;
      expect(opsForPath(batch, `${householdPath}/transactions/tx1`)).toHaveLength(1);
      // pending stays pending => effectiveImpact 0 before AND after => no debit.
      expect(accountOps(batch)).toHaveLength(0);
    });

    it('flipping pending_review → verified via updateTransaction applies the full impact', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'pending_review' })]);

      await act(async () => {
        await captured.value!.finance.updateTransaction('tx1', { status: 'verified' });
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -2500 });
    });

    it('flipping verified → pending_review via updateTransaction reverses the impact', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.updateTransaction('tx1', { status: 'pending_review' });
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      // Reversing a −2500 expense impact credits +2500 back.
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: 2500 });
    });

    it('changing a verified txn amount moves the balance by the impact delta', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.updateTransaction('tx1', { amount: 4000 });
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      // newImpact (−4000) − oldImpact (−2500) = −1500.
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -1500 });
    });

    it('recategorizing a verified expense → Income flips the sign (credit twice the amount)', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.updateTransaction('tx1', { category: 'Income' });
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      // newImpact (+2500 income) − oldImpact (−2500 expense) = +5000.
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: 5000 });
    });
  });

  describe('deleteTransaction', () => {
    it('deleting a pending_review txn does NOT move the balance', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'pending_review' })]);

      await act(async () => {
        await captured.value!.finance.deleteTransaction('tx1');
      });

      const batch = batches[0]!;
      // The txn is deleted, but a pending row never debited => no balance restore.
      expect(batch.ops.some(o => o.kind === 'delete' && o.path === `${householdPath}/transactions/tx1`)).toBe(true);
      expect(accountOps(batch)).toHaveLength(0);
    });

    it('deleting a verified expense reverses its impact (credit back +amount)', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 2500, category: 'Dining', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.deleteTransaction('tx1');
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: 2500 });
    });

    it('deleting a verified income transaction reverses its credit (debit back −amount)', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 5000, category: 'Income', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.deleteTransaction('tx1');
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -5000 });
    });
  });

  describe('splitTransaction', () => {
    it('splitting a VERIFIED expense into verified expenses (same total) does not move the balance', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 10000, category: 'Dining', status: 'verified' })]);

      await act(async () => {
        await captured.value!.finance.splitTransaction('tx1', [
          { amount: 6000, merchant: 'A', category: 'Dining', date: '2026-06-10', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
          { amount: 4000, merchant: 'B', category: 'Groceries', date: '2026-06-10', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
        ]);
      });

      const batch = batches[0]!;
      // Σ split impact (−10000) − original impact (−10000) = 0 => no balance op.
      expect(accountOps(batch)).toHaveLength(0);
    });

    it('splitting a PENDING_REVIEW capture into verified expenses now debits the new total', async () => {
      renderProvider();
      seed([baseTx({ id: 'tx1', amount: 10000, category: 'Dining', status: 'pending_review' })]);

      await act(async () => {
        await captured.value!.finance.splitTransaction('tx1', [
          { amount: 6000, merchant: 'A', category: 'Dining', date: '2026-06-10', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
          { amount: 4000, merchant: 'B', category: 'Groceries', date: '2026-06-10', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
        ]);
      });

      const accOps = accountOps(batches[0]!);
      expect(accOps).toHaveLength(1);
      // Σ split impact (−10000) − original (pending, 0) = −10000.
      expect(accOps[0]!.data!['balance']).toEqual({ __increment: -10000 });
    });
  });
});

describe('FirebaseHouseholdContext — payCalendarItem atomicity', () => {
  it('commits the paid calendar item, account balance, and new transaction in ONE batch', async () => {
    renderProvider();

    // Seed account + a one-time (non-recurring) unpaid expense.
    const account: Account = {
      id: 'acc1',
      name: 'Checking',
      type: 'checking',
      balance: 100000,
      lastUpdated: new Date().toISOString(),
    } as Account;
    emitCollection(`${householdPath}/accounts`, [docSnap('acc1', account)]);

    const item: CalendarItem = {
      id: 'cal1',
      title: 'Electric Bill',
      amount: 5000,
      date: format(new Date(), 'yyyy-MM-dd'),
      type: 'expense',
      isPaid: false,
      isRecurring: false,
    } as CalendarItem;
    emitCollection(`${householdPath}/calendarItems`, [docSnap('cal1', item)]);

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal1', 'acc1');
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    // 1) calendar item marked paid
    const calOps = opsForPath(batch, `${householdPath}/calendarItems/cal1`);
    expect(calOps).toHaveLength(1);
    expect(calOps[0]!.kind).toBe('update');
    expect(calOps[0]!.data).toMatchObject({ isPaid: true });

    // 2) account balance decremented by the expense amount
    const accOps = opsForPath(batch, `${householdPath}/accounts/acc1`);
    expect(accOps).toHaveLength(1);
    expect(accOps[0]!.data!['balance']).toEqual({ __increment: -5000 });

    // 3) a new transaction created in the SAME batch (auto-allocated id)
    const txSets = batch.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`)
    );
    expect(txSets).toHaveLength(1);
    expect(txSets[0]!.data).toMatchObject({
      amount: 5000,
      merchant: 'Electric Bill',
      status: 'verified',
    });
  });
});

describe('FirebaseHouseholdContext — useFreezeBankToken atomicity', () => {
  it('patches the habit, spends a token, and credits points in ONE batch', async () => {
    renderProvider();

    // Seed a positive daily habit and a freeze bank with a token, then patch a
    // PAST day (freeze tokens only apply to missed past days).
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', type: 'positive', completedDates: [] })),
    ]);

    const freezeBank: FreezeBank = {
      tokens: 2,
      maxTokens: 3,
      lastRolloverDate: format(new Date(), 'yyyy-MM-dd'),
      lastRolloverMonth: format(new Date(), 'yyyy-MM'),
      history: [],
    };
    // Household doc listener seeds householdSettings + freezeBank.
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank,
    });

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', yesterday);
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    // 1) habit gets the patched completion + recomputed streak
    const habitOps = opsForPath(batch, `${householdPath}/habits/hb1`);
    expect(habitOps).toHaveLength(1);
    expect(habitOps[0]!.data!['completedDates']).toEqual([yesterday]);

    // 2) the SAME batch decrements the token (freezeBank.tokens -> 1) and credits
    //    the patched day's points. Both live on the household doc op.
    const hhOps = opsForPath(batch, householdPath);
    expect(hhOps).toHaveLength(1);
    const hhData = hhOps[0]!.data!;
    const writtenBank = hhData['freezeBank'] as FreezeBank;
    expect(writtenBank.tokens).toBe(1);
    expect(writtenBank.history).toHaveLength(1);
    // total points always credited; never points.daily for a past day.
    expect(hhData['points.total']).toEqual({ __increment: 10 });
    expect(hhData['points.daily']).toBeUndefined();
    // weekly is credited iff yesterday falls within the current ISO week (Mon-anchored).
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (yesterday >= weekStart) {
      expect(hhData['points.weekly']).toEqual({ __increment: 10 });
    } else {
      expect(hhData['points.weekly']).toBeUndefined();
    }
  });

  it('does nothing (no batch) when there are no freeze tokens', async () => {
    renderProvider();
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', type: 'positive', completedDates: [] })),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank: {
        tokens: 0,
        maxTokens: 3,
        lastRolloverDate: format(new Date(), 'yyyy-MM-dd'),
        lastRolloverMonth: format(new Date(), 'yyyy-MM'),
        history: [],
      } satisfies FreezeBank,
    });

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', yesterday);
    });

    // No token => the mutation bails before opening a batch.
    expect(batches).toHaveLength(0);
  });
});

describe('FirebaseHouseholdContext — habit+points toggle atomicity', () => {
  it('toggleHabit writes the habit and points in a single committed batch', async () => {
    renderProvider();
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', completedDates: [], count: 0 })),
    ]);
    // householdSettings must be present for toggleHabit to proceed.
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });

    await act(async () => {
      await captured.value!.gamification.toggleHabit('hb1', 'up');
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);
    expect(opsForPath(batch, `${householdPath}/habits/hb1`)).toHaveLength(1);
    const hhOps = opsForPath(batch, householdPath);
    expect(hhOps).toHaveLength(1);
    expect(hhOps[0]!.data!['points.total']).toEqual({ __increment: 10 });
  });
});

describe('FirebaseHouseholdContext — reward CRUD (Plan 080d)', () => {
  it('addReward writes to the rewards subcollection with createdBy = current user', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.addReward({
        title: 'Movie Night',
        cost: 50,
        icon: '🎬',
        type: 'realWorld',
        active: true,
      });
    });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [collRef, data] = addDocMock.mock.calls[0]!;
    expect(pathOf(collRef)).toBe(`${householdPath}/rewards`);
    expect(data).toMatchObject({
      title: 'Movie Night',
      cost: 50,
      icon: '🎬',
      type: 'realWorld',
      active: true,
      createdBy: AUTH_USER.uid,
    });
  });

  it('addReward forwards the allowance fields for allowance-type rewards', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.addReward({
        title: '$5 Allowance',
        cost: 100,
        icon: '💵',
        type: 'allowance',
        allowanceCents: 500,
        targetMemberId: 'kid_leo',
        active: true,
      });
    });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [, data] = addDocMock.mock.calls[0]!;
    expect(data).toMatchObject({
      type: 'allowance',
      allowanceCents: 500,
      targetMemberId: 'kid_leo',
      createdBy: AUTH_USER.uid,
    });
  });

  it('updateReward writes to the reward doc and strips id + immutable createdBy', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.updateReward({
        id: 'rw1',
        title: 'Movie Night Deluxe',
        cost: 75,
        icon: '🎬',
        createdBy: 'someone-else',
        type: 'realWorld',
        active: false,
      });
    });

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [ref, updates] = updateDocMock.mock.calls[0]!;
    expect(pathOf(ref)).toBe(`${householdPath}/rewards/rw1`);
    // createdBy and id must NOT be in the update payload (immutable / synthetic).
    expect(updates).not.toHaveProperty('createdBy');
    expect(updates).not.toHaveProperty('id');
    expect(updates).toMatchObject({
      title: 'Movie Night Deluxe',
      cost: 75,
      active: false,
    });
    // A realWorld reward with no target clears both optional fields rather than
    // leaving them stale: the mocked deleteField() returns the '__deleteField'
    // sentinel (see the firebase/firestore vi.mock above).
    expect(updates).toMatchObject({
      allowanceCents: '__deleteField',
      targetMemberId: '__deleteField',
    });
  });

  it('updateReward switching allowance → realWorld issues deleteField() for allowanceCents', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.updateReward({
        id: 'rw1',
        title: 'Used To Be Allowance',
        cost: 100,
        icon: '🎁',
        createdBy: 'u1',
        type: 'realWorld', // switched away from 'allowance'
        allowanceCents: 500, // stale value on the incoming object — must NOT be written
        active: true,
      });
    });

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, updates] = updateDocMock.mock.calls[0]!;
    // allowanceCents must be removed (deleteField sentinel), not carried over.
    expect(updates).toMatchObject({
      type: 'realWorld',
      allowanceCents: '__deleteField',
    });
    expect(updates).not.toMatchObject({ allowanceCents: 500 });
  });

  it('updateReward writes the numeric allowanceCents and target for an allowance reward', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.updateReward({
        id: 'rw2',
        title: '$5 Allowance',
        cost: 100,
        icon: '💵',
        createdBy: 'u1',
        type: 'allowance',
        allowanceCents: 500,
        targetMemberId: 'kid_leo',
        active: true,
      });
    });

    const [, updates] = updateDocMock.mock.calls[0]!;
    expect(updates).toMatchObject({
      type: 'allowance',
      allowanceCents: 500,
      targetMemberId: 'kid_leo',
    });
  });

  it('deleteReward deletes the reward doc by id', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.deleteReward('rw1');
    });

    expect(deleteDocMock).toHaveBeenCalledTimes(1);
    const [ref] = deleteDocMock.mock.calls[0]!;
    expect(pathOf(ref)).toBe(`${householdPath}/rewards/rw1`);
  });
});

describe('FirebaseHouseholdContext — addChallenge (Plan 080e family challenges)', () => {
  it('creates a challenge in the challenges subcollection, decoupled from yearly goals', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.addChallenge({
        title: 'Family Fitness Month',
        description: 'Everyone moves every day',
        relatedHabitIds: ['hb1', 'hb2'],
        targetValue: 60,
      });
    });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [collRef, data] = addDocMock.mock.calls[0]!;
    expect(pathOf(collRef)).toBe(`${householdPath}/challenges`);
    expect(data).toMatchObject({
      title: 'Family Fitness Month',
      description: 'Everyone moves every day',
      relatedHabitIds: ['hb1', 'hb2'],
      targetType: 'count',
      targetValue: 60,
      status: 'active',
      createdBy: AUTH_USER.uid,
    });
    // Decoupled from yearly goals: NO yearlyGoalId is written.
    expect(data).not.toHaveProperty('yearlyGoalId');
    // Rules-safe: a non-empty yearlyRewardLabel is present (the existing
    // /challenges create rule requires it) and createdAt is an ISO string, not a
    // serverTimestamp sentinel.
    expect(typeof (data as Record<string, unknown>).yearlyRewardLabel).toBe('string');
    expect(((data as Record<string, unknown>).yearlyRewardLabel as string).length).toBeGreaterThan(0);
    expect(typeof (data as Record<string, unknown>).createdAt).toBe('string');
    // isFamilyChallenge is intentionally NOT persisted (not in the firestore.rules
    // allowlist) — the kid surfaces key off the active challenge, not the flag.
    expect(data).not.toHaveProperty('isFamilyChallenge');
  });

  it('omits an undefined description and a non-positive target from the write', async () => {
    renderProvider();

    await act(async () => {
      await captured.value!.gamification.addChallenge({
        title: 'No Frills',
        relatedHabitIds: [],
        // no description, no targetValue
      });
    });

    const [, data] = addDocMock.mock.calls[0]!;
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('targetValue');
    expect(data).toMatchObject({ title: 'No Frills', status: 'active', relatedHabitIds: [] });
  });
});

describe('FirebaseHouseholdContext — addKidProfile cap enforcement (Plan 080e)', () => {
  // Seed the parent + `managedKidCount` managed-kid members so addKidProfile's
  // membersRef.current.filter(isManaged) sees a real count, plus a household doc so
  // householdSettings is non-null. No `subscription` => free plan (maxKidProfiles 2).
  function seedHousehold(managedKidCount: number) {
    const members = [
      // The acting parent — NOT managed, so it never counts toward the kid cap.
      docSnap('user1', {
        uid: 'user1',
        displayName: 'Tester',
        role: 'admin',
        points: { daily: 0, weekly: 0, total: 0 },
      }),
      ...Array.from({ length: managedKidCount }, (_, i) =>
        docSnap(`kid_${i}`, {
          uid: `kid_${i}`,
          displayName: `Kid ${i}`,
          role: 'kid',
          isManaged: true,
          managedByUid: 'user1',
          points: { daily: 0, weekly: 0, total: 0 },
          allowanceCents: 0,
        }),
      ),
    ];
    emitCollection(`${householdPath}/members`, members);
    // Household doc => householdSettings non-null, free plan (no subscription block).
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
  }

  it('blocks the add and writes nothing when billing is ON and the free kid cap (2) is reached', async () => {
    getBillingEnabledMock.mockResolvedValueOnce(true);
    renderProvider();
    // Free plan caps managed kids at 2; seed exactly 2 so the household is AT the cap.
    seedHousehold(2);

    await act(async () => {
      await expect(
        captured.value!.core.addKidProfile({ displayName: 'Third Kid' }),
      ).rejects.toThrow(/limit reached/i);
    });

    // The members-subcollection write must NOT happen when the cap blocks the add.
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('proceeds (one members write) when billing is ON but the household is under the cap', async () => {
    getBillingEnabledMock.mockResolvedValueOnce(true);
    renderProvider();
    // Only 1 managed kid => under the free cap of 2, so the add is allowed.
    seedHousehold(1);

    await act(async () => {
      await captured.value!.core.addKidProfile({ displayName: 'Second Kid' });
    });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, data] = setDocMock.mock.calls[0]!;
    // Written to the members subcollection as a managed kid (login-less kid id).
    expect(pathOf(ref)).toMatch(new RegExp(`^${householdPath}/members/kid_`));
    expect(data).toMatchObject({
      displayName: 'Second Kid',
      role: 'kid',
      isManaged: true,
      managedByUid: AUTH_USER.uid,
    });
  });

  it('skips the cap entirely (DORMANT) when billing is OFF, even with many managed kids', async () => {
    // Default getBillingEnabled => false (see beforeEach). With billing dormant the
    // count is never checked, so an over-cap household can still add a kid — the
    // pre-080e behaviour, preserved (Plan 080 Principle 6: gate the count, not the
    // mechanics).
    renderProvider();
    seedHousehold(5); // well over the free cap of 2

    await act(async () => {
      await captured.value!.core.addKidProfile({ displayName: 'Another Kid' });
    });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [, data] = setDocMock.mock.calls[0]!;
    expect(data).toMatchObject({ displayName: 'Another Kid', isManaged: true });
  });
});

describe('FirebaseHouseholdContext — cross-mutation invariant', () => {
  it('every committed batch performs all of its writes atomically (one commit each)', async () => {
    // A meta-assertion: after exercising the multi-doc mutations, every batch we
    // created was committed exactly once and never left dangling — the property
    // that guarantees the documents can never diverge.
    renderProvider();
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', completedDates: [], count: 0 })),
    ]);
    // Un-gate the transactions listener + seed the tx1 row updateTransactionCategory
    // now requires (already-`verified` expense => zero balance delta, no accounts op).
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/transactions`, [
      docSnap('tx1', { amount: 2500, category: 'Dining', status: 'verified' }),
    ]);

    await act(async () => {
      await captured.value!.finance.updateTransactionCategory('tx1', 'Groceries', ['hb1']);
    });

    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      expect(batch.committed).toBe(true);
      expect(batch.ops.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// §1 — writeBatch COMMIT-REJECTION / rollback.
// The happy-path tests above prove every multi-doc mutation puts all of its
// writes in ONE batch. These prove the *atomicity guarantee against the failure
// it exists to prevent*: when commit() REJECTS, no write is applied outside the
// (failed) batch. The only write path for each of these mutations is the batch
// itself, so a rejected commit means nothing landed. We assert:
//   (a) the mutation's promise rejects (or swallows-and-returns, per its
//       contract — toggleHabit/useFreezeBankToken/updateTransactionCategory
//       re-throw; payCalendarItem/addMember re-throw after a toast),
//   (b) the batch was NOT marked committed, and
//   (c) NO single-doc write API (updateDoc/setDoc/addDoc/deleteDoc) was called —
//       i.e. nothing leaked outside the atomic batch.
// ===========================================================================
describe('FirebaseHouseholdContext — batch commit REJECTION (atomic rollback)', () => {
  // Shared assertion: no out-of-batch single-doc write happened, and the batch
  // never reached committed=true.
  function expectNoPartialWrite() {
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
    expect(addDocMock).not.toHaveBeenCalled();
    expect(deleteDocMock).not.toHaveBeenCalled();
    // Whatever batch was opened must NOT be marked committed.
    for (const b of batches) {
      expect(b.committed).toBe(false);
    }
  }

  it('toggleHabit: a rejected commit propagates and writes nothing outside the batch', async () => {
    renderProvider();
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', completedDates: [], count: 0 })),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });

    commitController.failNextCommit = true;
    await act(async () => {
      await expect(captured.value!.gamification.toggleHabit('hb1', 'up')).rejects.toThrow(
        'commit rejected',
      );
    });

    // Exactly one batch was opened (the toggle's), and it failed.
    expect(batches).toHaveLength(1);
    expectNoPartialWrite();
  });

  it('payCalendarItem: a rejected commit re-throws and applies no partial write', async () => {
    renderProvider();
    const account: Account = {
      id: 'acc1', name: 'Checking', type: 'checking', balance: 100000,
      lastUpdated: new Date().toISOString(),
    } as Account;
    emitCollection(`${householdPath}/accounts`, [docSnap('acc1', account)]);
    const item: CalendarItem = {
      id: 'cal1', title: 'Electric Bill', amount: 5000,
      date: format(new Date(), 'yyyy-MM-dd'), type: 'expense', isPaid: false, isRecurring: false,
    } as CalendarItem;
    emitCollection(`${householdPath}/calendarItems`, [docSnap('cal1', item)]);

    commitController.failNextCommit = true;
    await act(async () => {
      await expect(captured.value!.finance.payCalendarItem('cal1', 'acc1')).rejects.toThrow(
        'commit rejected',
      );
    });

    // The one expense pay-batch failed; calendar item is NOT marked paid, the
    // account balance is NOT moved, and the transaction is NOT created, because
    // all three writes only existed inside the failed batch.
    expect(batches).toHaveLength(1);
    expectNoPartialWrite();
  });

  it('useFreezeBankToken: a rejected commit propagates; no token spent / day patched outside the batch', async () => {
    renderProvider();
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', type: 'positive', completedDates: [] })),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank: {
        tokens: 2, maxTokens: 3,
        lastRolloverDate: format(new Date(), 'yyyy-MM-dd'),
        lastRolloverMonth: format(new Date(), 'yyyy-MM'),
        history: [],
      } satisfies FreezeBank,
    });

    commitController.failNextCommit = true;
    await act(async () => {
      await expect(
        captured.value!.gamification.useFreezeBankToken('hb1', yesterday),
      ).rejects.toThrow('commit rejected');
    });

    expect(batches).toHaveLength(1);
    expectNoPartialWrite();
  });

  it('updateTransactionCategory: a rejected commit propagates; transaction/habit/points untouched outside the batch', async () => {
    renderProvider();
    emitCollection(`${householdPath}/members`, [
      docSnap('user1', { uid: 'user1', points: { daily: 0, weekly: 0, total: 0 } }),
    ]);
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', completedDates: [], count: 0 })),
    ]);
    // Un-gate the transactions listener + seed the tx1 row the verify path now
    // requires. Seeded as an already-`verified` expense so re-categorising yields
    // a zero balance delta (no accounts op), keeping this the single failed batch
    // expectNoPartialWrite()/toHaveLength(1) assert against. Seeding only drives
    // onSnapshot callbacks — it does not call the single-doc write mocks.
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/transactions`, [
      docSnap('tx1', { amount: 2500, category: 'Dining', status: 'verified' }),
    ]);

    commitController.failNextCommit = true;
    await act(async () => {
      await expect(
        captured.value!.finance.updateTransactionCategory('tx1', 'Groceries', ['hb1']),
      ).rejects.toThrow('commit rejected');
    });

    expect(batches).toHaveLength(1);
    expectNoPartialWrite();
  });

  it('addMember: a rejected commit re-throws; member doc + memberUids never partially applied', async () => {
    renderProvider();
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });

    commitController.failNextCommit = true;
    await act(async () => {
      await expect(
        captured.value!.core.addMember({ displayName: 'New Member', email: 'n@e.com' }),
      ).rejects.toThrow('commit rejected');
    });

    // The member set() and the memberUids update() lived only in the failed batch.
    expect(batches).toHaveLength(1);
    expectNoPartialWrite();
  });
});

// ===========================================================================
// §2 — Paycheck approval + period rollover.
// handlePaycheckApproval / resetBucketsForNewPeriod / initializeFirstPeriod are
// NOT on the public context value — they're reached only via payCalendarItem
// with an `income` calendar item (which calls handlePaycheckApproval before its
// own expense-style batch). currentPeriodId is derived from
// householdSettings.lastPaycheckDate, so seeding the household doc with (or
// without) lastPaycheckDate selects the rollover branch vs. the first-period
// branch.
// ===========================================================================
describe('FirebaseHouseholdContext — paycheck approval / period rollover', () => {
  const account: Account = {
    id: 'acc1', name: 'Checking', type: 'checking', balance: 100000,
    lastUpdated: new Date().toISOString(),
  } as Account;

  const bucket = (id: string, name: string, limit: number): BudgetBucket => ({
    id, name, limit, color: 'blue', isVariable: false, isCore: true,
  } as BudgetBucket);

  function seedBucketsAndAccount(buckets: BudgetBucket[]) {
    emitCollection(`${householdPath}/accounts`, [docSnap('acc1', account)]);
    emitCollection(
      `${householdPath}/buckets`,
      buckets.map(b => docSnap(b.id, b)),
    );
  }

  function incomeItem(id: string, date: string): CalendarItem {
    return {
      id, title: 'Paycheck', amount: 200000, date, type: 'income',
      isPaid: false, isRecurring: false,
    } as CalendarItem;
  }

  it('rollover branch: snapshots + per-bucket currentPeriodId + lastPaycheckDate land in ONE batch', async () => {
    renderProvider();
    seedBucketsAndAccount([bucket('b1', 'Groceries', 50000), bucket('b2', 'Gas', 20000)]);
    // OLD period present => currentPeriodId is non-empty => rollover branch.
    const oldPeriod = '2026-06-01';
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      lastPaycheckDate: oldPeriod,
    });
    emitCollection(`${householdPath}/calendarItems`, [docSnap('cal_income', incomeItem('cal_income', '2026-06-15'))]);

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal_income', 'acc1');
    });

    // Two batches total: [0] = resetBucketsForNewPeriod (the rollover), [1] =
    // payCalendarItem's own income batch (calendar item + balance + transaction).
    expect(batches.length).toBe(2);
    const resetBatch = batches[0]!;
    expect(resetBatch.committed).toBe(true);

    const newPeriod = '2026-06-15';
    const periodEnd = '2026-06-14'; // newPeriodId − 1 day

    // One bucketHistory snapshot per bucket, all in the reset batch.
    const snapshotSets = resetBatch.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/bucketHistory`),
    );
    expect(snapshotSets).toHaveLength(2);
    for (const snap of snapshotSets) {
      expect(snap.data).toMatchObject({
        periodId: oldPeriod,
        periodStartDate: oldPeriod,
        periodEndDate: periodEnd,
      });
    }

    // Each bucket's currentPeriodId advances to the new period, in the SAME batch.
    const b1Ops = opsForPath(resetBatch, `${householdPath}/buckets/b1`);
    const b2Ops = opsForPath(resetBatch, `${householdPath}/buckets/b2`);
    expect(b1Ops).toHaveLength(1);
    expect(b2Ops).toHaveLength(1);
    expect(b1Ops[0]!.data).toMatchObject({ currentPeriodId: newPeriod, lastResetDate: oldPeriod });
    expect(b2Ops[0]!.data).toMatchObject({ currentPeriodId: newPeriod, lastResetDate: oldPeriod });

    // The household lastPaycheckDate advance is in the SAME reset batch.
    const hhOps = opsForPath(resetBatch, householdPath);
    expect(hhOps).toHaveLength(1);
    expect(hhOps[0]!.data).toMatchObject({ lastPaycheckDate: newPeriod });

    // The opening paycheck transaction is filed under the NEW period it opens
    // (the period that was just created), NOT the period that just closed —
    // payCalendarItem derives the income period from the just-approved date, not
    // the stale closure-captured householdSettings.lastPaycheckDate.
    const payBatch = batches[1]!;
    const txSets = payBatch.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
    );
    expect(txSets).toHaveLength(1);
    expect(txSets[0]!.data).toMatchObject({ payPeriodId: newPeriod });
    expect(txSets[0]!.data!['payPeriodId']).not.toBe(oldPeriod);
  });

  it('first-period branch: no prior period → initializeFirstPeriod sets lastPaycheckDate + each bucket, no snapshots', async () => {
    renderProvider();
    seedBucketsAndAccount([bucket('b1', 'Groceries', 50000)]);
    // NO lastPaycheckDate => currentPeriodId === '' => first-period branch.
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/calendarItems`, [docSnap('cal_income', incomeItem('cal_income', '2026-06-15'))]);

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal_income', 'acc1');
    });

    expect(batches.length).toBe(2);
    const initBatch = batches[0]!;
    expect(initBatch.committed).toBe(true);

    const paycheckDate = '2026-06-15';

    // First-period init writes the household lastPaycheckDate...
    const hhOps = opsForPath(initBatch, householdPath);
    expect(hhOps).toHaveLength(1);
    expect(hhOps[0]!.data).toMatchObject({ lastPaycheckDate: paycheckDate });

    // ...and seeds each bucket's currentPeriodId to the paycheck date...
    const b1Ops = opsForPath(initBatch, `${householdPath}/buckets/b1`);
    expect(b1Ops).toHaveLength(1);
    expect(b1Ops[0]!.data).toMatchObject({
      currentPeriodId: paycheckDate,
      lastResetDate: paycheckDate,
    });

    // ...but creates NO bucketHistory snapshots (nothing to close on the first period).
    const snapshotSets = initBatch.ops.filter(
      o => o.path.startsWith(`${householdPath}/bucketHistory`),
    );
    expect(snapshotSets).toHaveLength(0);
  });
});

// ===========================================================================
// §3 — reallocateBucket: a valid move lands the two limit changes in one batch
// (source increment(-amount), dest increment(+amount)). Input is validated first
// (PR #733): source!==target, a positive finite amount, and amount <= the
// source's limit — an invalid amount is rejected with a toast and NO write.
// ===========================================================================
describe('FirebaseHouseholdContext — reallocateBucket', () => {
  const bucket = (id: string, name: string, limit: number): BudgetBucket => ({
    id, name, limit, color: 'blue', isVariable: false, isCore: true,
  } as BudgetBucket);

  function seedTwoBuckets() {
    emitCollection(`${householdPath}/buckets`, [
      docSnap('src', bucket('src', 'Groceries', 50000)),
      docSnap('dst', bucket('dst', 'Gas', 20000)),
    ]);
  }

  it('debits the source and credits the destination via increment() in ONE batch', async () => {
    renderProvider();
    seedTwoBuckets();

    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'dst', 10000);
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    const srcOps = opsForPath(batch, `${householdPath}/buckets/src`);
    const dstOps = opsForPath(batch, `${householdPath}/buckets/dst`);
    expect(srcOps).toHaveLength(1);
    expect(dstOps).toHaveLength(1);
    // Mirror-image increments: source −amount, destination +amount.
    expect(srcOps[0]!.data!['limit']).toEqual({ __increment: -10000 });
    expect(dstOps[0]!.data!['limit']).toEqual({ __increment: 10000 });
  });

  it('allows moving the full source limit (boundary)', async () => {
    renderProvider();
    seedTwoBuckets();

    // Source limit is 50000; moving exactly that is allowed (source ends at 0).
    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'dst', 50000);
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);
    expect(opsForPath(batch, `${householdPath}/buckets/src`)[0]!.data!['limit'])
      .toEqual({ __increment: -50000 });
    expect(opsForPath(batch, `${householdPath}/buckets/dst`)[0]!.data!['limit'])
      .toEqual({ __increment: 50000 });
  });

  // Sub-cent input / float drift is rounded to whole cents before writing, so no
  // fractional cents land in the stored limit (roundMoney(1.005) === 1.01).
  it('rounds a sub-cent amount to whole cents before writing', async () => {
    renderProvider();
    seedTwoBuckets();

    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'dst', 1.005);
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(opsForPath(batch, `${householdPath}/buckets/src`)[0]!.data!['limit'])
      .toEqual({ __increment: -1.01 });
    expect(opsForPath(batch, `${householdPath}/buckets/dst`)[0]!.data!['limit'])
      .toEqual({ __increment: 1.01 });
  });

  // A negative amount would silently REVERSE the transfer — now rejected before
  // any write.
  it('rejects a negative amount without writing', async () => {
    renderProvider();
    seedTwoBuckets();

    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'dst', -5000);
    });

    expect(batches).toHaveLength(0);
  });

  it('rejects a zero amount without writing', async () => {
    renderProvider();
    seedTwoBuckets();

    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'dst', 0);
    });

    expect(batches).toHaveLength(0);
  });

  // An amount larger than the source limit would drive that limit negative — now
  // rejected before any write.
  it('rejects an amount exceeding the source limit without writing', async () => {
    renderProvider();
    seedTwoBuckets();

    // Source limit is 50000; transfer 999999 — far more than available.
    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'dst', 999999);
    });

    expect(batches).toHaveLength(0);
  });

  // source===target would collapse to a single same-doc update that fabricates
  // funds — now rejected before any write.
  it('rejects reallocating a bucket to itself without writing', async () => {
    renderProvider();
    seedTwoBuckets();

    await act(async () => {
      await captured.value!.finance.reallocateBucket('src', 'src', 10000);
    });

    expect(batches).toHaveLength(0);
  });
});

// ===========================================================================
// §7 — useFreezeBankToken weekly boundary: when targetDate is in a PRIOR week,
// the patched day's points credit points.total but NOT points.weekly (and never
// points.daily for a past day). Clock is pinned so "this week" and the 30-day
// validity window are deterministic.
// ===========================================================================
describe('FirebaseHouseholdContext — useFreezeBankToken weekly boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-06-17 (local). This week's Monday is 2026-06-15.
    vi.setSystemTime(new Date(2026, 5, 17, 12, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('credits points.total but NOT points.weekly when the patched day is in a prior week', async () => {
    renderProvider();
    // 2026-06-10 (Wed of the PRIOR week): in the past, within 30 days, before
    // this week's Monday (2026-06-15).
    const priorWeekDate = '2026-06-10';
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', type: 'positive', basePoints: 10, completedDates: [] })),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank: {
        tokens: 2, maxTokens: 3,
        lastRolloverDate: '2026-06-01',
        lastRolloverMonth: '2026-06',
        history: [],
      } satisfies FreezeBank,
    });

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', priorWeekDate);
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    const hhOps = opsForPath(batch, householdPath);
    expect(hhOps).toHaveLength(1);
    const hhData = hhOps[0]!.data!;
    // Lifetime total is always credited.
    expect(hhData['points.total']).toEqual({ __increment: 10 });
    // Prior week => weekly NOT credited; daily never for a past day.
    expect(hhData['points.weekly']).toBeUndefined();
    expect(hhData['points.daily']).toBeUndefined();
    // Token still spent + history recorded in the same batch.
    const writtenBank = hhData['freezeBank'] as FreezeBank;
    expect(writtenBank.tokens).toBe(1);
    expect(writtenBank.history).toHaveLength(1);
  });

  it('credits points.weekly when the patched day IS in the current week (control)', async () => {
    renderProvider();
    // 2026-06-16 (Tue of THIS week): past, within the current Mon-anchored week.
    const thisWeekDate = '2026-06-16';
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({ id: 'hb1', type: 'positive', basePoints: 10, completedDates: [] })),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank: {
        tokens: 2, maxTokens: 3,
        lastRolloverDate: '2026-06-01',
        lastRolloverMonth: '2026-06',
        history: [],
      } satisfies FreezeBank,
    });

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', thisWeekDate);
    });

    const hhData = opsForPath(batches[0]!, householdPath)[0]!.data!;
    expect(hhData['points.total']).toEqual({ __increment: 10 });
    expect(hhData['points.weekly']).toEqual({ __increment: 10 });
    expect(hhData['points.daily']).toBeUndefined();
  });
});

// --- Quick-stock-list move: stale-snapshot lost-update fix ----------------
//
// Reassigning a catalog item between quick-stock lists used to fire TWO
// sequential updateQuickStockList() calls in one handler invocation (add to the
// target list, remove from the source). Each rebuilt the WHOLE array from the
// same `householdSettings` snapshot captured in its closure — React state that
// only refreshes on the next onSnapshot tick — so the second full-array write
// clobbered the first, and the item could vanish from every list (data loss).
//
// The fix is a single bulk write: updateQuickStockLists(lists) persists the
// fully-computed array in ONE updateDoc. These tests lock that the bulk method
// writes the whole array atomically, and that a B→A move ends with the item in
// exactly the target list — the assertion that fails under the old two-write
// path.
describe('FirebaseHouseholdContext — updateQuickStockLists (bulk single-write)', () => {
  const listA: QuickStockList = { id: 'listA', name: 'Pantry', items: [] };
  const listB: QuickStockList = { id: 'listB', name: 'Fridge', items: ['cat1'] };

  function seedLists(lists: QuickStockList[]) {
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      quickStockLists: lists,
    });
  }

  // updateDoc's data arg is typed `string | FieldPath | {...}` by the SDK
  // overloads; the household-doc write always passes the object form. Narrow it
  // and pull out the persisted quickStockLists array.
  function persistedListsFromCall(call: typeof updateDocMock.mock.calls[number]): QuickStockList[] {
    const data = call[1] as unknown as Record<string, unknown>;
    return data['quickStockLists'] as QuickStockList[];
  }

  it('writes the ENTIRE quickStockLists array in a single updateDoc', async () => {
    renderProvider();
    seedLists([listA, listB]);

    const next: QuickStockList[] = [
      { ...listA, items: ['cat1'] },
      { ...listB, items: [] },
    ];

    await act(async () => {
      await captured.value!.shopping.updateQuickStockLists(next);
    });

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const call = updateDocMock.mock.calls[0]!;
    expect(pathOf(call[0])).toBe(householdPath);
    expect(persistedListsFromCall(call)).toEqual(next);
  });

  it('moving a catalog item from list B to list A leaves it in EXACTLY the target list, in ONE write', async () => {
    renderProvider();
    // Start: cat1 lives in B only. Move it to A.
    seedLists([listA, listB]);

    const moved: QuickStockList[] = [
      { ...listA, items: ['cat1'] }, // added to target
      { ...listB, items: [] },        // removed from source
    ];

    await act(async () => {
      await captured.value!.shopping.updateQuickStockLists(moved);
    });

    // Single write — two sequential full-array writes (the old bug) could never
    // be atomic; this method is one updateDoc by construction.
    expect(updateDocMock).toHaveBeenCalledTimes(1);

    const persisted = persistedListsFromCall(updateDocMock.mock.calls[0]!);

    const persistedA = persisted.find(l => l.id === 'listA')!;
    const persistedB = persisted.find(l => l.id === 'listB')!;

    // Regression assertion: present in the target (A), absent from the source (B).
    // Under the old two-stale-writes path the second write clobbered the first,
    // so the item could end up missing from BOTH lists — this would fail.
    expect(persistedA.items).toContain('cat1');
    expect(persistedB.items).not.toContain('cat1');
  });

  it('REGRESSION: two sequential singular writes from a stale snapshot lose the item; the bulk write does not', async () => {
    renderProvider();
    // cat1 lives in B only. Both lists are read from the SAME householdSettings
    // snapshot, which only refreshes on the next onSnapshot tick — so two awaits
    // in one handler invocation both rebuild the whole array from this base.
    seedLists([listA, listB]);

    // --- Reproduce the OLD buggy two-call sequence (add to A, then remove from B).
    // Each updateQuickStockList rebuilds the WHOLE array from the stale snapshot:
    //   write 1 → [A:{cat1}, B:{cat1}]   (added to A, B untouched in this base)
    //   write 2 → [A:{},     B:{}]       (removed from B, but A reverts to its
    //                                      stale empty state) → cat1 lost entirely.
    await act(async () => {
      await captured.value!.shopping.updateQuickStockList({ ...listA, items: ['cat1'] });
      await captured.value!.shopping.updateQuickStockList({ ...listB, items: [] });
    });

    // The second write is the one that persists; it clobbered the first.
    const buggyLists = persistedListsFromCall(updateDocMock.mock.calls[updateDocMock.mock.calls.length - 1]!);
    const buggyA = buggyLists.find(l => l.id === 'listA')!;
    const buggyB = buggyLists.find(l => l.id === 'listB')!;
    // Data loss: cat1 is gone from BOTH lists. This is exactly the bug.
    expect(buggyA.items).not.toContain('cat1');
    expect(buggyB.items).not.toContain('cat1');

    // --- The fix: one bulk write of the fully-computed array can't diverge.
    updateDocMock.mockClear();
    await act(async () => {
      await captured.value!.shopping.updateQuickStockLists([
        { ...listA, items: ['cat1'] },
        { ...listB, items: [] },
      ]);
    });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const fixedLists = persistedListsFromCall(updateDocMock.mock.calls[0]!);
    expect(fixedLists.find(l => l.id === 'listA')!.items).toContain('cat1');
    expect(fixedLists.find(l => l.id === 'listB')!.items).not.toContain('cat1');
  });

  it('rethrows when the Firestore write fails (so the caller reports failure, not success)', async () => {
    renderProvider();
    seedLists([listA, listB]);

    updateDocMock.mockRejectedValueOnce(new Error('firestore down'));

    // Must REJECT — swallowing the error would let handleQuickListChange's try
    // complete and show a success toast on a failed write (and double-toast).
    await expect(
      captured.value!.shopping.updateQuickStockLists([{ ...listA, items: ['cat1'] }, listB]),
    ).rejects.toThrow('firestore down');
  });
});

// ===========================================================================
// useFreezeBankToken — points TARGET routing. An assigned (kid) habit's points
// must land on members/{assignedTo}.points, mirroring habitPointsTargetRef in
// useHabitActions: the corrective recompute EXCLUDES assigned habits from the
// household pool, so crediting the household doc here would leave its total
// permanently inflated while the assignee is never paid for the patched day.
// ===========================================================================
describe('FirebaseHouseholdContext — useFreezeBankToken assigned-habit points routing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-06-17 (local); this week's Monday is 2026-06-15.
    vi.setSystemTime(new Date(2026, 5, 17, 12, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function seedFreezeBank(habit: Habit) {
    emitCollection(`${householdPath}/habits`, [docSnap(habit.id, habit)]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank: {
        tokens: 2, maxTokens: 3,
        lastRolloverDate: '2026-06-01',
        lastRolloverMonth: '2026-06',
        history: [],
      } satisfies FreezeBank,
    });
  }

  it('credits the ASSIGNED member doc (not the household pool) for an assigned habit', async () => {
    renderProvider();
    seedFreezeBank(baseHabit({ id: 'hb1', type: 'positive', basePoints: 10, completedDates: [], assignedTo: 'kid_leo' }));

    // 2026-06-16 (Tue of THIS week): past + within the current week, so both
    // total and weekly are credited — to the assignee.
    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', '2026-06-16');
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    // Points land on the assignee's member doc...
    const memberOps = opsForPath(batch, `${householdPath}/members/kid_leo`);
    expect(memberOps).toHaveLength(1);
    expect(memberOps[0]!.data!['points.total']).toEqual({ __increment: 10 });
    expect(memberOps[0]!.data!['points.weekly']).toEqual({ __increment: 10 });

    // ...while the household op (same batch) spends the token but gets NO points.
    const hhOps = opsForPath(batch, householdPath);
    expect(hhOps).toHaveLength(1);
    const hhData = hhOps[0]!.data!;
    expect((hhData['freezeBank'] as FreezeBank).tokens).toBe(1);
    expect(hhData['points.total']).toBeUndefined();
    expect(hhData['points.weekly']).toBeUndefined();
  });

  it('still credits the household pool for an UNASSIGNED habit (control)', async () => {
    renderProvider();
    seedFreezeBank(baseHabit({ id: 'hb1', type: 'positive', basePoints: 10, completedDates: [] }));

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', '2026-06-16');
    });

    const batch = batches[0]!;
    const hhData = opsForPath(batch, householdPath)[0]!.data!;
    expect(hhData['points.total']).toEqual({ __increment: 10 });
    // No member doc was touched.
    expect(batch.ops.some(o => o.path.startsWith(`${householdPath}/members/`))).toBe(false);
  });
});

// ===========================================================================
// useFreezeBankToken — weekly cadence guard. A weekly habit earns its points at
// most once per ISO week, so a week that already contains a completion was
// never "missed": patching another day in it must be rejected (no token spent,
// no double-credit) even though the day-based validator allows it.
// ===========================================================================
describe('FirebaseHouseholdContext — useFreezeBankToken weekly already-completed-week guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-06-17 (local). Prior ISO week: Mon 2026-06-08 → Sun 2026-06-14.
    vi.setSystemTime(new Date(2026, 5, 17, 12, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function seedWeekly(completedDates: string[]) {
    emitCollection(`${householdPath}/habits`, [
      docSnap('hb1', baseHabit({
        id: 'hb1', type: 'positive', period: 'weekly', basePoints: 20, completedDates,
      })),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      freezeBank: {
        tokens: 2, maxTokens: 3,
        lastRolloverDate: '2026-06-01',
        lastRolloverMonth: '2026-06',
        history: [],
      } satisfies FreezeBank,
    });
  }

  it('rejects patching a day whose ISO week already contains a completion (no batch, no token spent)', async () => {
    renderProvider();
    // Completed Tue 2026-06-09; patch target Wed 2026-06-10 — SAME ISO week,
    // already scored, streak never broken.
    seedWeekly(['2026-06-09']);

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', '2026-06-10');
    });

    // The mutation bails before opening a batch: no token spent, no points credit.
    expect(batches).toHaveLength(0);
  });

  it('allows patching a day in a week with NO completion (control)', async () => {
    renderProvider();
    // Completed in the 2026-06-08 week; patch 2026-06-03 (prior week, empty).
    seedWeekly(['2026-06-09']);

    await act(async () => {
      await captured.value!.gamification.useFreezeBankToken('hb1', '2026-06-03');
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);
    expect(opsForPath(batch, `${householdPath}/habits/hb1`)).toHaveLength(1);
    expect((opsForPath(batch, householdPath)[0]!.data!['freezeBank'] as FreezeBank).tokens).toBe(1);
  });
});

// ===========================================================================
// Paycheck approval — an income item dated ON/BEFORE the current period start
// (e.g. an older overdue paycheck approved after a newer one) must NOT rewind
// lastPaycheckDate or snapshot an inverted period. The income is still
// recorded, filed as historical (payPeriodId ''), and the balance credited.
// ===========================================================================
describe('FirebaseHouseholdContext — paycheck approval does not rewind the period', () => {
  const account: Account = {
    id: 'acc1', name: 'Checking', type: 'checking', balance: 100000,
    lastUpdated: new Date().toISOString(),
  } as Account;

  function seed(lastPaycheckDate: string, incomeDate: string) {
    emitCollection(`${householdPath}/accounts`, [docSnap('acc1', account)]);
    emitCollection(`${householdPath}/buckets`, [
      docSnap('b1', { id: 'b1', name: 'Groceries', limit: 50000, color: 'blue', isVariable: false, isCore: true } as BudgetBucket),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
      lastPaycheckDate,
    });
    emitCollection(`${householdPath}/calendarItems`, [
      docSnap('cal_income', {
        id: 'cal_income', title: 'Paycheck', amount: 200000, date: incomeDate,
        type: 'income', isPaid: false, isRecurring: false,
      } as CalendarItem),
    ]);
  }

  it('approving an OLDER income item leaves the period untouched and files it as historical', async () => {
    renderProvider();
    // Current period opened 2026-06-15; the stale unpaid paycheck is 2026-06-01.
    seed('2026-06-15', '2026-06-01');

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal_income', 'acc1');
    });

    // ONE batch only — payCalendarItem's own income batch. No reset batch, so
    // no bucketHistory snapshot (whose end would precede its start) and no
    // per-bucket currentPeriodId rewrite.
    expect(batches).toHaveLength(1);
    const payBatch = batches[0]!;
    expect(payBatch.committed).toBe(true);
    expect(payBatch.ops.some(o => o.path.startsWith(`${householdPath}/bucketHistory`))).toBe(false);
    expect(payBatch.ops.some(o => o.path.startsWith(`${householdPath}/buckets/`))).toBe(false);

    // lastPaycheckDate is never written (would have rolled the pointer BACK).
    const lastPaycheckWrites = payBatch.ops.filter(
      o => o.path === householdPath && o.data !== undefined && 'lastPaycheckDate' in o.data,
    );
    expect(lastPaycheckWrites).toHaveLength(0);

    // The income itself IS recorded: item paid, balance credited, transaction
    // filed OUTSIDE the (unchanged) current period — not into a resurrected one.
    expect(opsForPath(payBatch, `${householdPath}/calendarItems/cal_income`)[0]!.data).toMatchObject({ isPaid: true });
    expect(opsForPath(payBatch, `${householdPath}/accounts/acc1`)[0]!.data!['balance']).toEqual({ __increment: 200000 });
    const txSets = payBatch.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
    );
    expect(txSets).toHaveLength(1);
    expect(txSets[0]!.data).toMatchObject({ category: 'Income', payPeriodId: '' });
  });

  it('approving an income item dated ON the current period start does not re-roll the period', async () => {
    renderProvider();
    seed('2026-06-15', '2026-06-15');

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal_income', 'acc1');
    });

    // No reset batch; the transaction files into the EXISTING period it matches.
    expect(batches).toHaveLength(1);
    const payBatch = batches[0]!;
    expect(payBatch.ops.some(o => o.path.startsWith(`${householdPath}/bucketHistory`))).toBe(false);
    const txSets = payBatch.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
    );
    expect(txSets[0]!.data).toMatchObject({ payPeriodId: '2026-06-15' });
  });
});

// ===========================================================================
// payCalendarItem — auto-categorization must use the SAME whole-word bucket
// matching as safe-to-spend's bill exclusion (exact bucketId first, tokenized
// whole-word name fallback), never a raw substring match: "Las Vegas Hotel"
// paying into a "Gas" bucket double-counts the bill across the two surfaces.
// ===========================================================================
describe('FirebaseHouseholdContext — payCalendarItem bucket auto-categorization', () => {
  const account: Account = {
    id: 'acc1', name: 'Checking', type: 'checking', balance: 100000,
    lastUpdated: new Date().toISOString(),
  } as Account;

  function seed(item: CalendarItem) {
    emitCollection(`${householdPath}/accounts`, [docSnap('acc1', account)]);
    emitCollection(`${householdPath}/buckets`, [
      docSnap('b1', { id: 'b1', name: 'Gas', limit: 20000, color: 'blue', isVariable: false, isCore: true } as BudgetBucket),
    ]);
    emitCollection(`${householdPath}/calendarItems`, [docSnap(item.id, item)]);
  }

  function paidTxCategory(): unknown {
    const txSets = batches[0]!.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
    );
    expect(txSets).toHaveLength(1);
    return txSets[0]!.data!['category'];
  }

  it('does NOT categorize "Las Vegas Hotel" under a "Gas" bucket (substring false positive)', async () => {
    renderProvider();
    seed({
      id: 'cal1', title: 'Las Vegas Hotel', amount: 45000, date: '2026-06-10',
      type: 'expense', isPaid: false, isRecurring: false,
    } as CalendarItem);

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal1', 'acc1');
    });

    expect(paidTxCategory()).toBe('Bills');
  });

  it('categorizes a whole-word match ("Gas Bill") under the "Gas" bucket', async () => {
    renderProvider();
    seed({
      id: 'cal1', title: 'Gas Bill', amount: 8000, date: '2026-06-10',
      type: 'expense', isPaid: false, isRecurring: false,
    } as CalendarItem);

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal1', 'acc1');
    });

    expect(paidTxCategory()).toBe('Gas');
  });

  it('honors an exact bucketId over any name heuristic', async () => {
    renderProvider();
    seed({
      id: 'cal1', title: 'Some Utility', amount: 8000, date: '2026-06-10',
      type: 'expense', isPaid: false, isRecurring: false, bucketId: 'b1',
    } as CalendarItem);

    await act(async () => {
      await captured.value!.finance.payCalendarItem('cal1', 'acc1');
    });

    expect(paidTxCategory()).toBe('Gas');
  });
});

// ===========================================================================
// splitTransaction — the PERSISTED split amount must be rounded to whole cents
// with the SAME value used for the account delta. Persisting a raw sub-cent
// amount (e.g. "3.005") while applying a rounded delta desyncs the stored docs
// from the balance by a sub-cent forever.
// ===========================================================================
describe('FirebaseHouseholdContext — splitTransaction rounds persisted amounts', () => {
  it('stores roundMoney(amount) on each split doc, matching the applied balance delta', async () => {
    renderProvider();
    emitCollection(`${householdPath}/accounts`, [
      docSnap('acc1', {
        id: 'acc1', name: 'Checking', type: 'checking', balance: 1000,
        lastUpdated: new Date().toISOString(),
      } as Account),
    ]);
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/transactions`, [
      docSnap('tx1', {
        id: 'tx1', amount: 10, merchant: 'Store', category: 'Dining', date: '2026-06-10',
        status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false,
      } as Transaction),
    ]);

    await act(async () => {
      // The amount Input allows typing 3 decimals; "3.005" reaches the context raw.
      await captured.value!.finance.splitTransaction('tx1', [
        { amount: 3.005, merchant: 'A', category: 'Dining', date: '2026-06-10', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
        { amount: 7, merchant: 'B', category: 'Groceries', date: '2026-06-10', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
      ]);
    });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.committed).toBe(true);

    // Persisted amounts are whole cents — roundMoney(3.005) === 3.01, never 3.005.
    const txSets = batch.ops.filter(
      o => o.kind === 'set' && o.path.startsWith(`${householdPath}/transactions`),
    );
    expect(txSets).toHaveLength(2);
    expect(txSets.map(o => o.data!['amount'])).toEqual([3.01, 7]);

    // The balance delta was computed from those SAME rounded amounts:
    // reverse original (+10) − 3.01 − 7 = −0.01.
    const accOps = opsForPath(batch, `${householdPath}/accounts/acc1`);
    expect(accOps).toHaveLength(1);
    expect(accOps[0]!.data!['balance']).toEqual({ __increment: -0.01 });
  });
});

// ===========================================================================
// toggleShoppingItemPurchased — grocery-catalog dedup must key on normalized
// NAME only (as every other catalog lookup does). Requiring the category to
// match forked a duplicate catalog row whenever an item was recategorized,
// fragmenting purchaseCount/defaultStore history across rows.
// ===========================================================================
describe('FirebaseHouseholdContext — grocery catalog dedup on purchase', () => {
  function seed(shoppingItem: ShoppingItem, catalogItem: GroceryCatalogItem) {
    emitDoc(householdPath, HOUSEHOLD_ID, {
      memberUids: ['user1'],
      points: { daily: 0, weekly: 0, total: 0 },
    });
    emitCollection(`${householdPath}/shoppingList`, [docSnap(shoppingItem.id, shoppingItem)]);
    emitCollection(`${householdPath}/groceryCatalog`, [docSnap(catalogItem.id, catalogItem)]);
  }

  it('increments the existing same-name catalog row (refreshing its category) instead of forking a duplicate', async () => {
    renderProvider();
    seed(
      // The user recategorized Milk to Dairy before checking it off...
      { id: 's1', name: 'Milk', category: 'Dairy', isPurchased: false } as ShoppingItem,
      // ...but the catalog row from its first purchase says Uncategorized.
      { id: 'cat1', name: 'Milk', category: 'Uncategorized', purchaseCount: 1 } as GroceryCatalogItem,
    );

    await act(async () => {
      await captured.value!.shopping.toggleShoppingItemPurchased('s1');
    });

    // NO new catalog row is created — the existing row is updated in place.
    expect(addDocMock).not.toHaveBeenCalled();
    const catalogUpdate = updateDocMock.mock.calls.find(
      c => pathOf(c[0]) === `${householdPath}/groceryCatalog/cat1`,
    );
    expect(catalogUpdate).toBeDefined();
    const updates = catalogUpdate![1] as unknown as Record<string, unknown>;
    expect(updates['purchaseCount']).toEqual({ __increment: 1 });
    // The category is refreshed to the item's latest categorization.
    expect(updates['category']).toBe('Dairy');
  });

  it('still creates a catalog row for a genuinely new item name (control)', async () => {
    renderProvider();
    seed(
      { id: 's1', name: 'Bread', category: 'Bakery', isPurchased: false } as ShoppingItem,
      { id: 'cat1', name: 'Milk', category: 'Dairy', purchaseCount: 3 } as GroceryCatalogItem,
    );

    await act(async () => {
      await captured.value!.shopping.toggleShoppingItemPurchased('s1');
    });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [collRef, data] = addDocMock.mock.calls[0]!;
    expect(pathOf(collRef)).toBe(`${householdPath}/groceryCatalog`);
    expect(data).toMatchObject({ name: 'Bread', category: 'Bakery', purchaseCount: 1 });
  });
});
