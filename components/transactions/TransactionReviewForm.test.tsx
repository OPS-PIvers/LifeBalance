import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TransactionReviewForm from './TransactionReviewForm';
import { Transaction } from '@/types/schema';

// Hoisted mocks (available before the module imports run).
const {
  mockUpdateTransactionCategory,
  mockDeleteTransaction,
  mockMergeTransactions,
  mockKeepBothTransactions,
  mockOnDone,
  mockToast,
} = vi.hoisted(() => ({
  mockUpdateTransactionCategory: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockDeleteTransaction: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockMergeTransactions: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockKeepBothTransactions: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockOnDone: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// Transactions the form's `useFinance().transactions` should resolve
// `possibleDuplicateOf` against — mutable per-test via `mockTransactions.length = 0; mockTransactions.push(...)`.
const mockTransactions: Transaction[] = [];

// Mock the domain slices consumed by the form (same pattern as
// EditTransactionModal.test.tsx).
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    accounts: [] as unknown[],
    buckets: [
      { id: '1', name: 'Groceries' },
      { id: '2', name: 'Gas' },
    ],
    transactions: mockTransactions,
    updateTransactionCategory: mockUpdateTransactionCategory,
    deleteTransaction: mockDeleteTransaction,
    mergeTransactions: mockMergeTransactions,
    keepBothTransactions: mockKeepBothTransactions,
  }),
  useGamification: () => ({ habits: [] as unknown[] }),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast }));

// Mock Lucide icons to avoid rendering SVGs; each becomes a testid div.
vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="icon-check" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  Copy: () => <div data-testid="icon-copy" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Loader2: () => <div data-testid="icon-loader" />,
}));

const baseTx: Transaction = {
  id: 'tx1',
  amount: 25,
  merchant: 'Coffee',
  category: 'Groceries',
  date: '2026-06-10',
  status: 'pending_review',
  payPeriodId: '2026-06-01',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
};

describe('TransactionReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransactions.length = 0;
  });

  it('shows a selected Income chip for an income transaction', () => {
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, category: 'Income', amount: 500 }}
        onDone={mockOnDone}
      />
    );

    const incomeChip = screen.getByRole('button', { name: /income/i });
    // The Income chip is prepended (not a bucket) and pre-selected — selected
    // chips render the check icon and carry the accent-600 background.
    expect(within(incomeChip).getByTestId('icon-check')).toBeInTheDocument();
    expect(incomeChip.className).toContain('bg-accent-600');
  });

  it('approves an income transaction with the Income category (never an expense bucket)', async () => {
    const user = userEvent.setup();
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, category: 'Income', amount: 500 }}
        onDone={mockOnDone}
      />
    );

    await user.click(screen.getByRole('button', { name: /approve transaction/i }));

    expect(mockUpdateTransactionCategory).toHaveBeenCalledTimes(1);
    const call = mockUpdateTransactionCategory.mock.calls[0]!;
    expect(call[0]).toBe('tx1');
    expect(call[1]).toBe('Income');
    expect(mockOnDone).toHaveBeenCalled();
  });

  it('disables Approve for a $0 needsAmount stub until a valid amount is entered', async () => {
    const user = userEvent.setup();
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, amount: 0, needsAmount: true }}
        onDone={mockOnDone}
      />
    );

    const approve = screen.getByRole('button', { name: /add amount & approve/i });
    expect(approve).toBeDisabled();

    // A sub-cent entry rounds to $0 and must stay rejected.
    const amountInput = screen.getByLabelText(/amount/i);
    await user.type(amountInput, '0.004');
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();

    // A real amount unlocks it.
    await user.clear(amountInput);
    await user.type(amountInput, '12.50');
    expect(screen.getByRole('button', { name: /approve transaction/i })).toBeEnabled();
  });

  it('passes the entered amount as an override when approving a stub', async () => {
    const user = userEvent.setup();
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, amount: 0, needsAmount: true }}
        onDone={mockOnDone}
      />
    );

    const amountInput = screen.getByLabelText(/amount/i);
    await user.type(amountInput, '12.50');
    await user.click(screen.getByRole('button', { name: /approve transaction/i }));

    const call = mockUpdateTransactionCategory.mock.calls[0]!;
    expect(call[4]).toMatchObject({ amount: 12.5, clearNeedsAmount: true });
  });

  describe('possible-duplicate notice (plan 03 PR-3)', () => {
    const otherTx: Transaction = {
      ...baseTx,
      id: 'tx2',
      merchant: 'Coffee Shop',
      amount: 24.99,
      date: '2026-06-11',
    };

    it('renders a notice with Merge / Keep both when possibleDuplicateOf resolves to an existing transaction', () => {
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByText(/possible duplicate of/i)).toBeInTheDocument();
      expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^merge$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /keep both/i })).toBeInTheDocument();
    });

    it('renders no notice when possibleDuplicateOf points at a row that no longer exists', () => {
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'gone' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/possible duplicate of/i)).not.toBeInTheDocument();
    });

    it('renders no notice when the transaction has no possibleDuplicateOf', () => {
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);
      expect(screen.queryByText(/possible duplicate of/i)).not.toBeInTheDocument();
    });

    it('Merge calls mergeTransactions with the pickKeeper-chosen keeper/dupe pair', async () => {
      const user = userEvent.setup();
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /^merge$/i }));

      expect(mockMergeTransactions).toHaveBeenCalledTimes(1);
      // Both rows are pending_review with no distinguishing richness/createdAt,
      // so pickKeeper's stable tiebreak keeps whichever is passed as `a`
      // (the flagged transaction itself) — assert a keeper/dupe pair from
      // {tx1, tx2}, not upstream identity-verdict details this test doesn't own.
      const [keeperId, dupeId] = mockMergeTransactions.mock.calls[0]!;
      expect([keeperId, dupeId].sort()).toEqual(['tx1', 'tx2']);
      expect(mockOnDone).toHaveBeenCalled();
    });

    it('Keep both calls keepBothTransactions with the flagged transaction id and does not call onDone', async () => {
      const user = userEvent.setup();
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /keep both/i }));

      expect(mockKeepBothTransactions).toHaveBeenCalledWith('tx1');
      expect(mockOnDone).not.toHaveBeenCalled();
    });
  });
});
