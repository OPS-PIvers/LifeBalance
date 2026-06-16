import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TransactionMasterList from './TransactionMasterList';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '@/utils/exportUtils';

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

// Mock Child Modals
vi.mock('@/components/modals/EditTransactionModal', () => ({
  default: ({ isOpen, onClose, transaction }: { isOpen: boolean; onClose: () => void; transaction: { merchant: string } }) => isOpen ? (
    <div data-testid="edit-modal">
      Edit Modal for {transaction.merchant}
      <button onClick={onClose}>Close</button>
    </div>
  ) : null
}));

vi.mock('@/components/modals/SplitTransactionModal', () => ({
  default: ({ isOpen, onClose, transaction }: { isOpen: boolean; onClose: () => void; transaction: { merchant: string } }) => isOpen ? (
    <div data-testid="split-modal">
      Split Modal for {transaction.merchant}
      <button onClick={onClose}>Close</button>
    </div>
  ) : null
}));

vi.mock('@/components/modals/BatchCategorizeModal', () => ({
  default: ({ isOpen, onClose, onConfirm, count }: { isOpen: boolean; onClose: () => void; onConfirm: (category: string) => void; count: number }) => isOpen ? (
    <div data-testid="batch-categorize-modal">
      Batch Categorize {count} items
      <button onClick={() => onConfirm('Food')}>Confirm Food</button>
      <button onClick={onClose}>Close</button>
    </div>
  ) : null
}));

// Mock generic Modal
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children, onClose }: { isOpen: boolean; children: React.ReactNode, onClose: () => void }) =>
    isOpen ? (
      <div data-testid="generic-modal">
        <button onClick={onClose} aria-label="Close">X</button>
        {children}
      </div>
    ) : null
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
  Copy: () => <div data-testid="copy-icon" />,
  Scissors: () => <div data-testid="scissors-icon" />,
  Bookmark: () => <div data-testid="bookmark-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
  MoreVertical: () => <div data-testid="more-vertical-icon" />,
}));

// ---------------------------------------------------------------------------
// jsdom layout mocks required by @tanstack/react-virtual
//
// The virtualizer reads offsetHeight from the scroll container element via
// observeElementRect, and uses ResizeObserver to react to size changes.
// jsdom returns 0 for all layout properties and lacks ResizeObserver.
// We mock both here so the virtualizer can compute visible item ranges.
//
// SCROLL_CONTAINER_HEIGHT controls how many rows the virtualizer renders;
// rows are estimated at 84px each (see component estimateSize).  600px gives
// ~7 visible rows + 5 overscan = at most ~17 rows for small datasets, well
// below 500 for the windowing test.
// ---------------------------------------------------------------------------

const SCROLL_CONTAINER_HEIGHT = 600;

// ResizeObserver mock: immediately fires callback with observed element's
// offsetHeight so the virtualizer's observeElementRect gets a non-zero rect.
class MockResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    // Report the mocked offsetHeight immediately so the virtualizer is seeded.
    const height = (target as HTMLElement).offsetHeight;
    this.callback(
      [
        {
          target,
          contentRect: new DOMRectReadOnly(0, 0, 0, height),
          borderBoxSize: [{ inlineSize: 0, blockSize: height }],
          contentBoxSize: [{ inlineSize: 0, blockSize: height }],
          devicePixelContentBoxSize: [{ inlineSize: 0, blockSize: height }],
        },
      ],
      this
    );
  }

  unobserve(_target: Element): void {
    // no-op
  }

  disconnect(): void {
    // no-op
  }
}

// Store the original descriptor so we can restore it in afterAll.
const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight'
);

beforeAll(() => {
  // Provide ResizeObserver in the jsdom global scope.
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  // Make every element report SCROLL_CONTAINER_HEIGHT so the scroll container
  // (which has style={{ height: '64vh' }}) is seen as having real height.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return SCROLL_CONTAINER_HEIGHT;
    },
  });
});

afterAll(() => {
  // Restore original descriptor to avoid leaking into other test suites.
  if (originalOffsetHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeightDescriptor);
  }
});

