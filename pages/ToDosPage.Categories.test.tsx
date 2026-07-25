import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { format, startOfToday } from 'date-fns';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { ToDo } from '@/types/schema';
import {
  useTodos,
  useHouseholdCore,
  useGamification,
  type TodosContextValue,
  type HouseholdCoreContextValue,
} from '@/contexts/FirebaseHouseholdContext';
import ToDosPage from './ToDosPage';

// F-TODO-16 — the category filter, the category sort mode's collapsible
// sections, and the row chip's tap-to-filter shortcut. A separate file from
// ToDosPage.test.tsx so the (large) shared setup there stays untouched.

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: vi.fn(),
  useHouseholdCore: vi.fn(),
  useGamification: vi.fn(() => ({ habits: [] })),
}));

vi.mock('@/utils/toastHelpers', () => ({
  showDeleteConfirmation: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const render = (ui: ReactElement) =>
  rtlRender(<MemoryRouter><ThemeProvider>{ui}</ThemeProvider></MemoryRouter>);

const today = format(startOfToday(), 'yyyy-MM-dd');

const todo = (id: string, text: string, category?: string): ToDo => ({
  id,
  text,
  completeByDate: today,
  assignedTo: 'user1',
  isCompleted: false,
  createdBy: 'user1',
  createdAt: '2026-07-20T12:00:00.000Z',
  ...(category === undefined ? {} : { category }),
});

const todos: ToDo[] = [
  todo('1', 'Mow the lawn', 'Home'),
  todo('2', 'Pick up parcel', 'Errands'),
  todo('3', 'Something loose'),
];

const members = [
  {
    uid: 'user1',
    displayName: 'Alice Smith',
    role: 'member' as const,
    points: { daily: 0, weekly: 0, total: 0 },
  },
];

const setup = (overrides: Partial<TodosContextValue & HouseholdCoreContextValue> = {}) => {
  const value = {
    todos,
    members,
    currentUser: members[0],
    isLoading: false,
    todoCategories: ['Home', 'Errands'],
    updateTodoCategories: vi.fn(),
    addToDo: vi.fn(),
    updateToDo: vi.fn(),
    deleteToDo: vi.fn(),
    completeToDo: vi.fn(),
    uncompleteToDo: vi.fn(),
    toggleTodoSubtask: vi.fn(),
    taskTemplates: [],
    addTaskTemplate: vi.fn(),
    updateTaskTemplate: vi.fn(),
    deleteTaskTemplate: vi.fn(),
    applyTaskTemplate: vi.fn(),
    ...overrides,
  };
  vi.mocked(useTodos).mockReturnValue(value as unknown as TodosContextValue);
  vi.mocked(useHouseholdCore).mockReturnValue(value as unknown as HouseholdCoreContextValue);
  vi.mocked(useGamification).mockReturnValue({ habits: [] } as unknown as ReturnType<typeof useGamification>);
  render(<ToDosPage />);
  return value;
};

const openCategoryFilter = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Filter by category$/ }));

