
import { render, screen, fireEvent } from '@testing-library/react';
import { BudgetBucketCard } from './BudgetBucketCard';
import { BudgetBucket, Transaction } from '@/types/schema';
import { formatCurrency } from '@/utils/formatCurrency';
import { vi, describe, it, expect } from 'vitest';

// BudgetBucketCard formats amounts via useFormatCurrency (which reads the
// household context). These tests render the card without a provider, so back the
// hook with the real USD formatter — output is unchanged ($200.00, $500, etc.).
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (amount: number, options?: { decimals?: 0 | 2 }) =>
    formatCurrency(amount, options),
}));

describe('BudgetBucketCard', () => {
  const mockBucket: BudgetBucket = {
    id: 'bucket1',
    name: 'Groceries',
    limit: 500,
    color: 'bg-green-500',
    isVariable: false,
    isCore: true
  };

  const mockSpent = { verified: 200, pending: 50 };
  const mockTransactions: Transaction[] = [];

  const defaultProps = {
    bucket: mockBucket,
    spent: mockSpent,
    bucketTransactions: mockTransactions,
    isExpanded: false,
    isEditingLimit: false,
    onExpand: vi.fn(),
    onEditBucket: vi.fn(),
    onStartEditingLimit: vi.fn(),
    onSaveLimit: vi.fn(),
    onCancelEdit: vi.fn(),
    onReallocate: vi.fn(),
    onEditTransaction: vi.fn(),
    onDeleteTransaction: vi.fn(),
    onOpenTransactionActions: vi.fn(),
  };

  it('renders bucket information correctly', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    // The * was moved to a separate text element or removed from this specific span
    expect(screen.getByText('+$50.00')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
  });

  it('renders progress bar correctly', () => {
    const { container } = render(<BudgetBucketCard {...defaultProps} />);
    // Target the progress bar specifically (it's inside the bg-slate-100/80 wrapper)
    // We use a partial class match or the escaped selector
    const progressBarWrapper = container.querySelector('[class*="bg-slate-100/80"]');
    const progressBar = progressBarWrapper?.firstElementChild;

    expect(progressBar).toHaveStyle('width: 50%'); // (250/500)*100
    expect(progressBar).toHaveClass('bg-green-500');
  });

  it('switches to edit mode when isEditingLimit is true', () => {
    render(<BudgetBucketCard {...defaultProps} isEditingLimit={true} />);

    const input = screen.getByLabelText('Edit limit for Groceries');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(500);
    expect(input).toHaveFocus();
  });

  it('calls onStartEditingLimit when limit text is clicked', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    fireEvent.click(screen.getByText('$500'));
    expect(defaultProps.onStartEditingLimit).toHaveBeenCalledWith('bucket1');
  });

  it('calls onStartEditingLimit when limit text is activated via keyboard (Enter)', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    const limitElement = screen.getByLabelText('Edit limit for Groceries, currently $500');
    limitElement.focus();
    fireEvent.keyDown(limitElement, { key: 'Enter' });

    expect(defaultProps.onStartEditingLimit).toHaveBeenCalledWith('bucket1');
  });

  it('calls onStartEditingLimit when limit text is activated via keyboard (Space)', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    const limitElement = screen.getByLabelText('Edit limit for Groceries, currently $500');
    limitElement.focus();
    fireEvent.keyDown(limitElement, { key: ' ' });

    expect(defaultProps.onStartEditingLimit).toHaveBeenCalledWith('bucket1');
  });

  it('calls onSaveLimit when save button is clicked', () => {
    render(<BudgetBucketCard {...defaultProps} isEditingLimit={true} />);

    const input = screen.getByLabelText('Edit limit for Groceries');
    fireEvent.change(input, { target: { value: '600' } });

    fireEvent.click(screen.getByLabelText('Save limit'));
    expect(defaultProps.onSaveLimit).toHaveBeenCalledWith('bucket1', 600);
  });

  it('calls onSaveLimit when Enter is pressed', () => {
    render(<BudgetBucketCard {...defaultProps} isEditingLimit={true} />);

    const input = screen.getByLabelText('Edit limit for Groceries');
    fireEvent.change(input, { target: { value: '600' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(defaultProps.onSaveLimit).toHaveBeenCalledWith('bucket1', 600);
  });

  it('calls onCancelEdit when Escape is pressed', () => {
    render(<BudgetBucketCard {...defaultProps} isEditingLimit={true} />);

    const input = screen.getByLabelText('Edit limit for Groceries');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(defaultProps.onCancelEdit).toHaveBeenCalled();
  });

  it('syncs local state when entering edit mode', () => {
    const { rerender } = render(<BudgetBucketCard {...defaultProps} />);

    // Initial render - not editing
    expect(screen.queryByLabelText('Edit limit for Groceries')).not.toBeInTheDocument();

    // Re-render with editing enabled
    rerender(<BudgetBucketCard {...defaultProps} isEditingLimit={true} />);

    const input = screen.getByLabelText('Edit limit for Groceries');
    expect(input).toHaveValue(500);
  });

  it('calls onExpand when header is clicked', () => {
    render(<BudgetBucketCard {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Toggle/ }));
    expect(defaultProps.onExpand).toHaveBeenCalledWith('bucket1');
  });

  it('renders transactions when expanded', () => {
    const tx = {
      id: 'tx1',
      merchant: 'Test Merchant',
      amount: 50,
      date: '2023-01-01',
      category: 'Groceries',
      status: 'verified',
    } as Transaction;

    render(<BudgetBucketCard {...defaultProps} isExpanded={true} bucketTransactions={[tx]} />);

    expect(screen.getByText('Test Merchant')).toBeInTheDocument();
  });
});
