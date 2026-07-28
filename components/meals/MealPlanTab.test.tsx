import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import MealPlanTab from './MealPlanTab';

// MealPlanTab reads the global-search deep link off router state
// (`useDeepLinkHighlight`), so every render needs a Router around it.
const render = (ui: ReactElement) =>
  rtlRender(<MemoryRouter initialEntries={['/lists']}>{ui}</MemoryRouter>);

// Mutable mock state so individual tests can supply fixtures.
const mocks = vi.hoisted(() => ({
  meals: [] as unknown[],
  mealPlan: [] as unknown[],
  shoppingList: [] as unknown[],
  groceryCatalog: [] as unknown[],
  addShoppingItem: vi.fn(),
  addShoppingItems: vi.fn(),
  loadAllMeals: vi.fn(async () => {}),
}));

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useMealPlan: () => ({
    meals: mocks.meals,
    addMeal: vi.fn(),
    updateMeal: vi.fn(),
    mealPlan: mocks.mealPlan,
    addMealPlanItem: vi.fn(),
    updateMealPlanItem: vi.fn(),
    deleteMealPlanItem: vi.fn(),
    ensureMealPlanWeek: vi.fn(),
    loadAllMeals: mocks.loadAllMeals,
  }),
  useShopping: () => ({
    addShoppingItem: mocks.addShoppingItem,
    addShoppingItems: mocks.addShoppingItems,
    shoppingList: mocks.shoppingList,
    groceryCatalog: mocks.groceryCatalog,
  }),
  useHouseholdCore: () => ({
    householdId: 'test-household',
    householdSettings: {},
    setMealCookedHabitId: vi.fn(),
  }),
  useGamification: () => ({
    habits: [],
    toggleHabit: vi.fn(),
  }),
}));

// Replace the real selector modal with a stub that confirms every passed
// ingredient, so tests can drive handleConfirmIngredients directly.
vi.mock('./IngredientSelectorModal', () => ({
  IngredientSelectorModal: ({
    ingredients,
    onConfirm,
  }: {
    ingredients: { name: string; quantity?: string }[];
    onConfirm: (selected: { name: string; quantity?: string }[]) => void;
  }) => (
    <button onClick={() => onConfirm(ingredients)}>Confirm all ingredients</button>
  ),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Plus: () => <div data-testid="plus-icon" />,
  Camera: () => <div data-testid="camera-icon" />,
  ImageUp: () => <div data-testid="imageup-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
  Edit2: () => <div data-testid="edit-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
  ChefHat: () => <div data-testid="chef-hat-icon" />,
  ChevronRight: () => <div data-testid="chevron-right-icon" />,
  ChevronLeft: () => <div data-testid="chevron-left-icon" />,
  ShoppingCart: () => <div data-testid="shopping-cart-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
  Link2: () => <div data-testid="link-icon" />,
  X: () => <div data-testid="x-icon" />,
  Copy: () => <div data-testid="copy-icon" />,
  FileText: () => <div data-testid="file-text-icon" />,
  Search: () => <div data-testid="search-icon" />,
  ArrowUpAZ: () => <div data-testid="sort-icon" />,
  Calendar: () => <div data-testid="calendar-icon" />,
  CalendarDays: () => <div data-testid="calendar-days-icon" />,
  Star: () => <div data-testid="star-icon" />,
  CheckCircle2: () => <div data-testid="check-circle-icon" />,
  MoreVertical: () => <div data-testid="more-vertical-icon" />,
  MoreHorizontal: () => <div data-testid="more-horizontal-icon" />,
  Eye: () => <div data-testid="eye-icon" />,
  Utensils: () => <div data-testid="utensils-icon" />,
  Printer: () => <div data-testid="printer-icon" />,
  // Weekly Plan modal + Meal Guide icons
  FileJson: () => <div data-testid="file-json-icon" />,
  ClipboardPaste: () => <div data-testid="clipboard-paste-icon" />,
  CalendarPlus: () => <div data-testid="calendar-plus-icon" />,
  ArrowLeft: () => <div data-testid="arrow-left-icon" />,
  ArrowRight: () => <div data-testid="arrow-right-icon" />,
  Box: () => <div data-testid="box-icon" />,
  Timer: () => <div data-testid="timer-icon" />,
  Hourglass: () => <div data-testid="hourglass-icon" />,
  Baby: () => <div data-testid="baby-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  // RecipeModal (opened by the global-search deep link below).
  Check: () => <div data-testid="check-icon" />,
  ExternalLink: () => <div data-testid="external-link-icon" />,
  ShieldAlert: () => <div data-testid="shield-alert-icon" />,
  Minus: () => <div data-testid="minus-icon" />,
}));

