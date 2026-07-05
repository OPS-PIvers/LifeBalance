import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WeeklyRecap } from '@/types/schema';
import { track } from '@/services/analytics';

// The card reads recaps from the core slice; useFormatCurrency reads the same
// mocked context (householdSettings → default USD).
const mockCore = {
  recaps: [] as WeeklyRecap[],
  householdSettings: null,
};
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

// Stub the Drawer-based detail view so the test stays off framer-motion and
// can assert open/close via a plain marker element.
vi.mock('@/components/dashboard/WeeklyRecapDrawer', () => ({
  WeeklyRecapDrawer: ({ isOpen, recap }: { isOpen: boolean; recap: WeeklyRecap | null }) =>
    isOpen && recap ? <div data-testid="recap-drawer">{recap.isoWeek}</div> : null,
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
  });

  it('renders nothing (but keeps the drawer mount) without a recap', () => {
    render(<WeeklyRecapCard />);
    expect(screen.queryByText('Your week in review')).not.toBeInTheDocument();
  });

  it('renders headline numbers and narrative for a fresh premium recap', () => {
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    expect(screen.getByText('Your week in review')).toBeInTheDocument();
    expect(screen.getByText('$412')).toBeInTheDocument();
    expect(screen.getByText(/\$56 vs last week/)).toBeInTheDocument();
    expect(screen.getByText(/12 habits done/)).toBeInTheDocument();
    expect(screen.getByText('A calm spending week — nice work.')).toBeInTheDocument();
    expect(screen.queryByText(/Unlock your personal recap/)).not.toBeInTheDocument();
  });

  it('hides the card when the recap is older than the freshness window', () => {
    mockCore.recaps = [
      makeRecap({ generatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    render(<WeeklyRecapCard />);
    expect(screen.queryByText('Your week in review')).not.toBeInTheDocument();
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

  it('dismiss hides the card and persists per isoWeek in localStorage', () => {
    mockCore.recaps = [makeRecap()];
    render(<WeeklyRecapCard />);
    fireEvent.click(screen.getByLabelText('Dismiss weekly recap'));
    expect(screen.queryByText('Your week in review')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('lb_recap_dismissed_2026-W27')).toBe('1');

    // A re-mount (fresh state) stays hidden thanks to the persisted flag.
    const { container } = render(<WeeklyRecapCard />);
    expect(container.querySelector('button')).toBeNull();
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
    expect(track).toHaveBeenCalledWith('recap_viewed', { isoWeek: '2026-W27', source: 'push' });
    // The param is stripped from the address bar.
    expect(window.location.search).toBe('');
  });
});
