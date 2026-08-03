import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFinance, useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';
import { deriveWeeklyRecap, transactionsCoverWeek } from '@/utils/recapCompose';
import { resolveIsPremiumHousehold } from '@/utils/entitlements';
import { weekRangeForIsoWeek } from '@/utils/recapWeek';
import type { WeeklyRecap } from '@/types/schema';

export type RecapSource = 'stored' | 'derived';

/**
 * Why the requested week has (or hasn't) resolved. `recap` is non-null exactly
 * when this is `'ready'`.
 *
 *  - `idle`    — nothing requested (`isoWeek === null`).
 *  - `pending` — still resolving: an on-demand stored-doc lookup is in flight,
 *                a live listener hasn't delivered its first snapshot yet, or
 *                the out-of-window transaction history is still loading.
 *  - `ready`   — `recap` holds a real answer (stored or derived).
 *  - `error`   — resolution FAILED and will not resolve on its own: the
 *                transaction-history load errored (call `retry`), or the
 *                requested `isoWeek` is malformed (retrying can't help, but
 *                the archive only ever passes well-formed weeks).
 */
export type RecapForWeekStatus = 'idle' | 'pending' | 'ready' | 'error';

export interface RecapForWeekResult {
  /**
   * A `WeeklyRecap`-shaped object ready to hand to `WeeklyRecapDrawer`, or
   * `null` while the answer isn't ready yet (still resolving an on-demand
   * stored-doc lookup, still waiting on a live listener's first snapshot,
   * still loading the transaction history a derived week's money figures
   * need, or `isoWeek` itself is malformed/absent). Deliberately never a
   * half-computed or zeroed placeholder — see `utils/recapCompose.ts`'s
   * `transactionsCoverWeek` and `ListenerReadiness` in
   * `contexts/household/types.ts`.
   */
  recap: WeeklyRecap | null;
  /** `null` exactly when `recap` is `null`. */
  source: RecapSource | null;
  /** See `RecapForWeekStatus`. `'ready'` iff `recap !== null`. */
  status: RecapForWeekStatus;
  /**
   * Re-attempts a failed out-of-window transaction-history load. A no-op
   * unless `status === 'error'`. Deliberately caller-driven (one attempt per
   * user-initiated selection) rather than an automatic retry loop.
   */
  retry: () => void;
}

/**
 * ARCH-1 — resolves a full recap for ANY requested ISO week from LIVE client
 * state, so the app doesn't have to wait for Monday morning's server
 * generation. Preference order, matching "the server document remains the
 * source for the narrative":
 *
 *  1. A stored doc already in the bounded `recaps` live window
 *     (`RECAPS_LIMIT` weeks) — used verbatim, narrative and all.
 *  2. A stored doc fetched on demand (`fetchStoredRecap`) for a week outside
 *     that window. Still preferred over deriving once found — a household's
 *     older weeks keep their real AI narrative forever, not just for the
 *     first `RECAPS_LIMIT` weeks after generation.
 *  3. A CLIENT-DERIVED recap (`utils/recapCompose.ts`, wrapping the
 *     protected `utils/recapAssembly.ts`) built from the habits / members /
 *     calendarItems / transactions already held in context. Real numbers, no
 *     narrative (the absence itself is the signal — see `recapCompose.ts`'s
 *     doc comment) — but `premium` is still the household's TRUTHFUL plan
 *     status, resolved via `resolveIsPremiumHousehold` exactly the way a
 *     server-generated recap resolves it. Never hardcoded: a derived recap
 *     must not tell a non-billing (i.e. every current) household it lacks
 *     something it already has.
 *
 * 🛡️ DERIVATION NEVER RUNS OFF A LISTENER THAT HASN'T ANSWERED. `isLoading`
 * is set exclusively by the household DOCUMENT listener, and the transactions
 * listener isn't even attached until it flips false — so "isLoading === false"
 * plus empty `transactions`/`habits` arrays is the app's NORMAL first few
 * hundred milliseconds, not a real empty week. Deriving there produces a
 * confident "$0 spent, 0 habits completed", which the auto-open caller would
 * then mark as shown FOREVER for that ISO week. `listenersReady` (see
 * `ListenerReadiness`) is the disambiguator, and it is deliberately a
 * per-listener delivery flag rather than an array-length check: a household
 * that genuinely recorded nothing that week must still resolve — honestly
 * empty — the moment its listeners answer.
 *
 * `pass isoWeek={null}` (nothing requested yet) short-circuits to
 * `{ recap: null, source: null, status: 'idle' }` without touching any
 * context slice's data.
 */
