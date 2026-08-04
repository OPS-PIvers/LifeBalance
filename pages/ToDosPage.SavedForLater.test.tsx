/**
 * "Saved for later" — the parked section on the To-Dos page.
 *
 * Covers the three page-level rules the section exists to enforce:
 *   1. it obeys the page's live filters, and says so ("3 of 12") when they narrow it;
 *   2. it always renders (header + add bar), so direct-add is reachable at zero;
 *   3. in selection mode a parked row is selectable for DELETE ONLY — Complete
 *      and Reschedule disappear, because a parked item is not completable and
 *      has no real due date to reschedule.
 *
 * Unlike ToDosPage.test.tsx this does NOT mock lucide-react: the parked row's
 * leading control is a `Plus` glyph and the section header a `ChevronDown`, and
 * a blanket icon mock would let a missing icon pass unnoticed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ToDosPage from './ToDosPage';
import type { ToDo } from '@/types/schema';
import {
  useTodos,
  useHouseholdCore,
  type TodosContextValue,
  type HouseholdCoreContextValue,
} from '@/contexts/FirebaseHouseholdContext';
import { format, startOfToday } from 'date-fns';

const render = (ui: ReactElement) =>
  rtlRender(<MemoryRouter><ThemeProvider>{ui}</ThemeProvider></MemoryRouter>);

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: vi.fn(),
  useHouseholdCore: vi.fn(),
  useGamification: vi.fn(() => ({ habits: [] })),
}));

vi.mock('@/utils/exportUtils', () => ({ generateCsvExport: vi.fn() }));
vi.mock('@/utils/toastHelpers', () => ({ showDeleteConfirmation: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const today = format(startOfToday(), 'yyyy-MM-dd');

const members = [
  { uid: 'user1', displayName: 'Alice Smith', role: 'member' as const, points: { daily: 0, weekly: 0, total: 0 } },
  { uid: 'user2', displayName: 'Bob Jones', role: 'member' as const, points: { daily: 0, weekly: 0, total: 0 } },
];

const activeTodo: ToDo = {
  id: 'active-1',
  text: 'Active task',
  completeByDate: today,
  assignedTo: 'user1',
  isCompleted: false,
  createdBy: 'user1',
  createdAt: new Date().toISOString(),
};

/** A parked to-do: the stored date is the inert placeholder, never a real one. */
const parked = (id: string, text: string, extra: Partial<ToDo> = {}): ToDo => ({
  id,
  text,
  completeByDate: today,
  isCompleted: false,
  savedForLater: true,
  createdBy: 'user1',
  createdAt: new Date().toISOString(),
  ...extra,
});

const mockAddSavedForLaterTodo = vi.fn(() => Promise.resolve());
const mockDeleteToDo = vi.fn(() => Promise.resolve());
const mockCompleteToDo = vi.fn(() => Promise.resolve());
const mockPromoteTodo = vi.fn(() => Promise.resolve());

const setup = (savedForLaterTodos: ToDo[], todos: ToDo[] = [activeTodo]) => {
  const value = {
    todos,
    savedForLaterTodos,
    members,
    currentUser: members[0],
    addToDo: vi.fn(),
    addSavedForLaterTodo: mockAddSavedForLaterTodo,
    updateToDo: vi.fn(),
    deleteToDo: mockDeleteToDo,
    completeToDo: mockCompleteToDo,
    uncompleteToDo: vi.fn(),
    toggleTodoSubtask: vi.fn(),
    promoteTodo: mockPromoteTodo,
    parkTodo: vi.fn(),
    taskTemplates: [],
    addTaskTemplate: vi.fn(),
    updateTaskTemplate: vi.fn(),
    deleteTaskTemplate: vi.fn(),
    applyTaskTemplate: vi.fn(),
    todoCategories: ['Home', 'Work'],
    updateTodoCategories: vi.fn(),
  };
  vi.mocked(useTodos).mockReturnValue(value as unknown as TodosContextValue);
  vi.mocked(useHouseholdCore).mockReturnValue(value as unknown as HouseholdCoreContextValue);
  render(<ToDosPage />);
};

const parkedSection = () => screen.getByRole('region', { name: 'Saved for later' });

