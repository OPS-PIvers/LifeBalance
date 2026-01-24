/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  Layers: () => <div data-testid="layers-icon" />,
  CheckSquare: () => <div data-testid="check-square-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
}));

describe('ToDosPage', () => {
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

  const mockAddToDo = vi.fn();
  const mockUpdateToDo = vi.fn();
  const mockDeleteToDo = vi.fn();
  const mockCompleteToDo = vi.fn();

  const setup = (todos = mockTodos) => {
    (useHousehold as any).mockReturnValue({
      todos,
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

  describe('Export', () => {
    it('renders the export button', () => {
      setup();
      expect(screen.getByLabelText('Export active tasks to CSV')).toBeInTheDocument();
    });

    it('calls generateCsvExport with correct data and status when export button is clicked', () => {
      setup();

      const exportBtn = screen.getByLabelText('Export active tasks to CSV');
      fireEvent.click(exportBtn);

      expect(generateCsvExport).toHaveBeenCalledTimes(1);

      const [exportedData, filenamePrefix] = (generateCsvExport as any).mock.calls[0];
      expect(filenamePrefix).toBe('todo-list');
      expect(exportedData).toHaveLength(2);

      const overdueTask = exportedData.find((d: any) => d.Task === 'Overdue Task');
      expect(overdueTask).toBeDefined();
      expect(overdueTask['Due Date']).toBe(yesterday);
      expect(overdueTask['Status']).toBe('Overdue');
    });

    it('excludes completed tasks from export', () => {
      setup();
      const exportBtn = screen.getByLabelText('Export active tasks to CSV');
      fireEvent.click(exportBtn);
      const [exportedData] = (generateCsvExport as any).mock.calls[0];
      const completedTask = exportedData.find((d: any) => d.Task === 'Completed Task');
      expect(completedTask).toBeUndefined();
    });

    it('disables export button when no todos exist', () => {
      setup([]);
      const exportBtn = screen.getByLabelText('Export active tasks to CSV');
      expect(exportBtn).toBeDisabled();
    });
  });

  describe('Batch Operations', () => {
    it('toggles selection mode', () => {
      setup();
      const toggleBtn = screen.getByLabelText('Select Multiple');
      fireEvent.click(toggleBtn);

      // Should show "Select All" button
      expect(screen.getByText('Select All')).toBeInTheDocument();
      // Should show checkboxes (or placeholders)
      expect(screen.getByLabelText('Cancel Selection')).toBeInTheDocument();
    });

    it('selects all items', () => {
      setup();
      // Enter selection mode
      fireEvent.click(screen.getByLabelText('Select Multiple'));

      // Click Select All
      fireEvent.click(screen.getByText('Select All'));

      // Should show 2 selected (only active tasks)
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      expect(screen.getByText('Deselect All')).toBeInTheDocument();
    });

    it('batch completes selected items', async () => {
      setup();
      // Enter selection mode
      fireEvent.click(screen.getByLabelText('Select Multiple'));

      // Select All
      fireEvent.click(screen.getByText('Select All'));

      // Click Complete in FAB
      const completeBtn = screen.getByLabelText('Mark selected as completed');
      fireEvent.click(completeBtn);

      await waitFor(() => {
        expect(mockCompleteToDo).toHaveBeenCalledTimes(2);
        expect(mockCompleteToDo).toHaveBeenCalledWith('1');
        expect(mockCompleteToDo).toHaveBeenCalledWith('2');
      });
    });

    it('batch deletes selected items', async () => {
      setup();
      // Enter selection mode
      fireEvent.click(screen.getByLabelText('Select Multiple'));

      // Select All
      fireEvent.click(screen.getByText('Select All'));

      // Click Delete in FAB
      const deleteBtn = screen.getByLabelText('Delete selected items');
      fireEvent.click(deleteBtn);

      // Should show confirmation modal
      expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();

      // Click Confirm Delete
      fireEvent.click(screen.getByText('Delete All'));

      await waitFor(() => {
        expect(mockDeleteToDo).toHaveBeenCalledTimes(2);
        expect(mockDeleteToDo).toHaveBeenCalledWith('1');
        expect(mockDeleteToDo).toHaveBeenCalledWith('2');
      });
    });
  });

  describe('Task Interaction', () => {
    it('completes a single task', async () => {
      setup();
      // Find the check button for the first task
      const completeButtons = screen.getAllByLabelText('Complete task');
      fireEvent.click(completeButtons[0]);

      await waitFor(() => {
        expect(mockCompleteToDo).toHaveBeenCalledWith('1');
      });
    });

    it('adds a new task', async () => {
      setup();
      fireEvent.click(screen.getByLabelText('Add new task'));

      fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'New Test Task' } });
      fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: today } });

      // Select assignee (user1)
      fireEvent.click(screen.getByLabelText('Assign to Alice Smith'));

      fireEvent.click(screen.getByText('Create Task'));

      await waitFor(() => {
        expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
          text: 'New Test Task',
          completeByDate: today,
          assignedTo: 'user1'
        }));
      });
    });
  });
});
