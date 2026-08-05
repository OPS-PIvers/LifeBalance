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
    // "Saved for later": nothing parked, so the section renders header + add
    // bar only (covered in ToDosPage.SavedForLater.test.tsx).
    savedForLaterTodos: [],
    addSavedForLaterTodo: vi.fn(),
    promoteTodo: vi.fn(),
    parkTodo: vi.fn(),
    // Reachable from this page but never exercised here. Stubbed anyway: the
    // `as ...ContextValue` cast hides a missing FUNCTION until a future test
    // trips the code path, which then fails as `x is not a function` instead of
    // a clean assertion. These two come from the always-mounted
    // TodoCategoryManagerDrawer — squarely this suite's own subject matter.
    renameTodoCategory: vi.fn(),
    deleteTodoCategory: vi.fn(),
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
  it('hides the control entirely when nothing anywhere carries a category', () => {
    setup({ todoCategories: [], todos: [todo('1', 'Loose one'), todo('2', 'Loose two')] });
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

  it('drops a persisted category that was genuinely DELETED (vocabulary + every task)', () => {
    window.localStorage.setItem('todos-category-filter', '["Gone",null]');
    // No to-do carries "Gone" either, so it exists nowhere — the prune must
    // still drop it. Only the uncategorized bucket survives.
    setup();
    expect(activeTaskNames()).toEqual(['Edit task: Something loose']);
    expect(window.localStorage.getItem('todos-category-filter')).toBe('[null]');
  });

  // A category created by an iOS Shortcut lives on the TASK but never enters
  // `household.todoCategories` (quickAddTodo deliberately doesn't mint it), so
  // a vocabulary-only menu/prune silently reset the saved filter to "All" on
  // every reload. The vocabulary is the UNION of both.
  it('offers a category that only exists on tasks, never in the vocabulary', () => {
    setup({
      todoCategories: ['Home'],
      todos: [todo('1', 'Mow the lawn', 'Home'), todo('2', 'Shortcut task', 'Groceries')],
    });
    openCategoryFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Groceries/ }));
    expect(activeTaskNames()).toEqual(['Edit task: Shortcut task']);
  });

  it('keeps a task-only (Shortcut-created) category in the persisted filter across a reload', () => {
    window.localStorage.setItem('todos-category-filter', '["Groceries"]');
    setup({
      todoCategories: ['Home', 'Errands'],
      todos: [todo('1', 'Mow the lawn', 'Home'), todo('2', 'Shortcut task', 'Groceries')],
    });
    // Survives the vocabulary-edge prune...
    expect(activeTaskNames()).toEqual(['Edit task: Shortcut task']);
    // ...and the persistence effect must not write an emptied filter back.
    expect(window.localStorage.getItem('todos-category-filter')).toBe('["Groceries"]');
  });

  it('shows the control when only tasks carry categories', () => {
    setup({
      todoCategories: [],
      todos: [todo('1', 'Shortcut task', 'Groceries')],
    });
    expect(screen.getByRole('button', { name: 'Filter by category' })).toBeInTheDocument();
  });

  it('orders the menu household-first, then task-only extras alphabetically', () => {
    setup({
      todoCategories: ['Home', 'Errands'],
      todos: [
        todo('1', 'Zed task', 'Zebra'),
        todo('2', 'Ay task', 'Apples'),
        todo('3', 'Home task', 'home'), // same category, different spelling
      ],
    });
    openCategoryFilter();
    const items = screen
      .getAllByRole('menuitemcheckbox')
      .map(el => el.textContent?.trim());
    // "All categories" first, then the household's own order (its canonical
    // "Home" spelling wins over the task's "home"), then the extras sorted.
    expect(items).toEqual([
      'All categories',
      'Home',
      'Errands',
      'Apples',
      'Zebra',
      'Uncategorized',
    ]);
  });

  // Finding 3 regression: the popover's roving-focus item list must include
  // `menuitemcheckbox`, not just menuitem/menuitemradio.
  it('roves focus across the checkbox items with the arrow / Home / End keys', () => {
    setup();
    openCategoryFilter();
    const panel = screen.getByRole('menu', { name: 'Filter by category' });
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(items).toHaveLength(4); // All + Home + Errands + Uncategorized

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(panel, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(panel, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('ignores a malformed persisted value instead of throwing', () => {
    window.localStorage.setItem('todos-category-filter', '{not json');
    setup();
    expect(activeTaskNames()).toHaveLength(3);
  });
});

describe('ToDosPage — category sort mode sections', () => {
  const chooseCategorySort = () => {
    fireEvent.click(screen.getByRole('button', { name: /^Sort: / }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Category' }));
  };

  // The "Saved for later" section below the list is a disclosure too, so it
  // carries aria-expanded. These assertions are about the CATEGORY sections
  // specifically, so it is filtered out by name rather than by counting.
  const categoryHeaders = () =>
    screen
      .getAllByRole('button', { expanded: true })
      .filter(h => !h.textContent?.includes('Saved for later'));

  it('renders one collapsible section per category with Uncategorized last', () => {
    setup();
    chooseCategorySort();
    const headers = categoryHeaders();
    expect(headers.map(h => h.textContent?.trim())).toEqual([
      'Errands1',
      'Home1',
      'Uncategorized1',
    ]);
  });

  it('accepts a persisted "category" sort mode on mount', () => {
    window.localStorage.setItem('todos-sort-mode', 'category');
    setup();
    expect(categoryHeaders()).toHaveLength(3);
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

  // Finding 6 regression: the list was only rendered while expanded, so exactly
  // in the collapsed state — where aria-expanded="false" makes the reference
  // matter most — aria-controls pointed at a nonexistent id.
  it('keeps the aria-controls target in the DOM (but hidden) while collapsed', () => {
    setup();
    chooseCategorySort();
    const homeHeader = screen
      .getAllByRole('button', { expanded: true })
      .find(h => h.textContent?.includes('Home')) as HTMLElement;

    const controlsId = homeHeader.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).not.toBeNull();

    fireEvent.click(homeHeader);
    expect(homeHeader).toHaveAttribute('aria-expanded', 'false');

    const target = document.getElementById(controlsId as string);
    expect(target).not.toBeNull();
    // `hidden` keeps it out of the a11y tree AND out of tab order, so the
    // collapsed rows stay genuinely unreachable.
    expect(target).toHaveAttribute('hidden');
    expect(within(target as HTMLElement).queryAllByRole('button')).toHaveLength(0);
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
    const headers = categoryHeaders();
    expect(headers).toHaveLength(1);
    expect(within(headers[0] as HTMLElement).getByText('Errands')).toBeInTheDocument();
  });
});

describe('ToDosPage — triage entry points', () => {
  const openKebab = () =>
    fireEvent.click(screen.getByRole('button', { name: /To-do list actions/i }));

  it('nudges with the uncategorized count, and the count ignores the active filter', () => {
    setup();
    expect(screen.getByText('1 task needs a category')).toBeInTheDocument();

    // Filtering to a category must not make the backlog look smaller.
    openCategoryFilter();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Home/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('1 task needs a category')).toBeInTheDocument();
  });

  it('pluralises the nudge', () => {
    setup({ todos: [todo('1', 'Loose one'), todo('2', 'Loose two')] });
    expect(screen.getByText('2 tasks need a category')).toBeInTheDocument();
  });

  it('hides the nudge once nothing is uncategorized', () => {
    setup({ todos: [todo('1', 'Mow the lawn', 'Home')] });
    expect(screen.queryByText(/needs? a category/)).toBeNull();
  });

  it('dismisses the nudge, leaving triage reachable from the kebab', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the triage reminder' }));
    expect(screen.queryByText('1 task needs a category')).toBeNull();

    openKebab();
    expect(
      screen.getByRole('menuitem', { name: /Triage uncategorized tasks one at a time/ }),
    ).toBeEnabled();
  });

  it('offers manage-categories always, and disables triage with an empty backlog', () => {
    setup({ todos: [todo('1', 'Mow the lawn', 'Home')] });
    openKebab();

    expect(screen.getByRole('menuitem', { name: /Manage categories/ })).toBeEnabled();
    expect(
      screen.getByRole('menuitem', { name: /Triage uncategorized tasks one at a time/ }),
    ).toBeDisabled();
  });

  it('opens the triage drawer from the banner', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Triage' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
