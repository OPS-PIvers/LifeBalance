import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { format, startOfWeek, subDays } from 'date-fns';
import type {
  Account,
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
