import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TransactionMasterList from './TransactionMasterList';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '../../utils/exportUtils';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('../../utils/exportUtils', () => ({
  generateCsvExport: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock Child Modals
vi.mock('../modals/EditTransactionModal', () => ({
  default: ({ isOpen, onClose, transaction }: any) => isOpen ? (
    <div data-testid="edit-modal">
      Edit Modal for {transaction.merchant}
      <button onClick={onClose}>Close</button>
    </div>
  ) : null
}));

vi.mock('../modals/BatchCategorizeModal', () => ({
  default: ({ isOpen, onClose, onConfirm, count }: any) => isOpen ? (
    <div data-testid="batch-categorize-modal">
      Batch Categorize {count} items
      <button onClick={() => onConfirm('Food')}>Confirm Food</button>
      <button onClick={onClose}>Close</button>
    </div>
  ) : null
}));

// Mock generic Modal
vi.mock('../ui/Modal', () => ({
  Modal: ({ children, onClose }: { children: React.ReactNode, onClose: () => void }) => (
    <div data-testid="generic-modal">
      <button onClick={onClose} aria-label="Close">X</button>
      {children}
    </div>
  )
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
  Download: () => <div data-testid="download-icon" />,
  Layers: () => <div data-testid="layers-icon" />,
  CheckSquare: () => <div data-testid="check-square-icon" />,
  Tag: () => <div data-testid="tag-icon" />,
  Check: () => <div data-testid="check-icon" />,
}));

describe('TransactionMasterList', () => {
  const mockDeleteTransaction = vi.fn();
  const mockUpdateTransaction = vi.fn();

  const mockTransactions = [
    {
      id: '1',
      merchant: 'Groceries',
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
      merchant: 'Bus Ticket',
      amount: 5,
      category: 'Transport',
      date: '2023-01-05',
      source: 'manual',
      isRecurring: false,
      status: 'verified',
      autoCategorized: false,
    },
    {
      id: '3',
      merchant: 'Netflix',
      amount: 15,
      category: 'Entertainment',
      date: '2023-01-03',
      source: 'recurring',
      isRecurring: true,
      status: 'pending_review',
      autoCategorized: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as any).mockReturnValue({
      transactions: mockTransactions,
      deleteTransaction: mockDeleteTransaction,
      updateTransaction: mockUpdateTransaction,
    });

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  describe('Rendering & Sorting', () => {
    it('renders transactions sorted by date descending', () => {
      render(<TransactionMasterList />);

      const merchants = screen.getAllByText(/Groceries|Bus Ticket|Netflix/).map(el => el.textContent);
      // Expect order: Bus Ticket (Jan 5), Netflix (Jan 3), Groceries (Jan 1)
      expect(merchants[0]).toBe('Bus Ticket');
      expect(merchants[1]).toBe('Netflix');
      expect(merchants[2]).toBe('Groceries');
    });

    it('renders empty state when no transactions match', () => {
      render(<TransactionMasterList />);
      const searchInput = screen.getByPlaceholderText('Search merchant or amount...');
      fireEvent.change(searchInput, { target: { value: 'NonExistent' } });

      expect(screen.getByText('No transactions found matching your filters.')).toBeInTheDocument();
      expect(screen.getByText('Clear all filters')).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('filters by search term (merchant)', () => {
      render(<TransactionMasterList />);
      const searchInput = screen.getByPlaceholderText('Search merchant or amount...');
      fireEvent.change(searchInput, { target: { value: 'Netflix' } });

      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    });

    it('filters by category', () => {
      render(<TransactionMasterList />);
      // First select is Category (based on options)
      const selects = screen.getAllByRole('combobox');
      const categorySelect = selects[0]; // Assuming first is category

      fireEvent.change(categorySelect, { target: { value: 'Food' } });

      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.queryByText('Bus Ticket')).not.toBeInTheDocument();
    });

    it('filters by source', () => {
      render(<TransactionMasterList />);
      const selects = screen.getAllByRole('combobox');
      const sourceSelect = selects[1]; // Assuming second is source

      fireEvent.change(sourceSelect, { target: { value: 'recurring' } });

      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    });

    it('clears filters', () => {
      render(<TransactionMasterList />);
      // Set a category filter so the "Clear" button appears
      const selects = screen.getAllByRole('combobox');
      const categorySelect = selects[0];
      fireEvent.change(categorySelect, { target: { value: 'Food' } });

      // Verify filter is active
      expect(screen.queryByText('Bus Ticket')).not.toBeInTheDocument();

      // Click clear
      const clearButton = screen.getByText('Clear');
      fireEvent.click(clearButton);

      // Verify all items back
      expect(screen.getByText('Bus Ticket')).toBeInTheDocument();
      expect(categorySelect).toHaveValue('all');
    });
  });

  describe('Individual Actions', () => {
    it('opens delete confirmation modal and deletes on confirm', async () => {
      render(<TransactionMasterList />);

      // Find delete button for Groceries (last item)
      const deleteButtons = screen.getAllByLabelText(/Delete transaction from/);
      fireEvent.click(deleteButtons[2]);

      expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete the transaction from/)).toBeInTheDocument();

      // Scope to modal to avoid ambiguity
      const modal = screen.getByTestId('generic-modal');
      const confirmButton = within(modal).getByRole('button', { name: /Delete/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockDeleteTransaction).toHaveBeenCalledWith('1');
      });
    });

    it('opens edit modal', () => {
      render(<TransactionMasterList />);

      const editButtons = screen.getAllByLabelText(/Edit transaction from/);
      fireEvent.click(editButtons[0]); // Click first one

      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
    });
  });

  describe('Selection Mode & Batch Actions', () => {
    it('toggles selection mode', () => {
      render(<TransactionMasterList />);
      const toggleButton = screen.getByTitle('Toggle selection mode');

      fireEvent.click(toggleButton);
      expect(screen.getByText('Done')).toBeInTheDocument();
      expect(screen.getByText('Select All (3)')).toBeInTheDocument();
    });

    it('selects all items', () => {
      render(<TransactionMasterList />);
      fireEvent.click(screen.getByTitle('Toggle selection mode'));

      fireEvent.click(screen.getByText(/Select All/));

      // "3 selected" appears in the bar AND the FAB
      expect(screen.getAllByText('3 selected').length).toBeGreaterThan(0);
    });

    it('toggles individual items', () => {
      render(<TransactionMasterList />);
      fireEvent.click(screen.getByTitle('Toggle selection mode'));

      // Click on the first transaction item (the div acts as the checkbox area in selection mode)
      const transactions = screen.getAllByText(/Groceries|Bus Ticket|Netflix/);
      // Parent of the text is the container
      const item = transactions[0].closest('div.cursor-pointer');
      if (item) fireEvent.click(item);

      // "1 selected" appears in the bar AND the FAB
      expect(screen.getAllByText('1 selected').length).toBeGreaterThan(0);
    });

    it('performs batch verify', async () => {
      render(<TransactionMasterList />);
      fireEvent.click(screen.getByTitle('Toggle selection mode'));
      fireEvent.click(screen.getByText(/Select All/));

      const verifyButton = screen.getByText('Verify').closest('button');
      if (verifyButton) fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledTimes(3);
        expect(mockUpdateTransaction).toHaveBeenCalledWith('1', { status: 'verified' });
      });
    });

    it('performs batch categorize', async () => {
      render(<TransactionMasterList />);
      fireEvent.click(screen.getByTitle('Toggle selection mode'));
      fireEvent.click(screen.getByText(/Select All/));

      const categorizeButton = screen.getByText('Categorize').closest('button');
      if (categorizeButton) fireEvent.click(categorizeButton);

      expect(screen.getByTestId('batch-categorize-modal')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Confirm Food'));

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledTimes(3);
        expect(mockUpdateTransaction).toHaveBeenCalledWith('1', { category: 'Food', status: 'verified' });
      });
    });

    it('performs batch delete', async () => {
      render(<TransactionMasterList />);
      fireEvent.click(screen.getByTitle('Toggle selection mode'));
      fireEvent.click(screen.getByText(/Select All/));

      const deleteButton = screen.getByText('Delete').closest('button');
      if (deleteButton) fireEvent.click(deleteButton);

      // Should show confirmation modal
      expect(screen.getByText('Batch Delete')).toBeInTheDocument();

      const confirmDelete = screen.getByRole('button', { name: /Delete All/i });
      fireEvent.click(confirmDelete);

      await waitFor(() => {
        expect(mockDeleteTransaction).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('Export', () => {
    it('exports filtered transactions', () => {
      render(<TransactionMasterList />);
      const exportBtn = screen.getByTitle('Export filtered transactions to CSV');

      fireEvent.click(exportBtn);

      expect(generateCsvExport).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ Merchant: 'Bus Ticket' }),
          expect.objectContaining({ Merchant: 'Netflix' }),
          expect.objectContaining({ Merchant: 'Groceries' })
        ]),
        'transactions-export'
      );
    });
  });
});
