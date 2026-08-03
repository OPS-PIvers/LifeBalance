import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WeeklyRecap } from '@/types/schema';
import { track } from '@/services/analytics';

// The card reads recaps from the core slice; useFormatCurrency reads the same
// mocked context (householdSettings → default USD).
const mockCore = {
  recaps: [] as WeeklyRecap[],
  householdSettings: null,
  isLoading: false,
};
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

// The ISO week `lastClosedWeekRange()` resolves to for every test below —
// fixed rather than clock-dependent, so the auto-open tests don't have to
// reason about which real week "today" falls in.
const AUTO_OPEN_WEEK = '2026-W26';
vi.mock('@/utils/recapWeek', () => ({
  lastClosedWeekRange: () => ({ isoWeek: AUTO_OPEN_WEEK, weekStart: '2026-06-22', weekEnd: '2026-06-28' }),
}));

// ARCH-1's resolution hook (stored-or-derived) — stubbed to a plain lookup so
// this file can pin the CARD's own wiring (which isoWeek it asks for and what
// it does with the answer) without dragging in useFinance/useGamification
// mocks. `hooks/useRecapForWeek.test.ts` covers the hook's own resolution
// logic; `RecapArchiveDrawer.test.tsx` covers the archive list itself.
const mockUseRecapForWeek = vi.fn(
  (_isoWeek: string | null): { recap: WeeklyRecap | null; source: 'stored' | 'derived' | null } => ({
    recap: null,
    source: null,
  })
);
vi.mock('@/hooks/useRecapForWeek', () => ({
  useRecapForWeek: (isoWeek: string | null) => mockUseRecapForWeek(isoWeek),
}));

// Stub the Drawer-based detail view so the test stays off framer-motion and
// can assert open/close via a plain marker element.
vi.mock('@/components/dashboard/WeeklyRecapDrawer', () => ({
  WeeklyRecapDrawer: ({ isOpen, recap }: { isOpen: boolean; recap: WeeklyRecap | null }) =>
    isOpen && recap ? <div data-testid="recap-drawer">{recap.isoWeek}</div> : null,
}));

// Stub the archive list drawer too — its own listing/selection behaviour is
// pinned in RecapArchiveDrawer.test.tsx. Here it just needs to report when
// it's open and let a test simulate tapping a row.
vi.mock('@/components/dashboard/RecapArchiveDrawer', () => ({
  RecapArchiveDrawer: ({
    isOpen,
    onSelectWeek,
    pendingWeek,
  }: {
    isOpen: boolean;
    onSelectWeek: (isoWeek: string) => void;
    pendingWeek: string | null;
  }) =>
    isOpen ? (
      <div data-testid="archive-drawer">
        <button onClick={() => onSelectWeek('2026-W20')}>select-2026-W20</button>
        {pendingWeek && <span data-testid="archive-pending">{pendingWeek}</span>}
      </div>
    ) : null,
}));

import { WeeklyRecapCard } from './WeeklyRecapCard';

const makeRecap = (overrides: Partial<WeeklyRecap> = {}): WeeklyRecap => ({
  id: '2026-W27',
  isoWeek: '2026-W27',
  generatedAt: new Date().toISOString(),
  totalSpend: 412,
  priorWeekSpend: 468,
  topCategoryDeltas: [{ category: 'Groceries', current: 180, prior: 220 }],
  habitCompletions: 12,
  streaksAtRisk: [],
  pointsByMember: [],
  upcomingBills: [],
  narrative: 'A calm spending week — nice work.',
  narrativeSource: 'ai',
  premium: true,
  ...overrides,
});

