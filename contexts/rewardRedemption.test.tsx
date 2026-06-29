import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import type { RewardItem, RewardRedemption, RewardRedemptionRecord } from '@/types/schema';
import { REDEMPTION_HISTORY_LIMIT } from '@/utils/redemption';

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
// Member docs the mocked transaction.get() returns, keyed by full path
// (e.g. "households/h1/members/kid_leo"). approveRedemption reads the kid's
// member doc for the affordability check; tests seed the kid's points here.
let memberDocs: Record<string, Record<string, unknown>> = {};

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
        get: vi.fn(async (ref: unknown) => {
          const path = pathOf(ref);
          // Member-doc reads (affordability check) resolve from memberDocs; the
          // household doc resolves from householdDocData; autoId refs are empty.
          const data = path.includes('/members/')
            ? (memberDocs[path] ?? {})
            : path.endsWith('/__autoId')
              ? {}
              : householdDocData;
          return { exists: () => true, data: () => data };
        }),
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
  memberDocs = {};
  snapshotCallbacks.clear();
  captured.value = null;
  incrementMock.mockClear();
  arrayUnionMock.mockClear();
});

describe('requestRedemption', () => {
  it('appends a pending RewardRedemption to the household doc transactionally', async () => {
    renderProvider();
    // Seed the rewards listener so the reward can be found by id.
    emitCollection(`${householdPath}/rewards`, [docSnap('rw2', allowanceReward)]);

    await act(async () => {
      await captured.value!.requestRedemption('rw2', 'kid_leo');
    });

    // The request now runs in a transaction: read the queue, then update the
    // household doc with the appended redemption (no arrayUnion blind-append).
    expect(txUpdates).toHaveLength(1);
    const call = txUpdates[0]!;
    expect(call.path).toBe(householdPath);
    const queue = call.data.pendingRedemptions as RewardRedemption[];
    expect(queue).toHaveLength(1);
    const appended = queue[0]!;
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

  it('preserves existing pending entries when appending a new request', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);
    // A pending request for a DIFFERENT reward already exists.
    householdDocData = { pendingRedemptions: [seedRedemption({ id: 'existing', rewardId: 'rw2' })] };

    await act(async () => {
      await captured.value!.requestRedemption('rw1', 'kid_leo');
    });

    const queue = txUpdates[0]!.data.pendingRedemptions as RewardRedemption[];
    // Existing entry kept + the new one appended.
    expect(queue.map(r => r.rewardId).sort()).toEqual(['rw1', 'rw2']);
  });

  it('is a no-op when a pending request for the same (memberId, rewardId) already exists', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw2', allowanceReward)]);
    // Same member + same reward already pending — a fast double-tap / two tabs.
    householdDocData = {
      pendingRedemptions: [seedRedemption({ id: 'first', rewardId: 'rw2', memberId: 'kid_leo' })],
    };

    await act(async () => {
      await captured.value!.requestRedemption('rw2', 'kid_leo');
    });

    // No write at all — the duplicate is skipped, so approval can never
    // double-deduct points / double-credit allowance.
    expect(txUpdates).toHaveLength(0);
  });

  it('omits allowanceCents for a realWorld reward request', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);

    await act(async () => {
      await captured.value!.requestRedemption('rw1', 'kid_leo');
    });

    const queue = txUpdates[0]!.data.pendingRedemptions as RewardRedemption[];
    const appended = queue[0]!;
    expect(appended.type).toBe('realWorld');
    expect(appended).not.toHaveProperty('allowanceCents');
  });

  it('does nothing when the reward id is unknown', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);

    await act(async () => {
      await captured.value!.requestRedemption('does-not-exist', 'kid_leo');
    });

    expect(txUpdates).toHaveLength(0);
    expect(updateDocCalls).toHaveLength(0);
  });
});

