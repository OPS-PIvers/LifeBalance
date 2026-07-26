import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import CaptureModal from './CaptureModal';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Mock dependencies
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

// Controllable mocks for the dynamically-imported Gemini scan functions, so
// the cancellation-guard tests below can hold a scan "in flight" and resolve
// it on demand after the user has backed out.
const { parseReceiptLineItemsMock, parseBankStatementMock } = vi.hoisted(() => ({
  parseReceiptLineItemsMock: vi.fn(),
  parseBankStatementMock: vi.fn(),
}));
vi.mock('@/services/geminiService', () => ({
  parseReceiptLineItems: parseReceiptLineItemsMock,
  parseBankStatement: parseBankStatementMock,
}));

// Mock useHousehold
const mockUseHousehold = {
  addTransaction: vi.fn(),
  buckets: [] as unknown[],
  habits: [] as unknown[],
  transactions: [] as unknown[],
  addToDo: vi.fn(),
  members: [] as unknown[],
  currentUser: { uid: 'test-user' },
  addShoppingItem: vi.fn(),
  householdId: 'test-household',
  stores: [] as unknown[],
  accounts: [] as unknown[],
};

// Each slice hook returns the shared superset object; destructuring in the
// component picks the fields it needs from whichever slice it calls.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => mockUseHousehold,
  useGamification: () => mockUseHousehold,
  useHouseholdCore: () => mockUseHousehold,
  useTodos: () => mockUseHousehold,
  useShopping: () => mockUseHousehold,
}));

