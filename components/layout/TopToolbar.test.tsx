import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Narrow context slices TopToolbar reads. Stub each with the minimal shape.
// `currentUser`/`members` back the profile chip's MemberColorMap (paper cut:
// the chip now resolves the SAME color as this member's badge elsewhere).
// `useFinance` is a `vi.fn()` (not a fixed object) so individual tests can
// reconfigure `budgetFit` for the over-allocation mark, mirroring the
// `setEnabledModules` pattern used for `useModuleVisibility` below.
const useFinanceMock = vi.fn();
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => useFinanceMock(),
  useGamification: () => ({ dailyPoints: 10, weeklyPoints: 50 }),
  useHouseholdCore: () => ({
    unreadNotificationCount: 0,
    currentUser: { uid: 'user-1', displayName: 'Test User', photoURL: null },
    members: [{ uid: 'user-1', displayName: 'Test User', photoURL: null, role: 'admin', points: { daily: 0, weekly: 0, total: 0 } }],
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { displayName: 'Test User', photoURL: null } }),
}));
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `$${n}`,
}));
const trackMock = vi.fn();
vi.mock('@/services/analytics', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

// Keep the lazy FeedbackModal + preload off the test path, but still render
// `children` when `when` is true so the feedback-open flow is observable.
vi.mock('@/utils/preloadOnIdle', () => ({
  preloadOnIdle: () => () => {},
}));
vi.mock('@/components/ui/LazyMount', () => ({
  LazyMount: ({ when, children }: { when: boolean; children: React.ReactNode }) =>
    when ? <>{children}</> : null,
}));
vi.mock('@/components/modals/FeedbackModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="feedback-modal" /> : null,
}));
// Points Breakdown drawer (PR3) — the toolbar just needs to know it opened,
// not render its full standings; the drawer's own content states are covered
// by PointsBreakdownDrawer.test.tsx.
vi.mock('@/components/habits/PointsBreakdownDrawer', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="points-breakdown-drawer" /> : null,
}));
// ProfileMenu pulls in heavy deps; the toolbar visibility logic doesn't need
// its full implementation, but it does need to expose the "Send Feedback"
// menu item so the toolbar's feedback-open wiring is testable.
vi.mock('./ProfileMenu', () => ({
  default: ({
    isOpen,
    onSendFeedback,
    onOpenSearch,
    onOpenNotifications,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSendFeedback?: () => void;
    onOpenSearch?: () => void;
    onOpenNotifications?: () => void;
    unreadNotificationCount?: number;
  }) =>
    isOpen ? (
      <div data-testid="profile-menu">
        <button onClick={onSendFeedback}>Send Feedback</button>
        <button onClick={onOpenSearch}>Search</button>
        <button onClick={onOpenNotifications}>Notifications</button>
      </div>
    ) : null,
}));

// Module visibility (Plan 090): mocked so each test chooses enabled modules.
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
    isHomeVisible: true,
  });
};

const renderToolbar = () =>
  render(
    <MemoryRouter>
      <TopToolbar />
    </MemoryRouter>
  );

const STS_LABEL = 'View Safe to Spend details';
const REWARDS_LABEL = 'View Rewards and Points breakdown';
const FEEDBACK_LABEL = 'Send Feedback';
const PROFILE_LABEL = 'Open Profile Menu';

