import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { format, startOfWeek, subDays } from 'date-fns';
import type {
  Account,
  BudgetBucket,
  CalendarItem,
  FreezeBank,
  Habit,
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
}

const captured: { value: Captured | null } = { value: null };

const Capture: React.FC = () => {
  const finance = useFinance();
  const gamification = useGamification();
  const core = useHouseholdCore();
  // Write to the module-scope holder from an effect (mutating it during render
  // is disallowed by the react-hooks/immutability lint rule).
  React.useEffect(() => {
    captured.value = { finance, gamification, core };
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
