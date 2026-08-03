import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRecapForWeek } from '@/hooks/useRecapForWeek';
import type { WeeklyRecap } from '@/types/schema';

const fetchStoredRecap = vi.fn<(isoWeek: string) => Promise<WeeklyRecap | null>>();
const loadAllTransactions = vi.fn(async () => []);

const mockCore = {
  recaps: [] as WeeklyRecap[],
  members: [{ uid: 'u1', displayName: 'Jen' }],
  fetchStoredRecap,
};
const mockFinance = {
  transactions: [
    { id: 't1', amount: 42, category: 'Groceries', date: '2026-06-30', status: 'verified' as const },
  ],
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
    mockFinance.transactionWindowStart = null;
    mockFinance.hasMoreTransactions = false;
    fetchStoredRecap.mockResolvedValue(null);
  });

  it('returns nothing for a null isoWeek and never touches fetchStoredRecap', () => {
    const { result } = renderHook(() => useRecapForWeek(null));
    expect(result.current).toEqual({ recap: null, source: null });
    expect(fetchStoredRecap).not.toHaveBeenCalled();
  });

  it('prefers a stored recap already in the live `recaps` window, with no fetch at all', () => {
    const stored = makeStoredRecap();
    mockCore.recaps = [stored];
    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));
    expect(result.current).toEqual({ recap: stored, source: 'stored' });
    expect(fetchStoredRecap).not.toHaveBeenCalled();
  });

  it('falls back to an on-demand stored-doc fetch for a week outside the live window, and prefers it once found', async () => {
    const olderStored = makeStoredRecap({ narrative: 'An older week, fetched on demand.' });
    fetchStoredRecap.mockResolvedValue(olderStored);
    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));

    // Not resolved yet — never a half-built placeholder.
    expect(result.current.recap).toBeNull();

    await waitFor(() => expect(result.current.recap).not.toBeNull());
    expect(result.current).toEqual({ recap: olderStored, source: 'stored' });
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
    expect(result.current.recap?.premium).toBe(false);
  });

  it('withholds a derived recap (never a wrong $0) until out-of-window transactions finish loading', async () => {
    // The live window starts well after the recap's prior week — money isn't
    // safe to trust yet.
    mockFinance.transactionWindowStart = '2026-07-01';
    mockFinance.hasMoreTransactions = true;
    fetchStoredRecap.mockResolvedValue(null);

    const { result } = renderHook(() => useRecapForWeek(ISO_WEEK));

    await waitFor(() => expect(fetchStoredRecap).toHaveBeenCalled());
    // Still nothing — the money figures can't be trusted yet.
    expect(result.current).toEqual({ recap: null, source: null });
    await waitFor(() => expect(loadAllTransactions).toHaveBeenCalledTimes(1));
  });

  it('returns nothing for a malformed isoWeek rather than a broken/half-built recap', async () => {
    fetchStoredRecap.mockResolvedValue(null);
    const { result } = renderHook(() => useRecapForWeek('not-a-week'));
    await waitFor(() => expect(fetchStoredRecap).toHaveBeenCalled());
    expect(result.current).toEqual({ recap: null, source: null });
  });
});
