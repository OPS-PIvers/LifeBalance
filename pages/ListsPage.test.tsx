import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ListsPage from './ListsPage';
import React from 'react';

// Mock child components
vi.mock('./ToDosPage', () => ({
  default: () => <div data-testid="todos-page">ToDos Page Content</div>
}));
vi.mock('../components/meals/MealPlanTab', () => ({
  default: () => <div data-testid="meals-page">Meals Page Content</div>
}));
vi.mock('../components/meals/ShoppingListTab', () => ({
  default: () => <div data-testid="shopping-page">Shopping Page Content</div>
}));

describe('ListsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('renders defaults to To-Dos tab', () => {
    render(<ListsPage />);
    expect(screen.getByText('To-Dos')).toBeInTheDocument();
    expect(screen.getByTestId('todos-page')).toBeInTheDocument();
  });

  it('switches tabs correctly', () => {
    render(<ListsPage />);

    // Click Meals
    fireEvent.click(screen.getByText('Meals'));
    expect(screen.getByTestId('meals-page')).toBeInTheDocument();
    expect(localStorage.getItem('lists-active-tab')).toBe('meals');

    // Click Shopping
    fireEvent.click(screen.getByText('Shopping'));
    expect(screen.getByTestId('shopping-page')).toBeInTheDocument();
    expect(localStorage.getItem('lists-active-tab')).toBe('shopping');
  });

  it('remembers last active tab from localStorage', () => {
    localStorage.setItem('lists-active-tab', 'shopping');
    render(<ListsPage />);
    expect(screen.getByTestId('shopping-page')).toBeInTheDocument();
  });
});
