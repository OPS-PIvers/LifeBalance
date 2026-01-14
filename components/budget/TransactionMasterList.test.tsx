import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TransactionMasterList from './TransactionMasterList';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '../../utils/exportUtils';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/firebase.config', () => ({
  db: {},
  auth: {},
  messaging: null,
}));
vi.mock('../../contexts/FirebaseHouseholdContext');
vi.mock('../../utils/exportUtils');
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Transaction type based on schema
const mockTransactions = [
  {
    id: 't1',
    amount: 50,
    merchant: 'Grocery Store',
    category: 'Groceries',
    date: '2023-10-01',
    status: 'verified',
    source: 'manual',
    isRecurring: false,
    autoCategorized: false,
  },
  {
    id: 't2',
    amount: 20,
    merchant: 'Coffee Shop',
    category: 'Dining',
    date: '2023-10-02',
    status: 'verified',
    source: 'manual',
    isRecurring: false,
    autoCategorized: false,
  },
];

describe('TransactionMasterList Export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as any).mockReturnValue({
      transactions: mockTransactions,
      deleteTransaction: vi.fn(),
    });
  });

  it('renders the export button', () => {
    render(<TransactionMasterList />);
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('calls generateCsvExport when export button is clicked', () => {
    render(<TransactionMasterList />);
    const exportBtn = screen.getByTitle('Export filtered transactions to CSV');

    fireEvent.click(exportBtn);

    expect(generateCsvExport).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ Merchant: 'Coffee Shop' }), // Sorted by date desc
        expect.objectContaining({ Merchant: 'Grocery Store' })
      ]),
      'transactions-export'
    );
  });

  it('disables export button when no transactions match filter', () => {
    render(<TransactionMasterList />);

    // Type in search box to filter everything out
    const searchInput = screen.getByPlaceholderText('Search merchant or amount...');
    fireEvent.change(searchInput, { target: { value: 'NonExistent' } });

    const exportBtn = screen.getByTitle('Export filtered transactions to CSV');
    expect(exportBtn).toBeDisabled();
  });

  it('exports only filtered transactions', () => {
    render(<TransactionMasterList />);

    // Filter by 'Coffee Shop'
    const searchInput = screen.getByPlaceholderText('Search merchant or amount...');
    fireEvent.change(searchInput, { target: { value: 'Coffee' } });

    const exportBtn = screen.getByTitle('Export filtered transactions to CSV');
    fireEvent.click(exportBtn);

    // Ensure export called exactly once and does not include Grocery Store
    expect(generateCsvExport).toHaveBeenCalledTimes(1);

    const [exportedTransactions] = (generateCsvExport as any).mock.calls[0];
    expect(exportedTransactions).toHaveLength(1);
    expect(exportedTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Merchant: 'Coffee Shop',
          isRecurring: false,
          autoCategorized: false
        })
      ])
    );
    expect(exportedTransactions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Merchant: 'Grocery Store' })
      ])
    );
  });
});
