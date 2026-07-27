import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Settings from './Settings';
import type { Role } from '@/types/schema';

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

// Mutable so a test can render as a non-admin (e.g. the member visibility
// matrix, which renders every column for an admin and only the member's own
// column for anyone else) — `useHouseholdCore()` below reads this object at
// call time, so mutating `.role` before `renderSettings()` is enough; reset to
// 'admin' in `beforeEach` so every other test keeps its original default.
const mockCurrentUser: {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
} = {
  uid: 'user-1',
  displayName: 'Test User',
  email: 'test@example.com',
  role: 'admin',
};

const mockSetCaptureReviewMode = vi.fn();
const mockUpdateKidProfile = vi.fn();
const mockUpdateMember = vi.fn();

// A second admin so `canLeaveHousehold` is true (the last remaining admin is
// blocked from the self-serve Leave Household path).
const mockPartner = {
  uid: 'user-2',
  displayName: 'Partner User',
  email: 'partner@example.com',
  role: 'admin' as const,
};

// A managed kid profile (Plan 080) — no login/email, edited through
// `updateKidProfile` rather than the generic MemberModal.
const mockKid = {
  uid: 'kid-1',
  displayName: 'Kiddo',
  email: '',
  role: 'member' as const,
  isManaged: true,
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    members: [mockCurrentUser, mockPartner, mockKid],
    currentUser: mockCurrentUser,
    addMember: vi.fn(),
    updateMember: mockUpdateMember,
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
    updateKidProfile: mockUpdateKidProfile,
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
// NOTE: MemberVisibilityMatrix and HomeWidgetOrder — the two surfaces the
// Modules & Dashboard screen collapsed onto — are deliberately NOT mocked, so
// the assertions below are actual page-level coverage of them.
vi.mock('@/components/auth/HouseholdInviteCard', () => ({
  default: () => <div data-testid="household-invite-card" />,
}));
// Mimics MemberModal's real save-payload split (kid → displayName only; else
// the full trio) so Settings-level tests can assert the ROUTING in
// handleSaveMember (updateKidProfile vs. updateMember) without re-testing
// MemberModal's own field rendering — that's covered by MemberModal.test.tsx.
vi.mock('@/components/modals/MemberModal', () => ({
  default: ({
    isOpen,
    onSave,
    initialMember,
    title,
  }: {
    isOpen: boolean;
    onSave: (data: Record<string, unknown>) => void;
    initialMember?: { isManaged?: boolean } | null;
    title: string;
  }) =>
    isOpen ? (
      <div data-testid="member-modal" data-title={title}>
        <button
          onClick={() =>
            onSave(
              initialMember?.isManaged
                ? { displayName: 'New Kid Name' }
                : { displayName: 'New Name', email: 'new@example.com', role: 'member' }
            )
          }
        >
          Save Member
        </button>
      </div>
    ) : null,
}));
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
    mockCurrentUser.role = 'admin';
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

  // PC#2 — Modules & Dashboard used to stack three overlapping editors ("App
  // Modules", "What I see", "Member visibility"). It is now ONE matrix ("Who
  // sees what") carrying both layers, plus a widget-ORDER section (the only
  // thing the matrix can't express). Rendered un-mocked, so these are real
  // assertions about that surface.
  it('renders the single "Who sees what" matrix — both layers, no separate "What I see" section', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Modules & Dashboard'));

    expect(screen.getByRole('heading', { name: 'Who sees what' })).toBeInTheDocument();
    // The household layer lives on the matrix's section headers now, so the
    // old standalone "App Modules" switches are gone…
    expect(
      screen.getByRole('checkbox', { name: 'Toggle Habits for the household' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Toggle Habits page' })).not.toBeInTheDocument();
    // …and so is the duplicate per-member list.
    expect(screen.queryByText('What I see')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Show Transactions in Money' })
    ).not.toBeInTheDocument();
    // Per-member leaves are the matrix's columns instead.
    expect(screen.getByRole('checkbox', { name: 'Show Overview for Test User' })).toBeChecked();
  });

  it('renders the Home widget order section with drag handles instead of chevrons', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Modules & Dashboard'));

    expect(screen.getByRole('heading', { name: 'Home widget order' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show This Week Pulse on Home' })).toBeChecked();
    // PC#4 — a keyboard-operable grip replaced the up/down chevron pair.
    expect(screen.getByRole('button', { name: 'Reorder This Week Pulse' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Move This Week Pulse down' })
    ).not.toBeInTheDocument();
    // A default-hidden widget starts off, so the widget-merge default still
    // reaches the UI (no migration ran).
    expect(screen.getByRole('checkbox', { name: 'Show AI Insight on Home' })).not.toBeChecked();
  });

  // The matrix is no longer admin-gated — it is every member's own editor now
  // that "What I see" is gone. What the role decides is how many COLUMNS
  // render. Asserted by rendering as each role rather than by reading the
  // gate, per the 2G.1 lesson: gating only verified by code inspection is
  // invisible to whoever tests as the household admin.
  it('gives an admin a column for every member, including the managed kid', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Modules & Dashboard'));

    expect(screen.getByRole('checkbox', { name: 'Show Overview for Test User' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show Overview for Partner User' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show Overview for Kiddo' })).toBeInTheDocument();
  });

  // The regression risk of collapsing the sections: a non-admin must still be
  // able to edit their OWN nav (they lost "What I see"), while other members'
  // columns must be genuinely absent from the DOM, not merely unreachable.
  it('gives a non-admin the matrix with only their own column', () => {
    mockCurrentUser.role = 'member';
    renderSettings();
    fireEvent.click(screen.getByText('Modules & Dashboard'));

    expect(screen.getByRole('heading', { name: 'Who sees what' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show Overview for Test User' })).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Show Overview for Partner User' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Show Overview for Kiddo' })
    ).not.toBeInTheDocument();
    // The household layer was never admin-only and must not become so.
    expect(
      screen.getByRole('checkbox', { name: 'Toggle Habits for the household' })
    ).toBeInTheDocument();
  });

  // PC#1 — five wrapping preset chips became one Select. Nothing is written
  // until Apply, and the placeholder is the "no preview" state.
  it('previews a module preset chosen from the dropdown and only applies on Apply', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Modules & Dashboard'));

    const presets = screen.getByRole('combobox', { name: 'Quick presets' });
    expect(presets).toHaveValue('');
    // The old chips are gone.
    expect(screen.queryByRole('button', { name: 'Finance only' })).not.toBeInTheDocument();

    fireEvent.change(presets, { target: { value: 'finance-only' } });
    expect(
      screen.getByText('Just Money — habits, to-dos, meals, and shopping stay hidden.')
    ).toBeInTheDocument();

    // Cancel returns the Select to the placeholder without writing anything.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(presets).toHaveValue('');
    expect(
      screen.queryByText('Just Money — habits, to-dos, meals, and shopping stay hidden.')
    ).not.toBeInTheDocument();
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

  // Managed kids are edited through the SAME MemberModal as ordinary members
  // (it renders only the displayName field for them — see
  // MemberModal.test.tsx), but a save must never reach `updateMember`:
  // firestore.rules' managed-kid branch restricts that path, and a kid has no
  // email/role for it to write anyway. `handleSaveMember` routes a managed
  // kid's save to the purpose-built `updateKidProfile` mutation instead.
  describe('Members list — managed kid routing', () => {
    it('opens the generic MemberModal when editing an ordinary member, titled "Edit Member"', () => {
      renderSettings();
      fireEvent.click(screen.getByText('Household'));

      const editButtons = screen.getAllByRole('button', { name: 'Edit Member' });
      expect(editButtons.length).toBeGreaterThan(0);
      // Length just asserted above, so index 0 is provably present.
      fireEvent.click(editButtons[0]!);

      const modal = screen.getByTestId('member-modal');
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('data-title', 'Edit Member');
    });

    it('routes an ordinary member save to updateMember, not updateKidProfile', () => {
      renderSettings();
      fireEvent.click(screen.getByText('Household'));

      const editButtons = screen.getAllByRole('button', { name: 'Edit Member' });
      fireEvent.click(editButtons[0]!);
      fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));

      // editButtons[0] is Partner User (admins sort first, alphabetically).
      expect(mockUpdateMember).toHaveBeenCalledWith('user-2', {
        displayName: 'New Name',
        email: 'new@example.com',
        role: 'member',
      });
      expect(mockUpdateKidProfile).not.toHaveBeenCalled();
    });

    it('opens the SAME MemberModal for a managed kid, titled "Edit Kid Profile"', () => {
      renderSettings();
      fireEvent.click(screen.getByText('Household'));

      fireEvent.click(screen.getByRole('button', { name: 'Edit Kid Profile' }));

      const modal = screen.getByTestId('member-modal');
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('data-title', 'Edit Kid Profile');
    });

    it('routes a managed kid save to updateKidProfile, not updateMember', () => {
      renderSettings();
      fireEvent.click(screen.getByText('Household'));

      fireEvent.click(screen.getByRole('button', { name: 'Edit Kid Profile' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));

      expect(mockUpdateKidProfile).toHaveBeenCalledWith('kid-1', { displayName: 'New Kid Name' });
      expect(mockUpdateMember).not.toHaveBeenCalled();
    });
  });
});
