import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BudgetBuckets from './BudgetBuckets';
import { useHousehold, type HouseholdContextType } from '@/contexts/FirebaseHouseholdContext';

// Mock the Household Context
// BudgetBuckets reads useFinance. Back every hook with one shared mock fn so the
// existing `useHousehold` mock setup drives all of them with the same value.
vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const fn = vi.fn();
  return {
    useHousehold: fn,
    useFinance: fn,
    useHouseholdCore: fn,
    useMeals: fn,
    useTodos: fn,
    useGamification: fn,
  };
});

// Mock framer-motion so the real (unmocked) bucket-detail Drawer's
// open/close state is reflected synchronously in the DOM instead of lingering
// through an exit animation — needed to assert the Drawer actually closes
// (not just gets covered) before the Edit Transaction sheet opens.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, onClick, ...props }: { children: React.ReactNode, className?: string, onClick?: () => void, [key: string]: unknown }) => (
      <div className={className} onClick={onClick} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDragControls: () => ({ start: () => {} }),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="alert-triangle" />,
  ArrowRightLeft: () => <span data-testid="arrow-right-left" />,
  Plus: () => <span data-testid="plus-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  Check: () => <span data-testid="check-icon" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  Edit: () => <span data-testid="edit-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  MoreVertical: () => <span data-testid="more-vertical-icon" />,
  Wallet: () => <span data-testid="wallet-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

// Mock child modals
vi.mock('@/components/modals/BucketFormModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="bucket-form-modal">Bucket Form Modal</div> : null
}));

vi.mock('@/components/modals/EditTransactionModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="edit-transaction-modal">Edit Transaction Modal</div> : null
}));

// Mock shared UI Modal
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children, ariaLabelledBy }: { isOpen: boolean; children: React.ReactNode; ariaLabelledBy?: string }) =>
    isOpen ? (
      <div role="dialog" aria-labelledby={ariaLabelledBy}>
        {children}
      </div>
    ) : null
}));

