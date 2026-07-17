import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureTransactionManual } from './CaptureTransactionManual';
import { Transaction, Habit, Store, Account } from '@/types/schema';

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

  it('flags each empty required field with aria-invalid and an aria-describedby message on submit', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );

    fireEvent.click(screen.getByText('Save Transaction'));
    expect(mockOnAddTransaction).not.toHaveBeenCalled();

    // Amount: invalid + message wired via aria-describedby.
    const amountInput = screen.getByPlaceholderText('0.00');
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    const amountMsg = screen.getByText('Enter an amount');
    expect(amountInput.getAttribute('aria-describedby')).toBe(amountMsg.id);

    // Merchant: invalid + message wired via aria-describedby.
    const merchantInput = screen.getByPlaceholderText('e.g. Starbucks');
    expect(merchantInput).toHaveAttribute('aria-invalid', 'true');
    const merchantMsg = screen.getByText('Enter a merchant');
    expect(merchantInput.getAttribute('aria-describedby')).toBe(merchantMsg.id);

    // Date defaults to today, so it stays valid.
    expect(screen.getByLabelText(/date/i)).toHaveAttribute('aria-invalid', 'false');

    // The summary alert names the missing fields.
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix: Amount, Merchant');
  });

  it('marks the genuinely required inputs with the required attribute', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );

    expect(screen.getByPlaceholderText('0.00')).toBeRequired();
    expect(screen.getByPlaceholderText('e.g. Starbucks')).toBeRequired();
    expect(screen.getByLabelText(/date/i)).toBeRequired();
  });

  it('clears a field error as soon as the user fixes that field', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );

    fireEvent.click(screen.getByText('Save Transaction'));
    expect(screen.getByText('Enter an amount')).toBeInTheDocument();
    expect(screen.getByText('Enter a merchant')).toBeInTheDocument();

    // Fixing the merchant clears ONLY the merchant error, and the summary
    // alert narrows to the remaining invalid fields.
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Pizza Place' } });
    expect(screen.queryByText('Enter a merchant')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Starbucks')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('Enter an amount')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix: Amount');

    // Fixing the amount clears the last error AND the summary alert.
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    expect(screen.queryByText('Enter an amount')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('0.00')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  const makeHabit = (id: string, title: string): Habit => ({
    id,
    title,
    category: 'Growth',
    basePoints: 10,
    streakDays: 0,
    completedDates: [],
    type: 'positive',
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    lastUpdated: new Date().toISOString(),
    createdBy: 'user-1',
  });

  const mockAccounts: Account[] = [
    { id: 'acc-check', name: 'Checking', type: 'checking', balance: 500, lastUpdated: '' },
    { id: 'acc-save', name: 'Savings', type: 'savings', balance: 900, lastUpdated: '' },
    { id: 'acc-card', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' },
  ];

  it('renders no habit section when the household has no habits', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={[]}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /add details/i }));
    expect(screen.queryByText('Connect Habits (Optional)')).not.toBeInTheDocument();
  });

  it('lets the user pick ANY habit even when there are no merchant suggestions', async () => {
    const habits = [makeHabit('h1', 'Read 30 mins'), makeHabit('h2', 'No takeout')];
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={habits}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /add details/i }));

    // Label is shown, and a non-empty affordance ("Choose a habit") accompanies it.
    expect(screen.getByText('Connect Habits (Optional)')).toBeInTheDocument();
    const summary = screen.getByText(/choose a habit \(2\)/i);
    fireEvent.click(summary);
    fireEvent.click(screen.getByText('No takeout'));

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Anywhere' } });
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => expect(mockOnAddTransaction).toHaveBeenCalledTimes(1));
    expect(mockOnAddTransaction.mock.calls[0]![0]).toMatchObject({ relatedHabitIds: ['h2'] });
  });

  it('creates a monthly subscription calendar entry when Recurring is ON', async () => {
    const mockOnAddCalendarItem = vi.fn().mockResolvedValue(undefined);
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onAddCalendarItem={mockOnAddCalendarItem}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={[]}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '9.99' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Netflix' } });
    fireEvent.click(screen.getByRole('button', { name: /add details/i }));

    // Helper copy tells the user where the entry lands.
    expect(screen.getByText('Creates a monthly entry on your Subscriptions tab.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /recurring transaction/i }));
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => expect(mockOnAddTransaction).toHaveBeenCalledTimes(1));
    expect(mockOnAddTransaction.mock.calls[0]![0]).toMatchObject({ isRecurring: true });
    expect(mockOnAddCalendarItem).toHaveBeenCalledTimes(1);
    expect(mockOnAddCalendarItem.mock.calls[0]![0]).toMatchObject({
      title: 'Netflix',
      amount: 9.99,
      type: 'expense',
      isPaid: false,
      isRecurring: true,
      frequency: 'monthly',
      isSubscription: true,
    });
  });

  it('does not create a calendar entry when Recurring is OFF', async () => {
    const mockOnAddCalendarItem = vi.fn().mockResolvedValue(undefined);
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onAddCalendarItem={mockOnAddCalendarItem}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={[]}
        transactions={mockTransactions}
        stores={[]}
        accounts={[]}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '9.99' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Netflix' } });
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => expect(mockOnAddTransaction).toHaveBeenCalledTimes(1));
    expect(mockOnAddCalendarItem).not.toHaveBeenCalled();
  });

  it('shows the From-account selector only for a credit-card Payment, and hides Recurring there', async () => {
    render(
      <CaptureTransactionManual
        initialData={{ accountId: 'acc-card', creditPayment: true }}
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={[]}
        transactions={mockTransactions}
        stores={[]}
        accounts={mockAccounts}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /add details/i }));

    // Payment mode: funding selector visible (non-credit accounts only),
    // Recurring toggle hidden (a card payment is a transfer, not a subscription).
    const fromSelect = screen.getByLabelText('From account (Optional)');
    const optionLabels = Array.from((fromSelect as HTMLSelectElement).options).map(o => o.text);
    expect(optionLabels).toContain('Checking');
    expect(optionLabels).toContain('Savings');
    expect(optionLabels).not.toContain('Visa');
    expect(screen.queryByText('Recurring Transaction')).not.toBeInTheDocument();

    // Flip to Charge: funding selector goes away, Recurring returns.
    fireEvent.click(screen.getByRole('radio', { name: 'Charge' }));
    expect(screen.queryByLabelText('From account (Optional)')).not.toBeInTheDocument();
    expect(screen.getByText('Recurring Transaction')).toBeInTheDocument();
  });

  it('submits fundingAccountId with a credit-card payment', async () => {
    render(
      <CaptureTransactionManual
        initialData={{ accountId: 'acc-card', creditPayment: true }}
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={[]}
        transactions={mockTransactions}
        stores={[]}
        accounts={mockAccounts}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Visa payment' } });
    fireEvent.click(screen.getByRole('button', { name: /add details/i }));
    fireEvent.change(screen.getByLabelText('From account (Optional)'), { target: { value: 'acc-check' } });
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => expect(mockOnAddTransaction).toHaveBeenCalledTimes(1));
    expect(mockOnAddTransaction.mock.calls[0]![0]).toMatchObject({
      amount: 100,
      creditPayment: true,
      accountId: 'acc-card',
      fundingAccountId: 'acc-check',
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
