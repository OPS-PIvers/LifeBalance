import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MealPlanTab from './MealPlanTab';

// Mutable mock state so individual tests can supply fixtures.
const mocks = vi.hoisted(() => ({
  meals: [] as unknown[],
  mealPlan: [] as unknown[],
  shoppingList: [] as unknown[],
  groceryCatalog: [] as unknown[],
  addShoppingItems: vi.fn(),
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
  }),
  useShopping: () => ({
    addShoppingItem: vi.fn(),
    addShoppingItems: mocks.addShoppingItems,
    shoppingList: mocks.shoppingList,
    groceryCatalog: mocks.groceryCatalog,
  }),
  useHouseholdCore: () => ({
    householdId: 'test-household',
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
  Trash2: () => <div data-testid="trash-icon" />,
  Edit2: () => <div data-testid="edit-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
  ChefHat: () => <div data-testid="chef-hat-icon" />,
  ChevronRight: () => <div data-testid="chevron-right-icon" />,
  ChevronLeft: () => <div data-testid="chevron-left-icon" />,
  ShoppingCart: () => <div data-testid="shopping-cart-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
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

  it('starts the week on Monday', () => {
    // Set date to Wednesday, Oct 25, 2023
    const testDate = new Date(2023, 9, 25); // Month is 0-indexed: 9 = Oct
    vi.setSystemTime(testDate);

    render(<MealPlanTab />);

    // Expected Monday start: Oct 23 - Oct 29 (Sunday start would be Oct 22 - Oct 28).
    // The week-range headline was removed in the UX compaction (the slim week
    // strip carries the days), so assert via the day-strip cells' aria-labels:
    // first day is Monday Oct 23, and Sunday Oct 22 is not in the strip.
    expect(screen.getByLabelText(/^Monday, October 23/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Sunday, October 29/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Sunday, October 22/)).not.toBeInTheDocument();
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
