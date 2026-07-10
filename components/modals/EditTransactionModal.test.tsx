import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EditTransactionModal from './EditTransactionModal';
import { Transaction } from '@/types/schema';

// Hoist mocks to ensure they are available before imports
const {
  mockUpdateTransaction,
  mockDeleteTransaction,
  mockAddTransaction,
  mockOnClose,
  mockToast,
  mockGetTransactionComments,
  mockAddTransactionComment,
  mockDeleteTransactionComment,
} = vi.hoisted(() => ({
  mockUpdateTransaction: vi.fn(),
  mockDeleteTransaction: vi.fn(),
  mockAddTransaction: vi.fn(),
  mockOnClose: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  // Stable references (hoisted, defined once) — TransactionCommentThread's
  // load-on-open effect depends on getTransactionComments' identity, so a
  // fresh vi.fn() per render (e.g. one created inline inside the mocked
  // useFinance() factory below) would loop forever.
  mockGetTransactionComments: vi.fn().mockResolvedValue([]),
  mockAddTransactionComment: vi.fn(),
  mockDeleteTransactionComment: vi.fn(),
}));

// Mock slice hooks used by EditTransactionModal (including the Plan 23
// TransactionCommentThread it now renders, which reads useFinance's
// comment methods and useHouseholdCore's members/currentUser).
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    updateTransaction: mockUpdateTransaction,
    deleteTransaction: mockDeleteTransaction,
    addTransaction: mockAddTransaction,
    buckets: [
      { id: '1', name: 'Groceries', limit: 500, color: 'green', isVariable: true, isCore: true },
      { id: '2', name: 'Utilities', limit: 200, color: 'blue', isVariable: false, isCore: true },
    ],
    accounts: [] as unknown[],
    getTransactionComments: mockGetTransactionComments,
    addTransactionComment: mockAddTransactionComment,
    deleteTransactionComment: mockDeleteTransactionComment,
  }),
  useShopping: () => ({
    stores: [
      { id: 's1', name: 'Test Store' },
      { id: 's2', name: 'Costco' },
    ] as unknown[],
  }),
  useHouseholdCore: () => ({
    members: [] as unknown[],
    currentUser: null,
  }),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: mockToast,
}));

// Mock Lucide icons to avoid rendering issues
vi.mock('lucide-react', () => ({
  X: () => <div data-testid="icon-x" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Copy: () => <div data-testid="icon-copy" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  MessageSquare: () => <div data-testid="icon-message-square" />,
  Send: () => <div data-testid="icon-send" />,
}));

// Mock Modal component
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, onClose }: { children: React.ReactNode; isOpen: boolean; onClose: () => void }) => {
    if (!isOpen) return null;
    return (
      <div role="dialog">
        <button onClick={onClose} aria-label="Close modal">Close</button>
        {children}
      </div>
    );
  },
}));

describe('EditTransactionModal', () => {
  const mockTransaction: Transaction = {
    id: 'tx123',
    amount: 50.00,
    merchant: 'Test Store',
    category: 'Groceries',
    date: '2024-05-20',
    status: 'verified',
    payPeriodId: '2024-05-01',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    render(
      <EditTransactionModal
        isOpen={false}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when transaction is null', () => {
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={null}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders correctly with transaction data', () => {
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Store')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Groceries')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2024-05-20')).toBeInTheDocument();

    // The Status select and the separate Store select were removed — Merchant
    // is now the single field, backed by a datalist of known store names.
    expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^store$/i)).not.toBeInTheDocument();
    const merchantInput = screen.getByLabelText(/merchant/i);
    expect(merchantInput).toHaveAttribute('list');
    const datalistId = merchantInput.getAttribute('list')!;
    const options = Array.from(document.getElementById(datalistId)?.querySelectorAll('option') ?? []).map(
      (o) => o.getAttribute('value')
    );
    expect(options).toEqual(['Test Store', 'Costco']);
  });

  it('calls updateTransaction when save is clicked', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );

    // Change amount
    const amountInput = screen.getByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, '75.50');

    // Click save
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateTransaction).toHaveBeenCalledWith('tx123', expect.objectContaining({
      amount: 75.50,
      merchant: 'Test Store',
      category: 'Groceries',
      // Merchant exactly matches the "Test Store" store, so it resolves to
      // that store's canonical name.
      store: 'Test Store',
    }));
    // Status is no longer editable here — it must not appear in the payload
    // at all (the context is expected to leave it unchanged).
    expect(mockUpdateTransaction.mock.calls[0]![1]).not.toHaveProperty('status');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('preserves the existing store when the edited merchant does not match a known store', async () => {
    const user = userEvent.setup();
    const transactionWithStore: Transaction = { ...mockTransaction, store: 'Original Store' };
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={transactionWithStore}
      />
    );

    const merchantInput = screen.getByLabelText(/merchant/i);
    await user.clear(merchantInput);
    await user.type(merchantInput, 'A Whole New Merchant');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateTransaction).toHaveBeenCalledWith('tx123', expect.objectContaining({
      merchant: 'A Whole New Merchant',
      store: 'Original Store',
    }));
  });

  it('clears a stored store via the dismissible chip', async () => {
    const user = userEvent.setup();
    const txWithStore: Transaction = { ...mockTransaction, store: 'Costco' };
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={txWithStore}
      />
    );

    // The current store is surfaced as a dismissible chip.
    expect(screen.getByText(/store: costco/i)).toBeInTheDocument();

    // Dismiss it → the chip disappears and an explicit clear is armed.
    await user.click(screen.getByRole('button', { name: /clear store costco/i }));
    expect(screen.queryByText(/store: costco/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // The payload carries an explicit `store: undefined` (present key) so the
    // context maps it to deleteField(); it must NOT fall back to the old store.
    const payload = mockUpdateTransaction.mock.calls[0]![1];
    expect(payload).toHaveProperty('store', undefined);
  });

  it('does not show a store chip when the transaction has no store', () => {
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );
    expect(screen.queryByText(/^store:/i)).not.toBeInTheDocument();
  });

  it('validates input before saving', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );

    // Clear merchant
    const merchantInput = screen.getByLabelText(/merchant/i);
    await user.clear(merchantInput);

    // Click save
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateTransaction).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('Please enter a merchant name');
  });

  it('handles delete flow correctly', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );

    // Click initial delete button to open the confirmation
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    // The shared ConfirmDialog appears (async portal mount → findBy retries).
    expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();

    // There are now two "Delete" buttons (the trigger + the dialog's confirm,
    // which renders later in a portal). Click the dialog's confirm — the last.
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    await user.click(deleteButtons[deleteButtons.length - 1]!);

    expect(mockDeleteTransaction).toHaveBeenCalledWith('tx123');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles duplication correctly', async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
      />
    );

    // Click duplicate button
    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(mockAddTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: 50.00,
      merchant: 'Test Store',
      category: 'Groceries',
      status: 'verified',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Transaction duplicated');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('resets delete confirmation when modal closes and reopens', async () => {
    const { rerender } = render(
        <EditTransactionModal
            isOpen={true}
            onClose={mockOnClose}
            transaction={mockTransaction}
        />
    );

    const user = userEvent.setup();

    // Open delete confirmation
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();

    // Close modal (simulate prop change)
    rerender(
        <EditTransactionModal
            isOpen={false}
            onClose={mockOnClose}
            transaction={mockTransaction}
        />
    );

    // Reopen modal
    rerender(
        <EditTransactionModal
            isOpen={true}
            onClose={mockOnClose}
            transaction={mockTransaction}
        />
    );

    // Confirmation should be gone
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
