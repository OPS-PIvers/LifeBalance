/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ToDosPage from './ToDosPage';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '../utils/exportUtils';
import { format, subDays } from 'date-fns';
import toast from 'react-hot-toast';

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
  RotateCcw: () => <div data-testid="rotate-ccw-icon" />,
  Copy: () => <div data-testid="copy-icon" />,
  History: () => <div data-testid="history-icon" />,
}));

describe('ToDosPage', () => {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

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
      completedAt: new Date().toISOString(), // Completed today
      createdBy: 'user1',
      createdAt: new Date().toISOString()
    }
  ];

  const mockAddToDo = vi.fn();
  const mockUpdateToDo = vi.fn();
  const mockDeleteToDo = vi.fn();
  const mockCompleteToDo = vi.fn();

  const setup = (todos = mockTodos, members = mockMembers) => {
    (useHousehold as any).mockReturnValue({
      todos,
      members: members,
      currentUser: members[0] || null,
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
      expect(filenamePrefix).toBe('todo-list-active');
      expect(exportedData).toHaveLength(2);

      const overdueTask = exportedData.find((d: any) => d.Task === 'Overdue Task');
      expect(overdueTask).toBeDefined();
      expect(overdueTask['Due Date']).toBe(yesterday);
      expect(overdueTask['Status']).toBe('Overdue');
    });

    it('excludes completed tasks from active export', () => {
      setup();
      const exportBtn = screen.getByLabelText('Export active tasks to CSV');
      fireEvent.click(exportBtn);
      const [exportedData] = (generateCsvExport as any).mock.calls[0];
      const completedTask = exportedData.find((d: any) => d.Task === 'Completed Task');
      expect(completedTask).toBeUndefined();
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

    it('duplicates a task', async () => {
        setup();
        const duplicateBtn = screen.getAllByLabelText('Duplicate task')[0];
        fireEvent.click(duplicateBtn);

        await waitFor(() => {
            expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
                text: 'Overdue Task',
                assignedTo: 'user1',
                isCompleted: false
            }));
        });
    });
  });

  describe('Completed View', () => {
      it('toggles to completed view and shows completed tasks', () => {
          setup();

          // Switch to completed view
          const completedToggle = screen.getByText('Completed');
          fireEvent.click(completedToggle);

          // Check if Completed Task is visible
          expect(screen.getByText('Completed Task')).toBeInTheDocument();

          // Check if Active tasks are NOT visible
          expect(screen.queryByText('Overdue Task')).not.toBeInTheDocument();
      });

      it('restores a completed task to active', async () => {
          setup();
          // Switch to completed view
          fireEvent.click(screen.getByText('Completed'));

          // Click restore (uncomplete) button
          const restoreBtn = screen.getByTitle('Mark as incomplete');
          fireEvent.click(restoreBtn);

          await waitFor(() => {
              expect(mockUpdateToDo).toHaveBeenCalledWith('3', {
                  isCompleted: false,
                  completedAt: undefined
              });
          });
      });

      it('duplicates a completed task', async () => {
          setup();
          // Switch to completed view
          fireEvent.click(screen.getByText('Completed'));

          // Hover/Click duplicate on completed item
          // Note: Duplicate button might be hidden by CSS group-hover in real DOM,
          // but in RTL/JSDOM it should be present in the DOM.
          const duplicateBtn = screen.getByTitle('Duplicate task');
          fireEvent.click(duplicateBtn);

          await waitFor(() => {
            expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
                text: 'Completed Task',
                isCompleted: false
            }));
        });
      });
  });

  describe('Validation', () => {
    it('validates form inputs', async () => {
      setup();
      fireEvent.click(screen.getByLabelText('Add new task'));

      // Try submitting empty form
      fireEvent.click(screen.getByText('Create Task'));
      expect(toast.error).toHaveBeenCalledWith('Please fill in all required fields');
    });

    it('validates no members available', async () => {
      // Must provide a mock currentUser even if members list is empty to bypass "Authentication Required" check
      const mockUser = {
        uid: 'user1',
        displayName: 'Alice Smith',
        photoURL: 'http://example.com/alice.jpg',
        role: 'member' as const,
        points: { daily: 0, weekly: 0, total: 0 }
      };

      (useHousehold as any).mockReturnValue({
        todos: [],
        members: [],
        currentUser: mockUser,
        addToDo: mockAddToDo,
        updateToDo: mockUpdateToDo,
        deleteToDo: mockDeleteToDo,
        completeToDo: mockCompleteToDo,
      });
      render(<ToDosPage />);

      fireEvent.click(screen.getByLabelText('Add new task'));

      // Button should be disabled or show error on click if not disabled
      const createBtn = screen.getByText('Create Task');
      expect(createBtn).toBeDisabled();

      expect(screen.getByText('No household members available to assign this task.')).toBeInTheDocument();
    });
  });
});
