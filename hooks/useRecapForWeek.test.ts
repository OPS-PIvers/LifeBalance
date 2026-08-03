import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRecapForWeek } from '@/hooks/useRecapForWeek';
import type { Household, WeeklyRecap } from '@/types/schema';

const fetchStoredRecap = vi.fn<(isoWeek: string) => Promise<WeeklyRecap | null>>();
const loadAllTransactions = vi.fn(async () => []);
const mockBillingEnabled = vi.fn(() => false);

const ALL_LISTENERS_READY = { transactions: true, habits: true, members: true, calendarItems: true };

const mockCore = {
  recaps: [] as WeeklyRecap[],
  members: [{ uid: 'u1', displayName: 'Jen' }],
  fetchStoredRecap,
  household: undefined as Pick<Household, 'subscription'> | undefined,
  listenersReady: { ...ALL_LISTENERS_READY },
};
const SEED_TRANSACTIONS = [
  { id: 't1', amount: 42, category: 'Groceries', date: '2026-06-30', status: 'verified' as const },
];
const mockFinance = {
  transactions: [...SEED_TRANSACTIONS],
  calendarItems: [] as { id: string; title: string; amount: number; date: string; type: 'income' | 'expense'; isPaid: boolean }[],
  transactionWindowStart: null as string | null,
  hasMoreTransactions: false,
  loadAllTransactions,
};
const mockGamification = { habits: [] as unknown[] };

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
  useFinance: () => mockFinance,
  useGamification: () => mockGamification,
}));
vi.mock('@/hooks/useBillingEnabled', () => ({
  useBillingEnabled: () => mockBillingEnabled(),
}));

const ISO_WEEK = '2026-W27'; // Mon 2026-06-29 → Sun 2026-07-05, same anchor as recapAssembly.test.ts

const makeStoredRecap = (overrides: Partial<WeeklyRecap> = {}): WeeklyRecap => ({
  id: ISO_WEEK,
  isoWeek: ISO_WEEK,
  generatedAt: new Date().toISOString(),
  totalSpend: 300,
  priorWeekSpend: 250,
  topCategoryDeltas: [],
  habitCompletions: 5,
  streaksAtRisk: [],
  pointsByMember: [],
  upcomingBills: [],
  narrative: 'A real, server-written narrative.',
  narrativeSource: 'ai',
  premium: true,
  ...overrides,
});