// Module visibility (Plan 090): mocked so each test can choose which capture
// modules are enabled. Defaults to all-on (full 3-tab layout = pre-090 behavior).
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` capture modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    // To-Do/Shop capture require the Plan master AND the sub-tab to be on.
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
    isHomeVisible: true,
  });
};

// Mock child components to simplify testing
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ children, isOpen, header }: { children: React.ReactNode; isOpen: boolean; header: React.ReactNode }) => isOpen ? (
    <div data-testid="drawer">
      <div data-testid="drawer-header">{header}</div>
      {children}
    </div>
  ) : null,
}));

// Expose onManual/onSelectImage so tests can drive the merged menu without
// rendering the full CaptureMenu (its own tests cover its internals).
vi.mock('./CaptureMenu', () => ({
  CaptureMenu: ({ onManual, onSelectImage }: { onManual: () => void; onSelectImage: (file: File) => void }) => (
    <div data-testid="capture-menu">
      <button data-testid="manual-entry" onClick={onManual}>Manual Entry</button>
      <button
        data-testid="add-from-image"
        onClick={() => onSelectImage(new File(['x'], 'receipt.png', { type: 'image/png' }))}
      >
        Add from Image
      </button>
    </div>
  ),
}));

vi.mock('./CaptureTransactionManual', () => ({
  CaptureTransactionManual: () => <div data-testid="capture-transaction-manual">Manual Entry</div>,
}));

vi.mock('./CaptureTodoTab', () => ({
  CaptureTodoTab: () => <div data-testid="capture-todo-tab">Todo Tab</div>,
}));

vi.mock('./CaptureShoppingTab', () => ({
  CaptureShoppingTab: () => <div data-testid="capture-shopping-tab">Shopping Tab</div>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Wallet: () => <span data-testid="icon-wallet" />,
  CheckSquare: () => <span data-testid="icon-check-square" />,
  ShoppingBag: () => <span data-testid="icon-shopping-bag" />,
  X: () => <span data-testid="icon-x" />,
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  Loader2: () => <span data-testid="icon-loader" />,
  Store: () => <span data-testid="icon-store" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

describe('CaptureModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all capture modules enabled (pre-090 behavior). Plan is on so the
    // To-Do/Shop sub-tab destinations are reachable.
    setEnabledModules(['money', 'lists', 'todos', 'shopping']);
  });

  it('renders correctly when open', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    // Menu view with multiple capture types keeps the generic title — the
    // type selector below carries the specifics (round-3 critique).
    expect(screen.getByText('Capture')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<CaptureModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('renders tab switcher', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Expense')).toBeInTheDocument();
    expect(screen.getByText('To-Do')).toBeInTheDocument();
    expect(screen.getByText('Shop')).toBeInTheDocument();
  });

  it('switches to To-Do tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Initial state: Transaction tab (CaptureMenu)
    expect(screen.getByTestId('capture-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-todo-tab')).not.toBeInTheDocument();

    // Click To-Do tab
    fireEvent.click(screen.getByText('To-Do'));

    // Title stays the generic 'Capture' while the multi-type selector is
    // visible; the selected segment communicates the type.
    expect(screen.getByText('Capture')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  it('switches to Shopping tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Click Shop tab
    fireEvent.click(screen.getByText('Shop'));

    // Generic title while the multi-type selector is visible (see above).
    expect(screen.getByText('Capture')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();
  });

  it('switches back to Expense tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Go to Shop first
    fireEvent.click(screen.getByText('Shop'));
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();

    // Go back to Expense
    fireEvent.click(screen.getByText('Expense'));
    expect(screen.getByTestId('capture-menu')).toBeInTheDocument();
    expect(screen.getByText('Capture')).toBeInTheDocument();
  });

  // --- Plan 090: capture-tab cascade ---

  it('only renders tabs whose module is enabled', () => {
    setEnabledModules(['lists', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.queryByText('Expense')).not.toBeInTheDocument();
    expect(screen.getByText('To-Do')).toBeInTheDocument();
    expect(screen.getByText('Shop')).toBeInTheDocument();
  });

  it('gates To-Do/Shop tabs behind the Plan master (only Expense when Plan is off)', () => {
    // todos + shopping flags on, but Plan off → their destinations are hidden,
    // so only the Expense (money) capture tab remains.
    setEnabledModules(['money', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText('Add Transaction')).toBeInTheDocument(); // Expense active
    expect(screen.queryByText('To-Do')).not.toBeInTheDocument();
    expect(screen.queryByText('Shop')).not.toBeInTheDocument();
  });

  it('defaults the active tab to the first enabled tab when the default (money) is off', () => {
    // Money disabled, so the Expense (transaction) default is unavailable.
    setEnabledModules(['lists', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // First enabled tab is To-Do — its content is active (title stays the
    // generic 'Capture' since To-Do + Shop are both selectable).
    expect(screen.getByText('Capture')).toBeInTheDocument();
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  it('hides the tab switcher when only one capture module is enabled', () => {
    setEnabledModules(['lists', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Single enabled tab renders its content with no switchable strip.
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();
    expect(screen.getByText('Add Item')).toBeInTheDocument();
    expect(screen.queryByText('Expense')).not.toBeInTheDocument();
    expect(screen.queryByText('To-Do')).not.toBeInTheDocument();
    // Sole tab's own label is not rendered as a switcher option.
    expect(screen.queryByText('Shop')).not.toBeInTheDocument();
  });

  it('renders a graceful empty state when no capture module is enabled', () => {
    setEnabledModules([]);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // No crash on tabOptions[0]; a guidance message is shown instead.
    expect(screen.getByText(/No capture types are enabled/i)).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  // --- Back affordance (paper cut 2G.3) ---

  describe('back navigation', () => {
    it('shows no back button on the menu view', () => {
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
    });

    it('shows a Back button in the manual sub-view and returns to the menu', () => {
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('manual-entry'));
      expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
      expect(screen.getByLabelText('Back')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Back'));
      expect(screen.getByTestId('capture-menu')).toBeInTheDocument();
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
      // Back is a pure navigation — it must not close the whole drawer.
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  // --- Processing-view cancellation guard (PR #1108 finding) ---

  describe('processing view cancellation guard', () => {
    beforeEach(() => {
      parseReceiptLineItemsMock.mockReset();
      parseBankStatementMock.mockReset();
      mockUseHousehold.addTransaction.mockReset();
    });

    it('hides the Back button while a scan is processing', async () => {
      // Never resolves — keeps the flow parked in 'processing'.
      parseReceiptLineItemsMock.mockReturnValue(new Promise(() => {}));
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));

      await screen.findByText('Processing');
      // Let the flow actually reach (and lock in) its call to the mocked
      // scan function before the test ends — otherwise the FileReader's
      // callback can fire LATE (after this test has finished and the next
      // test has reconfigured the shared mock's return value), so this
      // never-resolving promise would end up calling the NEXT test's mock
      // return value instead of its own, contaminating that test.
      await waitFor(() => expect(parseReceiptLineItemsMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
      // The header X (unlike Back) intentionally remains — it's guarded by
      // the cancellation ref instead, see the next test.
      expect(screen.getByLabelText('Close drawer')).toBeInTheDocument();
    });

    it('a scan resolving after the flow was abandoned performs no state update and no addTransaction call', async () => {
      let resolveScan: (data: { merchant: string; date: string; items: { description: string; amount: number; category: string }[] }) => void = () => {};
      parseReceiptLineItemsMock.mockReturnValue(
        new Promise((resolve) => { resolveScan = resolve; })
      );
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByText('Processing');

      // Back is hidden during processing (previous test), but the header X
      // is still reachable — the user force-closes the in-flight scan.
      fireEvent.click(screen.getByLabelText('Close drawer'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      // ...and starts a fresh manual entry.
      await screen.findByTestId('capture-menu');
      fireEvent.click(screen.getByTestId('manual-entry'));
      expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();

      // The abandoned scan now resolves.
      resolveScan({
        merchant: 'Target',
        date: '2026-07-01',
        items: [{ description: 'Widget', amount: 10, category: 'Shopping' }],
      });
      // Flush the resolved scan's continuation (a couple of chained awaits)
      // before asserting nothing happened.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // It must be a total no-op: no transaction written, and the manual
      // form the user is now typing into must not be clobbered.
      expect(mockUseHousehold.addTransaction).not.toHaveBeenCalled();
      expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
      expect(screen.queryByText('Review')).not.toBeInTheDocument();
    });
  });
});