describe('MealPlanTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.meals = [];
    mocks.mealPlan = [];
    mocks.shoppingList = [];
    mocks.groceryCatalog = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('only materializes a bounded window of day chips up front', () => {
    // Set date to Wednesday, Oct 25, 2023
    const testDate = new Date(2023, 9, 25); // Month is 0-indexed: 9 = Oct
    vi.setSystemTime(testDate);

    render(<MealPlanTab />);

    // The strip's logical range spans 8 weeks back / 12 forward from today,
    // but only a bounded window around the selected day is rendered as DOM
    // chips up front — the far start of that range (~2 months back) is not
    // materialized until navigation reaches it.
    expect(screen.getByLabelText(/^Wednesday, October 25/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Monday, August 28/)).not.toBeInTheDocument();
  });

  it('extends the day strip window when keyboard navigation reaches its edge', () => {
    // Set date to Wednesday, Oct 25, 2023
    const testDate = new Date(2023, 9, 25); // Month is 0-indexed: 9 = Oct
    vi.setSystemTime(testDate);

    render(<MealPlanTab />);

    const stripGroup = screen.getByRole('group', { name: /Pick a day/i });
    const pressLeft = (times: number) => {
      for (let i = 0; i < times; i++) {
        fireEvent.keyDown(stripGroup, { key: 'ArrowLeft' });
      }
    };

    // What matters here is the extension *boundary*, not how far the strip can
    // be walked: the initial window is STRIP_WINDOW_SIZE (28) chips centered on
    // today (Oct 11 - Nov 7), and it only grows once the selection comes within
    // STRIP_WINDOW_EDGE_THRESHOLD (7) days of an edge, then pads by
    // STRIP_WINDOW_PAD (14). So the 8th ArrowLeft is the interesting press, and
    // asserting either side of it covers the wiring in 8 renders. (The window
    // arithmetic itself is exhaustively covered in utils/dateStripWindow.test.ts.)
    expect(screen.getByLabelText('Wednesday, October 11')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tuesday, October 3')).not.toBeInTheDocument();

    // Oct 18 — exactly at the threshold, so the window must NOT have grown yet.
    // The aria-pressed assertion also proves all 7 presses each moved a day,
    // i.e. every keydown got its own render rather than reusing a stale one.
    pressLeft(7);
    expect(screen.getByLabelText('Wednesday, October 18')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Tuesday, October 3')).not.toBeInTheDocument();

    // Oct 17 — crosses the threshold, extending the window back to Oct 3.
    pressLeft(1);
    expect(screen.getByLabelText('Tuesday, October 17')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Tuesday, October 3')).toBeInTheDocument();
  });

  it('anchors the start of the day strip range to Monday, not Sunday', () => {
    // Set date to Wednesday, Oct 25, 2023
    vi.setSystemTime(new Date(2023, 9, 25)); // Month is 0-indexed: 9 = Oct

    render(<MealPlanTab />);

    const stripGroup = screen.getByRole('group', { name: /Pick a day/i });
    const firstChip = () => stripGroup.querySelector<HTMLElement>('[data-date]');

    // Walk to the very first day of the strip's range. Selecting the earliest
    // materialized chip extends the window another STRIP_WINDOW_PAD (14) days
    // back, so clicking it repeatedly reaches the range start in ~5 renders
    // where day-at-a-time ArrowLeft presses would take 58.
    for (let i = 0; i < 10; i++) {
      const chip = firstChip();
      if (!chip) break;
      const before = chip.dataset.date;
      fireEvent.click(chip);
      // The window only ever grows; when it can't grow further we're at the
      // range's start boundary.
      if (firstChip()?.dataset.date === before) break;
    }

    // 8 weeks back from the week of Oct 25 is Aug 28. A Sunday-anchored range
    // would begin Aug 27 instead.
    expect(screen.getByLabelText('Monday, August 28')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sunday, August 27')).not.toBeInTheDocument();
  });

  it('orders ingredient-selector items after the highest existing order, not list length', () => {
    vi.setSystemTime(new Date(2023, 9, 25)); // Wednesday, Oct 25, 2023

    mocks.meals = [
      { id: 'meal-1', name: 'Tacos', ingredients: [{ name: 'Tortillas' }, { name: 'Beef' }], tags: [] },
    ];
    mocks.mealPlan = [
      { id: 'plan-1', date: '2023-10-25', mealId: 'meal-1', mealName: 'Tacos', type: 'dinner', isCooked: false },
    ];
    // Length 2 but max order 3: an order-2 item was deleted, and deletes never
    // renumber remaining orders — so length-based ordering would collide.
    mocks.shoppingList = [
      { id: 's1', name: 'Milk', category: 'Dairy', isPurchased: false, order: 1 },
      { id: 's2', name: 'Eggs', category: 'Dairy', isPurchased: false, order: 3 },
    ];

    render(<MealPlanTab />);

    fireEvent.click(screen.getByText(/Shop ingredients/i));
    fireEvent.click(screen.getByText('Confirm all ingredients'));

    expect(mocks.addShoppingItems).toHaveBeenCalledTimes(1);
    const added = mocks.addShoppingItems.mock.calls[0]?.[0] as { name: string; order: number }[];
    expect(added.map(item => item.order)).toEqual([4, 5]);
  });

  it('adds a meal\'s ingredients to the shopping list in a single batch call, skipping duplicates', () => {
    // Wednesday, Oct 25, 2023 — Monday-start week is Oct 23 - Oct 29.
    vi.setSystemTime(new Date(2023, 9, 25));

    mocks.meals = [
      {
        id: 'meal-1',
        name: 'Tacos',
        ingredients: [
          { name: 'Tortillas', quantity: '1 pack' },
          { name: 'Beef', quantity: '1 lb' },
          { name: 'Milk', quantity: '1 gallon' }, // already unpurchased on the list
        ],
        tags: [],
      },
    ];
    mocks.mealPlan = [
      { id: 'plan-this-week', date: '2023-10-25', mealId: 'meal-1', mealName: 'Tacos', type: 'dinner', isCooked: false },
    ];
    // Length 1 but max order 3: an order-2 item was deleted, so new orders must
    // be based on max order, not list length.
    mocks.shoppingList = [
      { id: 's1', name: 'Milk', category: 'Dairy', isPurchased: false, order: 3 },
    ];
    // Beef exists in purchase history — its category resolves from the
    // catalog; Tortillas is unknown and falls back to Uncategorized.
    mocks.groceryCatalog = [
      { id: 'c1', name: 'Beef', category: 'Meat' },
    ];

    render(<MealPlanTab />);

    fireEvent.click(screen.getByLabelText('More week actions'));
    fireEvent.click(screen.getByText('Shop for this week'));
    fireEvent.click(screen.getByText('Add Ingredients'));

    // Single batched call with all non-duplicate ingredients — no per-item calls.
    expect(mocks.addShoppingItems).toHaveBeenCalledTimes(1);
    expect(mocks.addShoppingItem).not.toHaveBeenCalled();

    const added = mocks.addShoppingItems.mock.calls[0]?.[0] as { name: string; order: number; category: string }[];
    expect(added.map(item => item.name)).toEqual(['Tortillas', 'Beef']);
    expect(added.map(item => item.order)).toEqual([4, 5]);
    expect(added.map(item => item.category)).toEqual(['Uncategorized', 'Meat']);
  });

  it('exposes Copy last week / Shop for this week behind the week-actions overflow menu', () => {
    // Wednesday, Oct 25, 2023 — Monday-start week is Oct 23 - Oct 29.
    vi.setSystemTime(new Date(2023, 9, 25));

    mocks.meals = [
      { id: 'meal-1', name: 'Tacos', ingredients: [{ name: 'Tortillas' }], tags: [] },
    ];
    mocks.mealPlan = [
      // Falls within this week — feeds "Shop for this week".
      { id: 'plan-this-week', date: '2023-10-25', mealId: 'meal-1', mealName: 'Tacos', type: 'dinner', isCooked: false },
      // Falls within last week — feeds "Copy last week".
      { id: 'plan-last-week', date: '2023-10-18', mealId: 'meal-1', mealName: 'Tacos', type: 'dinner', isCooked: false },
    ];

    render(<MealPlanTab />);

    // The two buttons no longer sit in the header directly...
    expect(screen.queryByText('Copy last week')).not.toBeInTheDocument();
    expect(screen.queryByText('Shop week')).not.toBeInTheDocument();

    // ...they live behind the overflow menu.
    fireEvent.click(screen.getByLabelText('More week actions'));
    expect(screen.getByRole('menu', { name: 'Week actions' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Shop for this week'));
    expect(screen.getByText('Shop for the Week')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));

    fireEvent.click(screen.getByLabelText('More week actions'));
    fireEvent.click(screen.getByText('Copy last week'));
    expect(screen.getByText('Copy Last Week')).toBeInTheDocument();
  });
});

// --- Global search deep-link (v1.2) ------------------------------------------
// A meal search result is a RECIPE, but this tab renders MealPlanItem rows for
// ONE selected day — so there is frequently no row to scroll to. Product
// decision: OPEN THE RECIPE. That works for a recipe planned in another week
// and for one that was never planned at all, which is exactly what
// "scroll to a planned occurrence" would miss.

const DeepLinkTrigger: React.FC<{ highlightId: string }> = ({ highlightId }) => {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/lists', { state: { tab: 'meals', highlightId } })}>
      deep-link
    </button>
  );
};

describe('MealPlanTab — global search deep-link', () => {
  beforeEach(() => {
    mocks.meals = [];
    mocks.mealPlan = [];
    mocks.shoppingList = [];
    mocks.groceryCatalog = [];
    mocks.loadAllMeals.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderWithTrigger = (highlightId: string) =>
    rtlRender(
      <MemoryRouter initialEntries={['/lists']}>
        <MealPlanTab />
        <DeepLinkTrigger highlightId={highlightId} />
      </MemoryRouter>
    );

  it('opens the recipe for a meal that is not planned on any day', () => {
    mocks.meals = [
      { id: 'meal-9', name: 'Sheet-pan salmon', ingredients: [], instructions: [], tags: [] },
    ];
    renderWithTrigger('meal-9');
    expect(screen.queryByText('Sheet-pan salmon')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('deep-link'));

    // The recipe drawer's own heading — no plan item, no date math, no scroll.
    expect(screen.getByRole('heading', { name: 'Sheet-pan salmon' })).toBeInTheDocument();
  });

  it('offers no "Mark as Cooked" action when there is no plan item', () => {
    mocks.meals = [
      { id: 'meal-9', name: 'Sheet-pan salmon', ingredients: [], instructions: [], tags: [] },
    ];
    renderWithTrigger('meal-9');
    fireEvent.click(screen.getByText('deep-link'));

    expect(screen.getByRole('heading', { name: 'Sheet-pan salmon' })).toBeInTheDocument();
    expect(screen.queryByText('Mark as Cooked')).not.toBeInTheDocument();
  });

  it('pulls in the full cookbook when the target is outside the bounded live window', () => {
    // The live `meals` listener is capped (MEALS_LIMIT), so an older recipe is
    // simply absent — the id is latched and resolved once loadAllMeals lands.
    const { rerender } = renderWithTrigger('meal-old');
    fireEvent.click(screen.getByText('deep-link'));

    expect(mocks.loadAllMeals).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Grandma stew' })).not.toBeInTheDocument();

    mocks.meals = [
      { id: 'meal-old', name: 'Grandma stew', ingredients: [], instructions: [], tags: [] },
    ];
    rerender(
      <MemoryRouter initialEntries={['/lists']}>
        <MealPlanTab />
        <DeepLinkTrigger highlightId="meal-old" />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Grandma stew' })).toBeInTheDocument();
  });
});
