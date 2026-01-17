import { render, screen, fireEvent } from '@testing-library/react';
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
});
