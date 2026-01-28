import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MealPlanTab from './MealPlanTab';
import * as FirebaseHouseholdContext from '@/contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
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
}));

describe('MealPlanTab', () => {
  const mockAddMeal = vi.fn();
  const mockUpdateMeal = vi.fn();
  const mockAddShoppingItem = vi.fn();
  const mockAddMealPlanItem = vi.fn();
  const mockUpdateMealPlanItem = vi.fn();
  const mockDeleteMealPlanItem = vi.fn();

  const defaultContextValues = {
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

  beforeEach(() => {
    // Only fake Date to ensure deterministic rendering, but keep setTimeout/promises real for waitFor
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.clearAllMocks();
    (FirebaseHouseholdContext.useHousehold as any).mockReturnValue(defaultContextValues);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the week on Monday', () => {
    // Set date to Wednesday, Oct 25, 2023
    const testDate = new Date(2023, 9, 25); // Month is 0-indexed: 9 = Oct
    vi.setSystemTime(testDate);

    render(<MealPlanTab />);

    // Expected Monday start: Oct 23 - Oct 29
    const dateRange = screen.getByText(/Oct 23 - Oct 29/i);
    expect(dateRange).toBeInTheDocument();
  });

  it('renders meals for the current week', () => {
    const testDate = new Date(2023, 9, 25); // Wed Oct 25 2023
    vi.setSystemTime(testDate);

    const mockMealPlan = [
      {
        id: 'plan-1',
        date: '2023-10-23', // Monday
        mealName: 'Spaghetti Bolognese',
        mealId: 'meal-1',
        type: 'dinner',
      },
      {
        id: 'plan-2',
        date: '2023-10-25', // Wednesday
        mealName: 'Tacos',
        mealId: 'meal-2',
        type: 'lunch',
      },
    ];

    (FirebaseHouseholdContext.useHousehold as any).mockReturnValue({
      ...defaultContextValues,
      mealPlan: mockMealPlan,
    });

    render(<MealPlanTab />);

    expect(screen.getByText('Spaghetti Bolognese')).toBeInTheDocument();
    expect(screen.getByText('Tacos')).toBeInTheDocument();

    // Check type badges
    const dinnerBadges = screen.getAllByText('dinner');
    expect(dinnerBadges.length).toBeGreaterThan(0);
    const lunchBadges = screen.getAllByText('lunch');
    expect(lunchBadges.length).toBeGreaterThan(0);
  });

  it('opens Add Meal modal when clicking the add button on a day', async () => {
    const user = userEvent.setup();
    const testDate = new Date(2023, 9, 25); // Wed Oct 25 2023
    vi.setSystemTime(testDate);

    render(<MealPlanTab />);

    // Find "Add Meal" buttons. There should be one for each day.
    const addButtons = screen.getAllByText('Add Meal');
    // Click the first one (Monday Oct 23)
    await user.click(addButtons[0]);

    // Check if modal title appears
    // Since we clicked Monday Oct 23, the title should be "Plan for Oct 23"
    expect(screen.getByText('Plan for Oct 23')).toBeInTheDocument();

    // Check for form inputs
    expect(screen.getByPlaceholderText('e.g. Adobo Chicken & Rice')).toBeInTheDocument();
  });

  it('calls addMeal and addMealPlanItem when saving a new meal', async () => {
    const user = userEvent.setup();
    const testDate = new Date(2023, 9, 25);
    vi.setSystemTime(testDate);

    // Mock addMeal to return a promise with a new ID
    mockAddMeal.mockResolvedValue('new-meal-id');
    mockAddMealPlanItem.mockResolvedValue('new-plan-id');

    render(<MealPlanTab />);

    // Open modal for Monday
    const addButtons = screen.getAllByText('Add Meal');
    await user.click(addButtons[0]);

    // Fill in the form
    const nameInput = screen.getByPlaceholderText('e.g. Adobo Chicken & Rice');
    await user.type(nameInput, 'Chicken Curry');

    const descInput = screen.getByPlaceholderText('Add notes about preparation...');
    await user.type(descInput, 'Spicy and good');

    // Click Save
    const saveButton = screen.getByText('Save to Plan');
    await user.click(saveButton);

    await waitFor(() => {
        expect(mockAddMeal).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Chicken Curry',
            description: 'Spicy and good',
        }));

        expect(mockAddMealPlanItem).toHaveBeenCalledWith(expect.objectContaining({
            date: '2023-10-23',
            mealName: 'Chicken Curry',
            mealId: 'new-meal-id',
            type: 'dinner', // default
        }));
    });
  });

  it('calls deleteMealPlanItem when delete button is clicked', async () => {
    const user = userEvent.setup();
    const testDate = new Date(2023, 9, 25);
    vi.setSystemTime(testDate);

    const mockMealPlan = [
      {
        id: 'plan-1',
        date: '2023-10-23',
        mealName: 'Pizza',
        mealId: 'meal-1',
        type: 'dinner',
      },
    ];

    (FirebaseHouseholdContext.useHousehold as any).mockReturnValue({
      ...defaultContextValues,
      mealPlan: mockMealPlan,
    });

    render(<MealPlanTab />);

    const deleteButton = screen.getByLabelText('Delete Pizza');
    await user.click(deleteButton);

    expect(mockDeleteMealPlanItem).toHaveBeenCalledWith('plan-1');
  });

  it('adds custom tag', async () => {
    const user = userEvent.setup();
    const testDate = new Date(2023, 9, 25);
    vi.setSystemTime(testDate);

    render(<MealPlanTab />);

    // Open modal
    const addButtons = screen.getAllByText('Add Meal');
    await user.click(addButtons[0]);

    // Add tag
    const tagInput = screen.getByPlaceholderText('Add custom tag...');
    await user.type(tagInput, 'Spicy');

    // Use getByRole for better specificity
    const addTagButton = screen.getByRole('button', { name: 'Add custom tag' });
    await user.click(addTagButton);

    expect(screen.getByText('Spicy')).toBeInTheDocument();
  });
});
