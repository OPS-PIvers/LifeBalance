import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Settings from './Settings';

/** Exposes the router's current path + query so tests can assert URL state. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname + location.search}</div>;
};

// ---- Context mocks ---------------------------------------------------------

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', displayName: 'Test User', email: 'test@example.com', photoURL: null },
    householdId: 'household-1',
  }),
}));

const mockCurrentUser = {
  uid: 'user-1',
  displayName: 'Test User',
  email: 'test@example.com',
  role: 'admin' as const,
};

const mockSetCaptureReviewMode = vi.fn();

// A second admin so `canLeaveHousehold` is true (the last remaining admin is
// blocked from the self-serve Leave Household path).
const mockPartner = {
  uid: 'user-2',
  displayName: 'Partner User',
  email: 'partner@example.com',
  role: 'admin' as const,
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    members: [mockCurrentUser, mockPartner],
    currentUser: mockCurrentUser,
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    deleteHousehold: vi.fn(),
    household: { id: 'household-1', name: 'Test Household' },
    householdSettings: { name: 'Test Household', inviteCode: 'ABC123', currency: 'USD' },
    setHouseholdCurrency: vi.fn(),
    setModuleVisibility: vi.fn(),
    updateModuleVisibility: vi.fn(),
    setCaptureReviewMode: mockSetCaptureReviewMode,
    setKidModePin: vi.fn(),
    apiKeys: [],
    activityLog: [],
  }),
  useGamification: () => ({ habits: [], challenges: [], rewardsInventory: [] }),
  useFinance: () => ({
    transactions: [],
    buckets: [],
    calendarItems: [],
    hasMoreTransactions: false,
    isLoadingOlderTransactions: false,
    loadAllTransactions: vi.fn(),
  }),
  useMealPlan: () => ({ mealPlan: [], loadAllMeals: vi.fn() }),
  useShopping: () => ({ shoppingList: [], stores: [] }),
  useTodos: () => ({ todos: [] }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    fontScale: '100',
    setFontScale: vi.fn(),
    highContrast: false,
    setHighContrast: vi.fn(),
  }),
}));

// ---- Feature-flag hooks ------------------------------------------------------

vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => false }));
vi.mock('@/hooks/useKidModeEnabled', () => ({ useKidModeEnabled: () => false }));
vi.mock('@/hooks/usePlaidEnabled', () => ({ usePlaidEnabled: () => false }));

// ---- Firebase / services -----------------------------------------------------

vi.mock('@/firebase.config', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), updateDoc: vi.fn() }));
vi.mock('@/services/notificationService', () => ({
  requestNotificationPermission: vi.fn(),
  setupForegroundNotificationListener: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

// ---- Heavy section components (moved as-is into sub-screens; not under test) --

vi.mock('@/components/settings/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
vi.mock('@/components/settings/NotificationSettings', () => ({
  default: () => <div data-testid="notification-settings" />,
}));
vi.mock('@/components/settings/ApiKeyManager', () => ({
  default: () => <div data-testid="api-key-manager" />,
}));
vi.mock('@/components/settings/CalendarFeedCard', () => ({
  default: () => <div data-testid="calendar-feed-card" />,
}));
vi.mock('@/components/settings/ShortcutSetupGuide', () => ({
  default: () => <div data-testid="shortcut-setup-guide" />,
}));
vi.mock('@/components/settings/ActivityLogCard', () => ({
  default: () => <div data-testid="activity-log-card" />,
}));
vi.mock('@/components/settings/ChangelogDrawer', () => ({
  ChangelogDrawer: () => null,
}));
// NOTE: MyViewSettings (2F.1, which replaced DashboardWidgetSettings) is
// deliberately NOT mocked — it renders for real so the "What I see" assertions
// below are actual page-level coverage of that surface.
vi.mock('@/components/auth/HouseholdInviteCard', () => ({
  default: () => <div data-testid="household-invite-card" />,
}));
vi.mock('@/components/modals/MemberModal', () => ({ default: () => null }));
vi.mock('@/components/modals/PointsBreakdownModal', () => ({ default: () => null }));
vi.mock('@/components/modals/DeveloperConsole', () => ({ default: () => null }));
vi.mock('@/components/modals/PaywallModal', () => ({ default: () => null }));
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="drawer">{children}</div> : null,
}));
vi.mock('@/components/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

const renderSettings = (initialEntry = '/settings') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Settings />
      <LocationProbe />
    </MemoryRouter>
  );

const INDEX_ROW_TITLES = [
  'Profile & Appearance',
  'Notifications',
  'Household',
  'Money',
  'Modules & Dashboard',
  'iOS Shortcuts',
  'Data & Account',
];

describe('Settings index + sub-screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  it('renders an index of at most 7 grouped navigation rows', () => {
    renderSettings();

    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    const rows = within(nav).getAllByRole('button');
    expect(rows.length).toBeLessThanOrEqual(7);

    for (const title of INDEX_ROW_TITLES) {
      expect(within(nav).getByText(title)).toBeInTheDocument();
    }
  });

  it('drills into a sub-screen and renders its content', () => {
    renderSettings();

    fireEvent.click(screen.getByText('iOS Shortcuts'));

    // Sub-screen content is rendered…
    expect(screen.getByTestId('api-key-manager')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-setup-guide')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('iOS Shortcuts');
    // …and the index is gone.
    expect(screen.queryByRole('navigation', { name: /settings sections/i })).not.toBeInTheDocument();
  });

  it('moves focus to the sub-screen heading on push', () => {
    renderSettings();

    fireEvent.click(screen.getByText('Modules & Dashboard'));

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Modules & Dashboard');
    expect(heading.contains(document.activeElement)).toBe(true);
  });

  // 2F.1 — the per-member "What I see" editor (MyViewSettings) lives inside the
  // Modules & Dashboard sub-screen, below the household module toggles. Rendered
  // un-mocked so this is real coverage: a per-page leaf row, and the Home widget
  // rows with their reorder controls.
  it('renders the per-member "What I see" editor in Modules & Dashboard', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Modules & Dashboard'));

    expect(screen.getByText('What I see')).toBeInTheDocument();

    // Per-page leaf rows, one switch per nav leaf the household has enabled.
    expect(screen.getByRole('checkbox', { name: 'Show Transactions in Money' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show Track in Habits' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show To-Dos in Lists' })).toBeChecked();

    // Home widget rows: a visibility switch plus the reorder controls.
    expect(screen.getByRole('checkbox', { name: 'Show This Week Pulse on Home' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Move This Week Pulse down' })).toBeInTheDocument();
    // A default-hidden widget starts off, so the widget-merge default still
    // reaches the UI (no migration ran).
    expect(screen.getByRole('checkbox', { name: 'Show AI Insight on Home' })).not.toBeChecked();
  });

  it('returns to the index via the back button', () => {
    renderSettings();

    fireEvent.click(screen.getByText('Household'));
    expect(screen.getByTestId('household-invite-card')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));

    expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument();
    expect(screen.queryByTestId('household-invite-card')).not.toBeInTheDocument();
  });

  it('supports deep links straight to a sub-screen via ?section=', () => {
    renderSettings('/settings?section=notifications');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Notifications');
    expect(screen.getByText('Push Notifications')).toBeInTheDocument();

    // Back from a deep link still lands on the index (no history to pop).
    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));
    expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument();
  });

  it('keeps Delete Household only in the Data & Account danger zone', () => {
    renderSettings();

    // Not on the index…
    expect(screen.queryByText('Delete Household')).not.toBeInTheDocument();

    // …not in the Household sub-screen…
    fireEvent.click(screen.getByText('Household'));
    expect(screen.queryByText('Delete Household')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));

    // …only in Data & Account, under the separated Danger Zone group.
    fireEvent.click(screen.getByText('Data & Account'));
    expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeInTheDocument();
    expect(screen.getByText('Delete Household')).toBeInTheDocument();
    expect(screen.getByText('Leave Household')).toBeInTheDocument();
  });

  it('renders the Money sub-screen with currency + calendar feed', () => {
    renderSettings('/settings?section=money');

    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-feed-card')).toBeInTheDocument();
  });

  it('preserves unrelated query params when drilling in and backing out', () => {
    renderSettings('/settings?ref=partner');

    fireEvent.click(screen.getByText('Profile & Appearance'));
    let url = screen.getByTestId('location-probe').textContent ?? '';
    expect(url).toContain('ref=partner');
    expect(url).toContain('section=profile');

    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));
    url = screen.getByTestId('location-probe').textContent ?? '';
    expect(url).toContain('ref=partner');
    expect(url).not.toContain('section=');
  });

  it('preserves unrelated query params when backing out of a deep link', () => {
    // Deep link: no pushed index entry, so back takes the replace path.
    renderSettings('/settings?section=money&ref=partner');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Money');
    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));

    const url = screen.getByTestId('location-probe').textContent ?? '';
    expect(url).toContain('ref=partner');
    expect(url).not.toContain('section=');
    expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument();
  });

  it('restores focus to the originating index row on back', () => {
    renderSettings();

    fireEvent.click(screen.getByText('Money'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Money');

    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));

    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    const moneyRow = within(nav).getByText('Money').closest('button');
    expect(moneyRow).not.toBeNull();
    expect(document.activeElement).toBe(moneyRow);
  });

  it('restores focus to the matching index row after backing out of a deep link', () => {
    renderSettings('/settings?section=shortcuts');

    fireEvent.click(screen.getByRole('button', { name: /back to settings/i }));

    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    const shortcutsRow = within(nav).getByText('iOS Shortcuts').closest('button');
    expect(document.activeElement).toBe(shortcutsRow);
  });

  it('ignores unknown section params and shows the index', () => {
    renderSettings('/settings?section=not-a-real-section');

    expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument();
  });

  it('renders the capture review toggles with the correct effective defaults on a fresh household', () => {
    renderSettings('/settings?section=shortcuts');

    // Transactions (expense) defaults to 'review'; shopping and to-dos default to 'auto'.
    const transactionsGroup = screen.getByRole('radiogroup', { name: 'Transactions review mode' });
    expect(within(transactionsGroup).getByRole('radio', { name: 'Manual review' })).toHaveAttribute('aria-checked', 'true');
    expect(within(transactionsGroup).getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'false');

    const shoppingGroup = screen.getByRole('radiogroup', { name: 'Shopping list review mode' });
    expect(within(shoppingGroup).getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');

    const todosGroup = screen.getByRole('radiogroup', { name: 'To-dos review mode' });
    expect(within(todosGroup).getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');
  });

  it('calls setCaptureReviewMode with the type and new mode when a toggle is clicked', () => {
    renderSettings('/settings?section=shortcuts');

    const shoppingGroup = screen.getByRole('radiogroup', { name: 'Shopping list review mode' });
    fireEvent.click(within(shoppingGroup).getByRole('radio', { name: 'Manual review' }));
    expect(mockSetCaptureReviewMode).toHaveBeenCalledWith('shopping', 'review');

    const transactionsGroup = screen.getByRole('radiogroup', { name: 'Transactions review mode' });
    fireEvent.click(within(transactionsGroup).getByRole('radio', { name: 'Automatic' }));
    expect(mockSetCaptureReviewMode).toHaveBeenCalledWith('expense', 'auto');
  });
});
