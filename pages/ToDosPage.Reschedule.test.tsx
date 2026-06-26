import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ToDosPage from './ToDosPage';
import { useTodos, useHouseholdCore, type TodosContextValue, type HouseholdCoreContextValue } from '@/contexts/FirebaseHouseholdContext';
import { format, addDays, startOfToday } from 'date-fns';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: vi.fn(),
  useHouseholdCore: vi.fn(),
}));

// ToDosPage reads `useTodos` and `useHouseholdCore` slices. Both mocks receive the
// same composed value object so existing per-test data still works.
const setHouseholdMock = (value: Partial<TodosContextValue & HouseholdCoreContextValue>) => {
  vi.mocked(useTodos).mockReturnValue(value as TodosContextValue);
  vi.mocked(useHouseholdCore).mockReturnValue(value as HouseholdCoreContextValue);
};

vi.mock('@/utils/exportUtils', () => ({
  generateCsvExport: vi.fn(),
}));

vi.mock('@/utils/toastHelpers', () => ({
  showDeleteConfirmation: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Plus: () => <div data-testid="plus-icon" />,
  Calendar: () => <div data-testid="calendar-icon" />,
  Check: () => <div data-testid="check-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
  Edit2: () => <div data-testid="edit-icon" />,
  AlertCircle: () => <div data-testid="alert-icon" />,
  X: () => <div data-testid="x-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  User: () => <div data-testid="user-icon" />,
  Download: () => <div data-testid="download-icon" />,
  Layers: () => <div data-testid="layers-icon" />,
  CheckSquare: () => <div data-testid="check-square-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
  RotateCcw: () => <div data-testid="rotate-ccw-icon" />,
  Copy: () => <div data-testid="copy-icon" />,
  History: () => <div data-testid="history-icon" />,
  MoreVertical: () => <div data-testid="more-vertical-icon" />,
}));

describe('ToDosPage Reschedule Features', () => {
  const today = format(startOfToday(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(startOfToday(), 1), 'yyyy-MM-dd');

  const mockMembers = [
    {
      uid: 'user1',
      displayName: 'Alice Smith',
      role: 'member' as const,
      points: { daily: 0, weekly: 0, total: 0 }
    }
  ];

  const mockTodos = [
    {
      id: '1',
      text: 'Task 1',
      completeByDate: today,
      assignedTo: 'user1',
      isCompleted: false,
      createdBy: 'user1',
      createdAt: new Date().toISOString()
    },
    {
      id: '2',
      text: 'Task 2',
      completeByDate: today,
      assignedTo: 'user1',
      isCompleted: false,
      createdBy: 'user1',
      createdAt: new Date().toISOString()
    }
  ];

  const mockUpdateToDo = vi.fn();
  const mockAddToDo = vi.fn();
  const mockDeleteToDo = vi.fn();
  const mockCompleteToDo = vi.fn();

  const setup = () => {
    setHouseholdMock({
      todos: mockTodos,
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: mockAddToDo,
      updateToDo: mockUpdateToDo,
      deleteToDo: mockDeleteToDo,
      completeToDo: mockCompleteToDo,
    });
    render(<ToDosPage />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves a single task to tomorrow', async () => {
    setup();
    // Find "Move to Tomorrow" button
    const moveBtns = screen.getAllByTitle('Move to Tomorrow');
    expect(moveBtns.length).toBeGreaterThan(0);

    fireEvent.click(moveBtns[0]!);

    await waitFor(() => {
      expect(mockUpdateToDo).toHaveBeenCalledWith('1', {
        completeByDate: tomorrow
      });
    });
  });

  it('batch reschedules selected tasks', async () => {
    setup();
    // Enter selection mode
    fireEvent.click(screen.getByLabelText('Select Multiple'));

    // Select all
    fireEvent.click(screen.getByText('Select all'));

    // Click Reschedule in FAB
    const rescheduleBtn = screen.getByLabelText('Reschedule selected items');
    fireEvent.click(rescheduleBtn);

    // Modal should open. Check for "Reschedule Tasks" title
    expect(screen.getByText('Reschedule Tasks')).toBeInTheDocument();

    // Click "Tomorrow" shortcut in modal
    fireEvent.click(screen.getByText('Tomorrow'));

    // Click Confirm
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(mockUpdateToDo).toHaveBeenCalledTimes(2);
      expect(mockUpdateToDo).toHaveBeenCalledWith('1', { completeByDate: tomorrow });
      expect(mockUpdateToDo).toHaveBeenCalledWith('2', { completeByDate: tomorrow });
    });
  });
});
