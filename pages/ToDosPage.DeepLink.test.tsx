import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { format, startOfToday, subMonths } from 'date-fns';
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

// Global search deep-link (v1.2). ONE highlight system now: router state
// (`state: { tab: 'todos', highlightId }`) and the dashboard Action Queue's
// legacy `?todo=` both resolve to the same `data-highlight-target` +
// `.search-highlight-flash` path Money and Habits use.
//
// The work being tested is `onBeforeScroll`: the target row is routinely
// invisible when the link lands — filtered out, inside a collapsed section, or
// in the other view mode — and `scrollIntoView` on a `display: none` subtree is
// a no-op, so it has to be un-hidden FIRST.

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

const completedTodo: ToDo = {
  ...todo('done-1', 'Return the library book'),
  isCompleted: true,
  // Old enough to land in the collapsed "Older" bucket.
  completedAt: subMonths(startOfToday(), 2).toISOString(),
};

const todos: ToDo[] = [
  todo('home-1', 'Mow the lawn', 'Home'),
  todo('errand-1', 'Pick up parcel', 'Errands'),
  completedTodo,
];

const members = [
  {
    uid: 'user1',
    displayName: 'Alice Smith',
    role: 'member' as const,
    points: { daily: 0, weekly: 0, total: 0 },
  },
];

/**
 * Delivers the deep link the way the app does — a navigation into an ALREADY
 * MOUNTED `/lists`. The filters, the collapse state and the view mode are all
 * component state, so they only exist to be un-hidden once the page is up.
 */
const DeepLinkTrigger: React.FC<{ highlightId: string }> = ({ highlightId }) => {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/lists', { state: { tab: 'todos', highlightId } })}>
      deep-link
    </button>
  );
};

const setup = (highlightId: string, overrides: Partial<TodosContextValue & HouseholdCoreContextValue> = {}) => {
  const value = {
    todos,
    members,
    currentUser: members[0],
    isLoading: false,
    todoCategories: ['Home', 'Errands'],
    updateTodoCategories: vi.fn(),
    // "Saved for later": nothing parked (covered in its own suite).
    savedForLaterTodos: [],
    addSavedForLaterTodo: vi.fn(),
    promoteTodo: vi.fn(),
    parkTodo: vi.fn(),
    // Reachable from this page but never exercised here. Stubbed anyway: the
    // `as ...ContextValue` cast hides a missing FUNCTION until a future test
    // trips the code path, which then fails as `x is not a function` instead of
    // a clean assertion. Both come from the always-mounted
    // TodoCategoryManagerDrawer.
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
  return rtlRender(
    <MemoryRouter initialEntries={['/lists']}>
      <ThemeProvider>
        <ToDosPage />
        <DeepLinkTrigger highlightId={highlightId} />
      </ThemeProvider>
    </MemoryRouter>
  );
};

/** The collapse toggle for one category section (they own an aria-controls id). */
const sectionToggle = (label: string): HTMLElement => {
  const button = screen
    .getAllByRole('button')
    .find(
      b =>
        b.getAttribute('aria-controls')?.startsWith('todo-category-section-') &&
        b.textContent?.includes(label)
    );
  if (!button) throw new Error(`No category section toggle for "${label}"`);
  return button;
};

const applyCategoryFilter = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^Filter by category$/ }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: label }));
};

/** `.getByRole` respects `hidden`/`display:none`, so this IS the visibility check. */
const rowIsReachable = (text: string) =>
  screen.queryByRole('button', { name: `Edit task: ${text}` }) !== null;

