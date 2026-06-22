import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TransactionMasterList from './TransactionMasterList';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { INCOME_CATEGORY } from '@/types/schema';

// Mock dependencies
// The component reads granular slices (useFinance/useHouseholdCore/useMeals).
// Back every hook with one shared mock fn so existing `useHousehold` mock setup
// drives all of them with the same value object.
vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const fn = vi.fn();
  return {
    useHousehold: fn,
    useFinance: fn,
    useHouseholdCore: fn,
    useMeals: fn,
    useShopping: fn,
    useTodos: fn,
    useGamification: fn,
  };
});

vi.mock('@/utils/exportUtils', () => ({
  generateCsvExport: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock Child Modals (simplified)
vi.mock('@/components/modals/EditTransactionModal', () => ({ default: (): null => null }));
vi.mock('@/components/modals/SplitTransactionModal', () => ({ default: (): null => null }));
vi.mock('@/components/modals/BatchCategorizeModal', () => ({ default: (): null => null }));
vi.mock('@/components/modals/CaptureTransactionManual', () => ({
  CaptureTransactionManual: (): null => null,
}));
vi.mock('@/components/ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Search: () => <div />,
  Filter: () => <div />,
  X: () => <div />,
  Edit: () => <div />,
  Trash2: () => <div />,
  History: () => <div />,
  ArrowUpRight: () => <div />,
  ArrowDownLeft: () => <div />,
  FileText: () => <div />,
  Loader2: () => <div />,
  Download: () => <div />,
  Layers: () => <div />,
  CheckSquare: () => <div />,
  Tag: () => <div />,
  Check: () => <div />,
  Copy: () => <div />,
  Scissors: () => <div />,
  Bookmark: () => <div />,
  Plus: () => <div />,
  MoreVertical: () => <div />,
  Receipt: () => <div />,
  PlusCircle: () => <div />,
}));

describe('TransactionMasterList Summary Widget', () => {
  const mockTransactions = [
    {
      id: '1',
      merchant: 'Salary',
      amount: 5000,
      category: INCOME_CATEGORY,
      date: '2023-01-01',
      source: 'manual',
    },
    {
      id: '2',
      merchant: 'Rent',
      amount: 2000,
      category: 'Housing',
      date: '2023-01-02',
      source: 'manual',
    },
    {
      id: '3',
      merchant: 'Groceries',
      amount: 150.50,
      category: 'Food',
      date: '2023-01-03',
      source: 'manual',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as unknown as Mock).mockReturnValue({
      transactions: mockTransactions,
      deleteTransaction: vi.fn(),
      updateTransaction: vi.fn(),
      addTransaction: vi.fn(),
      splitTransaction: vi.fn(),
      householdId: 'test-household',
      stores: [],
      buckets: [],
      accounts: [],
      habits: [],
    });
  });

  it('calculates and displays correct totals', () => {
    render(<TransactionMasterList />);

    // Income: 5000
    // Expense: 2000 + 150.50 = 2150.50
    // Net: 5000 - 2150.50 = 2849.50
    // Count: 3

    expect(screen.getAllByText('Income').length).toBeGreaterThan(0);
    expect(screen.getByText('+$5,000.00')).toBeInTheDocument();

    expect(screen.getAllByText('Expense').length).toBeGreaterThan(0);
    expect(screen.getByText('-$2,150.50')).toBeInTheDocument();

    expect(screen.getAllByText('Net').length).toBeGreaterThan(0);
    expect(screen.getByText('+$2,849.50')).toBeInTheDocument();

    expect(screen.getAllByText('Count').length).toBeGreaterThan(0);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('updates summary when filtered by search', () => {
    render(<TransactionMasterList />);
    const searchInput = screen.getByPlaceholderText('Search merchant or amount...');

    // Filter to only 'Rent'
    fireEvent.change(searchInput, { target: { value: 'Rent' } });

    // Income: 0 (filtered out)
    // Expense: 2000
    // Net: -2000
    // Count: 1

    expect(screen.getByText('+$0.00')).toBeInTheDocument();
    expect(screen.getByText('-$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('-$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('updates summary when filtered by category', () => {
    render(<TransactionMasterList />);
    const selects = screen.getAllByRole('combobox');
    const categorySelect = selects[0]!;

    // Filter to only 'Income'
    fireEvent.change(categorySelect, { target: { value: INCOME_CATEGORY } });

    // Income: 5000
    // Expense: 0
    // Net: 5000
    // Count: 1

    // Income and Net are both +$5,000.00
    const incomeAndNet = screen.getAllByText('+$5,000.00');
    expect(incomeAndNet.length).toBeGreaterThanOrEqual(2); // One for Income, one for Net

    expect(screen.getByText('-$0.00')).toBeInTheDocument();

    // Find the count element specifically to avoid ambiguity with filter badges
    const countLabel = screen.getByText('Count');
    const countValue = countLabel.nextElementSibling; // The p tag following the label
    expect(countValue).toHaveTextContent('1');
  });
});
