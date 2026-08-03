import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WeeklyRecap } from '@/types/schema';
import { track } from '@/services/analytics';
import { registerOpenDrawer, resetOpenDrawersForTest } from '@/utils/openDrawerRegistry';
import {
  resetNotificationOpenTypeForTest,
  trackNotificationOpenFromUrl,
} from '@/utils/notificationSource';

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
type MockRecapResult = {
  recap: WeeklyRecap | null;
  source: 'stored' | 'derived' | null;
  status: 'idle' | 'pending' | 'ready' | 'error';
  retry: () => void;
};
const retry = vi.fn();
const unresolved = (status: MockRecapResult['status'] = 'pending'): MockRecapResult => ({
  recap: null,
  source: null,
  status,
  retry,
});
const resolved = (recap: WeeklyRecap): MockRecapResult => ({
  recap,
  source: 'derived',
  status: 'ready',
  retry,
});
const mockUseRecapForWeek = vi.fn((_isoWeek: string | null): MockRecapResult => unresolved('idle'));
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
    errorWeek,
  }: {
    isOpen: boolean;
    onSelectWeek: (isoWeek: string) => void;
    pendingWeek: string | null;
    errorWeek: string | null;
  }) =>
    isOpen ? (
      <div data-testid="archive-drawer">
        <button onClick={() => onSelectWeek('2026-W20')}>select-2026-W20</button>
        {pendingWeek && <span data-testid="archive-pending">{pendingWeek}</span>}
        {errorWeek && <span data-testid="archive-error">{errorWeek}</span>}
      </div>
    ) : null,
}));

import { WeeklyRecapCard } from './WeeklyRecapCard';

/**
 * Drains the macrotask the auto-open arming is deferred to AND flushes the
 * React updates it schedules.
 *
 * The `act()` wrapper is load-bearing, not decoration. A bare
 * `await new Promise(r => setTimeout(r, 10))` drains the timer but leaves the
 * resulting state updates unflushed, so the DOM and localStorage still show
 * the pre-arming world — which made EVERY negative auto-open assertion below
 * pass whether or not its guard existed. (Verified by mutation: deleting the
 * `isLoading` guard, and deleting the resolved-recap gate, each failed zero
 * of the tests named for them.) Anything asserting that the auto-open did NOT
 * happen must flush first, or it is asserting nothing.
 */