const activeTaskNames = () =>
  screen.getAllByRole('button', { name: /^Edit task: / }).map(b => b.getAttribute('aria-label'));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('ToDosPage — category filter', () => {
  it('hides the control entirely when the household has no categories', () => {
    setup({ todoCategories: [] });
    // Exact name: the ROW chips are also "Filter by category: <name>" buttons.
    expect(screen.queryByRole('button', { name: 'Filter by category' })).toBeNull();
  });

  it('scopes the list to the picked category and keeps the popover open for a second pick', () => {
    setup();
    openCategoryFilter();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Home/ }));
    expect(activeTaskNames()).toEqual(['Edit task: Mow the lawn']);

    // Multi-select: the menu must NOT have closed on the first activation.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Errands/ }));
    expect(activeTaskNames()).toEqual(
      expect.arrayContaining(['Edit task: Mow the lawn', 'Edit task: Pick up parcel']),
    );
    expect(activeTaskNames()).not.toContain('Edit task: Something loose');
  });

  it('matches only category-less tasks through the Uncategorized bucket', () => {
    setup();
    openCategoryFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Uncategorized/ }));
    expect(activeTaskNames()).toEqual(['Edit task: Something loose']);
  });

  it('ANDs with the person filter', () => {
    setup({
      todos: [
        { ...todo('1', 'Mow the lawn', 'Home'), assignedTo: 'user1' },
        { ...todo('2', 'Wash the car', 'Home'), assignedTo: 'user2' },
      ],
      members: [
        ...members,
        { uid: 'user2', displayName: 'Bob Jones', role: 'member' as const, points: { daily: 0, weekly: 0, total: 0 } },
      ],
    });
    openCategoryFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Home/ }));
    // Close the category popover, then scope to one person.
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Filter by person' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Filter to Bob Jones' }));
    expect(activeTaskNames()).toEqual(['Edit task: Wash the car']);
  });

  it('persists the selection (uncategorized as JSON null, never a magic string)', () => {
    setup();
    openCategoryFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Home/ }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Uncategorized/ }));
    expect(window.localStorage.getItem('todos-category-filter')).toBe('["Home",null]');
  });

  it('restores a persisted selection on mount and clears it from the pill', () => {
    window.localStorage.setItem('todos-category-filter', '["Errands"]');
    setup();
    expect(activeTaskNames()).toEqual(['Edit task: Pick up parcel']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear category filter' }));
    expect(activeTaskNames()).toHaveLength(3);
    expect(window.localStorage.getItem('todos-category-filter')).toBe('[]');
  });

  it('drops a persisted category that has left the household vocabulary', () => {
    window.localStorage.setItem('todos-category-filter', '["Gone",null]');
    setup();
    // Only the uncategorized bucket survives the prune.
    expect(activeTaskNames()).toEqual(['Edit task: Something loose']);
    expect(window.localStorage.getItem('todos-category-filter')).toBe('[null]');
  });

  it('ignores a malformed persisted value instead of throwing', () => {
    window.localStorage.setItem('todos-category-filter', '{not json');
    setup();
    expect(activeTaskNames()).toHaveLength(3);
  });

  it('tapping a row chip toggles that category into the filter', () => {
    setup();
    const rowChips = screen.getAllByTestId('todo-category-chip');
    const homeChip = rowChips.find(c => c.textContent?.includes('Home'));
    expect(homeChip).toBeDefined();
    fireEvent.click(homeChip as HTMLElement);
    expect(activeTaskNames()).toEqual(['Edit task: Mow the lawn']);
  });
});

describe('ToDosPage — category sort mode sections', () => {
  const chooseCategorySort = () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sort: / }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Category' }));
  };

  it('renders one collapsible section per category with Uncategorized last', () => {
    setup();
    chooseCategorySort();
    const headers = screen.getAllByRole('button', { expanded: true });
    expect(headers.map(h => h.textContent?.trim())).toEqual([
      'Errands1',
      'Home1',
      'Uncategorized1',
    ]);
  });

  it('accepts a persisted "category" sort mode on mount', () => {
    window.localStorage.setItem('todos-sort-mode', 'category');
    setup();
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(3);
  });

  it('collapsing a section hides its rows without touching the others', () => {
    setup();
    chooseCategorySort();
    const homeHeader = screen
      .getAllByRole('button', { expanded: true })
      .find(h => h.textContent?.includes('Home'));
    fireEvent.click(homeHeader as HTMLElement);

    expect(homeHeader).toHaveAttribute('aria-expanded', 'false');
    expect(activeTaskNames()).toEqual(
      expect.arrayContaining(['Edit task: Pick up parcel', 'Edit task: Something loose']),
    );
    expect(activeTaskNames()).not.toContain('Edit task: Mow the lawn');
  });

  it('keeps rendering the flat (section-less) list in every other sort mode', () => {
    setup();
    expect(screen.queryByRole('button', { name: /Uncategorized/ })).toBeNull();
    expect(activeTaskNames()).toHaveLength(3);
  });

  it('scopes the sections by the category filter', () => {
    setup();
    chooseCategorySort();
    openCategoryFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Errands/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    const headers = screen.getAllByRole('button', { expanded: true });
    expect(headers).toHaveLength(1);
    expect(within(headers[0] as HTMLElement).getByText('Errands')).toBeInTheDocument();
  });
});
