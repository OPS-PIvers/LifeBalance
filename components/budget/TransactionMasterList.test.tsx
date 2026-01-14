import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TransactionMasterList from './TransactionMasterList';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Search: () => <div data-testid="search-icon" />,
  Filter: () => <div data-testid="filter-icon" />,
  X: () => <div data-testid="x-icon" />,
  Edit: () => <div data-testid="edit-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
  History: () => <div data-testid="history-icon" />,
  ArrowUpRight: () => <div data-testid="arrow-up-right-icon" />,
  ArrowDownLeft: () => <div data-testid="arrow-down-left-icon" />,
  FileText: () => <div data-testid="file-text-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
}));

describe('TransactionMasterList', () => {
  const mockTransactions = [
    {
      id: '1',
      merchant: 'Earlier Date',
      amount: 50,
      category: 'Food',
      date: '2023-01-01',
      source: 'manual',
      isRecurring: false,
      status: 'verified',
      autoCategorized: false,
    },
    {
      id: '2',
      merchant: 'Later Date',
      amount: 100,
      category: 'Transport',
      date: '2023-01-05',
      source: 'manual',
      isRecurring: false,
      status: 'verified',
      autoCategorized: false,
    },
    {
      id: '3',
      merchant: 'Middle Date',
      amount: 75,
      category: 'Utilities',
      date: '2023-01-03',
      source: 'manual',
      isRecurring: false,
      status: 'verified',
      autoCategorized: false,
    },
  ];

  it('renders transactions sorted by date descending', () => {
    (useHousehold as any).mockReturnValue({
      transactions: mockTransactions,
      deleteTransaction: vi.fn(),
    });

    render(<TransactionMasterList />);

    const merchants = screen.getAllByText(/Date/).map(el => el.textContent);

    // Expect order: Later Date (Jan 5), Middle Date (Jan 3), Earlier Date (Jan 1)
    expect(merchants[0]).toBe('Later Date');
    expect(merchants[1]).toBe('Middle Date');
    expect(merchants[2]).toBe('Earlier Date');
  });

  it('renders all transactions', () => {
    (useHousehold as any).mockReturnValue({
      transactions: mockTransactions,
      deleteTransaction: vi.fn(),
    });

    render(<TransactionMasterList />);
    // Just ensuring basic rendering works with the new sort
    expect(screen.getByText('Later Date')).toBeInTheDocument();
    expect(screen.getByText('Middle Date')).toBeInTheDocument();
    expect(screen.getByText('Earlier Date')).toBeInTheDocument();
  });
});
