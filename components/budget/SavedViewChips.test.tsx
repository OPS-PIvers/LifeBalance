import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SavedViewChips from './SavedViewChips';

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock icons
vi.mock('lucide-react', () => ({
  Bookmark: () => <div data-testid="bookmark-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
  X: () => <div data-testid="x-icon" />,
}));

describe('SavedViewChips', () => {
  const mockOnApply = vi.fn();
  const householdId = 'test-household';
  const currentFilters = {
    searchTerm: 'test',
    categoryFilter: 'Food',
    sourceFilter: 'all'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders correctly', () => {
    render(
      <SavedViewChips
        householdId={householdId}
        currentFilters={currentFilters}
        onApply={mockOnApply}
      />
    );
    expect(screen.getByText('Views')).toBeInTheDocument();
    expect(screen.getByText('Save View')).toBeInTheDocument();
  });

  it('saves a new view', () => {
    render(
      <SavedViewChips
        householdId={householdId}
        currentFilters={currentFilters}
        onApply={mockOnApply}
      />
    );

    // Click Save View
    fireEvent.click(screen.getByText('Save View'));

    // Input name
    const input = screen.getByPlaceholderText('View Name...');
    fireEvent.change(input, { target: { value: 'My View' } });

    // Submit
    const submitBtn = screen.getByTestId('plus-icon').closest('button');
    fireEvent.click(submitBtn!);

    // Check if chip appears
    expect(screen.getByText('My View')).toBeInTheDocument();

    // Check localStorage
    const stored = localStorage.getItem(`transaction_views_${householdId}`);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toHaveLength(1);
    expect(JSON.parse(stored!)[0].name).toBe('My View');
    expect(JSON.parse(stored!)[0].filters).toEqual(currentFilters);
  });

  it('applies a view', () => {
    // Seed localStorage
    const view = {
      id: '1',
      name: 'Test View',
      filters: { searchTerm: 'foo', categoryFilter: 'bar', sourceFilter: 'baz' }
    };
    localStorage.setItem(`transaction_views_${householdId}`, JSON.stringify([view]));

    render(
      <SavedViewChips
        householdId={householdId}
        currentFilters={currentFilters}
        onApply={mockOnApply}
      />
    );

    // Click chip
    fireEvent.click(screen.getByText('Test View'));

    expect(mockOnApply).toHaveBeenCalledWith(view.filters);
  });

  it('deletes a view', () => {
    // Seed localStorage
    const view = {
      id: '1',
      name: 'Test View',
      filters: currentFilters
    };
    localStorage.setItem(`transaction_views_${householdId}`, JSON.stringify([view]));

    render(
      <SavedViewChips
        householdId={householdId}
        currentFilters={currentFilters}
        onApply={mockOnApply}
      />
    );

    expect(screen.getByText('Test View')).toBeInTheDocument();

    // Click the delete button (X icon) on the chip
    const deleteBtn = screen.getByLabelText('Delete view Test View');
    fireEvent.click(deleteBtn);

    // ConfirmDialog should appear
    expect(screen.getByText('Delete Saved View')).toBeInTheDocument();

    // Confirm the deletion
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    expect(screen.queryByText('Test View')).not.toBeInTheDocument();

    const stored = localStorage.getItem(`transaction_views_${householdId}`);
    expect(JSON.parse(stored!)).toHaveLength(0);
  });
});
