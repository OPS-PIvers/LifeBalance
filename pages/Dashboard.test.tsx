import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Narrow context slices the Dashboard reads. Stub with minimal shapes; the
// gated widgets themselves are mocked to identifiable stubs below.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    isLoading: false,
    currentUser: { displayName: 'Test User', dashboardHidden: [] },
    members: [],
    pendingItemsCount: 0,
    recaps: [],
    moneyRecaps: [],
  }),
  useFinance: () => ({
    buckets: [],
    transactions: [],
    payCalendarItem: vi.fn(),
    deferCalendarItem: vi.fn(),
    deleteCalendarItem: vi.fn(),
    updateTransactionCategory: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  }),
  useGamification: () => ({ habits: [] }),
  useTodos: () => ({ updateToDo: vi.fn(), deleteToDo: vi.fn(), completeToDo: vi.fn() }),
}));

// The action queue is mixed-domain (PR4). Backed by a mutable array so the
// cap/show-more tests can seed items; visibility tests leave it empty. The
// factory only closes over `queueItems` (read at render time), so declaring it
// after the hoisted vi.mock is safe.
let queueItems: Array<{ id: string }> = [];
vi.mock('@/hooks/useActionQueue', () => ({
  useActionQueue: () => ({ actionQueue: queueItems }),
}));

// Gated single-domain widgets — stub to identifiable text so the visibility
// gating is observable regardless of their self-null-on-empty-data behavior.
vi.mock('@/components/dashboard/DailyHabitsWidget', () => ({
  DailyHabitsWidget: () => <div>DAILY_HABITS</div>,
}));

// Mixed-domain / unrelated widgets (PR4 + dormant) — rendered but inert.
vi.mock('@/components/dashboard/PulseStripWidget', () => ({
  PulseStripWidget: () => null,
}));
vi.mock('@/components/dashboard/WeeklyRecapCard', () => ({
  WeeklyRecapCard: () => null,
}));
vi.mock('@/components/dashboard/InsightWidget', () => ({
  InsightWidget: () => null,
}));
vi.mock('@/components/dashboard/ActivityFeedWidget', () => ({
  ActivityFeedWidget: () => null,
}));
vi.mock('@/components/dashboard/KidsChoresWidget', () => ({
  KidsChoresWidget: () => null,
}));
// Stubbed to identifiable text (rather than null) so the queue-reordering
// tests below can assert its position relative to the Action Queue section.
vi.mock('@/components/dashboard/CreditCardActivityWidget', () => ({
  CreditCardActivityWidget: () => <div>CREDIT_CARD_WIDGET</div>,
}));
vi.mock('@/components/dashboard/ActionQueueItem', () => ({
  ActionQueueItemCard: ({ item }: { item: { id: string } }) => (
    <div data-testid="queue-item">{item.id}</div>
  ),
}));
vi.mock('@/components/budget/AccountPicker', () => ({
  AccountPicker: () => null,
}));

// Module visibility (Plan 090): mocked so each test chooses enabled modules.
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('plan') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('plan') && enabled.includes(tab),
  });
};

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

const TRENDS_LABEL = 'View trends';

describe('Dashboard module visibility (Plan 090)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueItems = [];
    setEnabledModules(['habits', 'money', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('shows the trends button and DailyHabitsWidget when both domains are on', () => {
    renderDashboard();
    expect(screen.getByRole('button', { name: TRENDS_LABEL })).toBeInTheDocument();
    expect(screen.getByText('DAILY_HABITS')).toBeInTheDocument();
  });

  it('hides the trends button when money is off', () => {
    setEnabledModules(['habits']);
    renderDashboard();
    expect(screen.queryByRole('button', { name: TRENDS_LABEL })).not.toBeInTheDocument();
    // Habits widget stays.
    expect(screen.getByText('DAILY_HABITS')).toBeInTheDocument();
  });

  it('hides DailyHabitsWidget when habits is off', () => {
    setEnabledModules(['money']);
    renderDashboard();
    expect(screen.queryByText('DAILY_HABITS')).not.toBeInTheDocument();
    // Money widgets stay.
    expect(screen.getByRole('button', { name: TRENDS_LABEL })).toBeInTheDocument();
  });
});

describe('Dashboard action queue cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'plan', 'todos', 'meals', 'shopping']);
    queueItems = Array.from({ length: 8 }, (_, i) => ({ id: `q-${i}` }));
  });

  it('renders at most 6 items with a show-more row that expands in place', () => {
    renderDashboard();
    expect(screen.getAllByTestId('queue-item')).toHaveLength(6);

    const moreRow = screen.getByRole('button', { name: '+ 2 more items' });
    expect(moreRow).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(moreRow);

    expect(screen.getAllByTestId('queue-item')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('renders no show-more row when the queue fits under the cap', () => {
    queueItems = Array.from({ length: 4 }, (_, i) => ({ id: `q-${i}` }));
    renderDashboard();
    expect(screen.getAllByTestId('queue-item')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /more item/ })).not.toBeInTheDocument();
  });

  it('shows the FULL queue while selection mode is active, without a show-more row', () => {
    renderDashboard();
    expect(screen.getAllByTestId('queue-item')).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(screen.getAllByTestId('queue-item')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /more item/ })).not.toBeInTheDocument();

    // Leaving selection mode restores the cap.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByTestId('queue-item')).toHaveLength(6);
  });
});

describe('Dashboard hero slot (impeccable r6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('leads with the "Needs you" queue hero above the widgets when the queue has items', () => {
    queueItems = [{ id: 'q-0' }];
    renderDashboard();
    const queueHeading = screen.getByRole('heading', { name: /Needs you/ });
    expect(screen.getByText('1 item in your Action Queue')).toBeInTheDocument();
    const creditCardWidget = screen.getByText('CREDIT_CARD_WIDGET');
    // DOCUMENT_POSITION_FOLLOWING on creditCardWidget relative to queueHeading
    // means queueHeading comes first in the DOM.
    expect(
      queueHeading.compareDocumentPosition(creditCardWidget) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The glance hero never renders alongside the queue hero.
    expect(screen.queryByRole('heading', { name: /All caught up/ })).not.toBeInTheDocument();
  });

  it('leads with the "All caught up" glance hero above the widgets when the queue is empty', () => {
    queueItems = [];
    renderDashboard();
    const glanceHeading = screen.getByRole('heading', { name: /All caught up/ });
    // Money is enabled, so the Safe-to-Spend glance figure renders.
    expect(screen.getByText('safe to spend')).toBeInTheDocument();
    const creditCardWidget = screen.getByText('CREDIT_CARD_WIDGET');
    expect(
      glanceHeading.compareDocumentPosition(creditCardWidget) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The old bottom-of-page empty-queue card is gone — the hero owns the message.
    expect(screen.getAllByRole('heading', { name: /All caught up/ })).toHaveLength(1);
  });

  it('hides the glance figures for disabled modules', () => {
    queueItems = [];
    setEnabledModules([]);
    renderDashboard();
    expect(screen.getByRole('heading', { name: /All caught up/ })).toBeInTheDocument();
    expect(screen.queryByText('safe to spend')).not.toBeInTheDocument();
    expect(screen.queryByText(/habits done today|habits — day complete/)).not.toBeInTheDocument();
  });
});
