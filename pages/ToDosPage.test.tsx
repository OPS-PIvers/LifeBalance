import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ToDosPage from './ToDosPage';
import { useTodos, useHouseholdCore, type TodosContextValue, type HouseholdCoreContextValue } from '@/contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '@/utils/exportUtils';
import { format, subDays, addDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';

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
  MoreHorizontal: () => <div data-testid="more-horizontal-icon" />,
  ClipboardList: () => <div data-testid="clipboard-list-icon" />,
  SlidersHorizontal: () => <div data-testid="sliders-icon" />,
  ChevronDown: () => <div data-testid="chevron-down-icon" />,
}));

describe('ToDosPage', () => {
  const today = format(startOfToday(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  const mockMembers = [
    {
      uid: 'user1',
      displayName: 'Alice Smith',
      photoURL: 'http://example.com/alice.jpg',
      role: 'member' as const,
      points: { daily: 0, weekly: 0, total: 0 }
    },
    {
      uid: 'user2',
      displayName: 'Bob Jones',
      role: 'member' as const,
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
    setHouseholdMock({
      todos,
      members: members,
      currentUser: members[0] ?? null,
      addToDo: mockAddToDo,
      updateToDo: mockUpdateToDo,
      deleteToDo: mockDeleteToDo,
      completeToDo: mockCompleteToDo,
    });
    render(<ToDosPage />);
  };

  // Export + Select-multiple now live in the top-right "…" overflow menu.
  const openOverflowMenu = () =>
    fireEvent.click(screen.getByRole('button', { name: 'To-do list actions' }));
  const enterSelectionMode = () => {
    openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Select multiple/i }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Export', () => {
    it('exposes the export action in the overflow menu', () => {
      setup();
      openOverflowMenu();
      expect(screen.getByRole('menuitem', { name: /Export CSV/i })).toBeInTheDocument();
    });

    it('calls generateCsvExport with correct data and status when export is clicked', () => {
      setup();

      openOverflowMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: /Export CSV/i }));

      expect(generateCsvExport).toHaveBeenCalledTimes(1);

      const [exportedData, filenamePrefix] = vi.mocked(generateCsvExport).mock.calls[0]!;
      expect(filenamePrefix).toBe('todo-list-active');
      expect(exportedData).toHaveLength(2);

      const overdueTask = exportedData.find((d) => d['Task'] === 'Overdue Task');
      expect(overdueTask).toBeDefined();
      expect(overdueTask!['Due Date']).toBe(yesterday);
      expect(overdueTask!['Status']).toBe('Overdue');
    });

    it('excludes completed tasks from active export', () => {
      setup();
      openOverflowMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: /Export CSV/i }));
      const [exportedData] = vi.mocked(generateCsvExport).mock.calls[0]!;
      const completedTask = exportedData.find((d) => d['Task'] === 'Completed Task');
      expect(completedTask).toBeUndefined();
    });
  });

  describe('Batch Operations', () => {
    it('toggles selection mode', () => {
      setup();
      enterSelectionMode();

      // Should show "Select all" button
      expect(screen.getByText('Select all')).toBeInTheDocument();
      // Should show the visible Cancel control
      expect(screen.getByLabelText('Cancel Selection')).toBeInTheDocument();
    });

    it('selects all items', () => {
      setup();
      // Enter selection mode
      enterSelectionMode();

      // Click Select all
      fireEvent.click(screen.getByText('Select all'));

      // Should show 2 selected (only active tasks)
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      expect(screen.getByText('Deselect all')).toBeInTheDocument();
    });

    it('batch completes selected items', async () => {
      setup();
      // Enter selection mode
      enterSelectionMode();

      // Select all
      fireEvent.click(screen.getByText('Select all'));

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
      enterSelectionMode();

      // Select all
      fireEvent.click(screen.getByText('Select all'));

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
      const completeButtons = screen.getAllByLabelText(/^Complete task:/i);
      fireEvent.click(completeButtons[0]!);

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

      fireEvent.click(screen.getByText('Create task'));

      await waitFor(() => {
        expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
          text: 'New Test Task',
          completeByDate: today,
          assignedTo: 'user1'
        }));
      });
    });

    it('quick-adds a task from the sticky bar with default date and current-user assignee', async () => {
      setup();

      fireEvent.change(screen.getByLabelText('Quick add task'), { target: { value: 'Quick Task' } });
      fireEvent.click(screen.getByLabelText('Add task'));

      await waitFor(() => {
        expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
          text: 'Quick Task',
          completeByDate: today,
          assignedTo: 'user1', // currentUser (members[0]) is the default assignee
          isCompleted: false,
        }));
      });
    });

    it('does not quick-add when the field is empty', () => {
      setup();
      // Submit button is disabled with no text; clicking is a no-op.
      const submit = screen.getByLabelText('Add task');
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(mockAddToDo).not.toHaveBeenCalled();
    });

    it('blocks a same-tick double quick-add so only one task is created', async () => {
      setup();
      const input = screen.getByLabelText('Quick add task') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Once only' } });
      const form = input.closest('form')!;
      // Two synchronous submit events before React re-renders / the write
      // resolves — the in-flight ref guard must drop the second.
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(mockAddToDo).toHaveBeenCalledTimes(1);
      expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({ text: 'Once only' }));
    });

    it('duplicates a task', async () => {
        setup();
        const duplicateBtn = screen.getAllByLabelText('Duplicate task')[0]!;
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
      fireEvent.click(screen.getByText('Create task'));
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

      setHouseholdMock({
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
      const createBtn = screen.getByText('Create task');
      expect(createBtn).toBeDisabled();

      expect(screen.getByText('No household members available to assign this task.')).toBeInTheDocument();
    });
  });

  describe('List caps and collapsed history', () => {
    // Radar bucket = due after the end of the current week; +10 days or more is
    // always beyond it (endOfWeek is at most today+6), so these are deterministic.
    const makeRadarTodos = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `radar-${i + 1}`,
        text: `Radar Task ${i + 1}`,
        completeByDate: format(addDays(startOfToday(), 10 + i), 'yyyy-MM-dd'),
        assignedTo: 'user1',
        isCompleted: false,
        createdBy: 'user1',
        createdAt: new Date().toISOString(),
      }));

    it('caps On the Radar at 5 with a show-more row that reveals the rest', () => {
      setup(makeRadarTodos(7));

      // First five rows visible, the rest hidden behind the show-more row.
      expect(screen.getByText('Radar Task 1')).toBeInTheDocument();
      expect(screen.getByText('Radar Task 5')).toBeInTheDocument();
      expect(screen.queryByText('Radar Task 6')).not.toBeInTheDocument();
      expect(screen.queryByText('Radar Task 7')).not.toBeInTheDocument();

      const showMore = screen.getByRole('button', { name: '+ 2 more tasks' });
      expect(showMore).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(showMore);

      expect(screen.getByText('Radar Task 6')).toBeInTheDocument();
      expect(screen.getByText('Radar Task 7')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
    });

    it('renders the full list in selection mode despite the cap', () => {
      setup(makeRadarTodos(7));
      enterSelectionMode();

      // Every item must be selectable — the cap is bypassed and the row is gone.
      expect(screen.getByText('Radar Task 6')).toBeInTheDocument();
      expect(screen.getByText('Radar Task 7')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /more tasks/ })).not.toBeInTheDocument();

      // Select all operates on all 7 items.
      fireEvent.click(screen.getByText('Select all'));
      expect(screen.getByText('7 selected')).toBeInTheDocument();
    });

    it('collapses This Week and Older History by default while Completed Today stays expanded', () => {
      vi.useFakeTimers();
      try {
        // Friday, June 19 2026 — guarantees a "this week but not today/yesterday" slot.
        vi.setSystemTime(new Date(2026, 5, 19, 12, 0, 0));
        const completedTodos = [
          {
            id: 'c-today',
            text: 'Done Today',
            completeByDate: '2026-06-19',
            assignedTo: 'user1',
            isCompleted: true,
            completedAt: new Date(2026, 5, 19, 9, 0, 0).toISOString(),
            createdBy: 'user1',
            createdAt: new Date(2026, 5, 19, 8, 0, 0).toISOString(),
          },
          {
            id: 'c-week',
            text: 'Done Tuesday',
            completeByDate: '2026-06-16',
            assignedTo: 'user1',
            isCompleted: true,
            completedAt: new Date(2026, 5, 16, 9, 0, 0).toISOString(), // Tue, same ISO week
            createdBy: 'user1',
            createdAt: new Date(2026, 5, 16, 8, 0, 0).toISOString(),
          },
          {
            id: 'c-old',
            text: 'Done Long Ago',
            completeByDate: '2026-06-01',
            assignedTo: 'user1',
            isCompleted: true,
            completedAt: new Date(2026, 5, 1, 9, 0, 0).toISOString(),
            createdBy: 'user1',
            createdAt: new Date(2026, 5, 1, 8, 0, 0).toISOString(),
          },
        ];
        setup(completedTodos);
        fireEvent.click(screen.getByText('Completed'));

        // Recent bucket stays expanded; older buckets are collapsed.
        expect(screen.getByText('Done Today')).toBeInTheDocument();
        expect(screen.queryByText('Done Tuesday')).not.toBeInTheDocument();
        expect(screen.queryByText('Done Long Ago')).not.toBeInTheDocument();

        // Expanding This Week reveals its rows.
        const weekToggle = screen.getByRole('button', { name: /This Week/ });
        expect(weekToggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(weekToggle);
        expect(weekToggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Done Tuesday')).toBeInTheDocument();

        // Older History expands independently.
        fireEvent.click(screen.getByRole('button', { name: /Older History/ }));
        expect(screen.getByText('Done Long Ago')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
