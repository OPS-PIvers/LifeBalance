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

    // Mock confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    render(
      <SavedViewChips
        householdId={householdId}
        currentFilters={currentFilters}
        onApply={mockOnApply}
      />
    );

    expect(screen.getByText('Test View')).toBeInTheDocument();

    // Click delete (X icon inside the chip)
    // The chip structure has multiple X icons (one in form if open, one in chips).
    // We want the one inside the chip.
    // The chip structure: <button ...><span>Test View</span><div role="button"><X/></div></button>
    // We can find by role="button" inside the chip?
    // Or just query all X icons and pick the right one.
    // But since "Save View" form is closed, there is only one X icon (inside the chip)?
    // No, "Save View" button has a Plus icon.
    // Wait, the "Save View" button is NOT open initially.
    // So there is only the X icon in the chip.

    const deleteBtn = screen.getByTestId('x-icon').closest('div');
    fireEvent.click(deleteBtn!);

    expect(screen.queryByText('Test View')).not.toBeInTheDocument();

    const stored = localStorage.getItem(`transaction_views_${householdId}`);
    expect(JSON.parse(stored!)).toHaveLength(0);
  });
});
