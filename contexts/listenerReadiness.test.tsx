import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, cleanup } from '@testing-library/react';

/**
 * SESSION LIFECYCLE of `ListenerReadiness` (see contexts/household/types.ts).
 *
 * `listenersReady` is what stops `useRecapForWeek` from deriving a confident
 * "$0 spent, 0 habits" ceremony off listeners that have not answered yet — an
 * answer the auto-open caller then records as SHOWN for that ISO week forever.
 * Its first implementation recorded, per listener, the household id its first
 * snapshot belonged to, and derived readiness by comparing that against the
 * current `householdId`, on the reasoning that a household change invalidates
 * every flag with no explicit reset.
 *
 * That reasoning covers a household SWITCH and nothing else. A household id is
 * stable and shared by both adults on one device, so the ORDINARY sign-out →
 * sign-in cycle returns to the SAME id — and `FirebaseHouseholdProvider` sits
 * above `<Routes>` in App.tsx (it is mounted through /login), so it never
 * unmounts across that cycle. Only `householdId` flips to null and back, which
 * re-runs the listener effect: every array is emptied and every listener is
 * re-attached, but the recorded ids still matched the current household, so
 * every key read READY over the freshly-emptied arrays.
 *
 * These tests drive the real provider through each session transition with a
 * mutable `useAuth` mock and assert readiness from the core slice.
 */

// --- Firestore mock -------------------------------------------------------
// Records the onSnapshot callback per collection/doc path so a test can drive a
// specific listener's first snapshot by hand. Re-attaching a listener for the
// same path overwrites the entry, which is exactly the re-subscribe semantics
// the sign-out → sign-in cycle produces.

type NextCb = (snapshot: unknown) => void;
const snapshotCallbacks = new Map<string, NextCb>();
let unsubscribeCalls = 0;

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
      if (typeof path === 'string') return makeRef(id ? `${path}/${id}` : path);
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
    increment: vi.fn((n: number) => ({ __increment: n })),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    deleteField: vi.fn(() => '__deleteField'),
    arrayUnion: vi.fn((...args: unknown[]) => ({ __arrayUnion: args })),
    arrayRemove: vi.fn((...args: unknown[]) => ({ __arrayRemove: args })),
    Timestamp: { fromDate: vi.fn(), now: vi.fn() },
    onSnapshot: vi.fn((ref: unknown, next: NextCb) => {
      snapshotCallbacks.set(pathOf(ref), next);
      return () => { unsubscribeCalls++; };
    }),
    writeBatch: vi.fn(() => ({
      set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => undefined),
    })),
    addDoc: vi.fn(async () => ({ id: 'newDoc' })),
    updateDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    getDocs: vi.fn(async () => ({ docs: [], size: 0 })),
    getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
    setDoc: vi.fn(async () => undefined),
    runTransaction: vi.fn(),
  };
});

vi.mock('@/firebase.config', () => ({ db: {}, getFunctionsInstance: vi.fn(async () => ({})) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn(async () => ({ data: {} })) }));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/services/appConfig', () => ({ getBillingEnabled: vi.fn(async () => false) }));

// Mutable auth: the whole point of this file. AuthContext is the ONLY thing
// that changes across a sign-out → sign-in cycle — the provider itself stays
// mounted, so nothing else re-initialises on its own.
const auth: { user: { uid: string; displayName: string; email: string; photoURL: string } | null; householdId: string | null } = {
  user: null,
  householdId: null,
};
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

import { FirebaseHouseholdProvider, useHouseholdCore } from './FirebaseHouseholdContext';
import type { ListenerReadiness } from './household/types';

const HOUSEHOLD_A = 'h1';
const HOUSEHOLD_B = 'h2';
const USER_1 = { uid: 'user1', displayName: 'Paul', email: 'p@e.com', photoURL: '' };
const USER_2 = { uid: 'user2', displayName: 'Jen', email: 'j@e.com', photoURL: '' };

const captured: { readiness: ListenerReadiness | null } = { readiness: null };

const Capture: React.FC = () => {
  const core = useHouseholdCore();
  React.useEffect(() => {
    captured.readiness = core.listenersReady;
  });
  return null;
};

/** Signs a user into a household by mutating the auth mock and re-rendering. */
function signIn(rerender: (ui: React.ReactElement) => void, user: typeof USER_1, householdId: string) {
  auth.user = user;
  auth.householdId = householdId;
  act(() => {
    rerender(<FirebaseHouseholdProvider><Capture /></FirebaseHouseholdProvider>);
  });
}

function signOut(rerender: (ui: React.ReactElement) => void) {
  auth.user = null;
  auth.householdId = null;
  act(() => {
    rerender(<FirebaseHouseholdProvider><Capture /></FirebaseHouseholdProvider>);
  });
}

function emitCollection(path: string, docs: { id: string; data: () => object }[]) {
  const cb = snapshotCallbacks.get(path);
  if (!cb) throw new Error(`No listener registered for collection "${path}"`);
  act(() => { cb({ docs, size: docs.length }); });
}

