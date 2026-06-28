import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ListsPage from './ListsPage';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { PlanTab } from '@/utils/moduleVisibility';

// Mock child components
vi.mock('./ToDosPage', () => ({
  default: () => <div data-testid="todos-page">ToDos Page Content</div>
}));
vi.mock('@/components/meals/MealPlanTab', () => ({
  default: () => <div data-testid="meals-page">Meals Page Content</div>
}));
vi.mock('@/components/meals/ShoppingListTab', () => ({
  default: () => <div data-testid="shopping-page">Shopping Page Content</div>
}));

// Module visibility (Plan 090): mocked so each test can choose which sub-tabs
// are enabled. Defaults to all-on (full 3-tab layout = pre-090 behavior).
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` tabs are visible. */
const setEnabledTabs = (enabled: PlanTab[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: () => true,
    isPlanVisible: enabled.length > 0,
    isPlanTabVisible: (tab: PlanTab) => enabled.includes(tab),
  });
};

describe('ListsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    setEnabledTabs(['todos', 'meals', 'shopping']);
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

  it('falls back to the first enabled tab when the remembered tab is disabled', () => {
    // Remembered tab is meals, but only shopping is enabled now.
    localStorage.setItem('lists-active-tab', 'meals');
    setEnabledTabs(['shopping']);
    render(<ListsPage />);
    expect(screen.getByTestId('shopping-page')).toBeInTheDocument();
    expect(screen.queryByTestId('meals-page')).not.toBeInTheDocument();
  });

  it('only renders enabled tabs in the strip', () => {
    setEnabledTabs(['todos', 'shopping']);
    render(<ListsPage />);
    expect(screen.getByText('To-Dos')).toBeInTheDocument();
    expect(screen.getByText('Shopping')).toBeInTheDocument();
    expect(screen.queryByText('Meals')).not.toBeInTheDocument();
  });

  it('hides the tab strip when only one tab is enabled', () => {
    setEnabledTabs(['todos']);
    render(<ListsPage />);
    // Single enabled tab renders its content with no switchable strip.
    expect(screen.getByTestId('todos-page')).toBeInTheDocument();
    expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
    expect(screen.queryByText('Meals')).not.toBeInTheDocument();
  });
});
