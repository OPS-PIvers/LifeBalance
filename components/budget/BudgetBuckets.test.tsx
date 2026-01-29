/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText('Transactions This Period (1)')).toBeInTheDocument();
    expect(screen.getByText('Grocery Store')).toBeInTheDocument();
    expect(screen.getByText('$50')).toBeInTheDocument();
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
    // Mock window.confirm
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockImplementation(() => true);

    render(<BudgetBuckets />);

    // Expand first
    const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
    fireEvent.click(toggleButton);

    // Click delete transaction
    const deleteButton = screen.getByTitle('Delete transaction');
    fireEvent.click(deleteButton);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteTransaction).toHaveBeenCalledWith('t1');

    confirmSpy.mockRestore();
  });

  it('does not delete transaction when cancelled', async () => {
     // Mock window.confirm
     const confirmSpy = vi.spyOn(window, 'confirm');
     confirmSpy.mockImplementation(() => false);

     render(<BudgetBuckets />);

     // Expand first
     const toggleButton = screen.getByRole('button', { name: /Toggle 1 transactions for Groceries/i });
     fireEvent.click(toggleButton);

     // Click delete transaction
     const deleteButton = screen.getByTitle('Delete transaction');
     fireEvent.click(deleteButton);

     expect(confirmSpy).toHaveBeenCalled();
     expect(mockDeleteTransaction).not.toHaveBeenCalled();

     confirmSpy.mockRestore();
  });
});
