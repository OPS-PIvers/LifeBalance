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

// Mock date-fns to have consistent dates if needed, but for now we rely on real date logic
// Since ToDosPage uses `startOfToday()`, we should ensure consistent date handling if we test status logic rigidly.

describe('ToDosPage Export', () => {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const mockMembers = [
    { uid: 'user1', displayName: 'Alice Smith', photoURL: 'http://example.com/alice.jpg' },
    { uid: 'user2', displayName: 'Bob Jones' }
  ];

  const mockTodos = [
    {
      id: '1',
      text: 'Overdue Task',
      completeByDate: yesterday,
      assignedTo: 'user1',
      isCompleted: false,
    },
    {
      id: '2',
      text: 'Today Task',
      completeByDate: today,
      assignedTo: 'user2',
      isCompleted: false,
    },
    {
      id: '3',
      text: 'Completed Task',
      completeByDate: today,
      assignedTo: 'user1',
      isCompleted: true,
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

  it('calls generateCsvExport with correct data when export button is clicked', () => {
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

    // Check first item (Overdue)
    // Note: The sort order in ToDosPage is complex, but export likely uses the same filter or just filter(!completed)
    // We'll inspect what we pass. Ideally we pass formatted data.

    const overdueTask = exportedData.find((d: any) => d.Task === 'Overdue Task');
    expect(overdueTask).toBeDefined();
    expect(overdueTask['Due Date']).toBe(yesterday);
    expect(overdueTask['Assigned To']).toBe('Alice Smith');
    // Status might be computed. If we implement status logic in export, verify it.
    // For now, let's assume we implement 'Status' field.

    const todayTask = exportedData.find((d: any) => d.Task === 'Today Task');
    expect(todayTask).toBeDefined();
    expect(todayTask['Assigned To']).toBe('Bob Jones');
  });

  it('disables or handles empty list gracefully', () => {
     (useHousehold as any).mockReturnValue({
      todos: [], // No todos
      members: mockMembers,
      currentUser: mockMembers[0],
      addToDo: vi.fn(),
    });

    render(<ToDosPage />);

    const exportBtn = screen.getByLabelText('Export active tasks to CSV');

    // It could be disabled or just show toast error.
    // Let's assume we disable it for better UX, similar to TransactionMasterList
    expect(exportBtn).toBeDisabled();
  });
});
