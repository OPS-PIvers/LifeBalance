import { db } from '@/firebase.config';
import { doc, getDoc } from 'firebase/firestore';

/**
 * Reader for the shared `app_config/global` Firestore doc — the same operator
 * config document `geminiService.getAiEnabled()` uses as the AI kill-switch.
 *
 * This module owns the `openSignup` flag, which gates new-user signup:
 *
 *   - `openSignup === true`  → signup is OPEN to any Google user; the
 *     `beta_testers` allowlist in `AuthContext` is skipped entirely.
 *   - field absent / `false` → the `beta_testers` allowlist stays enforced
 *     (Private Alpha — current behavior).
 *
 * A human flips it WITHOUT a deploy by setting
 * `app_config/global.openSignup = true` in the Firestore console. When opening
 * signup, also add the production origin to Firebase Auth → Settings →
 * Authorized domains so Google Sign-In is permitted from it.
 *
 * Fail-safe direction is the OPPOSITE of the AI kill-switch: this guards
 * *access*, so it fails CLOSED — a missing doc, absent field, or read error
 * returns `false`, keeping the allowlist enforced rather than accidentally
 * throwing signup open.
 */

/** How long (ms) to reuse a cached value before re-fetching. */
const OPEN_SIGNUP_CACHE_TTL_MS = 60_000;

/**
 * Cache the in-flight promise (not just the resolved value) so concurrent reads
 * during a cold/expired cache window collapse onto a single Firestore read.
 */
let openSignupPromise: Promise<boolean> | null = null;
let openSignupFetchedAt = 0;

/**
 * Returns the current `openSignup` flag from the global app config.
 *
 * Fails CLOSED (returns `false`) when the doc is missing, the field is absent,
 * or the read throws — so the `beta_testers` allowlist remains enforced unless
 * an operator has explicitly set `openSignup: true`.
 */
export const getOpenSignup = (): Promise<boolean> => {
  const now = Date.now();
  if (openSignupPromise !== null && now - openSignupFetchedAt < OPEN_SIGNUP_CACHE_TTL_MS) {
    return openSignupPromise;
  }

  openSignupFetchedAt = now;
  openSignupPromise = (async (): Promise<boolean> => {
    try {
      const globalConfigRef = doc(db, 'app_config', 'global');
      const snap = await getDoc(globalConfigRef);
      return snap.exists() ? snap.data().openSignup === true : false;
    } catch {
      // Fail closed: keep the allowlist enforced if config is unreachable. Clear
      // the cache so the next call retries rather than caching the fallback.
      openSignupPromise = null;
      return false;
    }
  })();

  return openSignupPromise;
};
