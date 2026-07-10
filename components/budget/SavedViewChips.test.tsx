import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SavedViewChips from './SavedViewChips';

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock icons so we can target buttons by their glyph where needed.
vi.mock('lucide-react', () => ({
  Bookmark: () => <div data-testid="bookmark-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
  X: () => <div data-testid="x-icon" />,
  Check: () => <div data-testid="check-icon" />,
}));

const householdId = 'test-household';
const currentFilters = {
  searchTerm: 'test',
  categoryFilter: 'Food',
  sourceFilter: 'all',
};

const renderChips = (onApply = vi.fn()) => {
  render(
    <SavedViewChips
      householdId={householdId}
      currentFilters={currentFilters}
      onApply={onApply}
    />
  );
  return onApply;
};

const openMenu = () => fireEvent.click(screen.getByLabelText('Saved views'));

describe('SavedViewChips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders only the compact bookmark trigger; the menu is closed by default', () => {
    renderChips();
    expect(screen.getByLabelText('Saved views')).toBeInTheDocument();
    // Nothing from the dropdown is rendered until it's opened.
    expect(screen.queryByText('Save current view')).not.toBeInTheDocument();
    expect(screen.queryByText('No saved views yet.')).not.toBeInTheDocument();
  });

  it('shows an empty state and a save action once opened', () => {
    renderChips();
    openMenu();
    expect(screen.getByText('No saved views yet.')).toBeInTheDocument();
    expect(screen.getByText('Save current view')).toBeInTheDocument();
  });

  it('badges the trigger with the saved-view count', () => {
    localStorage.setItem(
      `transaction_views_${householdId}`,
      JSON.stringify([
        { id: '1', name: 'A', filters: currentFilters },
        { id: '2', name: 'B', filters: currentFilters },
      ])
    );
    renderChips();
    expect(screen.getByLabelText('Saved views')).toHaveTextContent('2');
  });

  it('saves a new view from the menu', () => {
    renderChips();
    openMenu();

    fireEvent.click(screen.getByText('Save current view'));
    fireEvent.change(screen.getByPlaceholderText('View name…'), {
      target: { value: 'My View' },
    });
    fireEvent.click(screen.getByLabelText('Confirm save view'));

    expect(screen.getByText('My View')).toBeInTheDocument();

    const stored = localStorage.getItem(`transaction_views_${householdId}`);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toHaveLength(1);
    expect(JSON.parse(stored!)[0].name).toBe('My View');
    expect(JSON.parse(stored!)[0].filters).toEqual(currentFilters);
  });

  it('applies a view when its name is clicked', () => {
    const view = {
      id: '1',
      name: 'Test View',
      filters: { searchTerm: 'foo', categoryFilter: 'bar', sourceFilter: 'baz' },
    };
    localStorage.setItem(`transaction_views_${householdId}`, JSON.stringify([view]));

    const onApply = renderChips();
    openMenu();
    fireEvent.click(screen.getByText('Test View'));

    expect(onApply).toHaveBeenCalledWith(view.filters);
  });

  it('deletes a view via the confirm dialog', () => {
    const view = { id: '1', name: 'Test View', filters: currentFilters };
    localStorage.setItem(`transaction_views_${householdId}`, JSON.stringify([view]));

    renderChips();
    openMenu();
    expect(screen.getByText('Test View')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete view Test View'));

    // ConfirmDialog appears (the menu closes first to avoid duelling focus traps).
    expect(screen.getByText('Delete Saved View')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    expect(screen.queryByText('Test View')).not.toBeInTheDocument();
    const stored = localStorage.getItem(`transaction_views_${householdId}`);
    expect(JSON.parse(stored!)).toHaveLength(0);
  });

  it('returns null without a household id', () => {
    const { container } = render(
      <SavedViewChips householdId={null} currentFilters={currentFilters} onApply={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