describe('BudgetBuckets', () => {
  const mockUpdateBucketLimit = vi.fn();
  const mockReallocateBucket = vi.fn();
  const mockDeleteTransaction = vi.fn();

  const mockBuckets = [
    {
      id: 'b1',
      name: 'Groceries',
      limit: 500,
      color: 'bg-green-500',
    },
    {
      id: 'b2',
      name: 'Dining Out',
      limit: 200,
      color: 'bg-blue-500',
    }
  ];

  const mockTransactions = [
    {
      id: 't1',
      date: '2023-10-01T12:00:00.000Z',
      amount: 50,
      merchant: 'Grocery Store',
      category: 'Groceries',
      payPeriodId: 'p1',
      status: 'posted'
    }
  ];

  const mockBucketSpentMap = new Map();
  mockBucketSpentMap.set('b1', { verified: 600, pending: 0 }); // Overspent
  mockBucketSpentMap.set('b2', { verified: 100, pending: 0 }); // Under budget

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHousehold).mockReturnValue({
      buckets: mockBuckets,
      accounts: [],
      safeToSpend: 1000,
      reallocateBucket: mockReallocateBucket,
      updateBucketLimit: mockUpdateBucketLimit,
      updateAccountBalance: vi.fn(),
      bucketSpentMap: mockBucketSpentMap,
      transactions: mockTransactions,
      currentPeriodId: 'p1',
      deleteTransaction: mockDeleteTransaction,
    } as unknown as HouseholdContextType);
  });

  it('renders buckets correctly', () => {
    render(<BudgetBuckets />);
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Dining Out')).toBeInTheDocument();
  });

  it('shows overspending alert and fix button for overspent bucket', () => {
    render(<BudgetBuckets />);
    expect(screen.getByText('$100.00 over budget')).toBeInTheDocument();
    expect(screen.getByText('Fix')).toBeInTheDocument();
  });

  it('surfaces the group-level total overage banner', () => {
    render(<BudgetBuckets />);
    expect(screen.getByText('1 bucket over budget')).toBeInTheDocument();
    expect(screen.getByText('$100.00 over')).toBeInTheDocument();
  });

  it('opens the Reallocate Modal when Fix button is clicked', () => {
    render(<BudgetBuckets />);
    const fixButton = screen.getByText('Fix');
    fireEvent.click(fixButton);

    // Check if Modal content appears
    expect(screen.getByText('Fix Overspending')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('allows inline editing of bucket limit', async () => {
    render(<BudgetBuckets />);

    // Click on limit to edit
    const limitDisplay = screen.getByText('$500');
    fireEvent.click(limitDisplay);

    // Check input appears
    const input = screen.getByLabelText('Edit limit for Groceries');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(500);

    // Change value
    fireEvent.change(input, { target: { value: '600' } });
    expect(input).toHaveValue(600);

    // Click save
    const saveButton = screen.getByLabelText('Save limit');
    fireEvent.click(saveButton);

    expect(mockUpdateBucketLimit).toHaveBeenCalledWith('b1', 600);
  });

  it('expands a bucket inline to show its transactions, and collapses on second tap', async () => {
    render(<BudgetBuckets />);

    // Initially transaction should not be visible
    expect(screen.queryByText('Grocery Store')).not.toBeInTheDocument();

    // Click the bucket row to expand it. The aria-label reflects the bucket's
    // transaction count.
    const toggleButton = screen.getByRole('button', { name: /View 1 transactions for Groceries/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggleButton);

    // The inline list shows the bucket's transactions
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('1 transaction')).toBeInTheDocument();
    expect(screen.getByText('Grocery Store')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();

    // Second tap collapses
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Grocery Store')).not.toBeInTheDocument();
  });

  it('shows the empty-state line when expanding a bucket with no transactions this period', async () => {
    render(<BudgetBuckets />);

    fireEvent.click(screen.getByRole('button', { name: /View 0 transactions for Dining Out/i }));
    expect(screen.getByText('No transactions yet this period')).toBeInTheDocument();
  });

  it('opens the edit transaction modal from the inline list', async () => {
    render(<BudgetBuckets />);

    // Expand the bucket first
    const toggleButton = screen.getByRole('button', { name: /View 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Click edit transaction
    const editButton = screen.getByTitle('Edit transaction');
    fireEvent.click(editButton);

    expect(screen.getByTestId('edit-transaction-modal')).toBeInTheDocument();
  });

  it('deletes transaction when confirmed', async () => {
    render(<BudgetBuckets />);

    // Open the transactions sheet first
    const toggleButton = screen.getByRole('button', { name: /View 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Click delete transaction -> opens the confirm dialog (on top of the
    // transactions sheet, so scope the query to the confirm dialog by name).
    const deleteButton = screen.getByTitle('Delete transaction');
    fireEvent.click(deleteButton);

    const dialog = screen.getByRole('dialog', { name: 'Delete Transaction' });
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmButton);

    expect(mockDeleteTransaction).toHaveBeenCalledWith('t1');
  });

  it('does not delete transaction when cancelled', async () => {
     render(<BudgetBuckets />);

     // Open the transactions sheet first
     const toggleButton = screen.getByRole('button', { name: /View 1 transactions for Groceries/i });
     fireEvent.click(toggleButton);

     // Click delete transaction -> opens the confirm dialog
     const deleteButton = screen.getByTitle('Delete transaction');
     fireEvent.click(deleteButton);

     // Cancel in the dialog (scoped by name since the transactions sheet is
     // also an open dialog behind it)
     const dialog = screen.getByRole('dialog', { name: 'Delete Transaction' });
     const cancelButton = within(dialog).getByRole('button', { name: 'Cancel' });
     fireEvent.click(cancelButton);

     expect(mockDeleteTransaction).not.toHaveBeenCalled();
  });
});
