import { db } from '@/firebase.config';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
 * `app_config/global.openSignup = true` in the Firestore console, or live via
 * Settings → Developer Console → Feature Flags. When opening signup, also add the
 * production origin to Firebase Auth → Settings → Authorized domains so Google
 * Sign-In is permitted from it.
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
 * deploy in the Firestore console, or live via Settings → Developer Console →
 * Feature Flags (effective within ~60 s).
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
 * Firestore console, or live via Settings → Developer Console → Feature Flags
 * (effective within ~60 s).
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

/** How long (ms) to reuse a cached plaid-enabled value before re-fetching. */
const PLAID_ENABLED_CACHE_TTL_MS = 60_000;

let plaidEnabledPromise: Promise<boolean> | null = null;
let plaidEnabledFetchedAt = 0;

/**
 * Returns the current `plaidEnabled` flag from the global app config.
 *
 * Gates the entire "Connect a bank (Plaid)" surface. Fails CLOSED (returns
 * `false`) when the doc is missing, the field is absent, or the read throws, so
 * Plaid stays **dormant** unless an operator has explicitly set the boolean
 * `plaidEnabled: true`. While off, no bank-link UI shows. Flip it WITHOUT a
 * deploy in the Firestore console, or live via Settings → Developer Console →
 * Feature Flags (effective within ~60 s). No Test-Mode short-circuit (like
 * `getBillingEnabled`): Plaid Link can't work against the mock backend.
 */
export const getPlaidEnabled = (): Promise<boolean> => {
  const now = Date.now();
  if (plaidEnabledPromise !== null && now - plaidEnabledFetchedAt < PLAID_ENABLED_CACHE_TTL_MS) {
    return plaidEnabledPromise;
  }

  plaidEnabledFetchedAt = now;
  plaidEnabledPromise = (async (): Promise<boolean> => {
    try {
      const globalConfigRef = doc(db, 'app_config', 'global');
      const snap = await getDoc(globalConfigRef);
      return snap.exists() ? snap.data().plaidEnabled === true : false;
    } catch {
      // Fail closed: keep Plaid dormant if config is unreachable.
      plaidEnabledPromise = null;
      return false;
    }
  })();

  return plaidEnabledPromise;
};

/**
 * The exact field name of the AI master kill-switch on `app_config/global`, owned
 * by `geminiService.getAiEnabled()`. Unlike the other three flags it is **fail-OPEN**:
 * AI is ON unless this field is explicitly the boolean `false`.
 */
export const AI_ENABLED_FLAG_KEY = 'aiEnabled' as const;

/** How long (ms) to reuse a cached power-tools-enabled value before re-fetching. */
const POWER_TOOLS_ENABLED_CACHE_TTL_MS = 60_000;

let powerToolsEnabledPromise: Promise<boolean> | null = null;
let powerToolsEnabledFetchedAt = 0;

/**
 * The exact field name of the power-tools flag on `app_config/global` (Plan 17,
 * June-2026 bloat audit §[4]). Like `aiEnabled` it is **fail-OPEN**: the gated
 * surfaces stay ON unless this field is explicitly the boolean `false`.
 */
export const POWER_TOOLS_FLAG_KEY = 'powerToolsEnabled' as const;

/**
 * Returns the current `powerToolsEnabled` flag from the global app config.
 *
 * Gates a set of power-user/AI-heavy surfaces (HabitCoach, Smart Adjust/Reorder,
 * grocery "Optimize with AI", BudgetHistory, SavedViewChips, YearlyGoal UI) that the
 * June-2026 bloat audit recommended parking behind a kill-switch. It fails OPEN
 * (returns `true`) when the doc is missing, the field is absent, or the read throws,
 * so shipping this flag is behavior-neutral until an operator explicitly sets
 * `powerToolsEnabled: false`. A human flips it WITHOUT a deploy in the Firestore
 * console, or live via Settings → Developer Console → Feature Flags (effective
 * within ~60 s).
 */
