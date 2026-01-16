import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EditTransactionModal from './EditTransactionModal';
import { Transaction } from '../../types/schema';

// Hoist mocks to ensure they are available before imports
const {
  mockUpdateTransaction,
  mockDeleteTransaction,
  mockAddTransaction,
  mockOnClose,
  mockToast
} = vi.hoisted(() => ({
  mockUpdateTransaction: vi.fn(),
  mockDeleteTransaction: vi.fn(),
  mockAddTransaction: vi.fn(),
  mockOnClose: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock useHousehold
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    updateTransaction: mockUpdateTransaction,
    deleteTransaction: mockDeleteTransaction,
    addTransaction: mockAddTransaction,
    buckets: [
      { id: '1', name: 'Groceries', limit: 500, color: 'green', isVariable: true, isCore: true },
      { id: '2', name: 'Utilities', limit: 200, color: 'blue', isVariable: false, isCore: true },
    ],
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
}));

// Mock Modal component
vi.mock('../../components/ui/Modal', () => ({
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
      status: 'verified',
    }));
    expect(mockOnClose).toHaveBeenCalled();
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

    // Click initial delete button
    await user.click(screen.getByRole('button', { name: /delete/i }));

    // Should show confirmation
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument();

    // Click confirm
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

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
