import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import type { RewardItem, RewardRedemption } from '@/types/schema';

/**
 * Behavior tests for the Plan 080d-2 reward-redemption context methods:
 *   - requestRedemption  → appends a pending RewardRedemption to the household
 *                          doc via updateDoc(arrayUnion(...)).
 *   - approveRedemption  → in ONE runTransaction: removes the request from the
 *                          household queue AND applies redemptionMemberDelta to
 *                          the kid member (deduct points.total, credit allowance).
 *                          Idempotent: a second approve with the request already
 *                          gone is a no-op (no member write).
 *   - denyRedemption     → removes the request, NEVER touches member points.
 *                          Idempotent the same way.
 *
 * Strategy mirrors FirebaseHouseholdContext.test.tsx: a hand-rolled
 * firebase/firestore mock. Here `runTransaction` is given a REAL working
 * transaction object whose `get` returns a seeded household doc and whose
 * `update` calls are captured, so the find-or-return idempotency and the
 * two-write atomicity can be asserted directly.
 */

interface CapturedUpdate {
  path: string;
  data: Record<string, unknown>;
}

let txUpdates: CapturedUpdate[] = [];
let updateDocCalls: CapturedUpdate[] = [];
// The household doc the mocked transaction.get() returns. Tests seed
// pendingRedemptions here before invoking approve/deny.
let householdDocData: Record<string, unknown> = {};

const incrementMock = vi.fn((n: number) => ({ __increment: n }));
const arrayUnionMock = vi.fn((...args: unknown[]) => ({ __arrayUnion: args }));

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
    withConverter: () => makeRef(path),
  });
  return {
    doc: vi.fn((dbOrRef: unknown, path?: string, id?: string) => {
      if (typeof path === 'string') {
        return makeRef(id ? `${path}/${id}` : path);
      }
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
    arrayUnion: (...args: unknown[]) => arrayUnionMock(...args),
    arrayRemove: vi.fn((...args: unknown[]) => ({ __arrayRemove: args })),
    Timestamp: { fromDate: vi.fn(), now: vi.fn() },
    onSnapshot: vi.fn((ref: unknown, next: NextCb) => {
      snapshotCallbacks.set(pathOf(ref), next);
      return vi.fn();
    }),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(async () => {}),
    })),
    addDoc: vi.fn(async () => ({ id: 'newDoc' })),
    updateDoc: vi.fn(async (ref: unknown, data: Record<string, unknown>) => {
      updateDocCalls.push({ path: pathOf(ref), data });
    }),
    deleteDoc: vi.fn(async () => undefined),
    getDocs: vi.fn(async () => ({ docs: [], size: 0 })),
    getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
    setDoc: vi.fn(async () => undefined),
    runTransaction: vi.fn(async (_db: unknown, updater: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: vi.fn(async (ref: unknown) => ({
          exists: () => true,
          // Only the household doc is read by approve/deny.
          data: () => (pathOf(ref).endsWith('/__autoId') ? {} : householdDocData),
        })),
        update: vi.fn((ref: unknown, data: Record<string, unknown>) => {
          txUpdates.push({ path: pathOf(ref), data });
        }),
        set: vi.fn(),
        delete: vi.fn(),
      };
      await updater(tx);
    }),
  };
});

vi.mock('@/firebase.config', () => ({ db: {} }));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const AUTH_USER = { uid: 'parent_1', displayName: 'Parent', email: 'p@e.com', photoURL: '' };
const HOUSEHOLD_ID = 'h1';
const householdPath = `households/${HOUSEHOLD_ID}`;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: AUTH_USER, householdId: HOUSEHOLD_ID }),
}));

import { FirebaseHouseholdProvider, useGamification } from './FirebaseHouseholdContext';

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

// --- Consumer harness ----------------------------------------------------

const captured: { value: ReturnType<typeof useGamification> | null } = { value: null };