/** Lets `useScrollToHighlight`'s onBeforeScroll → rAF → DOM lookup complete. */
const flushHighlight = () =>
  act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ToDosPage deep-link highlight', () => {
  it('reveals a target hidden behind BOTH a persisted category filter and a collapsed section', async () => {
    // 'category' sort mode is itself a persisted preference.
    window.localStorage.setItem('todos-sort-mode', 'category');
    const { container } = setup('home-1');

    // Collapse the target's own section, then scope the view to a DIFFERENT
    // category — the filter write persists to localStorage.
    fireEvent.click(sectionToggle('Home'));
    applyCategoryFilter('Errands');
    expect(window.localStorage.getItem('todos-category-filter')).toBe('["Errands"]');
    expect(rowIsReachable('Mow the lawn')).toBe(false);

    fireEvent.click(screen.getByText('deep-link'));
    await flushHighlight();

    expect(rowIsReachable('Mow the lawn')).toBe(true);
    expect(container.querySelector('[data-highlight-target="home-1"]')).not.toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  /**
   * "Saved for later": a parked to-do is a legitimate search/deep-link target
   * (PR-5 indexes them), and its section collapses the same `hidden` way the
   * category sections do. `scrollIntoView` AND the flash class are both silent
   * no-ops on a display:none subtree, and the highlight self-clears after ~2.2s
   * — so a collapsed section would mean landing on the page with zero feedback
   * that the search found anything.
   *
   * Also note the target is NOT in `todos` at all: the context split hides
   * parked items from that slice, so the reveal callback has to consult
   * `savedForLaterTodos` or it bails before doing anything.
   */
  const parkedTodo: ToDo = {
    ...todo('parked-1', 'Look into a bike rack'),
    assignedTo: undefined,
    savedForLater: true,
  };

  it('expands a COLLAPSED "Saved for later" section for a parked target', async () => {
    const { container } = setup('parked-1', { savedForLaterTodos: [parkedTodo] });

    fireEvent.click(screen.getByRole('button', { name: /Saved for later/ }));
    expect(rowIsReachable('Look into a bike rack')).toBe(false);
    expect(document.getElementById('saved-for-later-content')).toHaveAttribute('hidden');

    fireEvent.click(screen.getByText('deep-link'));
    await flushHighlight();

    expect(rowIsReachable('Look into a bike rack')).toBe(true);
    expect(document.getElementById('saved-for-later-content')).not.toHaveAttribute('hidden');
    expect(container.querySelector('[data-highlight-target="parked-1"]')).not.toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('clears a filter that hides a parked target, and leaves the category sections alone', async () => {
    setup('parked-1', { savedForLaterTodos: [parkedTodo] });

    // Parked items usually carry no category, so a category filter hides them.
    applyCategoryFilter('Errands');
    expect(rowIsReachable('Look into a bike rack')).toBe(false);

    fireEvent.click(screen.getByText('deep-link'));
    await flushHighlight();

    expect(rowIsReachable('Look into a bike rack')).toBe(true);
    expect(window.localStorage.getItem('todos-category-filter')).toBe('[]');
  });

  it('leaves a collapsed "Saved for later" section alone for an ACTIVE target', async () => {
    setup('home-1', { savedForLaterTodos: [parkedTodo] });

    fireEvent.click(screen.getByRole('button', { name: /Saved for later/ }));

    fireEvent.click(screen.getByText('deep-link'));
    await flushHighlight();

    // The deep link must reveal what it points at — and nothing else.
    expect(rowIsReachable('Mow the lawn')).toBe(true);
    expect(document.getElementById('saved-for-later-content')).toHaveAttribute('hidden');
  });

  it('leaves a category filter alone when the target already passes it', async () => {
    setup('errand-1');

    applyCategoryFilter('Errands');
    fireEvent.click(screen.getByText('deep-link'));
    await flushHighlight();

    // Still scoped to Errands — the deep link had no reason to widen the view.
    expect(rowIsReachable('Pick up parcel')).toBe(true);
    expect(rowIsReachable('Mow the lawn')).toBe(false);
    expect(window.localStorage.getItem('todos-category-filter')).toBe('["Errands"]');
  });

  it('switches to the completed view and opens its collapsed bucket for a completed target', async () => {
    const { container } = setup('done-1');

    // The active view is showing; the completed row is not rendered at all.
    expect(screen.queryByText('Return the library book')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('deep-link'));
    await flushHighlight();

    expect(screen.getByText('Return the library book')).toBeInTheDocument();
    expect(container.querySelector('[data-highlight-target="done-1"]')).not.toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('accepts the Action Queue\'s legacy ?todo= param as the same highlight target', async () => {
    vi.mocked(useTodos).mockReturnValue({
      todos,
      members,
      currentUser: members[0],
      isLoading: false,
      todoCategories: [],
      updateTodoCategories: vi.fn(),
      savedForLaterTodos: [],
      addSavedForLaterTodo: vi.fn(),
      promoteTodo: vi.fn(),
      parkTodo: vi.fn(),
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
    } as unknown as TodosContextValue);
    vi.mocked(useHouseholdCore).mockReturnValue({
      members,
      currentUser: members[0],
      isLoading: false,
    } as unknown as HouseholdCoreContextValue);
    vi.mocked(useGamification).mockReturnValue({ habits: [] } as unknown as ReturnType<typeof useGamification>);

    const { container } = rtlRender(
      <MemoryRouter initialEntries={['/lists?todo=home-1']}>
        <ThemeProvider>
          <ToDosPage />
        </ThemeProvider>
      </MemoryRouter>
    );
    await flushHighlight();

    expect(container.querySelector('[data-highlight-target="home-1"]')).not.toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
