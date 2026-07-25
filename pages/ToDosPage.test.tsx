import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ToDosPage from './ToDosPage';
import type { ToDo } from '@/types/schema';

// TodoRow's SwipeActionRow reads the resolved theme from ThemeContext.
// MemoryRouter: ToDosPage uses useSearchParams() for the ?todo= deep-link.
const render = (ui: ReactElement) => rtlRender(<MemoryRouter><ThemeProvider>{ui}</ThemeProvider></MemoryRouter>);
import { useTodos, useHouseholdCore, type TodosContextValue, type HouseholdCoreContextValue } from '@/contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '@/utils/exportUtils';
import { format, subDays, addDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: vi.fn(),
  useHouseholdCore: vi.fn(),
  // Habit Automations (PRD #1065): the "Counts toward habit" picker reads
  // habits from this slice. Default to none so existing tests are unaffected.
  useGamification: vi.fn(() => ({ habits: [] })),
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
  Camera: () => <div data-testid="camera-icon" />,
  ImageUp: () => <div data-testid="imageup-icon" />,
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
  Star: () => <div data-testid="star-icon" />,
  LayoutGrid: () => <div data-testid="layout-grid-icon" />,
  List: () => <div data-testid="list-icon" />,
  Rows3: () => <div data-testid="rows3-icon" />,
  Grid2x2: () => <div data-testid="grid2x2-icon" />,
  Smartphone: () => <div data-testid="smartphone-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
  GripVertical: () => <div data-testid="grip-vertical-icon" />,
  UserPlus: () => <div data-testid="user-plus-icon" />,
  ListChecks: () => <div data-testid="list-checks-icon" />,
  Repeat: () => <div data-testid="repeat-icon" />,
  Filter: () => <div data-testid="filter-icon" />,
  Tag: () => <div data-testid="tag-icon" />,
  ArrowUpDown: () => <div data-testid="arrow-up-down-icon" />,
  Info: () => <div data-testid="info-icon" />,
  // data/templateIcons.ts — pulled in transitively by TaskTemplateDrawer.
  ShoppingBag: () => <div data-testid="shoppingbag-icon" />,
  Coffee: () => <div data-testid="coffee-icon" />,
  Baby: () => <div data-testid="baby-icon" />,
  Home: () => <div data-testid="home-icon" />,
  Utensils: () => <div data-testid="utensils-icon" />,
  Zap: () => <div data-testid="zap-icon" />,
  Car: () => <div data-testid="car-icon" />,
  Dog: () => <div data-testid="dog-icon" />,
  Gift: () => <div data-testid="gift-icon" />,
  Briefcase: () => <div data-testid="briefcase-icon" />,
  Apple: () => <div data-testid="apple-icon" />,
  Beer: () => <div data-testid="beer-icon" />,
  Book: () => <div data-testid="book-icon" />,
  Cake: () => <div data-testid="cake-icon" />,
  Cat: () => <div data-testid="cat-icon" />,
  CreditCard: () => <div data-testid="creditcard-icon" />,
  Dumbbell: () => <div data-testid="dumbbell-icon" />,
  Flower: () => <div data-testid="flower-icon" />,
  Gamepad: () => <div data-testid="gamepad-icon" />,
  Hammer: () => <div data-testid="hammer-icon" />,
  Heart: () => <div data-testid="heart-icon" />,
  Laptop: () => <div data-testid="laptop-icon" />,
  Lightbulb: () => <div data-testid="lightbulb-icon" />,
  Map: () => <div data-testid="map-icon" />,
  Music: () => <div data-testid="music-icon" />,
  Package: () => <div data-testid="package-icon" />,
  Palette: () => <div data-testid="palette-icon" />,
  Pill: () => <div data-testid="pill-icon" />,
  Pizza: () => <div data-testid="pizza-icon" />,
  Plane: () => <div data-testid="plane-icon" />,
  Shirt: () => <div data-testid="shirt-icon" />,
  Snowflake: () => <div data-testid="snowflake-icon" />,
  Sofa: () => <div data-testid="sofa-icon" />,
  Sun: () => <div data-testid="sun-icon" />,
  Tent: () => <div data-testid="tent-icon" />,
  Train: () => <div data-testid="train-icon" />,
  Truck: () => <div data-testid="truck-icon" />,
  Tv: () => <div data-testid="tv-icon" />,
  Umbrella: () => <div data-testid="umbrella-icon" />,
  Wine: () => <div data-testid="wine-icon" />,
  Wrench: () => <div data-testid="wrench-icon" />,
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

  const mockTodos: ToDo[] = [
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
  const mockUncompleteToDo = vi.fn();

  const setup = (todos = mockTodos, members = mockMembers) => {
    setHouseholdMock({
      todos,
      members: members,
      currentUser: members[0] ?? null,
      addToDo: mockAddToDo,
      updateToDo: mockUpdateToDo,
      deleteToDo: mockDeleteToDo,
      completeToDo: mockCompleteToDo,
      uncompleteToDo: mockUncompleteToDo,
      taskTemplates: [],
      addTaskTemplate: vi.fn(),
      updateTaskTemplate: vi.fn(),
      deleteTaskTemplate: vi.fn(),
      applyTaskTemplate: vi.fn(),
      // F-TODO-16: category vocabulary. Empty by default so the category
      // filter control stays hidden and existing expectations are unaffected.
      todoCategories: [],
      updateTodoCategories: vi.fn(),
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

  // Creation entry points beyond the quick-add bar live in the single page
  // kebab menu ("Add" group): Full details / From template / Scan a list.
  const openFullAddForm = () => {
    openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add new task with full details' }));
  };
  // The Active/Completed toggle is now a "View" radio group in the same menu.
  const switchToCompleted = () => {
    openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Completed \(\d+\)/ }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // The sort mode persists to localStorage — clear it so a test that picks a
    // non-default sort can't leak ordering into later tests.
    window.localStorage.clear();
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
      expect(screen.getByLabelText('Cancel selection')).toBeInTheDocument();
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
      fireEvent.click(screen.getByText('Delete all'));

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
      openFullAddForm();

      fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'New Test Task' } });
      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: today } });

      // Select assignee (user1)
      fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'user1' } });

      fireEvent.click(screen.getByText('Create task'));

      await waitFor(() => {
        expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
          text: 'New Test Task',
          completeByDate: today,
          assignedTo: 'user1'
        }));
      });
    });

    it('lists Full details / From template / Scan a list in the page kebab menu', () => {
      setup();
      openOverflowMenu();
      expect(screen.getByRole('menuitem', { name: 'Add new task with full details' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Add tasks from a template' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Scan a list' })).toBeInTheDocument();
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

    it('duplicates a task from the Task-options drawer (context-menu on the row body)', async () => {
        setup();
        // Row actions moved into the options drawer — opened by long-press on
        // touch, or right-click / the context-menu key elsewhere.
        fireEvent.contextMenu(screen.getByRole('button', { name: 'Edit task: Overdue Task' }));
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

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

          // Switch to completed view via the kebab's View radio group
          switchToCompleted();

          // Check if Completed Task is visible
          expect(screen.getByText('Completed Task')).toBeInTheDocument();

          // Check if Active tasks are NOT visible
          expect(screen.queryByText('Overdue Task')).not.toBeInTheDocument();
      });

      it('restores a completed task to active', async () => {
          setup();
          switchToCompleted();

          // Click restore (uncomplete) button
          const restoreBtn = screen.getByTitle('Mark as incomplete');
          fireEvent.click(restoreBtn);

          await waitFor(() => {
              // Restore routes through uncompleteToDo (atomic kid-points
              // reversal), NOT a plain updateToDo. The second arg is the
              // optional subtasks-override (undefined for a plain restore).
              expect(mockUncompleteToDo).toHaveBeenCalledWith('3', undefined);
          });
      });

      it('duplicates a completed task', async () => {
          setup();
          switchToCompleted();

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
      openFullAddForm();

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
        taskTemplates: [],
        addTaskTemplate: vi.fn(),
        updateTaskTemplate: vi.fn(),
        deleteTaskTemplate: vi.fn(),
        applyTaskTemplate: vi.fn(),
        todoCategories: [],
        updateTodoCategories: vi.fn(),
      });
      render(<ToDosPage />);

      openFullAddForm();

      // Button should be disabled or show error on click if not disabled
      const createBtn = screen.getByText('Create task');
      expect(createBtn).toBeDisabled();

      expect(screen.getByText('No household members available to assign this task.')).toBeInTheDocument();
    });
  });

  describe('Completed history buckets', () => {
    it('collapses This week and Older by default while Completed today stays expanded', () => {
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
        switchToCompleted();

        // Recent bucket stays expanded; older buckets are collapsed.
        expect(screen.getByText('Done Today')).toBeInTheDocument();
        expect(screen.queryByText('Done Tuesday')).not.toBeInTheDocument();
        expect(screen.queryByText('Done Long Ago')).not.toBeInTheDocument();

        // Expanding This week reveals its rows.
        const weekToggle = screen.getByRole('button', { name: /This week/ });
        expect(weekToggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(weekToggle);
        expect(weekToggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Done Tuesday')).toBeInTheDocument();

        // Older expands independently.
        fireEvent.click(screen.getByRole('button', { name: /Older/ }));
        expect(screen.getByText('Done Long Ago')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Flat list, filter, and landscape grid', () => {
    const originalMatchMedia = window.matchMedia;

    // jsdom has no matchMedia; useIsLandscape guards its absence (→ portrait).
    // Installing this stub lets tests choose the orientation. It's stateful:
    // `rotateTo` flips the stored orientation and fires the registered mql
    // 'change' listeners so useMediaQuery/useSyncExternalStore re-reads — the
    // same signal a real device rotation produces.
    const orientation = { landscape: false };
    type MqlChangeListener = (e: { matches: boolean; media: string }) => void;
    const changeListeners = new Set<MqlChangeListener>();
    const setOrientation = (landscape: boolean) => {
      orientation.landscape = landscape;
      changeListeners.clear();
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          get matches() {
            return query === '(orientation: landscape)' ? orientation.landscape : false;
          },
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: (_type: string, cb: MqlChangeListener) => { changeListeners.add(cb); },
          removeEventListener: (_type: string, cb: MqlChangeListener) => { changeListeners.delete(cb); },
          dispatchEvent: vi.fn(),
        })),
      });
    };
    // Simulate a device rotation AFTER render (setOrientation only sets the
    // initial state — components subscribed via addEventListener need the
    // change event to notice).
    const rotateTo = (landscape: boolean) => {
      orientation.landscape = landscape;
      act(() => {
        // Real MediaQueryList listeners receive a MediaQueryListEvent.
        changeListeners.forEach(cb => cb({ matches: landscape, media: '(orientation: landscape)' }));
      });
    };

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });

    // Quadrant fixture: one task per Eisenhower quadrant. Urgent = overdue /
    // today / tomorrow; important = the isImportant star.
    const farOut = format(addDays(startOfToday(), 7), 'yyyy-MM-dd');
    const quadrantTodos = [
      { id: 'q1', text: 'Do First Task', completeByDate: today, assignedTo: 'user1', isCompleted: false, isImportant: true, createdBy: 'user1', createdAt: new Date().toISOString() },
      { id: 'q2', text: 'Schedule Task', completeByDate: farOut, assignedTo: 'user1', isCompleted: false, isImportant: true, createdBy: 'user1', createdAt: new Date().toISOString() },
      { id: 'q3', text: 'Delegate Task', completeByDate: yesterday, assignedTo: 'user1', isCompleted: false, createdBy: 'user1', createdAt: new Date().toISOString() },
      { id: 'q4', text: 'Later Task', completeByDate: farOut, assignedTo: 'user2', isCompleted: false, createdBy: 'user1', createdAt: new Date().toISOString() },
    ];

    it('renders the flat list in spec order: starred first, then overdue → ascending date', () => {
      setOrientation(false);
      setup(quadrantTodos);

      // Starred group (q1 today, q2 far out) before unstarred (q3 overdue, q4 far out).
      const rowLabels = screen
        .getAllByRole('button', { name: /^Edit task:/ })
        .map(b => b.getAttribute('aria-label'));
      expect(rowLabels).toEqual([
        'Edit task: Do First Task',
        'Edit task: Schedule Task',
        'Edit task: Delegate Task',
        'Edit task: Later Task',
      ]);
      // No section headings anymore — one flat list.
      expect(screen.queryByText('Immediate')).not.toBeInTheDocument();
      expect(screen.queryByText('Do First')).not.toBeInTheDocument();
    });

    it('shows the amber star (with sr-only "Important") only on starred rows', () => {
      setOrientation(false);
      setup(quadrantTodos);

      // Exactly the two starred fixtures carry the star.
      expect(screen.getAllByTestId('todo-important-star')).toHaveLength(2);
      // The meta line (star, due, pill, assignee) is now a SIBLING of the edit
      // button — not nested inside it — so query within the shared row body
      // container (the button's parent) rather than the button itself.
      const starredBody = screen.getByRole('button', { name: 'Edit task: Do First Task' }).parentElement as HTMLElement;
      expect(within(starredBody).getByText('Important')).toBeInTheDocument();
      const plainBody = screen.getByRole('button', { name: 'Edit task: Delegate Task' }).parentElement as HTMLElement;
      expect(within(plainBody).queryByTestId('todo-important-star')).not.toBeInTheDocument();
    });

    it('renders the quick-add bar as the first row of the list card', () => {
      setOrientation(false);
      setup(quadrantTodos);

      const quickAdd = screen.getByLabelText('Quick add task');
      const firstRow = screen.getAllByRole('button', { name: /^Edit task:/ })[0]!;
      // The add row precedes every task row in document order.
      expect(
        quickAdd.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      // Its secondary affordance is the single page kebab.
      expect(screen.getByRole('button', { name: 'To-do list actions' })).toBeInTheDocument();
    });

    it('filters by person via the title-row filter popover', () => {
      setOrientation(false);
      setup();

      fireEvent.click(screen.getByRole('button', { name: 'Filter by person' }));
      const menu = screen.getByRole('menu', { name: 'Filter by person' });
      expect(within(menu).getByRole('menuitemradio', { name: 'Everyone' })).toHaveAttribute('aria-checked', 'true');
      expect(within(menu).getByRole('menuitemradio', { name: 'Filter to Alice Smith' })).toHaveAttribute('aria-checked', 'false');

      // Choose Bob — only his tasks stay visible, and the trigger becomes an
      // accent pill with his name + an inline clear.
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Filter to Bob Jones' }));
      expect(screen.getByText('Today Task')).toBeInTheDocument(); // user2
      expect(screen.queryByText('Overdue Task')).not.toBeInTheDocument(); // user1

      // Reopening marks Bob as the active choice; the inline clear restores all.
      fireEvent.click(screen.getByRole('button', { name: 'Filter by person: Bob Jones' }));
      expect(screen.getByRole('menuitemradio', { name: 'Filter to Bob Jones' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Clear person filter' }));
      expect(screen.getByText('Overdue Task')).toBeInTheDocument();
    });

    it('re-sorts the flat list via the title-row sort popover', () => {
      setOrientation(false);
      setup(quadrantTodos);

      // Default: important first (tinted off), menu marks it checked.
      fireEvent.click(screen.getByRole('button', { name: 'Sort: Important first' }));
      const menu = screen.getByRole('menu', { name: 'Sort tasks' });
      expect(within(menu).getByRole('menuitemradio', { name: 'Important first' })).toHaveAttribute('aria-checked', 'true');

      // Switch to due-date order: stars no longer jump the queue.
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Due date' }));
      const rows = screen.getAllByRole('button', { name: /^Edit task:/ });
      const titles = rows.map(r => r.textContent);
      const idxUrgentUnstarred = titles.findIndex(t => t?.includes('Delegate Task'));
      const idxStarredLater = titles.findIndex(t => t?.includes('Schedule Task'));
      expect(idxUrgentUnstarred).toBeGreaterThanOrEqual(0);
      expect(idxStarredLater).toBeGreaterThanOrEqual(0);
      // Overdue unstarred (Delegate, yesterday) must precede far-future starred
      // (Schedule, +7 days) once stars are ignored by the 'due' mode.
      expect(idxUrgentUnstarred).toBeLessThan(idxStarredLater);
      // The trigger reflects the new mode.
      expect(screen.getByRole('button', { name: 'Sort: Due date' })).toBeInTheDocument();
    });

    it('shows the grid automatically when mounted in landscape, and rotating back returns the list', () => {
      setOrientation(true);
      setup(quadrantTodos);

      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();

      rotateTo(false);
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      expect(screen.getByText('Do First Task')).toBeInTheDocument(); // flat list
    });

    it('shows the grid when rotating to landscape after mounting in portrait', () => {
      setOrientation(false);
      setup(quadrantTodos);

      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      rotateTo(true);
      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
    });

    it('does not auto-show the grid in landscape while selection mode is active', () => {
      setOrientation(false);
      setup(quadrantTodos);
      enterSelectionMode();

      rotateTo(true);
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
    });

    it('renders all four quadrant cells with correct task placement in landscape', () => {
      setOrientation(true);
      setup(quadrantTodos);

      expect(within(screen.getByTestId('grid-cell-do')).getByText('Do First Task')).toBeInTheDocument();
      expect(within(screen.getByTestId('grid-cell-schedule')).getByText('Schedule Task')).toBeInTheDocument();
      expect(within(screen.getByTestId('grid-cell-delegate')).getByText('Delegate Task')).toBeInTheDocument();
      expect(within(screen.getByTestId('grid-cell-later')).getByText('Later Task')).toBeInTheDocument();
    });

    it('keeps an empty cell rendered with a placeholder so the 2×2 shape stays stable', () => {
      setOrientation(true);
      // Only one quadrant populated — the other three stay as empty cells.
      setup([quadrantTodos[0]!]);

      expect(screen.getByTestId('grid-cell-later')).toBeInTheDocument();
      expect(screen.getAllByText('Nothing here')).toHaveLength(3);
    });

    it('renders the grid as an immersive full-screen overlay in landscape', () => {
      setOrientation(true);
      setup(quadrantTodos);

      const overlay = screen.getByRole('region', { name: 'Eisenhower matrix' });
      expect(overlay).toHaveAttribute('data-testid', 'grid-overlay');
      // All four quadrant cells live inside the overlay.
      ['do', 'schedule', 'delegate', 'later'].forEach(q => {
        expect(within(overlay).getByTestId(`grid-cell-${q}`)).toBeInTheDocument();
      });
      expect(within(overlay).getByRole('button', { name: 'Exit matrix view' })).toBeInTheDocument();
    });

    it('✕ hides the grid until the next rotation cycle', () => {
      setOrientation(true);
      setup(quadrantTodos);

      fireEvent.click(screen.getByRole('button', { name: 'Exit matrix view' }));

      // Still landscape: the grid stays dismissed and the flat list shows.
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      expect(screen.getByText('Do First Task')).toBeInTheDocument();

      // Rotating to portrait resets the dismissal; the next landscape rotation
      // shows the grid again.
      rotateTo(false);
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      rotateTo(true);
      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
    });

    it('exits the overlay on Escape', () => {
      setOrientation(true);
      setup(quadrantTodos);

      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
    });

    it('does NOT exit on Escape while the edit drawer is open above the grid', () => {
      setOrientation(true);
      setup(quadrantTodos);

      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(screen.getByText('Edit task')).toBeInTheDocument();

      // Escape here belongs to the drawer — the grid overlay must stay put.
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
    });

    it('locks body scroll while the overlay is shown and restores it on exit', () => {
      setOrientation(true);
      setup(quadrantTodos);

      expect(document.body.style.overflow).toBe('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Exit matrix view' }));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('keeps body scroll locked when rotating to portrait while the edit drawer is open, and restores it when the drawer closes', () => {
      setOrientation(true);
      setup(quadrantTodos);

      // Overlay locks; drawer opens above it (Drawer adds its own lock).
      expect(document.body.style.overflow).toBe('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(screen.getByText('Edit task')).toBeInTheDocument();

      // Rotate to portrait: the overlay unmounts (flat list shows) but the
      // drawer is still open — the page-level latch must HOLD the lock.
      rotateTo(false);
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('hidden');

      // Close the drawer: now everything is closed — lock fully released.
      fireEvent.click(screen.getByLabelText('Close drawer'));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('does not auto-show the grid while a drawer is open, shows it after the drawer closes, and releases the lock cleanly', () => {
      // A drawer already holds the body-scroll lock when the device rotates:
      // the grid must NOT auto-show over it. Once the drawer closes (still
      // landscape) the grid appears — and the latch, having engaged after the
      // drawer's lock, must still fully release on exit (clear, not
      // capture-and-restore 'hidden').
      setOrientation(false);
      setup(quadrantTodos);

      // Open the action drawer from the flat list (context-menu on the row
      // body) — Drawer locks body scroll.
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(document.body.style.overflow).toBe('hidden');

      // Rotate to landscape with the drawer open: no grid.
      rotateTo(true);
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();

      // Close the drawer: the blocking layer is gone, so the grid appears and
      // the latch takes over the lock.
      fireEvent.click(screen.getByLabelText('Close drawer'));
      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
      expect(document.body.style.overflow).toBe('hidden');

      // Exit the grid — nothing holds a lock anymore.
      fireEvent.click(screen.getByRole('button', { name: 'Exit matrix view' }));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('focuses the exit button when the overlay mounts', () => {
      setOrientation(true);
      setup(quadrantTodos);

      expect(screen.getByRole('button', { name: 'Exit matrix view' })).toHaveFocus();
    });

    it('opens the edit drawer when a grid chip body is tapped', () => {
      setOrientation(true);
      setup(quadrantTodos);

      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(screen.getByText('Edit task')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Do First Task')).toBeInTheDocument();
    });
  });

  describe('Progressive disclosure ("More options")', () => {
    const moreOptionsButton = () => screen.getByRole('button', { name: 'More options' });

    it('is collapsed by default when creating a new task', () => {
      setup();
      openFullAddForm();

      expect(moreOptionsButton()).toHaveAttribute('aria-expanded', 'false');
      // The section stays mounted (so aria-controls always resolves) but is
      // hidden while collapsed.
      expect(screen.getByLabelText('Notes')).not.toBeVisible();
      expect(screen.getByLabelText('Repeat')).not.toBeVisible();
    });

    it('stays collapsed when editing a task with no secondary fields', () => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Today Task' }));

      expect(moreOptionsButton()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByLabelText('Notes')).not.toBeVisible();
    });

    it('auto-expands when editing a task that has notes', () => {
      setup([
        { ...mockTodos[0]!, id: 'n1', text: 'Notes Task', notes: 'call the office first' },
        ...mockTodos.slice(1),
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Notes Task' }));

      expect(moreOptionsButton()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByDisplayValue('call the office first')).toBeInTheDocument();
    });

    it('auto-expands for a zero-minute ("at due time") reminder', () => {
      setup([
        { ...mockTodos[0]!, id: 'r1', text: 'Reminder Task', dueTime: '09:00', reminderMinutesBefore: 0 },
        ...mockTodos.slice(1),
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Reminder Task' }));

      expect(moreOptionsButton()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByLabelText('Reminder')).toHaveValue('0');
    });

    it('keeps a value set before collapsing (collapse does not clear state)', () => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Today Task' }));

      fireEvent.click(moreOptionsButton());
      fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'hidden but saved' } });
      fireEvent.click(moreOptionsButton()); // collapse again
      fireEvent.click(screen.getByText('Save changes'));

      expect(mockUpdateToDo).toHaveBeenCalledWith(
        '2',
        expect.objectContaining({ notes: 'hidden but saved' })
      );
    });
  });
});
