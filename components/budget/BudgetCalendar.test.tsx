import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
    vi.clearAllMocks();
    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
      todos: [],
      completeToDo: vi.fn(),
    });
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
    fireEvent.click(saveButtons[1]);

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
    });

    render(<BudgetCalendar />);

    // Click delete
    const deleteButton = screen.getByLabelText('Delete Rent');
    fireEvent.click(deleteButton);

    expect(mockDeleteCalendarItem).toHaveBeenCalledWith('item-1');
  });

  it('navigates between months', () => {
    render(<BudgetCalendar />);

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Check current month is displayed
    expect(screen.getByText(currentMonth)).toBeInTheDocument();

    // Click Next
    fireEvent.click(screen.getByLabelText('Next month'));

    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextMonth = nextDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    expect(screen.getByText(nextMonth)).toBeInTheDocument();

    // Click Prev twice (back to current, then prev)
    fireEvent.click(screen.getByLabelText('Previous month'));
    fireEvent.click(screen.getByLabelText('Previous month'));

    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonth = prevDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    expect(screen.getByText(prevMonth)).toBeInTheDocument();
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

  it('shows mobile actions drawer when more button is clicked', () => {
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
    });

    render(<BudgetCalendar />);

    // Click More button
    const moreButton = screen.getByTestId('more-vertical').parentElement;
    fireEvent.click(moreButton!);

    // Check if Drawer opens (Delete Event button should be visible)
    expect(screen.getByText('Delete Event')).toBeInTheDocument();
    expect(screen.getByText('Edit Event')).toBeInTheDocument();
  });
});