const flushAutoOpen = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
};

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
    retry.mockClear();
    resetOpenDrawersForTest();
    resetNotificationOpenTypeForTest();
    mockUseRecapForWeek.mockReset();
    mockUseRecapForWeek.mockImplementation(() => unresolved('idle'));
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
    const AUTO_OPEN_KEY = `lb_recap_autoopened_${AUTO_OPEN_WEEK}`;

    const mockClosedWeekResolved = (recap: WeeklyRecap) => {
      mockUseRecapForWeek.mockImplementation((isoWeek: string | null) =>
        isoWeek === AUTO_OPEN_WEEK ? resolved(recap) : unresolved('idle')
      );
    };
    /** The week is armed, but `useRecapForWeek` hasn't produced a trustworthy
     *  answer yet (a live listener hasn't delivered its first snapshot). */
    const mockClosedWeekPending = () => {
      mockUseRecapForWeek.mockImplementation((isoWeek: string | null) =>
        isoWeek === AUTO_OPEN_WEEK ? unresolved('pending') : unresolved('idle')
      );
    };

    it('opens the just-closed week once real data is ready, and marks it so it never fires again', async () => {
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);

      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() => expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBe('1'));
    });

    it('does not fire while household data is still loading', async () => {
      mockCore.isLoading = true;
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);
      await flushAutoOpen();
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();
    });

    it('never fires twice for the same ISO week, including across a remount', async () => {
      window.localStorage.setItem(AUTO_OPEN_KEY, '1');
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);
      await flushAutoOpen();
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
      await flushAutoOpen();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();
    });

    // --- BLOCKING 1: never open (or MARK) off data that hasn't arrived ------
    it('neither opens nor marks while the recap is still resolving', async () => {
      mockClosedWeekPending();
      render(<WeeklyRecapCard />);
      await flushAutoOpen();
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      // The critical half: marking here would permanently suppress the
      // CORRECT auto-open for this ISO week.
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();
      expect(track).not.toHaveBeenCalledWith('recap_viewed', expect.objectContaining({ source: 'auto' }));
    });

    it('fires exactly once, later, when the listeners finally deliver', async () => {
      mockClosedWeekPending();
      const { rerender } = render(<WeeklyRecapCard />);
      await flushAutoOpen();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();

      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      rerender(<WeeklyRecapCard />);

      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() => expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBe('1'));
      expect(
        vi.mocked(track).mock.calls.filter(([, params]) => (params as { source?: string })?.source === 'auto')
      ).toHaveLength(1);
    });

    it('still opens and marks a genuinely EMPTY week (zeroes that are the truth)', async () => {
      mockClosedWeekResolved(
        makeRecap({
          id: AUTO_OPEN_WEEK,
          isoWeek: AUTO_OPEN_WEEK,
          totalSpend: 0,
          priorWeekSpend: 0,
          habitCompletions: 0,
        })
      );
      render(<WeeklyRecapCard />);
      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() => expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBe('1'));
    });

    // --- BLOCKING 2: the slot is taken → SKIP THE SESSION, never defer -----
    // Every negative below is paired with a positive control in the SAME
    // test — a fresh mount that does open — because "it didn't open" and
    // "auto-open is dead code" are indistinguishable assertions otherwise,
    // and the positive control is simultaneously the proof that the skip left
    // the week ELIGIBLE rather than burning it.

    it('skips the session when another drawer already holds the slot, and closing it brings no late landing', async () => {
      const close = registerOpenDrawer(Symbol('some-other-sheet'));
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      const { unmount } = render(<WeeklyRecapCard />);

      await flushAutoOpen();
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();
      // The slot was already taken when we armed, so the week is never even
      // REQUESTED — no derivation, and no `loadAllTransactions()` full-history
      // read, for an open we already know we won't take. (This is what makes
      // the arm-time check load-bearing rather than a duplicate of the
      // landing check below, which would suppress the open either way.)
      expect(mockUseRecapForWeek).not.toHaveBeenCalledWith(AUTO_OPEN_WEEK);

      // THE REVERSAL. Under the old defer-within-the-session rule this is
      // exactly where the recap landed — the instant the user dismissed the
      // sheet they were already dealing with, handing them a second
      // interruption mid-task. It must now stay shut for the rest of the
      // session.
      act(() => close());
      await flushAutoOpen();
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();
      expect(track).not.toHaveBeenCalledWith(
        'recap_viewed',
        expect.objectContaining({ source: 'auto' })
      );

      // POSITIVE CONTROL — the next app open (fresh mount, nothing in the
      // way) does show it, so the week was skipped and not burned.
      unmount();
      render(<WeeklyRecapCard />);
      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() => expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBe('1'));
      expect(mockUseRecapForWeek).toHaveBeenCalledWith(AUTO_OPEN_WEEK);
    });

    it('skips the session when a drawer takes the slot while the recap is still resolving', async () => {
      // The e2e-traced shape: at ARM time nothing is open (the transactions
      // listener hasn't answered), so the arm-time check passes — and then the
      // very delivery that resolves this recap is the one that opens
      // MainLayout's review drawer. The LANDING check is what has to catch it.
      mockClosedWeekPending();
      const { rerender, unmount } = render(<WeeklyRecapCard />);
      await flushAutoOpen();

      const close = registerOpenDrawer(Symbol('review-drawer'));
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      rerender(<WeeklyRecapCard />);
      await flushAutoOpen();

      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();

      act(() => close());
      await flushAutoOpen();
      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();

      // POSITIVE CONTROL — same mock, fresh session, empty slot.
      unmount();
      render(<WeeklyRecapCard />);
      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() => expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBe('1'));
    });

    // --- BLOCKING 3: don't hijack a deliberate deep-link arrival -----------
    it('skips the session when a push deep-linked the user somewhere else', async () => {
      // Reproduce boot faithfully: index.tsx consumes + strips `nsrc` BEFORE
      // React mounts, so the card can never read it off the URL itself.
      window.history.replaceState(null, '', '/?nsrc=bill_reminder#/budget');
      trackNotificationOpenFromUrl();
      expect(window.location.search).toBe('');

      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      const { unmount } = render(<WeeklyRecapCard />);
      await flushAutoOpen();

      expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();

      // POSITIVE CONTROL — identical setup minus the notification arrival.
      unmount();
      resetNotificationOpenTypeForTest();
      render(<WeeklyRecapCard />);
      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent(AUTO_OPEN_WEEK);
      await waitFor(() => expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBe('1'));
    });

    it('still opens the recap push itself, which carries BOTH nsrc and ?recap=', async () => {
      // The real weekly-recap notification URL. `nsrc` suppresses the
      // auto-open path, but the `?recap=` deep link opens the drawer directly
      // — so the one notification whose whole purpose is the recap must not be
      // silenced by the guard written for every other notification.
      window.history.replaceState(null, '', '/?recap=2026-W27&nsrc=weekly_recap');
      trackNotificationOpenFromUrl();
      mockCore.recaps = [makeRecap()];
      mockClosedWeekResolved(makeRecap({ id: AUTO_OPEN_WEEK, isoWeek: AUTO_OPEN_WEEK }));
      render(<WeeklyRecapCard />);

      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-W27');
      // …and the auto-open never fired alongside it.
      await flushAutoOpen();
      expect(window.localStorage.getItem(AUTO_OPEN_KEY)).toBeNull();
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
        isoWeek === '2026-W20' ? resolved(selected) : unresolved('idle')
      );
      render(<WeeklyRecapCard />);
      fireEvent.click(screen.getByText('Past weeks'));
      fireEvent.click(screen.getByText('select-2026-W20'));

      expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-W20');
      expect(track).toHaveBeenCalledWith('recap_viewed', { isoWeek: '2026-W20', source: 'archive' });
    });

    it('surfaces a failed selection as an error row, not an eternal spinner', () => {
      mockCore.recaps = [makeRecap()];
      mockUseRecapForWeek.mockImplementation((isoWeek: string | null) =>
        isoWeek === '2026-W20' ? unresolved('error') : unresolved('idle')
      );
      render(<WeeklyRecapCard />);
      fireEvent.click(screen.getByText('Past weeks'));
      fireEvent.click(screen.getByText('select-2026-W20'));

      expect(screen.getByTestId('archive-error')).toHaveTextContent('2026-W20');
      expect(screen.queryByTestId('archive-pending')).not.toBeInTheDocument();
    });

    it('re-tapping a failed row retries it exactly once per tap — and never when healthy', () => {
      mockCore.recaps = [makeRecap()];
      mockUseRecapForWeek.mockImplementation((isoWeek: string | null) =>
        isoWeek === '2026-W20' ? unresolved('error') : unresolved('idle')
      );
      const { rerender } = render(<WeeklyRecapCard />);
      fireEvent.click(screen.getByText('Past weeks'));
      fireEvent.click(screen.getByText('select-2026-W20'));
      retry.mockClear();

      fireEvent.click(screen.getByText('select-2026-W20'));
      expect(retry).toHaveBeenCalledTimes(1);

      // A tap while the hook is NOT failed must start no redundant
      // full-history read.
      mockUseRecapForWeek.mockImplementation(() => unresolved('pending'));
      rerender(<WeeklyRecapCard />);
      retry.mockClear();
      fireEvent.click(screen.getByText('select-2026-W20'));
      expect(retry).not.toHaveBeenCalled();

      // …and only the one tracked view for the original selection (a retry is
      // not a new "recap_viewed").
      expect(
        vi.mocked(track).mock.calls.filter(([, params]) => (params as { source?: string })?.source === 'archive')
      ).toHaveLength(1);
    });
  });
});
