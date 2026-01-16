import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToDosPage from './ToDosPage';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '../utils/exportUtils';
import { format, addDays, subDays } from 'date-fns';

// Mock dependencies
vi.mock('../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('../utils/exportUtils', () => ({
  generateCsvExport: vi.fn(),
}));

vi.mock('../utils/toastHelpers', () => ({
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
}));

describe('ToDosPage Export', () => {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const mockMembers = [
    {
      uid: 'user1',
      displayName: 'Alice Smith',
      photoURL: 'http://example.com/alice.jpg',
      role: 'member',
      points: { daily: 0, weekly: 0, total: 0 }
    },
    {
      uid: 'user2',
      displayName: 'Bob Jones',
      role: 'member',
      points: { daily: 0, weekly: 0, total: 0 }
    }
  ];

  const mockTodos = [
    {
      id: '1',
      text: 'Overdue Task',
      completeByDate: yesterday,
      assignedTo: 'user1',
      isCompleted: false,
      createdBy: 'user1',
      createdAt: new Date().toISOString()
    },
    {
      id: '2',
      text: 'Today Task',
      completeByDate: today,
      assignedTo: 'user2',
      isCompleted: false,
      createdBy: 'user1',
      createdAt: new Date().toISOString()
    },
    {
      id: '3',
      text: 'Completed Task',
      completeByDate: today,
      assignedTo: 'user1',
      isCompleted: true,
      createdBy: 'user1',
      createdAt: new Date().toISOString()
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the export button', () => {
    (useHousehold as any).mockReturnValue({
      todos: mockTodos,
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
      updateToDo: vi.fn(),
      deleteToDo: vi.fn(),
      completeToDo: vi.fn(),
    });

    render(<ToDosPage />);
    expect(screen.getByLabelText('Export active tasks to CSV')).toBeInTheDocument();
  });

  it('calls generateCsvExport with correct data and status when export button is clicked', () => {
    (useHousehold as any).mockReturnValue({
      todos: mockTodos,
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
      updateToDo: vi.fn(),
      deleteToDo: vi.fn(),
      completeToDo: vi.fn(),
    });

    render(<ToDosPage />);

    const exportBtn = screen.getByLabelText('Export active tasks to CSV');
    fireEvent.click(exportBtn);

    expect(generateCsvExport).toHaveBeenCalledTimes(1);

    // Check arguments
    const [exportedData, filenamePrefix] = (generateCsvExport as any).mock.calls[0];

    expect(filenamePrefix).toBe('todo-list');

    // Should contain 2 active tasks, not the completed one
    expect(exportedData).toHaveLength(2);

    const overdueTask = exportedData.find((d: any) => d.Task === 'Overdue Task');
    expect(overdueTask).toBeDefined();
    expect(overdueTask['Due Date']).toBe(yesterday);
    expect(overdueTask['Assigned To']).toBe('Alice Smith');
    expect(overdueTask['Status']).toBe('Overdue');

    const todayTask = exportedData.find((d: any) => d.Task === 'Today Task');
    expect(todayTask).toBeDefined();
    expect(todayTask['Assigned To']).toBe('Bob Jones');
    expect(todayTask['Status']).toBe('Today');
  });

  it('excludes completed tasks from export', () => {
    (useHousehold as any).mockReturnValue({
      todos: mockTodos,
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
      updateToDo: vi.fn(),
      deleteToDo: vi.fn(),
      completeToDo: vi.fn(),
    });

    render(<ToDosPage />);

    const exportBtn = screen.getByLabelText('Export active tasks to CSV');
    fireEvent.click(exportBtn);

    const [exportedData] = (generateCsvExport as any).mock.calls[0];

    const completedTask = exportedData.find((d: any) => d.Task === 'Completed Task');
    expect(completedTask).toBeUndefined();
  });

  it('sorts exported tasks by due date', () => {
    const sortedTodos = [
      {
        id: '1',
        text: 'Later Task',
        completeByDate: tomorrow,
        assignedTo: 'user1',
        isCompleted: false,
        createdBy: 'user1',
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        text: 'Earlier Task',
        completeByDate: yesterday,
        assignedTo: 'user1',
        isCompleted: false,
        createdBy: 'user1',
        createdAt: new Date().toISOString()
      }
    ];

    (useHousehold as any).mockReturnValue({
      todos: sortedTodos,
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
      updateToDo: vi.fn(),
      deleteToDo: vi.fn(),
      completeToDo: vi.fn(),
    });

    render(<ToDosPage />);
    const exportBtn = screen.getByLabelText('Export active tasks to CSV');
    fireEvent.click(exportBtn);

    const [exportedData] = (generateCsvExport as any).mock.calls[0];
    expect(exportedData[0].Task).toBe('Earlier Task');
    expect(exportedData[1].Task).toBe('Later Task');
  });

  it('disables export button when no todos exist', () => {
    (useHousehold as any).mockReturnValue({
      todos: [], // No todos
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
    });

    render(<ToDosPage />);
    const exportBtn = screen.getByLabelText('Export active tasks to CSV');
    expect(exportBtn).toBeDisabled();
  });

  it('disables export button when only completed todos exist', () => {
    const onlyCompletedTodos = [
      {
        id: '3',
        text: 'Completed Task',
        completeByDate: today,
        assignedTo: 'user1',
        isCompleted: true,
        createdBy: 'user1',
        createdAt: new Date().toISOString()
      }
    ];

    (useHousehold as any).mockReturnValue({
      todos: onlyCompletedTodos,
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
    });

    render(<ToDosPage />);
    const exportBtn = screen.getByLabelText('Export active tasks to CSV');
    expect(exportBtn).toBeDisabled();
  });
});
