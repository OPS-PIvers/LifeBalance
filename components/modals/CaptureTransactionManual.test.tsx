import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureTransactionManual } from './CaptureTransactionManual';
import { Transaction, Habit, BudgetBucket, Store } from '@/types/schema';

// Mock dependencies
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

vi.mock('@/utils/habitSuggestions', () => ({
  suggestHabitsForTransaction: vi.fn().mockReturnValue([]),
}));

// Mock lucide-react icons. Includes ChevronDown because the Store/Account fields
// now render the shared <Select> primitive, which draws its own ChevronDown.
vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="icon-check" />,
  CheckCircle2: () => <div data-testid="icon-check-circle" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  AlertCircle: () => <div data-testid="icon-alert-circle" />,
  Loader2: () => <div data-testid="icon-loader" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
}));

describe('CaptureTransactionManual', () => {
  const mockOnAddTransaction = vi.fn();
  const mockOnClose = vi.fn();
  const mockCategories = ['Food', 'Transport', 'Utilities'];
  const mockHabits: Habit[] = [];
  const mockTransactions: Transaction[] = [];
  const mockBuckets: BudgetBucket[] = [];
  const mockStores: Store[] = [
    { id: 'store-1', name: 'Trader Joes' },
    { id: 'store-2', name: 'Costco' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields correctly', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Starbucks')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Save Transaction')).toBeInTheDocument();
  });

  it('offers known store names as a datalist on the Merchant field (no separate Store select)', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={mockStores}
        accounts={[]}
      />
    );

    const merchantInput = screen.getByPlaceholderText('e.g. Starbucks');
    expect(merchantInput).toHaveAttribute('list');
    const datalistId = merchantInput.getAttribute('list')!;
    const options = Array.from(document.getElementById(datalistId)?.querySelectorAll('option') ?? []).map(
      (o) => o.getAttribute('value')
    );
    expect(options).toEqual(['Trader Joes', 'Costco']);
  });

  it('resolves the store to the matching known store name on submit', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={mockStores}
        accounts={[]}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    // Case/whitespace differences from the canonical store name still match.
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: '  costco  ' } });

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0]![0];
    expect(calledArg).toMatchObject({ store: 'Costco' });
  });

  it('omits the store when the merchant does not match a known store', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={mockStores}
        accounts={[]}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Some Random Shop' } });

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0]![0];
    expect(calledArg.store).toBeUndefined();
  });

  it('collapses account/habit/recurring fields behind "Add details" by default', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    // Quick-entry fields stay visible.
    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Starbucks')).toBeInTheDocument();

    // The disclosure toggle is present but collapsed by default.
    const toggle = screen.getByRole('button', { name: /add details/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Account (Optional)')).not.toBeInTheDocument();
    expect(screen.queryByText('Recurring Transaction')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Account (Optional)')).toBeInTheDocument();
    expect(screen.getByText('Recurring Transaction')).toBeInTheDocument();
  });

  it('submits successfully with only Amount/Merchant/Category while "Add details" stays collapsed', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    // "Add details" is never expanded in this test.
    expect(screen.queryByText('Account (Optional)')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Pizza Place' } });

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0]![0];
    expect(calledArg).toMatchObject({
      amount: 25.00,
      merchant: 'Pizza Place',
      category: 'Food',
      source: 'manual',
      status: 'verified',
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles successful submission', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Pizza Place' } });

    // Ensure date is set (it defaults to today but good to be explicit if testing validation)
    // We'll leave the default date.

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0]![0];
    expect(calledArg).toMatchObject({
      amount: 25.00,
      merchant: 'Pizza Place',
      category: 'Food', // Defaults to first category
      source: 'manual',
      status: 'verified',
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('validates required fields', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    // Empty submit
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).not.toHaveBeenCalled();
    });

    // Fill amount but no merchant
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).not.toHaveBeenCalled();
    });
  });

  it('populates from initialData', async () => {
    render(
      <CaptureTransactionManual
        initialData={{
            amount: '50',
            merchant: 'Test Merchant',
            category: 'Transport'
        }}
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0]![0];
    expect(calledArg).toMatchObject({
      amount: 50,
      merchant: 'Test Merchant',
      category: 'Transport',
    });
  });

  it('shows loading state during submission', async () => {
    let resolvePromise: (value: void | PromiseLike<void>) => void = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    mockOnAddTransaction.mockReturnValue(promise);

    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Loading Test' } });

    fireEvent.click(screen.getByText('Save Transaction'));

    expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save transaction/i })).toBeDisabled();

    resolvePromise();

    await waitFor(() => {
      expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('resets loading state on error', async () => {
    let rejectPromise: (reason?: unknown) => void = () => {};
    const promise = new Promise<void>((_, reject) => {
      rejectPromise = reject;
    });
    mockOnAddTransaction.mockReturnValue(promise);

    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
        stores={[]}
        accounts={[]}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Error Test' } });

    fireEvent.click(screen.getByText('Save Transaction'));

    expect(screen.getByTestId('icon-loader')).toBeInTheDocument();

    rejectPromise(new Error('Failed to save'));

    await waitFor(() => {
      expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save transaction/i })).not.toBeDisabled();
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