describe('TopToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
    useFinanceMock.mockReturnValue({ safeToSpendBreakdown: { safeToSpend: 1234 } });
  });

  it('shows Safe-to-Spend and the points/Rewards cluster when both domains are on', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: STS_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REWARDS_LABEL })).toBeInTheDocument();
  });

  it('hides Safe-to-Spend when money is off (keeps points/Rewards)', () => {
    setEnabledModules(['habits']);
    renderToolbar();
    expect(screen.queryByRole('button', { name: STS_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: REWARDS_LABEL })).toBeInTheDocument();
  });

  it('hides the points/Rewards cluster when habits is off (keeps Safe-to-Spend)', () => {
    setEnabledModules(['money']);
    renderToolbar();
    expect(screen.queryByRole('button', { name: REWARDS_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: STS_LABEL })).toBeInTheDocument();
  });

  it('shows only Profile when both money and habits are off (Feedback lives in the Profile menu)', () => {
    setEnabledModules([]);
    renderToolbar();
    expect(screen.queryByRole('button', { name: STS_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: REWARDS_LABEL })).not.toBeInTheDocument();
    // No standalone header Feedback button anymore.
    expect(screen.queryByRole('button', { name: FEEDBACK_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROFILE_LABEL })).toBeInTheDocument();
  });

  it('opens the Feedback modal via the Profile menu', async () => {
    renderToolbar();

    // Feedback modal is not mounted until opened.
    expect(screen.queryByTestId('feedback-modal')).not.toBeInTheDocument();
    // Profile menu starts closed.
    expect(screen.queryByTestId('profile-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: PROFILE_LABEL }));
    expect(screen.getByTestId('profile-menu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: FEEDBACK_LABEL }));

    // FeedbackModal is `React.lazy`-loaded, so it resolves asynchronously
    // even with the module mocked.
    await waitFor(() => {
      expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
    });
  });

  it('opens the Points Breakdown drawer when the points cluster is tapped, and tracks it', async () => {
    renderToolbar();

    expect(screen.queryByTestId('points-breakdown-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: REWARDS_LABEL }));

    // React.lazy resolves asynchronously even with the module mocked.
    await waitFor(() => {
      expect(screen.getByTestId('points-breakdown-drawer')).toBeInTheDocument();
    });
    expect(trackMock).toHaveBeenCalledWith('points_drawer_opened');
  });

  // PR A — Safe-to-Spend header over-allocation mark. Regression risk called
  // out explicitly: a mark that shows even when Safe-to-Spend itself is
  // negative would double up with the figure already rendering red.
  describe('budget over-allocation mark', () => {
    const OVER_ALLOCATED_LABEL = 'View Safe to Spend details, your budgets are over-allocated';

    // The mark is `aria-hidden` (its button's `aria-label` is the single
    // accessible-name carrier — see TopToolbar.tsx), so it carries no
    // `title` and no discoverable text. Assert on the DOM node directly.
    it('shows the amber mark when budgetFit.isOverAllocated is true', () => {
      useFinanceMock.mockReturnValue({
        safeToSpendBreakdown: { safeToSpend: 356.22 },
        budgetFit: { claimed: 423.76, leftover: -67.54, shortfall: 67.54, isOverAllocated: true },
      });
      renderToolbar();

      const button = screen.getByRole('button', { name: OVER_ALLOCATED_LABEL });
      const mark = button.querySelector('[aria-hidden="true"]');
      expect(mark).toBeInTheDocument();
      expect(mark?.querySelector('svg')).toBeInTheDocument();
      // The dead accessibility attributes this mark used to carry (fix:
      // both were unreachable — an ancestor aria-label wins the whole
      // subtree, and `title` is dead on touch besides) must stay gone.
      expect(mark).not.toHaveAttribute('title');
      expect(screen.queryByText('Budgets over-allocated', { exact: false })).not.toBeInTheDocument();
      // The plain (non-over-allocated) label must NOT also match — otherwise
      // this assertion would pass vacuously via a substring match.
      expect(screen.queryByRole('button', { name: STS_LABEL })).not.toBeInTheDocument();
    });

    it('does NOT show the mark when the shortfall is below the $10 threshold', () => {
      useFinanceMock.mockReturnValue({
        safeToSpendBreakdown: { safeToSpend: 100 },
        // isOverAllocated is what the toolbar reads — this is what
        // computeBudgetFit would produce for a $9.99 shortfall.
        budgetFit: { claimed: 109.99, leftover: -9.99, shortfall: 9.99, isOverAllocated: false },
      });
      renderToolbar();

      const button = screen.getByRole('button', { name: STS_LABEL });
      expect(button.querySelector('svg')).not.toBeInTheDocument();
    });

    it('does NOT show the mark when Safe-to-Spend itself is negative (figure already reads red)', () => {
      useFinanceMock.mockReturnValue({
        safeToSpendBreakdown: { safeToSpend: -50 },
        // A negative StS forces isOverAllocated false regardless of the
        // buckets' claim (see utils/budgetFit.ts) — the biggest regression
        // risk this feature has, so assert it directly here too.
        budgetFit: { claimed: 500, leftover: -550, shortfall: 550, isOverAllocated: false },
      });
      renderToolbar();

      const button = screen.getByRole('button', { name: STS_LABEL });
      expect(button.querySelector('svg')).not.toBeInTheDocument();
    });
  });

  // Parity gap fix: the debounced header live region previously tracked only
  // `{sts, pts}`, so a household crossing INTO over-allocation with StS
  // itself unchanged produced no announcement at all, even though the
  // sighted UI grows a new amber mark. `isOverAllocated` now rides the same
  // ref/effect.
  describe('over-allocation live-region announcement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('announces "Budgets over-allocated" on the false -> true transition', () => {
      useFinanceMock.mockReturnValue({
        safeToSpendBreakdown: { safeToSpend: 200 },
        budgetFit: { claimed: 0, leftover: 200, shortfall: 0, isOverAllocated: false },
      });
      const { rerender } = render(
        <MemoryRouter>
          <TopToolbar />
        </MemoryRouter>
      );

      useFinanceMock.mockReturnValue({
        safeToSpendBreakdown: { safeToSpend: 200 },
        budgetFit: { claimed: 210, leftover: -10, shortfall: 10, isOverAllocated: true },
      });
      rerender(
        <MemoryRouter>
          <TopToolbar />
        </MemoryRouter>
      );

      act(() => {
        vi.advanceTimersByTime(800);
      });

      expect(screen.getByRole('status')).toHaveTextContent('Budgets over-allocated');
    });

    // Negative control: if the mount-skip guard (`!prev`) were dropped, or
    // `prevFiguresRef` were seeded with a non-null default instead of
    // `null`, this would start reporting a spurious announcement on first
    // render whenever a household happens to load already over-allocated.
    // Pairs with the positive test above so this guard can't silently regress.
    it('does NOT announce on initial render even when already over-allocated', () => {
      useFinanceMock.mockReturnValue({
        safeToSpendBreakdown: { safeToSpend: 200 },
        budgetFit: { claimed: 210, leftover: -10, shortfall: 10, isOverAllocated: true },
      });
      renderToolbar();

      act(() => {
        vi.advanceTimersByTime(800);
      });

      expect(screen.getByRole('status')).toHaveTextContent('');
    });
  });
});