describe('useRecapForWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCore.recaps = [];
    mockCore.household = undefined;
    mockCore.listenersReady = { ...ALL_LISTENERS_READY };
    mockFinance.transactions = [...SEED_TRANSACTIONS];
    mockFinance.transactionWindowStart = null;
    mockFinance.hasMoreTransactions = false;
    // Restored explicitly: one test below swaps in a delegating wrapper to
    // change this dependency's IDENTITY without changing the spy it reports to.
    mockFinance.loadAllTransactions = loadAllTransactions;
    mockGamification.habits = [];
    loadAllTransactions.mockImplementation(async () => {
      // The real mutation's success path always ends the "more to load"
      // state; that flip is precisely what the hook reads as "the load
      // worked" (see its historyLoadFailed comment).
      mockFinance.hasMoreTransactions = false;
      return [];
    });
    mockBillingEnabled.mockReturnValue(false);
    fetchStoredRecap.mockResolvedValue(null);
  });

  it('returns nothing for a null isoWeek and never touches fetchStoredRecap', () => {
    const { result } = renderHook(() => useRecapForWeek(null));
    expect(result.current.recap).toBeNull();
    expect(result.current.source).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(fetchStoredRecap).not.toHaveBeenCalled();
  });

  it('prefers a stored recap already in the live `recaps` window, with no fetch at all', () => {
    const stored = makeStoredRecap();
    mockCore.recaps = [stored];
    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
    expect(result.current.recap).toBe(stored);
    expect(result.current.source).toBe('stored');
    expect(result.current.status).toBe('ready');
    expect(fetchStoredRecap).not.toHaveBeenCalled();
  });

  it('falls back to an on-demand stored-doc fetch for a week outside the live window, and prefers it once found', async () => {
    const olderStored = makeStoredRecap({ narrative: 'An older week, fetched on demand.' });
    fetchStoredRecap.mockResolvedValue(olderStored);
    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));

    // Not resolved yet — never a half-built placeholder.
    expect(result.current.recap).toBeNull();

    await waitFor(() => expect(result.current.recap).not.toBeNull());
    expect(result.current.recap).toBe(olderStored);
    expect(result.current.source).toBe('stored');
    expect(result.current.status).toBe('ready');
    expect(fetchStoredRecap).toHaveBeenCalledWith(ISO_WEEK);
    expect(fetchStoredRecap).toHaveBeenCalledTimes(1);
  });

  it('derives a recap from live state once the on-demand fetch confirms no stored doc exists', async () => {
    fetchStoredRecap.mockResolvedValue(null);
    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));

    await waitFor(() => expect(result.current.recap).not.toBeNull());
    expect(result.current.source).toBe('derived');
    expect(result.current.recap?.totalSpend).toBe(42); // the one seeded transaction
    expect(result.current.recap?.narrative).toBe(''); // honest — nothing generated
    // Billing is dormant (the default in every test here unless overridden) —
    // every household is premium, so this must NOT be false. See the
    // "premium truthfulness" describe block below for the full matrix.
    expect(result.current.recap?.premium).toBe(true);
  });

  describe('premium truthfulness — never inferred from the absence of a narrative', () => {
    // A prior version of useRecapForWeek/deriveWeeklyRecap hardcoded
    // `premium: false` on every derived recap (to route the drawer's
    // narrative section into its paywall fallback). That told every
    // currently-real household — billing is off, so ALL of them are
    // premium — that it lacked something it already has. These pin the fix:
    // `premium` reflects the household's actual entitlement
    // (`resolveIsPremiumHousehold`), completely independent of whether a
    // narrative exists (a derived recap never has one).

    it('is premium=true while billing is dormant, regardless of subscription — narrative is still empty', async () => {
      mockBillingEnabled.mockReturnValue(false);
      mockCore.household = { subscription: undefined };
      fetchStoredRecap.mockResolvedValue(null);
      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.recap).not.toBeNull());
      expect(result.current.recap?.narrative).toBe('');
      expect(result.current.recap?.premium).toBe(true);
    });

    it('once billing is live, is premium=true for an active subscription — narrative is still empty', async () => {
      mockBillingEnabled.mockReturnValue(true);
      mockCore.household = { subscription: { plan: 'premium', status: 'active' } };
      fetchStoredRecap.mockResolvedValue(null);
      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.recap).not.toBeNull());
      expect(result.current.recap?.narrative).toBe('');
      expect(result.current.recap?.premium).toBe(true);
    });

    it('once billing is live, is premium=false for a household with no subscription — the true free-tier answer', async () => {
      mockBillingEnabled.mockReturnValue(true);
      mockCore.household = { subscription: undefined };
      fetchStoredRecap.mockResolvedValue(null);
      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.recap).not.toBeNull());
      expect(result.current.recap?.premium).toBe(false);
    });
  });

  it('withholds a derived recap (never a wrong $0) until out-of-window transactions finish loading', async () => {
    // The live window starts well after the recap's prior week — money isn't
    // safe to trust yet.
    mockFinance.transactionWindowStart = '2026-07-01';
    mockFinance.hasMoreTransactions = true;
    // Never settles — this test is about the in-flight state.
    loadAllTransactions.mockImplementation(() => new Promise<never[]>(() => {}));
    fetchStoredRecap.mockResolvedValue(null);

    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));

    await waitFor(() => expect(fetchStoredRecap).toHaveBeenCalled());
    // Still nothing — the money figures can't be trusted yet.
    expect(result.current.recap).toBeNull();
    expect(result.current.status).toBe('pending');
    await waitFor(() => expect(loadAllTransactions).toHaveBeenCalledTimes(1));
  });

  it('returns nothing for a malformed isoWeek rather than a broken/half-built recap', async () => {
    fetchStoredRecap.mockResolvedValue(null);
    const { result } = renderHook(() => useRecapForWeek('not-a-week'));
    await waitFor(() => expect(fetchStoredRecap).toHaveBeenCalled());
    expect(result.current.recap).toBeNull();
    expect(result.current.source).toBeNull();
    expect(result.current.status).toBe('error');
  });

  describe('listener readiness — an empty array is NOT an empty week', () => {
    // BLOCKING-1: `isLoading` is set by the household DOCUMENT listener alone,
    // and the transactions listener is not even attached until it flips. So
    // "not loading, arrays empty" is the app's normal first few hundred ms —
    // deriving there yields a confident "$0 spent, 0 habits", which the
    // auto-open caller would then mark as shown FOREVER for that ISO week.

    it.each([
      ['transactions'],
      ['habits'],
      ['members'],
      ['calendarItems'],
    ] as const)('withholds the derivation while the %s listener has not delivered', async (key) => {
      mockCore.listenersReady = { ...ALL_LISTENERS_READY, [key]: false };
      fetchStoredRecap.mockResolvedValue(null);

      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(fetchStoredRecap).toHaveBeenCalled());

      expect(result.current.recap).toBeNull();
      expect(result.current.source).toBeNull();
      expect(result.current.status).toBe('pending');
    });

    it('resolves the moment the last pending listener delivers', async () => {
      mockCore.listenersReady = { ...ALL_LISTENERS_READY, transactions: false };
      fetchStoredRecap.mockResolvedValue(null);

      const { result, rerender } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(fetchStoredRecap).toHaveBeenCalled());
      expect(result.current.status).toBe('pending');

      mockCore.listenersReady = { ...ALL_LISTENERS_READY };
      rerender();

      await waitFor(() => expect(result.current.recap).not.toBeNull());
      expect(result.current.source).toBe('derived');
      expect(result.current.recap?.totalSpend).toBe(42);
    });

    it('STILL resolves for a household that genuinely recorded nothing that week', async () => {
      // The bug must not be traded for "never opens": readiness is a delivery
      // flag, not an array-length check, so a real empty week resolves —
      // honestly empty — as soon as the listeners answer.
      mockFinance.transactions = [];
      mockGamification.habits = [];
      fetchStoredRecap.mockResolvedValue(null);

      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));

      await waitFor(() => expect(result.current.recap).not.toBeNull());
      expect(result.current.source).toBe('derived');
      expect(result.current.status).toBe('ready');
      expect(result.current.recap?.totalSpend).toBe(0);
      expect(result.current.recap?.habitCompletions).toBe(0);
    });
  });

  describe('a failed history load is recoverable, not permanent', () => {
    // SHOULD-FIX 3: `loadAllTransactions` swallows its own error (it toasts
    // and returns the unchanged list — semantics shared with export/analytics
    // and deliberately untouched), so a failure used to leave `needsMoney`
    // true forever with the one-shot trigger guard already spent.
    const failLoad = () => {
      loadAllTransactions.mockImplementation(async () => {
        // The real catch block leaves hasMoreTransactions alone.
        return [];
      });
    };

    beforeEach(() => {
      mockFinance.transactionWindowStart = '2026-07-01';
      mockFinance.hasMoreTransactions = true;
      fetchStoredRecap.mockResolvedValue(null);
    });

    it('surfaces status:error instead of hanging on pending forever', async () => {
      failLoad();
      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.recap).toBeNull();
      expect(loadAllTransactions).toHaveBeenCalledTimes(1);
    });

    it('retry() re-attempts the load and resolves once it succeeds', async () => {
      failLoad();
      const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.status).toBe('error'));

      // The next attempt works (transient failure — e.g. a dropped connection).
      loadAllTransactions.mockImplementation(async () => {
        mockFinance.hasMoreTransactions = false;
        return [];
      });
      result.current.retry();

      await waitFor(() => expect(result.current.recap).not.toBeNull());
      expect(result.current.status).toBe('ready');
      expect(result.current.source).toBe('derived');
      expect(loadAllTransactions).toHaveBeenCalledTimes(2);
    });

    // The trigger guard (`triggeredAttemptRef.current === attempt`) only bites
    // when the effect BODY actually re-runs on an unchanged `attempt`. A bare
    // rerender() with untouched dependencies is no-oped by React's own
    // dependency array, so it exercises nothing — these two drive real re-runs
    // instead. Deleting the guard must fail them.

    it('does NOT re-read the full history when the transactions listener re-delivers', async () => {
      failLoad();
      const { result, rerender } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(loadAllTransactions).toHaveBeenCalledTimes(1);

      // A real re-subscribe (household re-attach / pay-period window change)
      // drops `listenersReady.transactions` and raises it again — a genuine
      // dependency change, so the effect body runs a second time with the SAME
      // attempt. Only the guard stops a second full-history read.
      mockCore.listenersReady = { ...ALL_LISTENERS_READY, transactions: false };
      rerender();
      mockCore.listenersReady = { ...ALL_LISTENERS_READY };
      rerender();

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(loadAllTransactions).toHaveBeenCalledTimes(1);
      // Positive control: the guard suppresses AUTOMATIC re-runs only — an
      // explicit retry still gets through, so a passing assertion above can't
      // just mean "the effect never ran again for any reason".
      result.current.retry();
      await waitFor(() => expect(loadAllTransactions).toHaveBeenCalledTimes(2));
    });

    it('does NOT re-read the full history when an unrelated dependency changes identity', async () => {
      failLoad();
      const { result, rerender } = renderHook(() => useRecapForWeek(ISO_WEEK));
      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(loadAllTransactions).toHaveBeenCalledTimes(1);

      // `loadAllTransactions` is a useCallback in the real provider; any of its
      // deps changing hands this hook a fresh identity, re-running the effect
      // with an unchanged `attempt`. The delegating wrapper keeps the call
      // count observable on the same spy.
      mockFinance.loadAllTransactions = vi.fn(async () => loadAllTransactions());
      rerender();

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(loadAllTransactions).toHaveBeenCalledTimes(1);
    });
  });
});
