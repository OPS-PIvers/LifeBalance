import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import RecurringBillsModal from './RecurringBillsModal';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';

// Mock dependencies
// RecurringBillsModal reads useFinance. Back every hook with one shared mock fn
// so the existing `useHousehold` mock setup drives all of them with one value.
vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const fn = vi.fn();
  return {
    useHousehold: fn,
    useFinance: fn,
    useHouseholdCore: fn,
    useMeals: fn,
    useTodos: fn,
    useGamification: fn,
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('lucide-react', () => ({
  Trash2: () => <div data-testid="trash-icon" />,
  Edit2: () => <div data-testid="edit-icon" />,
  X: () => <div data-testid="close-icon" />,
  Check: () => <div data-testid="check-icon" />,
  Repeat: () => <div data-testid="repeat-icon" />,
  TrendingUp: () => <div data-testid="trending-up-icon" />,
  TrendingDown: () => <div data-testid="trending-down-icon" />,
  ChevronDown: () => <div data-testid="chevron-down" />,
  MoreVertical: () => <div data-testid="more-vertical-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
}));

describe('RecurringBillsModal', () => {
  const mockUpdateCalendarItem = vi.fn();
  const mockDeleteCalendarItem = vi.fn();
  const mockAddCalendarItem = vi.fn();
  const onClose = vi.fn();

  const recurringItems = [
    {
      id: 'item-1',
      title: 'Netflix',
      amount: 15.99,
      type: 'expense',
      isRecurring: true,
      frequency: 'monthly',
    },
    {
      id: 'item-2',
      title: 'Salary',
      amount: 5000,
      type: 'income',
      isRecurring: true,
      frequency: 'monthly',
    },
    {
        id: 'item-3',
        title: 'Weekly Gym',
        amount: 25,
        type: 'expense',
        isRecurring: true,
        frequency: 'weekly',
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: recurringItems,
      transactions: [],
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      addCalendarItem: mockAddCalendarItem,
    });
  });

  it('renders correctly when open', () => {
    render(<RecurringBillsModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Recurring Manager')).toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('calculates totals correctly', () => {
    render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

    // Monthly Expenses: 15.99 + (25 * 4.33) = 15.99 + 108.25 = 124.24
    // Monthly Income: 5000

    expect(screen.getByText('$124.24')).toBeInTheDocument();
    // $5,000.00 now appears twice: the Monthly Income summary and the Salary
    // per-instance amount (both use the shared currency formatter with cents).
    expect(screen.getAllByText('$5,000.00').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onClose when close button is clicked', () => {
    render(<RecurringBillsModal isOpen={true} onClose={onClose} />);
    const closeButton = screen.getByLabelText('Close drawer');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('filters out non-recurring items and instances', () => {
    const mixedItems = [
      ...recurringItems,
      {
        id: 'item-4',
        title: 'One-time',
        amount: 100,
        type: 'expense',
        isRecurring: false,
      },
      {
        id: 'item-5',
        title: 'Instance',
        amount: 15.99,
        type: 'expense',
        isRecurring: true,
        parentRecurringId: 'item-1', // Should be filtered out
      },
      {
          id: 'item-6',
          title: 'Deleted Template',
          amount: 10,
          type: 'expense',
          isRecurring: true,
          isDeleted: true // Should be filtered out
      }
    ];

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: mixedItems,
      transactions: [],
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      addCalendarItem: mockAddCalendarItem,
    });

    render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

    expect(screen.queryByText('One-time')).not.toBeInTheDocument();
    expect(screen.queryByText('Instance')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted Template')).not.toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
  });

  it('enters edit mode and updates item', async () => {
    render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

    // Find edit button for Netflix (first item)
    // Note: Since we have multiple edit buttons, we need to be specific or assume order.
    // The items are mapped in order. Netflix is index 0.
    const editButtons = screen.getAllByTestId('edit-icon');
    fireEvent.click(editButtons[0]!.parentElement!);

    // Check if inputs appear
    const titleInput = screen.getByPlaceholderText('Title');
    const amountInput = screen.getByPlaceholderText('Amount');

    expect(titleInput).toHaveValue('Netflix');
    expect(amountInput).toHaveValue(15.99);

    // Update values
    fireEvent.change(titleInput, { target: { value: 'Netflix Premium' } });
    fireEvent.change(amountInput, { target: { value: '20.00' } });

    // Save
    const saveButton = screen.getByTestId('check-icon').parentElement!;
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateCalendarItem).toHaveBeenCalledWith(expect.objectContaining({
        id: 'item-1',
        title: 'Netflix Premium',
        amount: 20.00,
        frequency: 'monthly'
      }));
    });
  });

  it('validates invalid amount input', async () => {
      render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

      const editButtons = screen.getAllByTestId('edit-icon');
      fireEvent.click(editButtons[0]!.parentElement!);

      const amountInput = screen.getByPlaceholderText('Amount');
      fireEvent.change(amountInput, { target: { value: '-5' } }); // Negative

      const saveButton = screen.getByTestId('check-icon').parentElement!;
      fireEvent.click(saveButton);

      // Should not call update
      expect(mockUpdateCalendarItem).not.toHaveBeenCalled();

      // Should behave same for NaN
      fireEvent.change(amountInput, { target: { value: 'abc' } });
      fireEvent.click(saveButton);
      expect(mockUpdateCalendarItem).not.toHaveBeenCalled();
  });

  it('deletes an item', async () => {
    render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

    const deleteButtons = screen.getAllByTestId('trash-icon');
    fireEvent.click(deleteButtons[0]!.parentElement!);

    // Confirm via the accessible ConfirmDialog (replaces window.confirm)
    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDeleteCalendarItem).toHaveBeenCalledWith('item-1');
    });
  });

  describe('detected subscriptions', () => {
    const detectableTransactions = [
      { id: 't1', merchant: 'Hulu', amount: 12.99, date: '2026-04-15', category: 'Subscriptions' },
      { id: 't2', merchant: 'Hulu', amount: 12.99, date: '2026-05-15', category: 'Subscriptions' },
      { id: 't3', merchant: 'Hulu', amount: 12.99, date: '2026-06-14', category: 'Subscriptions' },
    ];

    it('renders a detected subscription row', () => {
      (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        calendarItems: recurringItems,
        transactions: detectableTransactions,
        updateCalendarItem: mockUpdateCalendarItem,
        deleteCalendarItem: mockDeleteCalendarItem,
        addCalendarItem: mockAddCalendarItem,
      });

      render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

      expect(screen.getByText('Detected subscriptions')).toBeInTheDocument();
      expect(screen.getByText('Hulu')).toBeInTheDocument();
    });

    it('calls addCalendarItem when "Add as bill" is clicked', async () => {
      (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        calendarItems: recurringItems,
        transactions: detectableTransactions,
        updateCalendarItem: mockUpdateCalendarItem,
        deleteCalendarItem: mockDeleteCalendarItem,
        addCalendarItem: mockAddCalendarItem,
      });

      render(<RecurringBillsModal isOpen={true} onClose={onClose} />);

      const addButton = screen.getByLabelText('Add Hulu as a bill');
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockAddCalendarItem).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Hulu',
            amount: 12.99,
            type: 'expense',
            isRecurring: true,
            frequency: 'monthly',
          })
        );
      });
    });

    it('hides a dismissed detection and keeps it hidden on re-render', () => {
      (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        calendarItems: recurringItems,
        transactions: detectableTransactions,
        updateCalendarItem: mockUpdateCalendarItem,
        deleteCalendarItem: mockDeleteCalendarItem,
        addCalendarItem: mockAddCalendarItem,
      });

      const { unmount } = render(<RecurringBillsModal isOpen={true} onClose={onClose} />);
      expect(screen.getByText('Hulu')).toBeInTheDocument();

      const dismissButton = screen.getByLabelText('Dismiss Hulu detection');
      fireEvent.click(dismissButton);

      expect(screen.queryByText('Detected subscriptions')).not.toBeInTheDocument();
      unmount();

      // Re-render (fresh mount) — the localStorage dismissal persists.
      render(<RecurringBillsModal isOpen={true} onClose={onClose} />);
      expect(screen.queryByText('Detected subscriptions')).not.toBeInTheDocument();
    });

    it('does not render the section when there are no detections', () => {
      render(<RecurringBillsModal isOpen={true} onClose={onClose} />);
      expect(screen.queryByText('Detected subscriptions')).not.toBeInTheDocument();
    });
  });
});
