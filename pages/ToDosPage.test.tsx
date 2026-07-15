import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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
  ListChecks: () => <div data-testid="list-checks-icon" />,
  Repeat: () => <div data-testid="repeat-icon" />,
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
      taskTemplates: [],
      addTaskTemplate: vi.fn(),
      updateTaskTemplate: vi.fn(),
      deleteTaskTemplate: vi.fn(),
      applyTaskTemplate: vi.fn(),
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
        taskTemplates: [],
        addTaskTemplate: vi.fn(),
        updateTaskTemplate: vi.fn(),
        deleteTaskTemplate: vi.fn(),
        applyTaskTemplate: vi.fn(),
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

  describe('Arrangement views (list / matrix / grid)', () => {
    const ARRANGEMENT_KEY = 'lifebalance:todos-view';
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

    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
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

    it('cycles list → matrix → grid → list and persists each step to localStorage', () => {
      setOrientation(true);
      // Use the quadrant fixture so every stacked section has an item — the
      // quick-add bar now lives in a page-level sticky card, so an empty
      // quadrant section (like "Do First") collapses away instead of being
      // kept alive by the add row.
      setup(quadrantTodos);

      // Default: list arrangement — the toggle offers the prioritized list next.
      fireEvent.click(screen.getByRole('button', { name: 'Switch to prioritized list' }));
      expect(localStorage.getItem(ARRANGEMENT_KEY)).toBe('matrix');
      expect(screen.getByText('Do First')).toBeInTheDocument(); // stacked quadrant sections

      fireEvent.click(screen.getByRole('button', { name: 'Switch to matrix grid' }));
      expect(localStorage.getItem(ARRANGEMENT_KEY)).toBe('grid');
      expect(screen.getByTestId('grid-cell-do')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Switch to standard list' }));
      expect(localStorage.getItem(ARRANGEMENT_KEY)).toBe('list');
      expect(screen.getByText('Immediate')).toBeInTheDocument();
    });

    it('falls back to the list arrangement when the stored value is invalid', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'bogus');
      setup();
      expect(screen.getByRole('button', { name: 'Switch to prioritized list' })).toBeInTheDocument();
      expect(screen.getByText('Immediate')).toBeInTheDocument();
    });

    it('shows a rotate prompt in grid arrangement while portrait', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(false);
      setup();

      expect(screen.getByText('Rotate your phone')).toBeInTheDocument();
      expect(screen.queryByTestId('grid-cell-do')).not.toBeInTheDocument();
    });

    it('renders all four quadrant cells with correct task placement in landscape', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      expect(within(screen.getByTestId('grid-cell-do')).getByText('Do First Task')).toBeInTheDocument();
      expect(within(screen.getByTestId('grid-cell-schedule')).getByText('Schedule Task')).toBeInTheDocument();
      expect(within(screen.getByTestId('grid-cell-delegate')).getByText('Delegate Task')).toBeInTheDocument();
      expect(within(screen.getByTestId('grid-cell-later')).getByText('Later Task')).toBeInTheDocument();
    });

    it('keeps an empty cell rendered with a placeholder so the 2×2 shape stays stable', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      // Only one quadrant populated — the other three stay as empty cells.
      setup([quadrantTodos[0]!]);

      expect(screen.getByTestId('grid-cell-later')).toBeInTheDocument();
      expect(screen.getAllByText('Nothing here')).toHaveLength(3);
    });

    it('renders the grid as an immersive full-screen overlay in landscape', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
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

    it('exits to the list arrangement (persisted) when ✕ is clicked', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      fireEvent.click(screen.getByRole('button', { name: 'Exit matrix view' }));

      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      expect(localStorage.getItem(ARRANGEMENT_KEY)).toBe('list');
      expect(screen.getByText('Immediate')).toBeInTheDocument();
    });

    it('exits the overlay on Escape', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      expect(localStorage.getItem(ARRANGEMENT_KEY)).toBe('list');
    });

    it('does NOT exit on Escape while the edit drawer is open above the grid', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(screen.getByText('Edit task')).toBeInTheDocument();

      // Escape here belongs to the drawer — the grid overlay must stay put.
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
      expect(localStorage.getItem(ARRANGEMENT_KEY)).toBe('grid');
    });

    it('locks body scroll while the overlay is shown and restores it on exit', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      expect(document.body.style.overflow).toBe('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Exit matrix view' }));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('keeps body scroll locked when rotating to portrait while the edit drawer is open, and restores it when the drawer closes', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      // Overlay locks; drawer opens above it (Drawer adds its own lock).
      expect(document.body.style.overflow).toBe('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(screen.getByText('Edit task')).toBeInTheDocument();

      // Rotate to portrait: the overlay unmounts (rotate prompt shows) but the
      // drawer is still open — the page-level latch must HOLD the lock.
      rotateTo(false);
      expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
      expect(screen.getByText('Rotate your phone')).toBeInTheDocument();
      expect(document.body.style.overflow).toBe('hidden');

      // Close the drawer: now everything is closed — lock fully released.
      fireEvent.click(screen.getByLabelText('Close drawer'));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('releases body scroll even when the latch engaged while a drawer already held the lock', () => {
      // The inverse race: the overlay appears while a Drawer has already set
      // body overflow to 'hidden'. If the latch captured-and-restored that
      // value, release would re-pin 'hidden' forever; it must clear instead.
      localStorage.setItem(ARRANGEMENT_KEY, 'list');
      setOrientation(true);
      setup(quadrantTodos);

      // Open the action drawer from the list view — Drawer locks body scroll.
      fireEvent.click(screen.getByRole('button', { name: 'More options for: Do First Task' }));
      expect(document.body.style.overflow).toBe('hidden');

      // Cycle list → matrix → grid while the drawer is open: the overlay
      // mounts and the latch engages on top of the drawer's existing lock.
      fireEvent.click(screen.getByRole('button', { name: 'Switch to prioritized list' }));
      fireEvent.click(screen.getByRole('button', { name: 'Switch to matrix grid' }));
      expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();

      // Close the drawer, then exit the grid — nothing holds a lock anymore.
      fireEvent.click(screen.getByLabelText('Close drawer'));
      fireEvent.click(screen.getByRole('button', { name: 'Exit matrix view' }));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('focuses the exit button when the overlay mounts', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      expect(screen.getByRole('button', { name: 'Exit matrix view' })).toHaveFocus();
    });

    it('opens the edit drawer when a grid chip body is tapped', () => {
      localStorage.setItem(ARRANGEMENT_KEY, 'grid');
      setOrientation(true);
      setup(quadrantTodos);

      fireEvent.click(screen.getByRole('button', { name: 'Edit task: Do First Task' }));
      expect(screen.getByText('Edit task')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Do First Task')).toBeInTheDocument();
    });
  });
});
