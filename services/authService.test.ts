import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirebaseError } from 'firebase/app';
import {
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth';

// Mock the firebase config so importing authService doesn't initialize a real app.
vi.mock('@/firebase.config', () => ({ auth: {}, googleProvider: {} }));
vi.mock('@/utils/platform', () => ({ isPWA: vi.fn() }));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  getAdditionalUserInfo: vi.fn(),
  signOut: vi.fn(),
}));

// Note: firebase/app is intentionally NOT mocked so `instanceof FirebaseError`
// works against the real class.

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('signInWithGoogle', () => {
    it('uses the redirect flow (returning null) when running as a PWA', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(true);
      vi.mocked(signInWithRedirect).mockResolvedValue(undefined as never);

      const result = await signInWithGoogle();

      expect(result).toBeNull();
      expect(signInWithRedirect).toHaveBeenCalledTimes(1);
      expect(signInWithPopup).not.toHaveBeenCalled();
    });

    it('returns the popup user when not a PWA and popup succeeds', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      const user = { uid: 'u1' };
      // signInWithPopup returns a UserCredential; only `.user` is read.
      vi.mocked(signInWithPopup).mockResolvedValue({
        user,
      } as unknown as Awaited<ReturnType<typeof signInWithPopup>>);

      const result = await signInWithGoogle();

      expect(result).toBe(user);
      expect(signInWithRedirect).not.toHaveBeenCalled();
    });

    it('tracks sign_up for a new user on popup sign-in', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { getAdditionalUserInfo } = await import('firebase/auth');
      const { track } = await import('@/services/analytics');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      vi.mocked(signInWithPopup).mockResolvedValue({
        user: { uid: 'u1' },
      } as unknown as Awaited<ReturnType<typeof signInWithPopup>>);
      vi.mocked(getAdditionalUserInfo).mockReturnValue({
        isNewUser: true,
      } as unknown as ReturnType<typeof getAdditionalUserInfo>);

      await signInWithGoogle();

      expect(track).toHaveBeenCalledWith('sign_up', { method: 'google' });
    });

    it('tracks login for a returning user on popup sign-in', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { getAdditionalUserInfo } = await import('firebase/auth');
      const { track } = await import('@/services/analytics');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      vi.mocked(signInWithPopup).mockResolvedValue({
        user: { uid: 'u1' },
      } as unknown as Awaited<ReturnType<typeof signInWithPopup>>);
      vi.mocked(getAdditionalUserInfo).mockReturnValue({
        isNewUser: false,
      } as unknown as ReturnType<typeof getAdditionalUserInfo>);

      await signInWithGoogle();

      expect(track).toHaveBeenCalledWith('login', { method: 'google' });
    });

    it('falls back to redirect (returns null) when popup fails with auth/popup-blocked', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      vi.mocked(signInWithPopup).mockRejectedValue(
        new FirebaseError('auth/popup-blocked', 'blocked')
      );
      vi.mocked(signInWithRedirect).mockResolvedValue(undefined as never);

      const result = await signInWithGoogle();

      expect(result).toBeNull();
      expect(signInWithRedirect).toHaveBeenCalledTimes(1);
    });

    it('falls back to redirect for operation-not-supported error', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      vi.mocked(signInWithPopup).mockRejectedValue(
        new FirebaseError('auth/operation-not-supported-in-this-environment', 'nope')
      );
      vi.mocked(signInWithRedirect).mockResolvedValue(undefined as never);

      const result = await signInWithGoogle();

      expect(result).toBeNull();
      expect(signInWithRedirect).toHaveBeenCalledTimes(1);
    });

    it('rethrows (without redirect) for a FirebaseError with a non-fallback code', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      vi.mocked(signInWithPopup).mockRejectedValue(
        new FirebaseError('auth/user-cancelled', 'cancelled by user')
      );

      await expect(signInWithGoogle()).rejects.toThrow('cancelled by user');
      expect(signInWithRedirect).not.toHaveBeenCalled();
    });

    it('rethrows (without redirect) for a plain Error', async () => {
      const { isPWA } = await import('@/utils/platform');
      const { signInWithGoogle } = await import('@/services/authService');
      vi.mocked(isPWA).mockReturnValue(false);
      vi.mocked(signInWithPopup).mockRejectedValue(new Error('boom'));

      await expect(signInWithGoogle()).rejects.toThrow('boom');
      expect(signInWithRedirect).not.toHaveBeenCalled();
    });
  });

  describe('completeRedirectSignIn', () => {
    // This function memoizes a module-level promise, so each test imports the
    // module fresh to reset that shared state.
    beforeEach(() => {
      vi.resetModules();
    });

    it('resolves to void when there is no pending redirect (getRedirectResult -> null)', async () => {
      // Re-import the mock after resetModules so we hold the same instance the
      // freshly-imported authService closes over.
      const freshAuth = await import('firebase/auth');
      vi.mocked(freshAuth.getRedirectResult).mockResolvedValue(null);
      const { completeRedirectSignIn } = await import('@/services/authService');

      await expect(completeRedirectSignIn()).resolves.toBeUndefined();
      expect(freshAuth.getRedirectResult).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent calls into a single getRedirectResult invocation', async () => {
      const freshAuth = await import('firebase/auth');
      vi.mocked(freshAuth.getRedirectResult).mockResolvedValue(null);
      const { completeRedirectSignIn } = await import('@/services/authService');

      await Promise.all([completeRedirectSignIn(), completeRedirectSignIn()]);

      expect(freshAuth.getRedirectResult).toHaveBeenCalledTimes(1);
    });
  });

  describe('signOut', () => {
    it('calls firebaseSignOut on success', async () => {
      const { signOut } = await import('@/services/authService');
      vi.mocked(firebaseSignOut).mockResolvedValue(undefined);

      await expect(signOut()).resolves.toBeUndefined();
      expect(firebaseSignOut).toHaveBeenCalledTimes(1);
    });

    it('rethrows a new Error when firebaseSignOut rejects', async () => {
      const { signOut } = await import('@/services/authService');
      vi.mocked(firebaseSignOut).mockRejectedValue(new Error('sign-out failed'));

      await expect(signOut()).rejects.toThrow('sign-out failed');
    });
  });
});
