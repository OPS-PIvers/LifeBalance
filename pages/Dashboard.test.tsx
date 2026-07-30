import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey, ToDo, ShoppingItem } from '@/types/schema';

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
  useTodos: () => ({
    updateToDo: vi.fn(),
    deleteToDo: vi.fn(),
    completeToDo: vi.fn(),
    todosAwaitingReview: mockTodosAwaitingReview,
  }),
  useShopping: () => ({ shoppingAwaitingReview: mockShoppingAwaitingReview }),
}));

// The action queue is mixed-domain (PR4). Backed by a mutable array so the
// cap/show-more tests can seed items; visibility tests leave it empty. The
// factory only closes over `queueItems` (read at render time), so declaring it
// after the hoisted vi.mock is safe.
let queueItems: Array<{ id: string }> = [];
vi.mock('@/hooks/useActionQueue', async (importOriginal) => {
  // Keep the REAL type guards (isTransactionQueueItem etc.) — the approve
  // pre-commit disclosure memo runs them at render over the seeded queue.
  const actual = await importOriginal<typeof import('@/hooks/useActionQueue')>();
  return {
    ...actual,
    useActionQueue: () => ({ actionQueue: queueItems }),
  };
});

// Layer 4: the aggregate ReviewQueueCard's held shopping/to-do sources.
// Mutable, closed over by the useTodos/useShopping mocks above (declaring
// them after those hoisted vi.mock calls is safe — same reasoning as
// `queueItems`).
let mockTodosAwaitingReview: ToDo[] = [];
let mockShoppingAwaitingReview: ShoppingItem[] = [];

// Keep the LazyMount gate real (children render once `when` flips true) but
// off framer-motion/Drawer — mirrors TopToolbar.test.tsx's pattern.
vi.mock('@/components/ui/LazyMount', () => ({
  LazyMount: ({ when, children }: { when: boolean; children: React.ReactNode }) =>
    when ? <>{children}</> : null,
}));
// Stub the heavy cycling drawer to an identifiable marker so the "opens on
// tap" wiring is observable without pulling in its real per-type review forms.
vi.mock('@/components/modals/ReviewPendingDrawer', () => ({
  default: ({ isOpen, items }: { isOpen: boolean; items: Array<{ id: string }> }) =>
    isOpen ? <div data-testid="review-drawer">{items.map((i) => i.id).join(',')}</div> : null,
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
vi.mock('@/components/dashboard/ScoreboardWidget', () => ({
  ScoreboardWidget: () => null,
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
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
    // 2F.2: Home has no household-level toggle; these tests aren't exercising
    // that member-only choice, so it's simply on.
    isHomeVisible: true,
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
    mockTodosAwaitingReview = [];
    mockShoppingAwaitingReview = [];
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
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
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
    queueItems = Array.from({ length: 8 }, (_, i) => ({ id: `q-${i}` }));
    mockTodosAwaitingReview = [];
    mockShoppingAwaitingReview = [];
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
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
    mockTodosAwaitingReview = [];
    mockShoppingAwaitingReview = [];
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

describe('Dashboard aggregate review queue card (Layer 4)', () => {
  const makeTodo = (id: string): ToDo => ({
    id,
    text: `Todo ${id}`,
    completeByDate: '2026-07-21',
    assignedTo: 'uid-1',
    isCompleted: false,
    createdBy: 'uid-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    needsReview: true,
  });

  const makeShoppingItem = (id: string): ShoppingItem => ({
    id,
    name: `Item ${id}`,
    category: 'Produce',
    isPurchased: false,
    needsReview: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
    queueItems = [];
    mockTodosAwaitingReview = [];
    mockShoppingAwaitingReview = [];
  });

  it('renders no review card when nothing is held for review', () => {
    renderDashboard();
    expect(screen.queryByText(/item.*to review/)).not.toBeInTheDocument();
  });

  it('shows the aggregate count across held todos + shopping items (not transactions)', () => {
    mockTodosAwaitingReview = [makeTodo('t1'), makeTodo('t2')];
    mockShoppingAwaitingReview = [makeShoppingItem('s1')];
    renderDashboard();
    expect(screen.getByText('3 items to review')).toBeInTheDocument();
  });

  it('uses the singular label for exactly one held item', () => {
    mockTodosAwaitingReview = [makeTodo('t1')];
    renderDashboard();
    expect(screen.getByText('1 item to review')).toBeInTheDocument();
  });

  it('opens the review drawer with a todos-then-shopping snapshot on tap', async () => {
    mockTodosAwaitingReview = [makeTodo('t1')];
    mockShoppingAwaitingReview = [makeShoppingItem('s1')];
    renderDashboard();

    expect(screen.queryByTestId('review-drawer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('2 items to review'));

    // ReviewPendingDrawer is `React.lazy`-loaded, so it resolves asynchronously
    // even with the module mocked (mirrors TopToolbar.test.tsx).
    await waitFor(() => {
      expect(screen.getByTestId('review-drawer')).toHaveTextContent('t1,s1');
    });
  });

  it('hides the review card when both the To-Dos and Shopping tabs are disabled', () => {
    mockTodosAwaitingReview = [makeTodo('t1')];
    mockShoppingAwaitingReview = [makeShoppingItem('s1')];
    // Plan stays on, but its To-Dos/Shopping sub-tabs are both off.
    setEnabledModules(['habits', 'money', 'lists', 'meals']);
    renderDashboard();
    expect(screen.queryByText(/item.*to review/)).not.toBeInTheDocument();
  });

  it('shows only the visible-domain items when one of the two tabs is disabled', async () => {
    mockTodosAwaitingReview = [makeTodo('t1')];
    mockShoppingAwaitingReview = [makeShoppingItem('s1')];
    // Shopping tab hidden — only the held to-do should count/appear.
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals']);
    renderDashboard();

    expect(screen.getByText('1 item to review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('1 item to review'));

    await waitFor(() => {
      expect(screen.getByTestId('review-drawer')).toHaveTextContent('t1');
    });
  });
});