function emitDoc(path: string, id: string, data: Record<string, unknown>) {
  const cb = snapshotCallbacks.get(path);
  if (!cb) throw new Error(`No listener registered for doc "${path}"`);
  act(() => { cb({ id, exists: () => true, data: () => data }); });
}

/**
 * Feeds every listener `listenersReady` tracks its first snapshot, so the
 * household reads fully ready. The household DOC has to land first: the
 * transactions listener is gated on it (`loadedHouseholdId === householdId`)
 * and is not even attached until it does.
 */
function deliverAllListeners(householdId: string) {
  const base = `households/${householdId}`;
  emitDoc(base, householdId, { memberUids: [USER_1.uid], points: { daily: 0, weekly: 0, total: 0 } });
  emitCollection(`${base}/members`, []);
  emitCollection(`${base}/habits`, []);
  emitCollection(`${base}/calendarItems`, []);
  emitCollection(`${base}/transactions`, []);
}

const ALL_FALSE: ListenerReadiness = {
  transactions: false, habits: false, members: false, calendarItems: false,
};
const ALL_TRUE: ListenerReadiness = {
  transactions: true, habits: true, members: true, calendarItems: true,
};

function renderProvider() {
  return render(<FirebaseHouseholdProvider><Capture /></FirebaseHouseholdProvider>);
}

beforeEach(() => {
  snapshotCallbacks.clear();
  captured.readiness = null;
  unsubscribeCalls = 0;
  auth.user = null;
  auth.householdId = null;
});

describe('ListenerReadiness — session lifecycle', () => {
  it('starts all-false and flips true only as each listener delivers', () => {
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);

    expect(captured.readiness).toEqual(ALL_FALSE);

    const base = `households/${HOUSEHOLD_A}`;
    emitDoc(base, HOUSEHOLD_A, { memberUids: [USER_1.uid] });
    emitCollection(`${base}/habits`, []);
    expect(captured.readiness).toEqual({ ...ALL_FALSE, habits: true });

    emitCollection(`${base}/members`, []);
    emitCollection(`${base}/calendarItems`, []);
    expect(captured.readiness).toEqual({ ...ALL_FALSE, habits: true, members: true, calendarItems: true });

    emitCollection(`${base}/transactions`, []);
    expect(captured.readiness).toEqual(ALL_TRUE);
  });

  it('goes all-false on sign-out and STAYS false with no session', () => {
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);
    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);

    signOut(rerender);
    expect(captured.readiness).toEqual(ALL_FALSE);
  });

  it('goes all-false on a switch to a DIFFERENT household until the new listeners deliver', () => {
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);
    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);

    signIn(rerender, USER_2, HOUSEHOLD_B);
    expect(captured.readiness).toEqual(ALL_FALSE);

    deliverAllListeners(HOUSEHOLD_B);
    expect(captured.readiness).toEqual(ALL_TRUE);
  });

  // THE REGRESSION. Everything above passed before the reset existed, because a
  // changing household id invalidated the marks by comparison. This one did
  // not: the id is unchanged, so the previous session's marks kept matching.
  it('goes all-false across sign-out → sign-in to the SAME household with a DIFFERENT uid', () => {
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);
    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);

    signOut(rerender);
    // Paul signs out, Jen signs in — same shared device, same household id.
    signIn(rerender, USER_2, HOUSEHOLD_A);

    // The listener effect re-ran: every array was emptied and every listener
    // re-attached. NOTHING has delivered for this session yet, so a derived
    // recap here would be a confident (and permanently recorded) "$0 spent, 0
    // habits". Readiness must say so.
    expect(captured.readiness).toEqual(ALL_FALSE);

    // ...and it must still resolve once the new session's listeners answer.
    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);
  });

  it('goes all-false across a re-auth to the same household with the SAME uid', () => {
    // Same-uid re-auth (a token/session refresh that flips householdId through
    // null) re-attaches the listeners just the same, so it must re-arm too.
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);
    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);

    signOut(rerender);
    signIn(rerender, USER_1, HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_FALSE);

    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);
  });

  it('goes all-false when only the uid changes, with no intervening sign-out', () => {
    // AuthContext can swap the acting user without ever passing through null
    // (household unchanged). The listener effect keys on `user?.uid`, so it
    // still tears down and re-attaches — and readiness must follow it.
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);
    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);

    signIn(rerender, USER_2, HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_FALSE);

    deliverAllListeners(HOUSEHOLD_A);
    expect(captured.readiness).toEqual(ALL_TRUE);
  });

  it('unmounting the provider tears the listeners down (positive control for the mock)', () => {
    const { rerender } = renderProvider();
    signIn(rerender, USER_1, HOUSEHOLD_A);
    deliverAllListeners(HOUSEHOLD_A);
    expect(unsubscribeCalls).toBe(0);

    cleanup();
    expect(unsubscribeCalls).toBeGreaterThan(0);
  });
});