describe('approveRedemption', () => {
  // The affordability guard (FIX 2) reads the kid's member doc; seed it with
  // enough points so the happy-path approvals proceed past the check.
  const seedKidPoints = (total: number) => {
    memberDocs[`${householdPath}/members/kid_leo`] = { points: { daily: 0, weekly: 0, total } };
  };

  it('removes the request AND deducts points + credits allowance in one transaction', async () => {
    renderProvider();
    householdDocData = { pendingRedemptions: [seedRedemption()] };
    seedKidPoints(220); // >= cost 100

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
    seedKidPoints(220); // >= cost 50

    await act(async () => {
      await captured.value!.approveRedemption('r_real');
    });

    const memberUpdate = txUpdates.find(u => u.path === `${householdPath}/members/kid_leo`)!;
    expect(memberUpdate.data['points.total']).toEqual({ __increment: -50 });
    expect(memberUpdate.data).not.toHaveProperty('allowanceCents');
  });

  it('rejects (no writes, request stays pending) when the kid can no longer afford the cost', async () => {
    renderProvider();
    householdDocData = { pendingRedemptions: [seedRedemption()] }; // cost 100
    seedKidPoints(50); // < cost → approval must not drive points negative

    await act(async () => {
      await captured.value!.approveRedemption('redemption_1');
    });

    // No deduction, no queue removal — neither the household nor the member is
    // written, so the request remains pending for a later retry.
    expect(txUpdates).toHaveLength(0);
  });

  it('approves when the kid has EXACTLY the cost (boundary, not unaffordable)', async () => {
    renderProvider();
    householdDocData = { pendingRedemptions: [seedRedemption()] }; // cost 100
    seedKidPoints(100); // exactly affordable

    await act(async () => {
      await captured.value!.approveRedemption('redemption_1');
    });

    expect(txUpdates).toHaveLength(2);
    const memberUpdate = txUpdates.find(u => u.path === `${householdPath}/members/kid_leo`)!;
    expect(memberUpdate.data['points.total']).toEqual({ __increment: -100 });
  });

  it('strips ALL pending entries for the same (memberId, rewardId) but credits once', async () => {
    renderProvider();
    // A stray duplicate for the same kid+reward slipped past the request dedup.
    householdDocData = {
      pendingRedemptions: [
        seedRedemption({ id: 'redemption_1' }),
        seedRedemption({ id: 'dup_same' }),
        seedRedemption({ id: 'keep_other_reward', rewardId: 'rw1' }),
      ],
    };
    seedKidPoints(500);

    await act(async () => {
      await captured.value!.approveRedemption('redemption_1');
    });

    const hhUpdate = txUpdates.find(u => u.path === householdPath)!;
    const remaining = hhUpdate.data.pendingRedemptions as RewardRedemption[];
    // Both rw2 entries (the approved one AND the stray duplicate) are removed; the
    // unrelated rw1 request is preserved.
    expect(remaining.map(r => r.id)).toEqual(['keep_other_reward']);

    // The member is credited exactly ONCE despite two stripped entries.
    const memberUpdates = txUpdates.filter(u => u.path === `${householdPath}/members/kid_leo`);
    expect(memberUpdates).toHaveLength(1);
    expect(memberUpdates[0]!.data['points.total']).toEqual({ __increment: -100 });
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

describe('redeemReward (instant, rewards center)', () => {
  it('deducts shared points AND appends a history record in ONE transaction', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);
    householdDocData = { points: { daily: 0, weekly: 0, total: 200 } };

    await act(async () => {
      await captured.value!.redeemReward('rw1');
    });

    // One atomic update to the household doc: points deducted + history appended.
    expect(txUpdates).toHaveLength(1);
    const hh = txUpdates[0]!;
    expect(hh.path).toBe(householdPath);
    expect(hh.data['points.total']).toEqual({ __increment: -50 });

    const history = hh.data.redemptionHistory as RewardRedemptionRecord[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      rewardId: 'rw1',
      rewardTitle: 'Movie Night',
      icon: '🎬',
      cost: 50,
      redeemedByUid: 'parent_1',
    });
    expect(typeof history[0]!.id).toBe('string');
    expect(typeof history[0]!.redeemedAt).toBe('string');
  });

  it('rejects (no write) when the shared total cannot afford the reward', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);
    householdDocData = { points: { daily: 0, weekly: 0, total: 10 } }; // < cost 50

    await act(async () => {
      await captured.value!.redeemReward('rw1');
    });

    expect(txUpdates).toHaveLength(0);
  });

  it('prepends the newest record and caps history at REDEMPTION_HISTORY_LIMIT', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);
    // Seed a full history so the cap is exercised.
    const existing: RewardRedemptionRecord[] = Array.from({ length: REDEMPTION_HISTORY_LIMIT }, (_, i) => ({
      id: `old_${i}`,
      rewardId: 'rwX',
      rewardTitle: `Old ${i}`,
      icon: '⭐',
      cost: 5,
      redeemedByUid: 'parent_1',
      redeemedAt: new Date(2020, 0, 1, 0, i).toISOString(),
    }));
    householdDocData = { points: { daily: 0, weekly: 0, total: 999 }, redemptionHistory: existing };

    await act(async () => {
      await captured.value!.redeemReward('rw1');
    });

    const history = txUpdates[0]!.data.redemptionHistory as RewardRedemptionRecord[];
    // Newest is first; total length is clamped to the cap (oldest entry dropped).
    expect(history).toHaveLength(REDEMPTION_HISTORY_LIMIT);
    expect(history[0]).toMatchObject({ rewardId: 'rw1', rewardTitle: 'Movie Night' });
    expect(history[history.length - 1]!.id).toBe(`old_${REDEMPTION_HISTORY_LIMIT - 2}`);
  });

  it('does nothing when the reward id is unknown', async () => {
    renderProvider();
    emitCollection(`${householdPath}/rewards`, [docSnap('rw1', realWorldReward)]);
    householdDocData = { points: { daily: 0, weekly: 0, total: 200 } };

    await act(async () => {
      await captured.value!.redeemReward('does-not-exist');
    });

    expect(txUpdates).toHaveLength(0);
  });
});
