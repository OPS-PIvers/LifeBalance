import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MealPlanTab from './MealPlanTab';
import React from 'react';
import { format, startOfWeek } from 'date-fns';

// Mock dependencies
const mockAddMeal = vi.fn();
const mockUpdateMeal = vi.fn();
const mockAddShoppingItem = vi.fn();
const mockAddMealPlanItem = vi.fn();
const mockUpdateMealPlanItem = vi.fn();
const mockDeleteMealPlanItem = vi.fn();

// We use a mutable object so we can update values in tests
const mockUseHouseholdData: any = {
  meals: [],
  addMeal: mockAddMeal,
  updateMeal: mockUpdateMeal,
  pantry: [],
  addShoppingItem: mockAddShoppingItem,
  shoppingList: [],
  mealPlan: [],
  addMealPlanItem: mockAddMealPlanItem,
  updateMealPlanItem: mockUpdateMealPlanItem,
  deleteMealPlanItem: mockDeleteMealPlanItem,
  householdId: 'test-household',
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockUseHouseholdData,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="plus-icon">Plus</span>,
  Trash2: () => <span data-testid="trash-icon">Trash</span>,
  Edit2: () => <span data-testid="edit-icon">Edit</span>,
  Sparkles: () => <span data-testid="sparkles-icon">Sparkles</span>,
  ChefHat: () => <span data-testid="chef-hat-icon">ChefHat</span>,
  ChevronRight: () => <span data-testid="chevron-right-icon">Next</span>,
  ChevronLeft: () => <span data-testid="chevron-left-icon">Prev</span>,
  ShoppingCart: () => <span data-testid="shopping-cart-icon">Cart</span>,
  Loader2: () => <span data-testid="loader-icon">Loading</span>,
  X: () => <span data-testid="x-icon">X</span>,
  Copy: () => <span data-testid="copy-icon">Copy</span>,
}));

describe('MealPlanTab', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockUseHouseholdData.meals = [];
    mockUseHouseholdData.mealPlan = [];
    mockUseHouseholdData.shoppingList = [];

    // Resolve promises immediately by default
    mockAddMeal.mockResolvedValue('new-meal-id');
    mockAddMealPlanItem.mockResolvedValue('new-plan-id');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the week view with correct dates', () => {
    vi.useFakeTimers();
    const testDate = new Date(2023, 9, 25); // Wed Oct 25 2023
    vi.setSystemTime(testDate);
    render(<MealPlanTab />);

    // Week starts Mon Oct 23
    expect(screen.getByText(/Oct 23 - Oct 29/i)).toBeInTheDocument();

    // Check for day headers
    expect(screen.getByText('23')).toBeInTheDocument(); // Monday
    expect(screen.getByText('Monday')).toBeInTheDocument();
    expect(screen.getByText('29')).toBeInTheDocument(); // Sunday
    expect(screen.getByText('Sunday')).toBeInTheDocument();
  });

  it('renders empty state for days with no meals', () => {
    render(<MealPlanTab />);
    const emptyStates = screen.getAllByText('No meals planned');
    expect(emptyStates).toHaveLength(7);
  });

  it('opens add meal modal when clicking "Add Meal" button', async () => {
    const user = userEvent.setup();
    render(<MealPlanTab />);

    // Click first "Add Meal" button (Monday)
    const addButtons = screen.getAllByRole('button', { name: /add meal/i });
    await user.click(addButtons[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Header text depends on the date, e.g. "Plan for Oct 23"
    expect(screen.getByRole('heading', { name: /plan for/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/meal name/i)).toBeInTheDocument();
  });

  it('allows creating a new meal', async () => {
    const user = userEvent.setup();
    render(<MealPlanTab />);

    // Open modal
    const addButtons = screen.getAllByRole('button', { name: /add meal/i });
    await user.click(addButtons[0]);

    // Fill form
    await user.type(screen.getByLabelText(/meal name/i), 'Test Pasta');
    await user.type(screen.getByLabelText(/description/i), 'Delicious pasta test');

    // Save
    await user.click(screen.getByRole('button', { name: /save to plan/i }));

    expect(mockAddMeal).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test Pasta',
      description: 'Delicious pasta test'
    }));

    // Should also add to plan
    expect(mockAddMealPlanItem).toHaveBeenCalled();
  });

  it('displays existing meal plan items', () => {
    vi.useFakeTimers();
    const testDate = new Date(2023, 9, 23); // Monday
    vi.setSystemTime(testDate);

    // Mock data
    mockUseHouseholdData.meals = [
      { id: 'm1', name: 'Burger', description: 'Yum' }
    ];
    mockUseHouseholdData.mealPlan = [
      { id: 'p1', date: '2023-10-23', mealId: 'm1', mealName: 'Burger', type: 'dinner' }
    ];

    render(<MealPlanTab />);

    expect(screen.getByText('Burger')).toBeInTheDocument();
    expect(screen.getByText('Yum')).toBeInTheDocument();
    expect(screen.getByText(/dinner/i)).toBeInTheDocument();
  });

  it('allows deleting a meal plan item', async () => {
    const user = userEvent.setup();

    // Don't mock time, use current date to ensure userEvent works reliably
    const today = new Date();
    const monday = startOfWeek(today, { weekStartsOn: 1 });
    const mondayStr = format(monday, 'yyyy-MM-dd');

    mockUseHouseholdData.meals = [{ id: 'm1', name: 'Burger' }];
    mockUseHouseholdData.mealPlan = [
      { id: 'p1', date: mondayStr, mealId: 'm1', mealName: 'Burger', type: 'dinner' }
    ];

    render(<MealPlanTab />);

    // Find delete button
    const deleteButton = screen.getByRole('button', { name: /delete burger/i });
    await user.click(deleteButton);

    expect(mockDeleteMealPlanItem).toHaveBeenCalledWith('p1');
  });

  it('adds ingredients to the list', async () => {
    const user = userEvent.setup();
    render(<MealPlanTab />);

    // Open modal
    const addButtons = screen.getAllByRole('button', { name: /add meal/i });
    await user.click(addButtons[0]);

    // Add ingredient
    const nameInput = screen.getByPlaceholderText('Item name');
    const qtyInput = screen.getByLabelText('Ingredient quantity');

    await user.type(nameInput, 'Tomato');
    await user.type(qtyInput, '2');
    await user.click(screen.getByRole('button', { name: /add ingredient/i }));

    expect(screen.getByText('Tomato')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('adds weekly ingredients to shopping list', async () => {
    const user = userEvent.setup();
    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    // Dynamic date approach to avoid timer issues
    const today = new Date();
    const monday = startOfWeek(today, { weekStartsOn: 1 });
    const mondayStr = format(monday, 'yyyy-MM-dd');

    mockUseHouseholdData.meals = [{ id: 'm1', name: 'Burger', ingredients: [{name: 'Beef', quantity: '1'}] }];
    mockUseHouseholdData.mealPlan = [
      { id: 'p1', date: mondayStr, mealId: 'm1', mealName: 'Burger', type: 'dinner' }
    ];

    render(<MealPlanTab />);

    await user.click(screen.getByRole('button', { name: /shop this week/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockAddShoppingItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beef' }));
  });
});
