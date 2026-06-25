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

/** How long (ms) to reuse a cached billing-enabled value before re-fetching. */
const BILLING_ENABLED_CACHE_TTL_MS = 60_000;

let billingEnabledPromise: Promise<boolean> | null = null;
let billingEnabledFetchedAt = 0;

/**
 * Returns the current `billingEnabled` flag from the global app config (Plan 050).
 *
 * Gates the entire freemium surface: the upgrade UI AND the plan-aware AI cap. It
 * fails CLOSED (returns `false`) when the doc is missing, the field is absent, or
 * the read throws, so billing stays **dormant / free-tier-permissive** unless an
 * operator has explicitly set the boolean `billingEnabled: true`. While off, no
 * upgrade UI shows and the AI quota keeps its legacy cap for everyone — so flipping
 * this is what actually launches the tiered limits. A human flips it WITHOUT a
 * deploy in the Firestore console (effective within ~60 s).
 */
export const getBillingEnabled = (): Promise<boolean> => {
  const now = Date.now();
  if (billingEnabledPromise !== null && now - billingEnabledFetchedAt < BILLING_ENABLED_CACHE_TTL_MS) {
    return billingEnabledPromise;
  }

  billingEnabledFetchedAt = now;
  billingEnabledPromise = (async (): Promise<boolean> => {
    try {
      const globalConfigRef = doc(db, 'app_config', 'global');
      const snap = await getDoc(globalConfigRef);
      return snap.exists() ? snap.data().billingEnabled === true : false;
    } catch {
      // Fail closed: keep billing dormant if config is unreachable. Clear the cache
      // so the next call retries rather than caching the fallback.
      billingEnabledPromise = null;
      return false;
    }
  })();

  return billingEnabledPromise;
};

/** How long (ms) to reuse a cached kid-mode-enabled value before re-fetching. */
const KID_MODE_ENABLED_CACHE_TTL_MS = 60_000;

let kidModeEnabledPromise: Promise<boolean> | null = null;
let kidModeEnabledFetchedAt = 0;

/**
 * Returns the current `kidModeEnabled` flag from the global app config (Plan 080).
 *
 * Gates the entire Kid Mode surface: the profile switcher and the kid views. It
 * fails CLOSED (returns `false`) when the doc is missing, the field is absent, or
 * the read throws, so Kid Mode stays **dormant** unless an operator has explicitly
 * set the boolean `kidModeEnabled: true`. While off, no switcher or kid view shows
 * and households behave exactly as before. A human flips it WITHOUT a deploy in the
 * Firestore console (effective within ~60 s).
 */
export const getKidModeEnabled = (): Promise<boolean> => {
  // DEV + TEST-MODE ONLY short-circuit. In Test Mode the mock backend can't reach
  // `app_config/global`, so the real read below would fail closed and the entire
  // Kid Mode surface would be unreachable for an AI agent walking the app. When we
  // detect the same session signal the rest of the app uses to swap in the mock
  // providers (`sessionStorage['LIFEBALANCE_TEST_MODE'] === 'true'`, set by
  // pages/Login.tsx and read in App.tsx), enable Kid Mode. The whole branch is
  // guarded by `import.meta.env.DEV`, so Vite/Rollup dead-code-eliminates it from
  // production builds — it can NEVER be true in prod, preserving dormancy. We early
  // -return WITHOUT touching the cache vars so production reads stay unaffected.
  if (
    import.meta.env.DEV &&
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem('LIFEBALANCE_TEST_MODE') === 'true'
  ) {
    return Promise.resolve(true);
  }

  const now = Date.now();
  if (kidModeEnabledPromise !== null && now - kidModeEnabledFetchedAt < KID_MODE_ENABLED_CACHE_TTL_MS) {
    return kidModeEnabledPromise;
  }

  kidModeEnabledFetchedAt = now;
  kidModeEnabledPromise = (async (): Promise<boolean> => {
    try {
      const globalConfigRef = doc(db, 'app_config', 'global');
      const snap = await getDoc(globalConfigRef);
      return snap.exists() ? snap.data().kidModeEnabled === true : false;
    } catch {
      // Fail closed: keep Kid Mode dormant if config is unreachable. Clear the cache
      // so the next call retries rather than caching the fallback.
      kidModeEnabledPromise = null;
      return false;
    }
  })();

  return kidModeEnabledPromise;
};
