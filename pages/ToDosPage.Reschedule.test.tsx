import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ToDosPage from './ToDosPage';

// TodoRow's SwipeActionRow reads the resolved theme from ThemeContext.
const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);
import { useTodos, useHouseholdCore, type TodosContextValue, type HouseholdCoreContextValue } from '@/contexts/FirebaseHouseholdContext';
import { format, addDays, startOfToday } from 'date-fns';

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
  ListChecks: () => <div data-testid="list-checks-icon" />,
  Repeat: () => <div data-testid="repeat-icon" />,
  Filter: () => <div data-testid="filter-icon" />,
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
      taskTemplates: [],
      addTaskTemplate: vi.fn(),
      updateTaskTemplate: vi.fn(),
      deleteTaskTemplate: vi.fn(),
      applyTaskTemplate: vi.fn(),
    });
    render(<ToDosPage />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves a single task to tomorrow via the Task-options drawer', async () => {
    setup();
    // Row actions moved into the options drawer — opened by long-press on
    // touch, or right-click / the context-menu key elsewhere.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Edit task: Task 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to tomorrow' }));

    await waitFor(() => {
      expect(mockUpdateToDo).toHaveBeenCalledWith('1', {
        completeByDate: tomorrow
      });
    });
  });

  it('batch reschedules selected tasks', async () => {
    setup();
    // Enter selection mode via the overflow menu
    fireEvent.click(screen.getByRole('button', { name: 'To-do list actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Select multiple/i }));

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