const enterSelectionMode = () => {
  fireEvent.click(screen.getByRole('button', { name: 'To-do list actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Select multiple/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('ToDosPage — Saved for later section', () => {
  it('always renders the header and add bar, even with nothing parked', () => {
    setup([]);
    const section = parkedSection();
    expect(within(section).getByText('Saved for later')).toBeInTheDocument();
    expect(within(section).getByLabelText('Save a task for later')).toBeInTheDocument();
    expect(within(section).getByText(/Nothing parked yet/)).toBeInTheDocument();
  });

  it('shows a plain total when nothing narrows the list', () => {
    setup([parked('p1', 'Bike rack'), parked('p2', 'Bread machine')]);
    expect(within(parkedSection()).getByText('· 2')).toBeInTheDocument();
  });

  it('reads "N of M" when the page filters narrow it', async () => {
    setup([
      parked('p1', 'Assigned to Alice', { assignedTo: 'user1' }),
      parked('p2', 'Unassigned idea'),
      parked('p3', 'Another unassigned idea'),
    ]);
    // Plain total to begin with.
    expect(within(parkedSection()).getByText('· 3')).toBeInTheDocument();

    // Apply the page's PERSON filter — parked items usually carry no assignee,
    // so this is exactly the case the "N of M" mitigation exists for.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by person' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Filter to Alice Smith' }));

    await waitFor(() => {
      expect(within(parkedSection()).getByText('· 1 of 3')).toBeInTheDocument();
    });
    expect(within(parkedSection()).getByText('Assigned to Alice')).toBeInTheDocument();
    expect(within(parkedSection()).queryByText('Unassigned idea')).toBeNull();
  });

  it('parks a thought straight from its own add bar', async () => {
    setup([]);
    const input = within(parkedSection()).getByLabelText('Save a task for later');
    fireEvent.change(input, { target: { value: 'Look into a bike rack' } });
    fireEvent.click(within(parkedSection()).getByRole('button', { name: 'Save for later' }));

    await waitFor(() => {
      expect(mockAddSavedForLaterTodo).toHaveBeenCalledWith('Look into a bike rack');
    });
  });

  it('collapses (session-only) and hides its rows from the a11y tree', () => {
    setup([parked('p1', 'Bike rack')]);
    const toggle = within(parkedSection()).getByRole('button', { name: /Saved for later/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // `hidden` (not unmounted), so the header's aria-controls target still exists.
    const content = document.getElementById('saved-for-later-content');
    expect(content).not.toBeNull();
    expect(content).toHaveAttribute('hidden');
  });

  it('renders parked rows with a promote control and no due-date label', () => {
    setup([parked('p1', 'Bike rack')]);
    const section = parkedSection();
    expect(
      within(section).getByRole('button', { name: 'Add to your list: Bike rack' }),
    ).toBeInTheDocument();
    expect(within(section).queryByTestId('todo-due-label')).toBeNull();
    expect(within(section).queryByRole('checkbox')).toBeNull();
  });

  it('opens the promote sheet from the + control', async () => {
    setup([parked('p1', 'Bike rack')]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to your list: Bike rack' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add to list' })).toBeInTheDocument();
    });
    // The sheet is the ONLY promotion path, and its due date starts empty.
    expect(screen.getByRole('button', { name: 'Add to list' })).toBeDisabled();
  });

  describe('selection mode', () => {
    it('offers Delete but NOT Complete or Reschedule once a parked row is selected', () => {
      setup([parked('p1', 'Bike rack')]);
      enterSelectionMode();

      fireEvent.click(screen.getByRole('button', { name: 'Select task: Bike rack' }));

      expect(screen.getByRole('button', { name: 'Delete selected items' })).toBeInTheDocument();
      // A parked item is not completable and has no real due date — offering
      // either control (even disabled) would be a control that lies.
      expect(screen.queryByRole('button', { name: 'Mark selected as completed' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reschedule selected items' })).toBeNull();
    });

    it('positive control: an ACTIVE-only selection keeps Complete and Reschedule', () => {
      setup([parked('p1', 'Bike rack')]);
      enterSelectionMode();

      fireEvent.click(screen.getByRole('button', { name: 'Select task: Active task' }));

      expect(screen.getByRole('button', { name: 'Mark selected as completed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reschedule selected items' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete selected items' })).toBeInTheDocument();
    });

    it('a mixed selection is treated as parked — the delete-only rule wins', () => {
      setup([parked('p1', 'Bike rack')]);
      enterSelectionMode();

      fireEvent.click(screen.getByRole('button', { name: 'Select task: Active task' }));
      fireEvent.click(screen.getByRole('button', { name: 'Select task: Bike rack' }));

      expect(screen.queryByRole('button', { name: 'Mark selected as completed' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reschedule selected items' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Delete selected items' })).toBeInTheDocument();
    });

    it('Select all covers the parked rows too', () => {
      setup([parked('p1', 'Bike rack'), parked('p2', 'Bread machine')]);
      enterSelectionMode();

      fireEvent.click(screen.getByRole('button', { name: /Select all/ }));

      // 1 active + 2 parked.
      expect(screen.getByText('3 selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Deselect all/ })).toBeInTheDocument();
    });
  });
});
