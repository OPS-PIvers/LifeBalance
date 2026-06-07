/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BudgetBuckets from './BudgetBuckets';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock the Household Context
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="alert-triangle" />,
  ArrowRightLeft: () => <span data-testid="arrow-right-left" />,
  Plus: () => <span data-testid="plus-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  Check: () => <span data-testid="check-icon" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  Edit: () => <span data-testid="edit-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  MoreVertical: () => <span data-testid="more-vertical-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

// Mock child modals
vi.mock('../modals/BucketFormModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="bucket-form-modal">Bucket Form Modal</div> : null
}));

vi.mock('../modals/EditTransactionModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="edit-transaction-modal">Edit Transaction Modal</div> : null
}));

// Mock shared UI Modal
vi.mock('../ui/Modal', () => ({
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
    (useHousehold as any).mockReturnValue({
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
    });
  });

  it('renders buckets correctly', () => {
    render(<BudgetBuckets />);
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Dining Out')).toBeInTheDocument();
  });

  it('shows overspending alert and fix button for overspent bucket', () => {
    render(<BudgetBuckets />);
    expect(screen.getByText('Over by $100.00')).toBeInTheDocument();
    expect(screen.getByText('Fix')).toBeInTheDocument();
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

  it('expands bucket details to show transactions', async () => {
    render(<BudgetBuckets />);

    // Initially transaction should not be visible
    expect(screen.queryByText('Grocery Store')).not.toBeInTheDocument();

    // Click to expand. The aria-label is dynamic based on expanded state
    const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Check transactions are visible
    expect(screen.getByText('Transactions (1)')).toBeInTheDocument();
    expect(screen.getByText('Grocery Store')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
  });

  it('opens edit transaction modal', async () => {
    render(<BudgetBuckets />);

    // Expand first
    const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Click edit transaction
    const editButton = screen.getByTitle('Edit transaction');
    fireEvent.click(editButton);

    expect(screen.getByTestId('edit-transaction-modal')).toBeInTheDocument();
  });

  it('deletes transaction when confirmed', async () => {
    render(<BudgetBuckets />);

    // Expand first
    const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Click delete transaction -> opens the confirm dialog
    const deleteButton = screen.getByTitle('Delete transaction');
    fireEvent.click(deleteButton);

    // Confirm in the accessible dialog
    const dialog = screen.getByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmButton);

    expect(mockDeleteTransaction).toHaveBeenCalledWith('t1');
  });

  it('does not delete transaction when cancelled', async () => {
     render(<BudgetBuckets />);

     // Expand first
     const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
     fireEvent.click(toggleButton);

     // Click delete transaction -> opens the confirm dialog
     const deleteButton = screen.getByTitle('Delete transaction');
     fireEvent.click(deleteButton);

     // Cancel in the dialog
     const dialog = screen.getByRole('dialog');
     const cancelButton = within(dialog).getByRole('button', { name: 'Cancel' });
     fireEvent.click(cancelButton);

     expect(mockDeleteTransaction).not.toHaveBeenCalled();
  });

  it('opens transaction actions drawer on mobile', async () => {
    render(<BudgetBuckets />);

    // Expand first
    const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Find the More Options button (which is rendered in the card)
    // Note: In the real app, this is only visible on mobile (sm:hidden).
    // In JSDOM tests, usually styles aren't applied so both desktop and mobile buttons might be in the DOM,
    // or we might need to target it specifically.
    // The BudgetBucketCard implementation has `aria-label="More options"` on the button.
    const moreButton = screen.getByLabelText('More options');
    expect(moreButton).toBeInTheDocument();

    // Click it to open drawer
    fireEvent.click(moreButton);

    // Check if Drawer content appears
    expect(screen.getByText('Transaction Options')).toBeInTheDocument();

    // Check if Edit button works
    const editButton = screen.getByText('Edit Transaction');
    fireEvent.click(editButton);
    expect(screen.getByTestId('edit-transaction-modal')).toBeInTheDocument();

    // Re-open drawer (since it closes on action)
    fireEvent.click(moreButton);

    // Check if Delete button works -> opens the confirm dialog
    const deleteButton = screen.getByText('Delete');
    fireEvent.click(deleteButton);

    // Confirm in the accessible dialog
    const dialog = screen.getByRole('dialog', { name: 'Delete Transaction' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(mockDeleteTransaction).toHaveBeenCalledWith('t1');
  });
});