describe('TransactionMasterList', () => {
  const mockDeleteTransaction = vi.fn();
  const mockUpdateTransaction = vi.fn();
  const mockAddTransaction = vi.fn();
  const mockSplitTransaction = vi.fn();

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

  // Shared default mock value; individual tests may override via mockReturnValue.
  const defaultMockValue = () => ({
    transactions: mockTransactions,
    deleteTransaction: mockDeleteTransaction,
    updateTransaction: mockUpdateTransaction,
    addTransaction: mockAddTransaction,
    splitTransaction: mockSplitTransaction,
    householdId: 'test-household',
    stores: [],
    hasMoreTransactions: false,
    isLoadingOlderTransactions: false,
    loadOlderTransactions: vi.fn(),
    loadAllTransactions: vi.fn(),
    transactionWindowStart: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Freeze the clock so date-dependent behavior (e.g. the duplicate handler's
    // "today" via getLocalDateString) is deterministic across CI runs that may
    // cross a midnight/month boundary. Fake timers with shouldAdvanceTime keep
    // RAF/microtask-based timers (used by the @tanstack/react-virtual
    // virtualizer and waitFor) progressing so component tests still settle.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));

    vi.mocked(useHousehold).mockReturnValue(
      defaultMockValue() as unknown as ReturnType<typeof useHousehold>
    );

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    // Restores real timers and the real system clock.
    vi.useRealTimers();
  });

  describe('Accessibility', () => {
    it('search input has aria-label', () => {
      render(<TransactionMasterList />);
      const searchInput = screen.getByRole('textbox', { name: /search transactions/i });
      expect(searchInput).toBeInTheDocument();
      expect(searchInput).toHaveAttribute('placeholder', 'Search merchant or amount...');
    });
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

      expect(screen.getByText('No transactions found')).toBeInTheDocument();
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
      const categorySelect = selects[0]!; // first combobox is category

      fireEvent.change(categorySelect, { target: { value: 'Food' } });

      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.queryByText('Bus Ticket')).not.toBeInTheDocument();
    });

    it('filters by source', () => {
      render(<TransactionMasterList />);
      const selects = screen.getAllByRole('combobox');
      const sourceSelect = selects[1]!; // second combobox is source

      fireEvent.change(sourceSelect, { target: { value: 'recurring' } });

      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    });

    it('clears filters', () => {
      render(<TransactionMasterList />);
      // Set a category filter so the "Clear" button appears
      const selects = screen.getAllByRole('combobox');
      const categorySelect = selects[0]!;
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
      fireEvent.click(deleteButtons[2]!);

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
      fireEvent.click(editButtons[0]!); // Click first one

      expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
    });

    it('opens split modal', () => {
      render(<TransactionMasterList />);

      const splitButtons = screen.getAllByLabelText(/Split transaction from/);
      fireEvent.click(splitButtons[0]!); // Click first one

      expect(screen.getByTestId('split-modal')).toBeInTheDocument();
    });

    it('duplicates a transaction', async () => {
      // The component sets the duplicate's date via getLocalDateString() (local
      // time). Derive the expected date the same way under the frozen clock so
      // the comparison stays deterministic and timezone-robust.
      const now = new Date();
      const expectedToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      render(<TransactionMasterList />);

      const duplicateButtons = screen.getAllByLabelText(/Duplicate transaction from/);
      fireEvent.click(duplicateButtons[0]!); // Click first one (Bus Ticket)

      await waitFor(() => {
        expect(mockAddTransaction).toHaveBeenCalledWith(expect.objectContaining({
          merchant: 'Bus Ticket',
          amount: 5,
          category: 'Transport',
          source: 'manual',
          isRecurring: false,
          status: 'verified',
          autoCategorized: false,
          date: expectedToday
        }));
      });
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
      const item = transactions[0]!.closest('div.cursor-pointer');
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

      // ConfirmDialog should appear
      expect(screen.getByText('Verify Transactions')).toBeInTheDocument();

      // Confirm — scope to the dialog to avoid collision with the FAB "Verify" button
      const dialog = screen.getByTestId('generic-modal');
      fireEvent.click(within(dialog).getByRole('button', { name: /^Verify$/i }));

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

  // ---------------------------------------------------------------------------
  // Virtualizer windowing test
  //
  // With SCROLL_CONTAINER_HEIGHT = 600 and estimateSize = 84, the virtualizer
  // should render at most ~ceil(600/84) + overscan(5) * 2 = ~21 rows.
  // We feed 500 transactions and confirm the DOM contains far fewer than 500
  // transaction rows, proving that windowing is active.
  // ---------------------------------------------------------------------------

  describe('Virtualizer windowing', () => {
    it('renders only a bounded subset of rows for a large dataset (windowing is active)', () => {
      // Build 500 unique transactions
      const largeDataset = Array.from({ length: 500 }, (_, i) => ({
        id: `tx-${i}`,
        merchant: `Merchant ${i}`,
        amount: 10 + (i % 100),
        category: 'Food',
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
        source: 'manual' as const,
        isRecurring: false,
        status: 'verified' as const,
        autoCategorized: false,
      }));

      vi.mocked(useHousehold).mockReturnValue({
        ...defaultMockValue(),
        transactions: largeDataset,
      } as unknown as ReturnType<typeof useHousehold>);

      render(<TransactionMasterList />);

      // The scroll container must be present (list is not empty)
      const scrollContainer = screen.getByTestId('virtual-scroll-container');
      expect(scrollContainer).toBeInTheDocument();

      // Count how many transaction merchant names are actually in the DOM.
      // Each virtualized row renders a TransactionItem which renders the merchant name.
      // With SCROLL_CONTAINER_HEIGHT=600 and estimateSize=84 the maximum number of
      // rendered rows is roughly (600/84 + overscan*2) = ~21.  We use a generous
      // ceiling of 100 to make the assertion resilient to overscan changes while
      // still proving that far fewer than 500 rows are mounted.
      const renderedMerchants = screen
        .getAllByText(/^Merchant \d+$/)
        .filter(el => el.closest('[data-testid="virtual-scroll-container"]'));

      expect(renderedMerchants.length).toBeGreaterThan(0);
      expect(renderedMerchants.length).toBeLessThan(100);
    });
  });
});
