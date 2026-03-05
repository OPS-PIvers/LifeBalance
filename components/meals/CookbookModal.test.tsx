import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CookbookModal } from './CookbookModal';
import { Meal } from '@/types/schema';
import React, { PropsWithChildren } from 'react';

// Mock dependencies
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, ariaLabelledBy }: PropsWithChildren<{ isOpen: boolean; ariaLabelledBy?: string }>) => isOpen ? <div role="dialog" aria-labelledby={ariaLabelledBy}>{children}</div> : null,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, ...props }: PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => <button onClick={onClick} {...props}>{children}</button>,
}));

vi.mock('@/components/ui/Input', () => ({
  default: ({ value, onChange, placeholder }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} placeholder={placeholder} />
  ),
}));

// Mock icons
vi.mock('lucide-react', () => ({
  Search: () => <div data-testid="search-icon" />,
  ChevronRight: () => <div data-testid="chevron-right-icon" />,
  Copy: () => <div data-testid="copy-icon" />,
  X: () => <div data-testid="x-icon" />,
  ArrowUpAZ: () => <div data-testid="sort-az-icon" />,
  Calendar: () => <div data-testid="calendar-icon" />,
  Star: () => <div data-testid="star-icon" />,
  ChefHat: () => <div data-testid="chef-hat-icon" />,
  Download: () => <div data-testid="download-icon" />
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: (date: Date, _fmt: string) => `Formatted(${date.toISOString()})`,
  parseISO: (str: string) => new Date(str),
}));

const mockMeals: Meal[] = [
  {
    id: '1',
    name: 'Adobo Chicken',
    description: 'Filipino classic',
    ingredients: [{ name: 'Chicken' }, { name: 'Soy Sauce' }],
    tags: ['Filipino', 'Chicken'],
    rating: 5,
    lastCooked: '2023-10-25',
    instructions: [],
    recipeUrl: '',
  } as Meal,
  {
    id: '2',
    name: 'Beef Stir Fry',
    description: 'Quick dinner',
    ingredients: [{ name: 'Beef' }, { name: 'Broccoli' }],
    tags: ['Quick', 'Beef'],
    rating: 4,
    lastCooked: '2023-10-20',
    instructions: [],
    recipeUrl: '',
  } as Meal,
  {
    id: '3',
    name: 'Vegetable Curry',
    description: 'Spicy and healthy',
    ingredients: [{ name: 'Potato' }, { name: 'Carrot' }],
    tags: ['Vegetarian', 'Spicy'],
    rating: 3,
    lastCooked: '2023-10-01',
    instructions: [],
    recipeUrl: '',
  } as Meal,
];

describe('CookbookModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSelect = vi.fn();
  const mockOnClone = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly when open', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Cookbook')).toBeInTheDocument();
    expect(screen.getByText('3 recipes found')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search recipes, ingredients...')).toBeInTheDocument();

    // Check if all meals are rendered
    mockMeals.forEach(meal => {
      expect(screen.getByText(meal.name)).toBeInTheDocument();
    });
  });

  it('does not render when closed', () => {
    render(
      <CookbookModal
        isOpen={false}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters meals by search term', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    const input = screen.getByPlaceholderText('Search recipes, ingredients...');
    fireEvent.change(input, { target: { value: 'chicken' } });

    expect(screen.getByText('Adobo Chicken')).toBeInTheDocument();
    expect(screen.queryByText('Beef Stir Fry')).not.toBeInTheDocument();
    expect(screen.queryByText('Vegetable Curry')).not.toBeInTheDocument();
  });

  it('filters meals by tag', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    const tagButton = screen.getByRole('button', { name: 'Vegetarian' });
    fireEvent.click(tagButton);

    expect(screen.getByText('Vegetable Curry')).toBeInTheDocument();
    expect(screen.queryByText('Adobo Chicken')).not.toBeInTheDocument();
    expect(screen.queryByText('Beef Stir Fry')).not.toBeInTheDocument();
  });

  it('sorts meals by rating', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    const sortButton = screen.getByLabelText('Sort by Rating');
    fireEvent.click(sortButton);

    const items = screen.getAllByText(/Adobo Chicken|Beef Stir Fry|Vegetable Curry/);
    // Should be descending rating: Adobo (5), Beef (4), Curry (3)
    expect(items[0]).toHaveTextContent('Adobo Chicken');
    expect(items[1]).toHaveTextContent('Beef Stir Fry');
    expect(items[2]).toHaveTextContent('Vegetable Curry');
  });

  it('calls onSelect when a meal is clicked', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    const mealButton = screen.getByText('Adobo Chicken').closest('button');
    if (!mealButton) throw new Error('Meal button not found');
    fireEvent.click(mealButton);

    expect(mockOnSelect).toHaveBeenCalledWith(mockMeals[0]);
  });

  it('calls onClone when clone button is clicked', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    const cloneButtons = screen.getAllByLabelText('Clone as New Meal');
    fireEvent.click(cloneButtons[0]);

    expect(mockOnClone).toHaveBeenCalledWith(mockMeals[0]);
  });

  it('has accessible labels', () => {
    render(
      <CookbookModal
        isOpen={true}
        onClose={mockOnClose}
        meals={mockMeals}
        onSelect={mockOnSelect}
        onClone={mockOnClone}
      />
    );

    expect(screen.getByLabelText('Close')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort by Name')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Clone as New Meal')[0]).toBeInTheDocument();

    // Check aria-labelledby on modal
    const modal = screen.getByRole('dialog');
    expect(modal).toHaveAttribute('aria-labelledby', 'cookbook-modal-title');
    expect(screen.getByText('Cookbook')).toHaveAttribute('id', 'cookbook-modal-title');
  });
});
