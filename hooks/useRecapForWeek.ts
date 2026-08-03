import { useEffect, useMemo, useRef, useState } from 'react';
import { useFinance, useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { deriveWeeklyRecap, transactionsCoverWeek } from '@/utils/recapCompose';
import { weekRangeForIsoWeek } from '@/utils/recapWeek';
import type { WeeklyRecap } from '@/types/schema';

export type RecapSource = 'stored' | 'derived';

export interface RecapForWeekResult {
  /**
   * A `WeeklyRecap`-shaped object ready to hand to `WeeklyRecapDrawer`, or
   * `null` while the answer isn't ready yet (still resolving an on-demand
   * stored-doc lookup, still loading the transaction history a derived
   * week's money figures need, or `isoWeek` itself is malformed/absent).
   * Deliberately never a half-computed or zeroed placeholder — see
   * `utils/recapCompose.ts`'s `transactionsCoverWeek`.
   */
  recap: WeeklyRecap | null;
  /** `null` exactly when `recap` is `null`. */
  source: RecapSource | null;
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
 *     calendarItems / transactions already held in context. Real numbers,
 *     no narrative — `WeeklyRecapDrawer`'s existing premium gate (untouched;
 *     out of this task's scope) is the only available lever to keep that
 *     section from rendering blank space, so derived recaps are composed
 *     with `premium: false` on purpose. See `recapCompose.ts`'s doc comment.
 *
 * `pass isoWeek={null}` (nothing requested yet) short-circuits to
 * `{ recap: null, source: null }` without touching any context slice's data.
 */
export function useRecapForWeek(isoWeek: string | null): RecapForWeekResult {
  const { recaps, fetchStoredRecap, members } = useHouseholdCore();
  const { habits } = useGamification();
  const { transactions, calendarItems, transactionWindowStart, hasMoreTransactions, loadAllTransactions } =
    useFinance();

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

  // Money honesty: a derived week's spend/category figures depend on
  // transactions that may sit outside the live 90-day window. Trigger the
  // existing `loadAllTransactions()` helper (already used by
  // analytics/export flows) at most once — `hasMoreTransactions` flipping to
  // `false` is itself the "now covered" signal for every `useRecapForWeek`
  // instance, live or future, so a second call is never needed.
  const needsMoney = !!range && !transactionsCoverWeek(range, transactionWindowStart, hasMoreTransactions);
  const loadAllTriggeredRef = useRef(false);
  useEffect(() => {
    if (!needsMoney || loadAllTriggeredRef.current) return;
    loadAllTriggeredRef.current = true;
    // `loadAllTransactions` sets state that belongs to the household
    // context's OWN provider, not this hook's — calling it here is a plain
    // function call, not a same-component setState-in-effect.
    void loadAllTransactions();
  }, [needsMoney, loadAllTransactions]);

  return useMemo<RecapForWeekResult>(() => {
    if (!isoWeek) return { recap: null, source: null };
    if (stored) return { recap: stored, source: 'stored' };
    if (fetchedStored === undefined) return { recap: null, source: null }; // still resolving
    if (fetchedStored) return { recap: fetchedStored, source: 'stored' };
    if (!range) return { recap: null, source: null }; // malformed isoWeek
    if (needsMoney) return { recap: null, source: null }; // history still loading
    return { recap: deriveWeeklyRecap(range, { transactions, habits, members, calendarItems }), source: 'derived' };
  }, [isoWeek, stored, fetchedStored, range, needsMoney, transactions, habits, members, calendarItems]);
}
