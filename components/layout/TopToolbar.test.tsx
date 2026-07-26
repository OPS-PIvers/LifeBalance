import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Narrow context slices TopToolbar reads. Stub each with the minimal shape.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ safeToSpendBreakdown: { safeToSpend: 1234 } }),
  useGamification: () => ({ dailyPoints: 10, weeklyPoints: 50 }),
  useHouseholdCore: () => ({ household: { pendingRedemptions: [] }, unreadNotificationCount: 0 }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { displayName: 'Test User', photoURL: null } }),
}));
vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => false,
}));
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `$${n}`,
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
});
