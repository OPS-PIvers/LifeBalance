import { StrictMode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MonthlyMoneyRecap } from '@/types/schema';
import { track } from '@/services/analytics';
import { moneyRecapDismissKey } from '@/components/dashboard/recapVisibility';

// The card reads recaps from the core slice; useFormatCurrency reads the same
// mocked context (householdSettings → default USD).
const mockCore = {
  moneyRecaps: [] as MonthlyMoneyRecap[],
  householdSettings: null,
};
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

// Stub the Drawer-based detail view so the test stays off framer-motion and
// can assert open/close via a plain marker element — same rationale as
// WeeklyRecapCard.test.tsx's WeeklyRecapDrawer stub.
vi.mock('@/components/dashboard/MoneyRecapDrawer', () => ({
  MoneyRecapDrawer: ({
    isOpen,
    recap,
  }: {
    isOpen: boolean;
    recap: MonthlyMoneyRecap | null;
    onClose: () => void;
  }) => (isOpen && recap ? <div data-testid="recap-drawer">{recap.month}</div> : null),
}));

import { MoneyRecapCard } from './MoneyRecapCard';

/**
 * Drains the macrotask the `?moneyrecap=` deep-link open (and its dedupe
 * effect) are deferred to, AND flushes the React updates it schedules.
 *
 * The `act()` wrapper is load-bearing, not decoration — mirrors
 * `flushAutoOpen` in WeeklyRecapCard.test.tsx. A bare
 * `await new Promise(r => setTimeout(r, 10))` drains the timer but leaves the
 * resulting state updates unflushed, so the DOM still shows the pre-open
 * world and every negative assertion below would pass whether or not its
 * guard existed.
 */
const flushPush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
};

const pushTrackCalls = () =>
  vi
    .mocked(track)
    .mock.calls.filter(
      ([event, params]) =>
        event === 'money_recap_viewed' && (params as { source?: string } | undefined)?.source === 'push'
    );

const makeRecap = (overrides: Partial<MonthlyMoneyRecap> = {}): MonthlyMoneyRecap => ({
  id: '2026-06',
  month: '2026-06',
  generatedAt: new Date().toISOString(),
  totalIncome: 3000,
  totalSpend: 1200,
  priorMonthSpend: 1000,
  bucketResults: [],
  topExpense: null,
  netWorthDelta: null,
  narrative: 'A calm money month — nice work.',
  narrativeSource: 'ai',
  premium: true,
  ...overrides,
});