export const getPowerToolsEnabled = (): Promise<boolean> => {
  const now = Date.now();
  if (
    powerToolsEnabledPromise !== null &&
    now - powerToolsEnabledFetchedAt < POWER_TOOLS_ENABLED_CACHE_TTL_MS
  ) {
    return powerToolsEnabledPromise;
  }

  powerToolsEnabledFetchedAt = now;
  powerToolsEnabledPromise = (async (): Promise<boolean> => {
    try {
      const globalConfigRef = doc(db, 'app_config', 'global');
      const snap = await getDoc(globalConfigRef);
      return snap.exists() ? snap.data()[POWER_TOOLS_FLAG_KEY] !== false : true;
    } catch {
      // Fail open: keep the power-tool surfaces visible if config is unreachable.
      // Clear the cache so the next call retries rather than caching the fallback.
      powerToolsEnabledPromise = null;
      return true;
    }
  })();

  return powerToolsEnabledPromise;
};

/**
 * Reads `app_config/global` ONCE (not through the cached single-flag getters) and
 * returns all operator flags as their **effective** booleans — i.e. what the
 * running app actually does right now:
 *
 *   - `openSignup`, `billingEnabled`, `kidModeEnabled`, `plaidEnabled` — fail-CLOSED:
 *     `true` only when the field is the boolean `true`; absent / non-boolean /
 *     missing-doc → `false`.
 *   - `aiEnabled`, `powerToolsEnabled` — fail-OPEN to match `geminiService.getAiEnabled()`
 *     / `getPowerToolsEnabled()`: `true` unless the field is explicitly the boolean
 *     `false`. So an absent field or missing doc reads back as `true`, truthfully
 *     reflecting that the surface is live by default.
 *
 * Used by the admin Feature Flags panel so the toggles show the real effective state.
 * On read error every flag falls back to its fail-safe default (the fail-closed
 * gates → `false`, the fail-open switches → `true`).
 */
export const readAppConfigFlags = async (): Promise<Record<string, boolean>> => {
  try {
    const globalConfigRef = doc(db, 'app_config', 'global');
    const snap = await getDoc(globalConfigRef);
    const data = snap.exists() ? snap.data() : {};
    return {
      openSignup: data.openSignup === true,
      billingEnabled: data.billingEnabled === true,
      kidModeEnabled: data.kidModeEnabled === true,
      plaidEnabled: data.plaidEnabled === true,
      // Fail-open: only an explicit boolean false disables AI / power tools.
      [AI_ENABLED_FLAG_KEY]: data[AI_ENABLED_FLAG_KEY] !== false,
      [POWER_TOOLS_FLAG_KEY]: data[POWER_TOOLS_FLAG_KEY] !== false,
    };
  } catch {
    // Each flag falls back to its fail-safe default if the doc is unreachable.
    return {
      openSignup: false,
      billingEnabled: false,
      kidModeEnabled: false,
      plaidEnabled: false,
      [AI_ENABLED_FLAG_KEY]: true,
      [POWER_TOOLS_FLAG_KEY]: true,
    };
  }
};

/**
 * Writes a single operator flag to `app_config/global` with **merge** so the other
 * flags on the doc are never clobbered, then invalidates this module's caches so the
 * operator's own session re-reads the new value immediately (rather than waiting out
 * the 60 s TTL).
 *
 * Note: this does NOT reset `geminiService`'s separate kill-switch cache — callers
 * flipping the AI flag should also invoke `geminiService.resetAiEnabledCache()` so the
 * AI SDK module stays out of this SDK-free config module.
 */
export const setAppFlag = async (key: string, value: boolean): Promise<void> => {
  await setDoc(doc(db, 'app_config', 'global'), { [key]: value }, { merge: true });
  invalidateAppConfigCaches();
};

/**
 * Resets the module-level flag caches (promise → `null`, fetchedAt → `0`) so the
 * next `getOpenSignup` / `getBillingEnabled` / `getKidModeEnabled` / `getPlaidEnabled`
 * / `getPowerToolsEnabled` performs a fresh Firestore read instead of returning a
 * stale cached promise. Called by `setAppFlag` after a write so an operator sees
 * their change take effect at once.
 *
 * Does not touch `geminiService`'s kill-switch cache (that module owns the `aiEnabled`
 * read); reset it there via `resetAiEnabledCache()` to keep this module SDK-free.
 */
export const invalidateAppConfigCaches = (): void => {
  openSignupPromise = null;
  openSignupFetchedAt = 0;
  billingEnabledPromise = null;
  billingEnabledFetchedAt = 0;
  kidModeEnabledPromise = null;
  kidModeEnabledFetchedAt = 0;
  plaidEnabledPromise = null;
  powerToolsEnabledPromise = null;
  powerToolsEnabledFetchedAt = 0;
  plaidEnabledFetchedAt = 0;
};