const Capture: React.FC = () => {
  const gamification = useGamification();
  React.useEffect(() => {
    captured.value = gamification;
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

const allowanceReward: RewardItem = {
  id: 'rw2',
  title: '$5 Allowance',
  cost: 100,
  icon: '💵',
  createdBy: 'parent_1',
  type: 'allowance',
  allowanceCents: 500,
  active: true,
};

const realWorldReward: RewardItem = {
  id: 'rw1',
  title: 'Movie Night',
  cost: 50,
  icon: '🎬',
  createdBy: 'parent_1',
  type: 'realWorld',
  active: true,
};

const seedRedemption = (overrides: Partial<RewardRedemption> = {}): RewardRedemption => ({
  id: 'redemption_1',
  rewardId: 'rw2',
  rewardTitle: '$5 Allowance',
  memberId: 'kid_leo',
  cost: 100,
  type: 'allowance',
  allowanceCents: 500,
  status: 'pending',
  requestedAt: new Date().toISOString(),
  requestedByUid: 'parent_1',
  ...overrides,
});

beforeEach(() => {
  txUpdates = [];
  updateDocCalls = [];
  householdDocData = {};
  snapshotCallbacks.clear();
  captured.value = null;
  incrementMock.mockClear();
  arrayUnionMock.mockClear();
});

describe('requestRedemption', () => {
  it('appends a pending RewardRedemption to the household doc via arrayUnion', async () => {
    renderProvider();
    // Seed the rewards listener so the reward can be found by id.
    emitCollection(`${householdPath}/rewards`, [docSnap('rw2', allowanceReward)]);

    await act(async () => {
      await captured.value!.requestRedemption('rw2', 'kid_leo');
    });

    expect(updateDocCalls).toHaveLength(1);
    const call = updateDocCalls[0]!;
    expect(call.path).toBe(householdPath);
    // The pendingRedemptions field is an arrayUnion of the new redemption.
    expect(arrayUnionMock).toHaveBeenCalledTimes(1);
    const appended = arrayUnionMock.mock.calls[0]![0] as RewardRedemption;
    expect(appended).toMatchObject({
      rewardId: 'rw2',
      rewardTitle: '$5 Allowance',
      memberId: 'kid_leo',
      cost: 100,
      type: 'allowance',
      allowanceCents: 500,
      status: 'pending',
      requestedByUid: 'parent_1',
    });
    expect(typeof appended.id).toBe('string');
    expect(typeof appended.requestedAt).toBe('string');
  });

  it('omits allowanceCents for a realWorld reward request', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);

    await act(async () => {
      await captured.value!.requestRedemption('rw1', 'kid_leo');
    });

    const appended = arrayUnionMock.mock.calls[0]![0] as RewardRedemption;
    expect(appended.type).toBe('realWorld');
    expect(appended).not.toHaveProperty('allowanceCents');
  });

  it('does nothing when the reward id is unknown', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);

    await act(async () => {
      await captured.value!.requestRedemption('does-not-exist', 'kid_leo');
    });

    expect(updateDocCalls).toHaveLength(0);
  });
});

describe('approveRedemption', () => {
  it('removes the request AND deducts points + credits allowance in one transaction', async () => {
    renderProvider();
    householdDocData = { pendingRedemptions: [seedRedemption()] };

    await act(async () => {
      await captured.value!.approveRedemption('redemption_1');
    });

    // Two updates inside the single transaction: household queue + kid member.
    expect(txUpdates).toHaveLength(2);

    const hhUpdate = txUpdates.find(u => u.path === householdPath)!;
    expect(hhUpdate).toBeDefined();
    // The resolved request is removed from the queue (empty array remains).
    expect(hhUpdate.data.pendingRedemptions).toEqual([]);

    const memberUpdate = txUpdates.find(u => u.path === `${householdPath}/members/kid_leo`)!;
    expect(memberUpdate).toBeDefined();
    // Points cost deducted (-100) and allowance IOU credited (+500 cents).
    expect(memberUpdate.data['points.total']).toEqual({ __increment: -100 });
    expect(memberUpdate.data['allowanceCents']).toEqual({ __increment: 500 });
  });

  it('does NOT write allowanceCents for a realWorld redemption (only deducts points)', async () => {
    renderProvider();
    householdDocData = {
      pendingRedemptions: [
        seedRedemption({ id: 'r_real', rewardId: 'rw1', rewardTitle: 'Movie Night', cost: 50, type: 'realWorld', allowanceCents: undefined }),
      ],
    };

    await act(async () => {
      await captured.value!.approveRedemption('r_real');
    });

    const memberUpdate = txUpdates.find(u => u.path === `${householdPath}/members/kid_leo`)!;
    expect(memberUpdate.data['points.total']).toEqual({ __increment: -50 });
    expect(memberUpdate.data).not.toHaveProperty('allowanceCents');
  });

  it('is idempotent: approving an already-resolved request is a no-op (no member write)', async () => {
    renderProvider();
    // Queue does NOT contain the id → already resolved.
    householdDocData = { pendingRedemptions: [seedRedemption({ id: 'other' })] };

    await act(async () => {
      await captured.value!.approveRedemption('redemption_1');
    });

    // No updates at all — the transaction found nothing and returned early.
    expect(txUpdates).toHaveLength(0);
  });
});

describe('denyRedemption', () => {
  it('removes the request without any points/allowance change', async () => {
    renderProvider();
    householdDocData = { pendingRedemptions: [seedRedemption(), seedRedemption({ id: 'keep_me' })] };

    await act(async () => {
      await captured.value!.denyRedemption('redemption_1');
    });

    // Exactly one update — the household queue — and NO member write.
    expect(txUpdates).toHaveLength(1);
    const hhUpdate = txUpdates[0]!;
    expect(hhUpdate.path).toBe(householdPath);
    const remaining = hhUpdate.data.pendingRedemptions as RewardRedemption[];
    expect(remaining.map(r => r.id)).toEqual(['keep_me']);
    expect(txUpdates.some(u => u.path.includes('/members/'))).toBe(false);
  });

  it('is idempotent: denying an already-resolved request is a no-op', async () => {
    renderProvider();
    householdDocData = { pendingRedemptions: [] };

    await act(async () => {
      await captured.value!.denyRedemption('redemption_1');
    });

    expect(txUpdates).toHaveLength(0);
  });
});
