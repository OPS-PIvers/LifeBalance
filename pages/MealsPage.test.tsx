import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MealsPage from './MealsPage';

// Mock child components to isolate MealsPage logic
vi.mock('@/components/meals/MealPlanTab', () => ({
  default: () => <div data-testid="meal-plan-tab">Meal Plan Content</div>
}));

vi.mock('@/components/meals/ShoppingListTab', () => ({
  default: () => <div data-testid="shopping-list-tab">Shopping List Content</div>
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Calendar: () => <div data-testid="calendar-icon" />,
  ShoppingCart: () => <div data-testid="shopping-cart-icon" />,
}));

describe('MealsPage', () => {
  it('renders both tabs: Meal Plan and Shopping List', () => {
    render(
      <MemoryRouter>
        <MealsPage />
      </MemoryRouter>
    );

    // Check for Tab Buttons
    expect(screen.getByRole('tab', { name: /meal plan/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /shopping list/i })).toBeInTheDocument();
  });

  it('switches content when tabs are clicked', () => {
    render(
      <MemoryRouter>
        <MealsPage />
      </MemoryRouter>
    );

    // Default should be Meal Plan
    expect(screen.getByTestId('meal-plan-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('shopping-list-tab')).not.toBeInTheDocument();

    // Click Shopping List
    fireEvent.click(screen.getByRole('tab', { name: /shopping list/i }));
    expect(screen.getByTestId('shopping-list-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('meal-plan-tab')).not.toBeInTheDocument();
  });
});
