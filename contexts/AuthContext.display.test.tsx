import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Wall display identity in AuthContext (docs/plans/wall-display-kiosk.md §4.2):
 * a custom-token display user resolves its household from its claims and
 * must skip the member lookup and the Private Alpha guard (it has no email).
 */
const mocks = vi.hoisted(() => ({
  listener: null as null | ((user: unknown) => Promise<void> | void),
  currentUser: null as unknown,
  getUserHousehold: vi.fn(),
  signOut: vi.fn(async () => undefined),
}));

vi.mock('@/firebase.config', () => ({
  auth: {
    get currentUser() {
      return mocks.currentUser;
    },
  },
  db: {},
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    mocks.listener = cb;
    return () => undefined;
  },
}));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn() }));
vi.mock('@/services/householdService', () => ({ getUserHousehold: mocks.getUserHousehold }));
vi.mock('@/services/authService', () => ({ signOut: mocks.signOut, completeRedirectSignIn: vi.fn(async () => undefined) }));
vi.mock('@/services/appConfig', () => ({ getOpenSignup: vi.fn(async () => false) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

import { AuthProvider, useAuth } from './AuthContext';

const Probe: React.FC = () => {
  const { householdId, isDisplay, displayId, loading, user } = useAuth();
  return <p data-testid="probe">{JSON.stringify({ householdId, isDisplay, displayId, loading, uid: (user as { uid?: string } | null)?.uid ?? null })}</p>;
};

const probe = () => JSON.parse(screen.getByTestId('probe').textContent ?? '{}') as Record<string, unknown>;

function displayUser(claims: Record<string, unknown>) {
  return { uid: 'display_d1', email: null, getIdTokenResult: vi.fn(async () => ({ claims })) };
}

describe('AuthContext wall display identity', () => {
  beforeEach(() => {
    mocks.listener = null;
    mocks.currentUser = null;
    vi.clearAllMocks();
  });

  it('takes the household from display claims and skips the member lookup', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    const user = displayUser({ display: true, hid: 'H1', did: 'd1' });
    mocks.currentUser = user;
    await act(async () => {
      await mocks.listener?.(user);
    });
    await waitFor(() => expect(probe()).toMatchObject({ householdId: 'H1', isDisplay: true, displayId: 'd1', loading: false }));
    expect(mocks.getUserHousehold).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('signs out a display-shaped uid without valid claims', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    const user = displayUser({ email: 'x@y.z' });
    mocks.currentUser = user;
    await act(async () => {
      await mocks.listener?.(user);
    });
    await waitFor(() => expect(probe()).toMatchObject({ isDisplay: false, uid: null, loading: false }));
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.getUserHousehold).not.toHaveBeenCalled();
  });

  it('leaves normal users on the member path', async () => {
    mocks.getUserHousehold.mockResolvedValue('H9');
    render(<AuthProvider><Probe /></AuthProvider>);
    const user = { uid: 'person1', email: 'p@x.com', getIdTokenResult: vi.fn() };
    mocks.currentUser = user;
    await act(async () => {
      await mocks.listener?.(user);
    });
    await waitFor(() => expect(probe()).toMatchObject({ householdId: 'H9', isDisplay: false, displayId: null }));
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
  });
});