describe('WeeklyRecapCard', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    mockCore.recaps = [];
    mockCore.isLoading = false;
    mockUseRecapForWeek.mockReset();
    mockUseRecapForWeek.mockImplementation(() => ({ recap: null, source: null }));
  });

  it('renders nothing (but keeps the drawer mount) without a recap', () => {
    render(<WeeklyRecapCard />);
    expect(screen.queryByText('Week of Jun 29')).not.toBeInTheDocument();
  });

  it('renders headline numbers and narrative for a fresh premium recap', () => {
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    expect(screen.getByText('Week of Jun 29')).toBeInTheDocument();
    expect(screen.getByText('$412')).toBeInTheDocument();
    expect(screen.getByText(/\$56 vs last week/)).toBeInTheDocument();
    expect(screen.getByText(/12 habits done/)).toBeInTheDocument();
    expect(screen.getByText('A calm spending week — nice work.')).toBeInTheDocument();
    expect(screen.queryByText(/Unlock your personal recap/)).not.toBeInTheDocument();
  });

  it('titles the card with the ISO week start date across a year boundary', () => {
    // 2026-W01's Monday falls in the PRIOR calendar year (2025-12-29) — the
    // classic ISO-week-year edge case CRIT-05 asked to be verified.
    mockCore.recaps = [makeRecap({ id: '2026-W01', isoWeek: '2026-W01' })];
    render(<WeeklyRecapCard />);
    expect(screen.getByText('Week of Dec 29')).toBeInTheDocument();
  });

  it('falls back to the generic title when isoWeek is malformed', () => {
    // isoWeekStartDate returns null for a well-formed-but-impossible (or
    // shape-invalid) week — a corrupted/hand-edited doc must render the
    // generic title instead of a confidently wrong date.
    mockCore.recaps = [makeRecap({ id: '2026-W60', isoWeek: '2026-W60' })];
    render(<WeeklyRecapCard />);
    expect(screen.getByText('Your week in review')).toBeInTheDocument();
    expect(screen.queryByText(/^Week of/)).not.toBeInTheDocument();
  });

  it('keeps the vs-last-week delta out of the spent/habits row (own line beneath it)', () => {
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    const spentAmount = screen.getByText('$412');
    const habitsStat = screen.getByText(/12 habits done/);
    const delta = screen.getByText(/\$56 vs last week/);
    // The amount and the habits stat share one row…
    const row = spentAmount.closest('.flex.items-baseline.justify-between');
    expect(row).not.toBeNull();
    expect(row?.contains(habitsStat)).toBe(true);
    // …but the delta is NOT part of that row (it sits in its own block below).
    expect(row?.contains(delta)).toBe(false);
  });

  it('hides the card when the recap is older than the freshness window', () => {
    mockCore.recaps = [
      makeRecap({ generatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    render(<WeeklyRecapCard />);
    expect(screen.queryByText('Week of Jun 29')).not.toBeInTheDocument();
  });

  it('locks the narrative behind an upsell row when premium is false', () => {
    mockCore.recaps = [makeRecap({ premium: false })];
    render(<WeeklyRecapCard />);
    // Numbers still show…
    expect(screen.getByText('$412')).toBeInTheDocument();
    // …but the narrative is aria-hidden (blurred) with the upsell row visible.
    expect(screen.getByText(/Unlock your personal recap with Premium/)).toBeInTheDocument();
    expect(screen.getByText('A calm spending week — nice work.')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('dismiss hides the card and persists per isoWeek in localStorage — but the archive trigger stays', () => {
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    fireEvent.click(screen.getByLabelText('Dismiss weekly recap'));
    expect(screen.queryByText('Week of Jun 29')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('lb_recap_dismissed_2026-W27')).toBe('1');

    // A re-mount (fresh state) stays hidden thanks to the persisted flag —
    // but the permanent "Past weeks" archive entry point is still reachable
    // (ARCH-1: the archive never expires, unlike the ephemeral card).
    render(<WeeklyRecapCard />);
    expect(screen.getAllByText('Past weeks').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Week of Jun 29')).toHaveLength(0);
  });

  it('opens the detail drawer on card tap and tracks recap_viewed', () => {
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Open weekly recap for 2026-W27'));
    expect(screen.getByTestId('recap-drawer')).toHaveTextContent('2026-W27');
    expect(track).toHaveBeenCalledWith('recap_viewed', { isoWeek: '2026-W27', source: 'card' });
  });

  it('auto-opens the drawer from the ?recap= deep link and tracks the push open', async () => {
    window.history.replaceState(null, '', '/?recap=2026-W27');
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    // The deep-link consume defers its setState to a macrotask — wait for it.
    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-W27');
    expect(track).toHaveBeenCalledWith('recap_push_opened');
    // recap_viewed fires in a passive effect after the drawer's commit — the
    // drawer can be queryable a beat before the effect runs, so wait for it.
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('recap_viewed', { isoWeek: '2026-W27', source: 'push' })
    );
    // The param is stripped from the address bar.
    expect(window.location.search).toBe('');
  });

  describe('ARCH-1 — auto-open the just-closed week', () => {
    const mockClosedWeekResolved = (recap: WeeklyRecap) => {
      mockUseRecapForWeek.mockImplementation((isoWeek: string | null) =>
        isoWeek === AUTO_OPEN_WEEK ? { recap, source: 'derived' as const } : { recap: null, source: null }
      );
    };

    it('opens the just-closed week once real data is ready, and marks it so it never fires again', async () => {
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);

      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() =>
        expect(window.localStorage.getItem(`lb_recap_autoopened_${AUTO_OPEN_WEEK}`)).toBe('1')
      );
    });

    it('does not fire while household data is still loading', async () => {
      mockCore.isLoading = true;
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(`lb_recap_autoopened_${AUTO_OPEN_WEEK}`)).toBeNull();
    });

    it('never fires twice for the same ISO week, including across a remount', async () => {
      window.localStorage.setItem(`lb_recap_autoopened_${AUTO_OPEN_WEEK}`, '1');
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
    });

    it('does not fire when the ?recap= deep link already targets a week this load', async () => {
      window.history.replaceState(null, '', '/?recap=2026-W27');
      mockCore.recaps = [makeRecap()]; // the pushed week
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);

      // The push target opens as usual…
      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-W27');
      // …but the auto-open target never got its turn.
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(window.localStorage.getItem(`lb_recap_autoopened_${AUTO_OPEN_WEEK}`)).toBeNull();
    });
  });

  describe('ARCH-1 — "Past weeks" archive', () => {
    it('is reachable from the card and opens the archive drawer', () => {
      mockCore.recaps = [makeRecap()];
      render(<WeeklyRecapCard />);
      expect(screen.queryByTestId('archive-drawer')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Past weeks'));
      expect(screen.getByTestId('archive-drawer')).toBeInTheDocument();
    });

    it('opens the detail drawer for whichever week is selected, once it resolves', async () => {
      mockCore.recaps = [makeRecap()];
      const selected = makeRecap({ id: '2026-W20', isoWeek: '2026-W20', narrative: 'An archived week.' });
      mockUseRecapForWeek.mockImplementation((isoWeek: string | null) =>
        isoWeek === '2026-W20' ? { recap: selected, source: 'derived' as const } : { recap: null, source: null }
      );
      render(<WeeklyRecapCard />);
      fireEvent.click(screen.getByText('Past weeks'));
      fireEvent.click(screen.getByText('select-2026-W20'));

      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-W20');
      expect(track).toHaveBeenCalledWith('recap_viewed', { isoWeek: '2026-W20', source: 'archive' });
    });
  });
});
