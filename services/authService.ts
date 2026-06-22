import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAdditionalUserInfo,
  signOut as firebaseSignOut,
  User,
  type UserCredential,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth, googleProvider } from '@/firebase.config';
import { isPWA } from '@/services/notificationService';
import { track } from '@/services/analytics';

/**
 * Emit an activation analytics event for a completed sign-in, distinguishing a
 * brand-new account (`sign_up`) from a returning user (`login`). Fully
 * defensive — analytics must never interfere with authentication.
 */
function trackSignIn(result: UserCredential): void {
  try {
    const isNewUser = getAdditionalUserInfo(result)?.isNewUser ?? false;
    track(isNewUser ? 'sign_up' : 'login', { method: 'google' });
  } catch {
    // Never let analytics break the sign-in flow.
  }
}

// Popup failures that mean "this environment can't do popups" — fall back to
// the full-page redirect flow instead of surfacing an error to the user.
const POPUP_UNSUPPORTED_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

/**
 * Sign in with Google.
 *
 * Uses a popup where possible. Installed PWAs (iOS home-screen apps in
 * particular) open popups in a detached in-app browser that can't communicate
 * the result back to the app, so the full-page redirect flow is used there —
 * and as a fallback when the popup is blocked. The redirect result is consumed
 * by {@link completeRedirectSignIn} on the next app load.
 *
 * @returns The signed-in user, or `null` when a redirect flow has started and
 *          the page is navigating away.
 */
export const signInWithGoogle = async (): Promise<User | null> => {
  if (isPWA()) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    trackSignIn(result);
    return result.user;
  } catch (error: unknown) {
    if (error instanceof FirebaseError && POPUP_UNSUPPORTED_CODES.has(error.code)) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    console.error('Error signing in with Google:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to sign in with Google';
    throw new Error(errorMessage);
  }
};

/**
 * Complete a pending redirect sign-in, if any. Call once on app start.
 *
 * The signed-in user is delivered through onAuthStateChanged like any other
 * sign-in; this exists to surface redirect-flow errors (which would otherwise
 * be silently dropped) to the caller.
 */
// getRedirectResult consumes the pending redirect state, so concurrent calls
// (e.g. the doubled effect mount under React StrictMode in dev) must share a
// single promise instead of racing each other.
let redirectResultPromise: Promise<UserCredential | null> | null = null;

export const completeRedirectSignIn = async (): Promise<void> => {
  // Resolves with null when there is no pending redirect, so this is a cheap
  // no-op on normal app loads.
  redirectResultPromise ??= getRedirectResult(auth);
  const result = await redirectResultPromise;
  if (result) trackSignIn(result);
};

/**
 * Sign out the current user
 */
export const signOut = async (): Promise<void> => {
  try {
    await firebaseSignOut(auth);
  } catch (error: unknown) {
    console.error('Error signing out:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to sign out';
    throw new Error(errorMessage);
  }
};
