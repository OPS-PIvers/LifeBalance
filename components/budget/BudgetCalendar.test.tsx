import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import BudgetCalendar from './BudgetCalendar';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <div data-testid="chevron-left" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  Plus: () => <div data-testid="plus" />,
  CheckCircle2: () => <div data-testid="check-circle" />,
  Circle: () => <div data-testid="circle" />,
  Trash2: () => <div data-testid="trash" />,
  Edit2: () => <div data-testid="edit" />,
  X: () => <div data-testid="close" />,
  Copy: () => <div data-testid="copy" />,
  CheckSquare: () => <div data-testid="check-square" />,
  Download: () => <div data-testid="download" />,
  ChevronDown: () => <div data-testid="chevron-down" />,
  MoreVertical: () => <div data-testid="more-vertical" />,
  Repeat: () => <div data-testid="repeat" />,
  CalendarPlus: () => <div data-testid="calendar-plus" />,
  TrendingUp: () => <div data-testid="trending-up" />,
  TrendingDown: () => <div data-testid="trending-down" />,
  Check: () => <div data-testid="check" />,
}));

// Mock framer-motion for Drawer
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, onClick, ...props }: { children: React.ReactNode, className?: string, onClick?: () => void, [key: string]: unknown }) => (
      <div className={className} onClick={onClick} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('BudgetCalendar', () => {
  const mockAddCalendarItem = vi.fn();
  const mockUpdateCalendarItem = vi.fn();
  const mockDeleteCalendarItem = vi.fn();

  beforeEach(() => {
    // Set a fixed date to avoid end-of-month navigation issues in tests
    // 15th is safe from month-length overflow logic
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-15'));

    vi.clearAllMocks();
    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
      accounts: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens add modal when Add Event button is clicked', () => {
    render(<BudgetCalendar />);

    // Find "Add Event" button
    const addButton = screen.getByText('Add Event');
    fireEvent.click(addButton);

    // Verify modal content appears
    expect(screen.getByText('Add Calendar Item')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Title (e.g. Rent)')).toBeInTheDocument();
  });

  it('displays todos for the selected date', () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [
        {
          id: 'todo-1',
          text: 'Test Task',
          completeByDate: todayStr,
          isCompleted: false,
          assignedTo: 'user1'
        }
      ],
      completeToDo: vi.fn(),
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Should show "Test Task" because selectedDate defaults to today
    expect(screen.getByText('Test Task')).toBeInTheDocument();
    expect(screen.getByText('Task')).toBeInTheDocument();
  });

  it('calls completeToDo when complete button is clicked', () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const mockCompleteToDo = vi.fn().mockResolvedValue(undefined);

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [],
      addCalendarItem: vi.fn(),
      updateCalendarItem: vi.fn(),
      deleteCalendarItem: vi.fn(),
      todos: [
        {
          id: 'todo-1',
          text: 'Test Task',
          completeByDate: todayStr,
          isCompleted: false,
          assignedTo: 'user1'
        }
      ],
      completeToDo: mockCompleteToDo,
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Find and click the complete button
    const completeButton = screen.getByText('Complete');
    fireEvent.click(completeButton);

    expect(mockCompleteToDo).toHaveBeenCalledWith('todo-1');
  });

  it('adds a new calendar item when save is clicked', async () => {
    render(<BudgetCalendar />);

    // Open Modal
    fireEvent.click(screen.getByText('Add Event'));

    // Fill Form
    const titleInput = screen.getByPlaceholderText('Title (e.g. Rent)');
    const amountInput = screen.getByPlaceholderText('Amount');

    fireEvent.change(titleInput, { target: { value: 'New Job' } });
    fireEvent.change(amountInput, { target: { value: '5000' } });

    // Select Income
    fireEvent.click(screen.getByText('Income'));

    // The modal has a "Add Event" button which is the second one on the screen (first one is the trigger)
    const saveButtons = screen.getAllByText('Add Event');
    fireEvent.click(saveButtons[1]!);

    await waitFor(() => {
      expect(mockAddCalendarItem).toHaveBeenCalledWith(expect.objectContaining({
        title: 'New Job',
        amount: 5000,
        type: 'income',
        isRecurring: false
      }));
    });
  });

  it('duplicates a calendar item', async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const item = {
      id: 'item-1',
      title: 'Rent',
      amount: 1000,
      date: todayStr,
      type: 'expense',
      isPaid: false
    };

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [item],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Open edit modal
    const editButton = screen.getByLabelText('Edit Rent');
    fireEvent.click(editButton);

    // Click Duplicate
    fireEvent.click(screen.getByText('Duplicate'));

    await waitFor(() => {
      expect(mockAddCalendarItem).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Rent (Copy)',
        amount: 1000,
        type: 'expense'
      }));
    });
  });

  it('edits an existing calendar item', async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const item = {
      id: 'item-1',
      title: 'Rent',
      amount: 1000,
      date: todayStr,
      type: 'expense',
      isPaid: false
    };

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [item],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Open edit modal
    const editButton = screen.getByLabelText('Edit Rent');
    fireEvent.click(editButton);

    // Change title
    const titleInput = screen.getByPlaceholderText('Title (e.g. Rent)');
    fireEvent.change(titleInput, { target: { value: 'Rent Updated' } });

    // Click Save (Save Changes)
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mockUpdateCalendarItem).toHaveBeenCalledWith(expect.objectContaining({
        id: 'item-1',
        title: 'Rent Updated',
        amount: 1000
      }));
    });
  });

  it('deletes a calendar item', () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const item = {
      id: 'item-1',
      title: 'Rent',
      amount: 1000,
      date: todayStr,
      type: 'expense',
      isPaid: false
    };

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [item],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Click delete
    const deleteButton = screen.getByLabelText('Delete Rent');
    fireEvent.click(deleteButton);

    expect(mockDeleteCalendarItem).toHaveBeenCalledWith('item-1');
  });

  it('navigates between months', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15'));

    try {
      render(<BudgetCalendar />);

      // Current date is mocked to 2024-01-15, so month is January 2024
      expect(screen.getByText('January 2024')).toBeInTheDocument();

      // Click Next
      fireEvent.click(screen.getByLabelText('Next month'));
      expect(screen.getByText('February 2024')).toBeInTheDocument();

      // Click Prev twice (back to current, then prev)
      fireEvent.click(screen.getByLabelText('Previous month'));
      fireEvent.click(screen.getByLabelText('Previous month'));

      expect(screen.getByText('December 2023')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('toggles recurring switch with accessibility attributes', () => {
    render(<BudgetCalendar />);

    // Open Modal
    fireEvent.click(screen.getByText('Add Event'));

    // Find the toggle
    const toggle = screen.getByRole('switch', { name: /recurring/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Click it
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Click again
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('shows mobile actions drawer and handles actions', async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const item = {
      id: 'item-1',
      title: 'Rent',
      amount: 1000,
      date: todayStr,
      type: 'expense',
      isPaid: false
    };

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [item],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Click More button (finding by new aria-label)
    const moreButton = screen.getByLabelText('More actions for Rent');
    fireEvent.click(moreButton);

    // Verify Drawer opens
    expect(screen.getByText('Delete Event')).toBeInTheDocument();
    expect(screen.getByText('Edit Event')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();

    // Test Delete Action
    fireEvent.click(screen.getByText('Delete Event'));
    expect(mockDeleteCalendarItem).toHaveBeenCalledWith('item-1');

    // Re-open drawer for next test (since it closes on action)
    fireEvent.click(moreButton);

    // Test Edit Action (Should open Edit Modal)
    fireEvent.click(screen.getByText('Edit Event'));

    // The modal title changes to "Edit Event"
    // Note: Modal component needs ariaLabelledBy for name query to work with getByRole,
    // so we check for presence of dialog and the specific title text.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit Event', { selector: 'h3' })).toBeInTheDocument();

    // Re-open drawer for Cancel test
    fireEvent.click(screen.getByLabelText('Close modal')); // Close edit modal first
    fireEvent.click(moreButton);

    // Test Cancel Action
    fireEvent.click(screen.getByText('Cancel'));
    // Drawer content should disappear
    expect(screen.queryByText('Delete Event')).not.toBeInTheDocument();
  });

  it('hides edit option for paid items in mobile drawer', () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const item = {
      id: 'item-paid',
      title: 'Paid Bill',
      amount: 50,
      date: todayStr,
      type: 'expense',
      isPaid: true
    };

    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [item],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
      accounts: [],
    });

    render(<BudgetCalendar />);

    // Click More button
    const moreButton = screen.getByLabelText('More actions for Paid Bill');
    fireEvent.click(moreButton);

    // Verify Edit is hidden but Delete is shown
    expect(screen.queryByText('Edit Event')).not.toBeInTheDocument();
    expect(screen.getByText('Delete Event')).toBeInTheDocument();
  });

  it('day cells have role=button, tabIndex, and aria-label for keyboard access', () => {
    render(<BudgetCalendar />);

    // All day cells should be keyboard-accessible buttons
    const dayButtons = screen.getAllByRole('button').filter(el => el.getAttribute('aria-label')?.match(/\w+ \d+, \d{4}/));
    expect(dayButtons.length).toBeGreaterThan(0);

    // Each should have tabIndex 0
    dayButtons.forEach(btn => {
      expect(btn).toHaveAttribute('tabindex', '0');
    });

    // Pressing Enter on a day cell should activate it (select the date)
    // Find the cell for the 15th (the mocked current date)
    const cell15 = dayButtons.find(btn => btn.getAttribute('aria-label')?.includes('January 15'));
    expect(cell15).toBeDefined();

    // Pressing Space on the cell should call setSelectedDate
    fireEvent.keyDown(cell15!, { key: ' ', code: 'Space' });

    // After pressing Space, the selected day should show "January 15" as the detail heading
    expect(screen.getByText('January 15')).toBeInTheDocument();
  });

  it('opens recurring manager modal when repeat button is clicked', () => {
    render(<BudgetCalendar />);

    const repeatButton = screen.getByLabelText('Manage Recurring Bills');
    fireEvent.click(repeatButton);

    // Since we can't test the internal state of the modal easily without it being rendered,
    // and the modal is rendered conditionally inside the component:
    // <RecurringBillsModal isOpen={isRecurringModalOpen} ... />
    // We expect the modal text to appear.
    // The modal has text "Recurring Manager"
    expect(screen.getByText('Recurring Manager')).toBeInTheDocument();
  });
});
