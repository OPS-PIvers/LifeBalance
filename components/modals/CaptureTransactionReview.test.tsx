import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureTransactionReview } from './CaptureTransactionReview';
import { ParsedTransaction } from '../../types/ui';
import { BudgetBucket } from '../../types/schema';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="icon-check" />,
  AlertCircle: () => <div data-testid="icon-alert-circle" />,
}));

const mockTransactions: ParsedTransaction[] = [
  {
    id: '1',
    merchant: 'Test Merchant',
    amount: 10.00,
    category: 'Food',
    date: '2023-10-01',
    selected: true,
  },
  {
    id: '2',
    merchant: 'Another Merchant',
    amount: 20.00,
    category: 'Transport',
    date: '2023-10-02',
    selected: false,
  }
];

const mockBuckets: BudgetBucket[] = [
    { id: 'b1', name: 'Food', limit: 100, color: 'red', isVariable: true, isCore: true, subBuckets: [{ id: 'sb1', name: 'Groceries' }] },
    { id: 'b2', name: 'Transport', limit: 50, color: 'blue', isVariable: true, isCore: true }
];

describe('CaptureTransactionReview', () => {
  const mockOnUpdate = vi.fn();
  const mockOnToggle = vi.fn();
  const mockOnToggleAll = vi.fn();
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders transactions list', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    expect(screen.getByText('Test Merchant')).toBeInTheDocument();
    expect(screen.getByText('Another Merchant')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  });

  it('calls onToggleSelection when clicking checkbox', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    const selectButtons = screen.getAllByLabelText(/select transaction/i);
    const [firstButton, secondButton] = selectButtons;

    // Toggle second transaction (currently unselected)
    fireEvent.click(secondButton);
    expect(mockOnToggle).toHaveBeenNthCalledWith(1, '2');

    // Toggle first transaction (currently selected)
    fireEvent.click(firstButton);
    expect(mockOnToggle).toHaveBeenNthCalledWith(2, '1');
  });

  it('calls onToggleAll when clicking Select/Deselect All', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    // Initial state: Not all selected, so button says "Select All"
    const toggleAllBtn = screen.getByText('Select All');
    fireEvent.click(toggleAllBtn);
    expect(mockOnToggleAll).toHaveBeenCalled();
  });

  it('calls onSubmit when clicking Add button', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    const submitBtn = screen.getByText('Add 1 to Action Queue');
    fireEvent.click(submitBtn);
    expect(mockOnSubmit).toHaveBeenCalled();
  });

  it('disables Add button when no transactions selected', () => {
    const noneSelected = mockTransactions.map(t => ({ ...t, selected: false }));
    render(
      <CaptureTransactionReview
        parsedTransactions={noneSelected}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    const submitBtn = screen.getByText('Add 0 to Action Queue');
    expect(submitBtn).toBeDisabled();
  });

  it('calls onUpdateTransaction when changing category', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    // Click the 'Food' chip for the first transaction
    const foodChips = screen.getAllByText('Food');
    fireEvent.click(foodChips[0]);
    expect(mockOnUpdate).toHaveBeenCalledWith('1', { category: 'Food', subBucketId: undefined });
  });

  it('renders sub-bucket selector if bucket has sub-buckets', () => {
     render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        onSubmit={mockOnSubmit}
        dynamicCategories={['Food', 'Transport']}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    // First transaction is Food, which has sub-buckets
    expect(screen.getByText('Sub-Category...')).toBeInTheDocument();
  });
});
