import { render, screen, fireEvent } from '@testing-library/react';
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
    isPlanVisible: true,
    isPlanTabVisible: () => true,
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

vi.mock('./CaptureMenu', () => ({
  CaptureMenu: () => <div data-testid="capture-menu">Capture Menu</div>,
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
  Loader2: () => <span data-testid="icon-loader" />,
  Store: () => <span data-testid="icon-store" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

describe('CaptureModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all capture modules enabled (pre-090 behavior).
    setEnabledModules(['money', 'todos', 'shopping']);
  });

  it('renders correctly when open', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByText('Add Transaction')).toBeInTheDocument(); // Default title
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

    // Check header update
    expect(screen.getByText('New Task')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  it('switches to Shopping tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Click Shop tab
    fireEvent.click(screen.getByText('Shop'));

    // Check header update
    expect(screen.getByText('Add Item')).toBeInTheDocument();

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
    expect(screen.getByText('Add Transaction')).toBeInTheDocument();
  });

  // --- Plan 090: capture-tab cascade ---

  it('only renders tabs whose module is enabled', () => {
    setEnabledModules(['todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.queryByText('Expense')).not.toBeInTheDocument();
    expect(screen.getByText('To-Do')).toBeInTheDocument();
    expect(screen.getByText('Shop')).toBeInTheDocument();
  });

  it('defaults the active tab to the first enabled tab when the default (money) is off', () => {
    // Money disabled, so the Expense (transaction) default is unavailable.
    setEnabledModules(['todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // First enabled tab is To-Do — its content + title should be active.
    expect(screen.getByText('New Task')).toBeInTheDocument();
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  it('hides the tab switcher when only one capture module is enabled', () => {
    setEnabledModules(['shopping']);
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
});
