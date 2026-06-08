import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import CaptureModal from './CaptureModal';

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

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockUseHousehold,
}));

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
});
