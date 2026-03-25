import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MealPlanTab from './MealPlanTab';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    meals: [],
    addMeal: vi.fn(),
    updateMeal: vi.fn(),
    pantry: [],
    addShoppingItem: vi.fn(),
    shoppingList: [],
    mealPlan: [],
    addMealPlanItem: vi.fn(),
    updateMealPlanItem: vi.fn(),
    deleteMealPlanItem: vi.fn(),
    householdId: 'test-household',
  }),
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
  Star: () => <div data-testid="star-icon" />,
}));

describe('MealPlanTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

    // Expected Monday start: Oct 23 - Oct 29
    // Current Sunday start: Oct 22 - Oct 28

    // We search for the date range text
    const dateRange = screen.getByText(/Oct 23 - Oct 29/i);
    expect(dateRange).toBeInTheDocument();
  });
});
