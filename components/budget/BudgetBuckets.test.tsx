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
}));

// Mock child modals to avoid complex setup
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
      transactions: [], // Simplified for this test
      currentPeriodId: 'p1',
      deleteTransaction: vi.fn(),
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
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'reallocate-title');
  });

  it('has accessible edit limit inputs', () => {
      // We need to trigger edit mode. The code toggles edit mode when clicking the limit amount.
      render(<BudgetBuckets />);

      // Find the limit display for Groceries ($500)
      const limitDisplay = screen.getByText('$500');
      fireEvent.click(limitDisplay);

      // Now the input should appear
      const input = screen.getByLabelText('Edit limit for Groceries');
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();

      const saveButton = screen.getByLabelText('Save limit');
      expect(saveButton).toBeInTheDocument();
  });
});
