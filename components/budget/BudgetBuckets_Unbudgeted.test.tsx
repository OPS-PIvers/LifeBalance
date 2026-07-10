import { render, screen, fireEvent } from '@testing-library/react';
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

// Mock Toast
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  }
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

describe('BudgetBuckets Unbudgeted Logic', () => {
  const mockUpdateBucketLimit = vi.fn();
  const mockReallocateBucket = vi.fn();
  const mockDeleteTransaction = vi.fn();

  const mockBuckets = [
    {
      id: 'b1',
      name: 'Groceries',
      limit: 500,
      color: 'bg-green-500',
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
    },
    {
      id: 't2',
      date: '2023-10-02T12:00:00.000Z',
      amount: 100,
      merchant: 'Mystery Skydiving',
      category: 'Skydiving', // No matching bucket
      payPeriodId: 'p1',
      status: 'posted'
    },
    {
      id: 't3',
      date: '2023-10-03T12:00:00.000Z',
      amount: 25,
      merchant: 'Unknown Expense',
      category: null, // No category at all
      payPeriodId: 'p1',
      status: 'posted'
    },
    {
      id: 't4',
      date: '2023-10-04T12:00:00.000Z',
      amount: 2000,
      merchant: 'My Job',
      category: 'Income', // Should be excluded
      payPeriodId: 'p1',
      status: 'posted'
    },
    {
      id: 't5',
      date: '2023-10-05T12:00:00.000Z',
      amount: 800,
      merchant: 'Rent',
      category: 'Budgeted in Calendar', // Calendar-budgeted → excluded from Unbudgeted
      payPeriodId: 'p1',
      status: 'verified'
    },
    {
      id: 't6',
      date: '2023-10-06T12:00:00.000Z',
      amount: 60,
      merchant: 'Electric Co',
      category: 'Bills', // Legacy paid-bill tag → excluded from Unbudgeted
      payPeriodId: 'p1',
      status: 'verified'
    }
  ];

  const mockBucketSpentMap = new Map();
  mockBucketSpentMap.set('b1', { verified: 50, pending: 0 });

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

  it('renders "Unbudgeted & Other" bucket with unmatched transactions', () => {
    render(<BudgetBuckets />);

    // Should see the normal bucket
    expect(screen.getByText('Groceries')).toBeInTheDocument();

    // Should see the Unbudgeted bucket
    expect(screen.getByText('Unbudgeted & Other')).toBeInTheDocument();

    // Should verify amount: 100 (Skydiving) + 25 (Unknown) = 125
    // Income (2000) should be excluded
    // Groceries (50) is in other bucket
    expect(screen.getByText('$125.00')).toBeInTheDocument();
  });

  it('excludes calendar-budgeted spend from the Unbudgeted bucket', () => {
    render(<BudgetBuckets />);

    // Unbudgeted total stays $125 (Skydiving 100 + Unknown 25); the $800 Rent
    // ("Budgeted in Calendar") and $60 Electric ("Bills") are not lumped in.
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.queryByText('$985.00')).not.toBeInTheDocument();
  });

  it('allows expanding Unbudgeted bucket to see details', () => {
    render(<BudgetBuckets />);

    const toggleButton = screen.getByRole('button', { name: /View 2 transactions for Unbudgeted & Other/i });
    fireEvent.click(toggleButton);

    expect(screen.getByText('Mystery Skydiving')).toBeInTheDocument();
    expect(screen.getByText('Unknown Expense')).toBeInTheDocument();
    expect(screen.queryByText('My Job')).not.toBeInTheDocument(); // Income excluded
    expect(screen.queryByText('Rent')).not.toBeInTheDocument(); // Budgeted in Calendar excluded
    expect(screen.queryByText('Electric Co')).not.toBeInTheDocument(); // Legacy Bills excluded
  });

  it('shows error toast when clicking Fix on Unbudgeted bucket', async () => {
    const toast = await import('react-hot-toast');
    render(<BudgetBuckets />);

    // Unbudgeted is always overspent (limit 0)
    // Find the Fix button within the Unbudgeted card.
    // Since there are multiple "Fix" buttons if other buckets are overspent, we need to be careful.
    // In this mock setup, Groceries is NOT overspent (50 spent, 500 limit).
    // So only Unbudgeted should have a "Fix" button.
    const fixButton = screen.getByText('Fix');
    fireEvent.click(fixButton);

    expect(toast.default.error).toHaveBeenCalledWith('Please categorize these transactions to fix them.');
  });
});
