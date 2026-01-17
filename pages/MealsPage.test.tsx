import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MealsPage from './MealsPage';

// Mock child components to isolate MealsPage logic
vi.mock('@/components/meals/PantryTab', () => ({
  default: () => <div data-testid="pantry-tab">Pantry Content</div>
}));

vi.mock('@/components/meals/MealPlanTab', () => ({
  default: () => <div data-testid="meal-plan-tab">Meal Plan Content</div>
}));

vi.mock('@/components/meals/ShoppingListTab', () => ({
  default: () => <div data-testid="shopping-list-tab">Shopping List Content</div>
}));

describe('MealsPage', () => {
  it('renders all three tabs: Pantry, Meal Plan, and Shopping List', () => {
    render(<MealsPage />);

    // Check for Tab Buttons
    expect(screen.getByRole('tab', { name: /pantry/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /meal plan/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /shopping list/i })).toBeInTheDocument();
  });

  it('switches content when tabs are clicked', () => {
    render(<MealsPage />);

    // Default should be Pantry
    expect(screen.getByTestId('pantry-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('meal-plan-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shopping-list-tab')).not.toBeInTheDocument();

    // Click Meal Plan
    fireEvent.click(screen.getByRole('tab', { name: /meal plan/i }));
    expect(screen.getByTestId('meal-plan-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('pantry-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shopping-list-tab')).not.toBeInTheDocument();

    // Click Shopping List
    fireEvent.click(screen.getByRole('tab', { name: /shopping list/i }));
    expect(screen.getByTestId('shopping-list-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('pantry-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meal-plan-tab')).not.toBeInTheDocument();
  });
});