describe('MoneyRecapCard', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    mockCore.moneyRecaps = [];
  });

  it('renders nothing (but keeps the drawer mount) without a recap', () => {
    render(<MoneyRecapCard />);
    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
  });

  it('drawerOnly renders only the always-mounted drawer, never the card', () => {
    mockCore.moneyRecaps = [makeRecap()];
    render(<MoneyRecapCard drawerOnly />);
    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
  });

  it('drawerOnly still opens the drawer for a deep-linked month — the whole reason RecapSlot uses it', async () => {
    window.history.replaceState(null, '', '/?moneyrecap=2026-06');
    mockCore.moneyRecaps = [makeRecap({ id: '2026-06', month: '2026-06' })];
    render(<MoneyRecapCard drawerOnly />);
    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-06');
  });

  it('renders headline figures from a seeded MonthlyMoneyRecap', () => {
    mockCore.moneyRecaps = [makeRecap()];
    render(<MoneyRecapCard />);
    expect(screen.getByText('Your month in money')).toBeInTheDocument();
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText(/spent in June 2026/)).toBeInTheDocument();
    expect(screen.getByText(/\$3,000 in/)).toBeInTheDocument();
    // priorMonthSpend 1000 → totalSpend 1200 is UP $200 vs last month.
    expect(screen.getByText(/↑ \$200 vs last month/)).toBeInTheDocument();
    expect(screen.getByText('A calm money month — nice work.')).toBeInTheDocument();
    expect(screen.queryByText(/Unlock your personal recap/)).not.toBeInTheDocument();
  });

  it('omits the vs-last-month delta when there is no prior-month spend to compare', () => {
    mockCore.moneyRecaps = [makeRecap({ priorMonthSpend: 0 })];
    render(<MoneyRecapCard />);
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.queryByText(/vs last month/)).not.toBeInTheDocument();
  });

  it('locks the narrative behind an upsell row when premium is false', () => {
    mockCore.moneyRecaps = [makeRecap({ premium: false })];
    render(<MoneyRecapCard />);
    // Numbers still show…
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    // …but the narrative is aria-hidden (blurred) with the upsell row visible.
    expect(screen.getByText(/Unlock your personal recap with Premium/)).toBeInTheDocument();
    expect(screen.getByText('A calm money month — nice work.')).toHaveAttribute('aria-hidden', 'true');
  });

  // --- Freshness / dismissal wiring (recapVisibility.ts unit-tests the pure
  // logic; these confirm the CARD actually consults it) ---------------------

  it('hides the card when the recap is older than the freshness window', () => {
    mockCore.moneyRecaps = [
      makeRecap({ generatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    render(<MoneyRecapCard />);
    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
  });

  it('dismiss hides the card and persists per month in localStorage across a remount', () => {
    mockCore.moneyRecaps = [makeRecap()];
    const { unmount } = render(<MoneyRecapCard />);
    fireEvent.click(screen.getByLabelText('Dismiss monthly money recap'));
    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(moneyRecapDismissKey('2026-06'))).toBe('1');

    unmount();
    render(<MoneyRecapCard />);
    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
  });

  it('dismiss still hides the card in-session via component state, even when the localStorage write throws', () => {
    // `persistDismiss` is best-effort (wrapped in try/catch) — the comment on
    // it says "the in-session state still hides the card". The in-memory
    // `dismissedMonth` check is what actually delivers that promise: without
    // it, a dismiss whose localStorage write fails would leave the card
    // visible for the rest of the session (it re-appears on every render
    // since `shouldShowCard` alone can't see the failed write).
    mockCore.moneyRecaps = [makeRecap()];
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      render(<MoneyRecapCard />);
      fireEvent.click(screen.getByLabelText('Dismiss monthly money recap'));
      expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
      expect(window.localStorage.getItem(moneyRecapDismissKey('2026-06'))).toBeNull();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('opens the detail drawer on card tap and tracks money_recap_viewed with source card', () => {
    mockCore.moneyRecaps = [makeRecap()];
    render(<MoneyRecapCard />);
    expect(screen.queryByTestId('recap-drawer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Open money recap for June 2026'));
    expect(screen.getByTestId('recap-drawer')).toHaveTextContent('2026-06');
    expect(track).toHaveBeenCalledWith('money_recap_viewed', { month: '2026-06', source: 'card' });
  });

  // --- Deep link (?moneyrecap=<month>) --------------------------------------

  it('opens the drawer for the requested month from the ?moneyrecap= deep link', async () => {
    window.history.replaceState(null, '', '/?moneyrecap=2026-05');
    mockCore.moneyRecaps = [
      makeRecap({ id: '2026-06', month: '2026-06' }),
      makeRecap({ id: '2026-05', month: '2026-05', totalSpend: 800 }),
    ];
    render(<MoneyRecapCard />);

    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-05');
    expect(track).toHaveBeenCalledWith('money_recap_push_opened');
    expect(track).toHaveBeenCalledWith('money_recap_viewed', { month: '2026-05', source: 'push' });
    // The param is stripped from the address bar.
    expect(window.location.search).toBe('');
  });

  it('falls back to the latest recap when the requested month is not in the loaded set', async () => {
    window.history.replaceState(null, '', '/?moneyrecap=2099-01');
    mockCore.moneyRecaps = [makeRecap({ id: '2026-06', month: '2026-06' })];
    render(<MoneyRecapCard />);

    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-06');
    expect(track).toHaveBeenCalledWith('money_recap_viewed', { month: '2026-06', source: 'push' });
  });

  it('fires money_recap_viewed exactly once per opened month, under StrictMode doubled effects and a later snapshot for the same month', async () => {
    window.history.replaceState(null, '', '/?moneyrecap=2026-06');
    mockCore.moneyRecaps = [makeRecap({ id: '2026-06', month: '2026-06' })];
    const { rerender, unmount } = render(
      <StrictMode>
        <MoneyRecapCard />
      </StrictMode>
    );

    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-06');
    await flushPush();
    expect(pushTrackCalls()).toHaveLength(1);

    // Simulate a fresh Firestore snapshot delivering a NEW recap object for
    // the SAME month (different reference, same `.month`) — the dedupe keys
    // off the month string, not object identity, so it must not re-fire.
    mockCore.moneyRecaps = [makeRecap({ id: '2026-06', month: '2026-06', totalSpend: 1500 })];
    rerender(
      <StrictMode>
        <MoneyRecapCard />
      </StrictMode>
    );
    await flushPush();
    expect(pushTrackCalls()).toHaveLength(1);

    // POSITIVE CONTROL — a genuinely different month, on a fresh mount, still
    // fires its own event. Proves the guard dedupes per-month rather than
    // being permanently latched after the first fire.
    unmount();
    window.history.replaceState(null, '', '/?moneyrecap=2026-07');
    mockCore.moneyRecaps = [makeRecap({ id: '2026-07', month: '2026-07' })];
    render(<MoneyRecapCard />);
    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-07');
    await flushPush();
    expect(pushTrackCalls()).toHaveLength(2);
  });

  it('keeps the drawer mounted so a late deep link still works even when the card is hidden by dismissal', async () => {
    mockCore.moneyRecaps = [makeRecap({ id: '2026-06', month: '2026-06' })];
    const { unmount } = render(<MoneyRecapCard />);
    fireEvent.click(screen.getByLabelText('Dismiss monthly money recap'));
    expect(window.localStorage.getItem(moneyRecapDismissKey('2026-06'))).toBe('1');
    unmount();

    // A fresh mount (e.g. a later app open) with a push deep link targeting
    // the SAME, now-dismissed month.
    window.history.replaceState(null, '', '/?moneyrecap=2026-06');
    render(<MoneyRecapCard />);

    expect(screen.queryByText('Your month in money')).not.toBeInTheDocument();
    expect(await screen.findByTestId('recap-drawer')).toHaveTextContent('2026-06');
  });
});
