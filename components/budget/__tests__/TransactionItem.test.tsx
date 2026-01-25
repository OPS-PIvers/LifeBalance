import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionItem, TransactionItemProps } from '../TransactionItem';
import { Transaction } from '../../../types/schema';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  History: () => <div data-testid="icon-history" />,
  FileText: () => <div data-testid="icon-file-text" />,
  ArrowUpRight: () => <div data-testid="icon-arrow-up-right" />,
  ArrowDownLeft: () => <div data-testid="icon-arrow-down-left" />,
  Edit: () => <div data-testid="icon-edit" />,
  Trash2: () => <div data-testid="icon-trash" />,
  CheckSquare: () => <div data-testid="icon-check-square" />,
  Copy: () => <div data-testid="icon-copy" />,
}));

const mockTransaction: Transaction = {
  id: 'tx-123',
  amount: 42.50,
  merchant: 'Test Merchant',
  category: 'Groceries',
  date: '2024-05-22',
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
};

const defaultProps: TransactionItemProps = {
  transaction: mockTransaction,
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
  isSelectionMode: false,
  isSelected: false,
  onToggleSelection: vi.fn(),
};

describe('TransactionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders transaction details correctly', () => {
    render(<TransactionItem {...defaultProps} />);

    expect(screen.getByText('Test Merchant')).toBeInTheDocument();
    expect(screen.getByText('$42.50')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('calls onEdit when clicking the row in default mode', () => {
    render(<TransactionItem {...defaultProps} />);

    const merchant = screen.getByText('Test Merchant');
    fireEvent.click(merchant);

    expect(defaultProps.onEdit).toHaveBeenCalledWith(mockTransaction);
  });

  it('calls onEdit when clicking the edit button', () => {
    render(<TransactionItem {...defaultProps} />);

    const editButton = screen.getByLabelText(/Edit transaction from Test Merchant/i);
    fireEvent.click(editButton);

    expect(defaultProps.onEdit).toHaveBeenCalledWith(mockTransaction);
  });

  it('toggles selection when clicking the row in selection mode', () => {
    render(<TransactionItem {...defaultProps} isSelectionMode={true} />);

    const merchant = screen.getByText('Test Merchant');
    fireEvent.click(merchant);

    expect(defaultProps.onToggleSelection).toHaveBeenCalledWith(mockTransaction.id);
    expect(defaultProps.onEdit).not.toHaveBeenCalled();
  });
});