export function useRecapForWeek(isoWeek: string | null): RecapForWeekResult {
  const { recaps, fetchStoredRecap, members, household, listenersReady } = useHouseholdCore();
  const { habits } = useGamification();
  const { transactions, calendarItems, transactionWindowStart, hasMoreTransactions, loadAllTransactions } =
    useFinance();
  const billingEnabled = useBillingEnabled();

  const stored = useMemo(
    () => (isoWeek ? (recaps.find(r => r.isoWeek === isoWeek) ?? null) : null),
    [isoWeek, recaps]
  );

  // On-demand stored-doc lookup for a week outside the live `recaps` window.
  // `fetchResult` is keyed by the isoWeek it answers so a prop change while a
  // fetch is in flight can't apply a stale answer to the new week.
  const [fetchResult, setFetchResult] = useState<{ isoWeek: string; recap: WeeklyRecap | null } | null>(null);
  const fetchAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isoWeek || stored) return;
    if (fetchAttemptedRef.current.has(isoWeek)) return;
    fetchAttemptedRef.current.add(isoWeek);
    // `fetchStoredRecap` is an external-system read (Firestore `getDoc`), not
    // derivable state — deferred to a macrotask so this effect body never
    // calls `setFetchResult` synchronously (same "external-input
    // subscription" restructuring `WeeklyRecapCard` already uses for its
    // push-param consume, rather than suppressing
    // react-hooks/set-state-in-effect).
    window.setTimeout(() => {
      void fetchStoredRecap(isoWeek).then(recap => setFetchResult({ isoWeek, recap }));
    }, 0);
  }, [isoWeek, stored, fetchStoredRecap]);

  const fetchedStored =
    fetchResult && isoWeek && fetchResult.isoWeek === isoWeek ? fetchResult.recap : undefined;

  const range = useMemo(() => (isoWeek ? weekRangeForIsoWeek(isoWeek) : null), [isoWeek]);

  // Every collection the derivation reads must have answered at least once —
  // see the doc comment above. `transactions` also has to COVER the requested
  // window, which is the separate `needsMoney` question below.
  const dataReady =
    listenersReady.transactions &&
    listenersReady.habits &&
    listenersReady.members &&
    listenersReady.calendarItems;

  // Money honesty: a derived week's spend/category figures depend on
  // transactions that may sit outside the live 90-day window. Trigger the
  // existing `loadAllTransactions()` helper (already used by
  // analytics/export flows) at most once per ATTEMPT — `hasMoreTransactions`
  // flipping to `false` is itself the "now covered" signal for every
  // `useRecapForWeek` instance, live or future, so a second call is never
  // needed on the happy path.
  const needsMoney = !!range && !transactionsCoverWeek(range, transactionWindowStart, hasMoreTransactions);

  // A FAILED load must not wedge the hook. `loadAllTransactions` swallows its
  // own error (it toasts and returns the unchanged list — semantics shared
  // with the export/analytics callers, deliberately left alone), so failure is
  // detected structurally instead: a SUCCESSFUL call always sets
  // `hasMoreTransactions` false, which makes `needsMoney` false. So
  // "the attempt for this nonce settled AND we still need money" IS the
  // failure signal — no change to that mutation's contract required.
  const [attempt, setAttempt] = useState(0);
  const [settledAttempt, setSettledAttempt] = useState<number | null>(null);
  const triggeredAttemptRef = useRef<number | null>(null);
  useEffect(() => {
    if (!needsMoney || !listenersReady.transactions) return;
    if (triggeredAttemptRef.current === attempt) return;
    triggeredAttemptRef.current = attempt;
    const thisAttempt = attempt;
    // `loadAllTransactions` sets state that belongs to the household
    // context's OWN provider, not this hook's — calling it here is a plain
    // function call, not a same-component setState-in-effect. The completion
    // bookkeeping IS this hook's own state, so it is deferred to a macrotask
    // like every other external-input write in this file.
    window.setTimeout(() => {
      void loadAllTransactions().finally(() => setSettledAttempt(thisAttempt));
    }, 0);
  }, [needsMoney, listenersReady.transactions, loadAllTransactions, attempt]);

  const historyLoadFailed = needsMoney && settledAttempt === attempt;

  const retry = useCallback(() => {
    // Bumping the attempt both re-arms the trigger guard and clears the
    // derived `historyLoadFailed` (settledAttempt now trails attempt), so the
    // caller's error affordance flips back to a spinner for the retry.
    setAttempt(n => n + 1);
  }, []);

  return useMemo<RecapForWeekResult>(() => {
    if (!isoWeek) return { recap: null, source: null, status: 'idle', retry };
    if (stored) return { recap: stored, source: 'stored', status: 'ready', retry };
    if (fetchedStored === undefined) return { recap: null, source: null, status: 'pending', retry }; // still resolving
    if (fetchedStored) return { recap: fetchedStored, source: 'stored', status: 'ready', retry };
    // Malformed isoWeek — terminal, but never reachable from the archive
    // (its rows come from `pastClosedWeeks`) or from auto-open.
    if (!range) return { recap: null, source: null, status: 'error', retry };
    if (historyLoadFailed) return { recap: null, source: null, status: 'error', retry };
    if (needsMoney) return { recap: null, source: null, status: 'pending', retry }; // history still loading
    if (!dataReady) return { recap: null, source: null, status: 'pending', retry }; // listeners haven't answered
    const premium = resolveIsPremiumHousehold(household ?? {}, billingEnabled);
    return {
      recap: deriveWeeklyRecap(range, { transactions, habits, members, calendarItems }, premium),
      source: 'derived',
      status: 'ready',
      retry,
    };
  }, [
    isoWeek,
    stored,
    fetchedStored,
    range,
    needsMoney,
    historyLoadFailed,
    dataReady,
    transactions,
    habits,
    members,
    calendarItems,
    household,
    billingEnabled,
    retry,
  ]);
}
