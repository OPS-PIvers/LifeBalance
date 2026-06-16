import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterControls, { type FilterControlsProps } from './FilterControls';

const baseProps: FilterControlsProps = {
  categoryFilter: 'all',
  setCategoryFilter: vi.fn(),
  sourceFilter: 'all',
  setSourceFilter: vi.fn(),
  storeFilter: 'all',
  setStoreFilter: vi.fn(),
  categories: ['Food', 'Gas'],
  stores: [
    { id: 's1', name: 'Safeway' },
    { id: 's2', name: 'Costco' },
  ],
  layout: 'row',
};

describe('FilterControls', () => {
  it('renders the three filter selects with provided options', () => {
    render(<FilterControls {...baseProps} />);

    // Category options
    expect(screen.getByText('All Categories')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Gas')).toBeInTheDocument();

    // Source options (static)
    expect(screen.getByText('All Sources')).toBeInTheDocument();
    expect(screen.getByText('Recurring')).toBeInTheDocument();

    // Store options
    expect(screen.getByText('All Stores')).toBeInTheDocument();
    expect(screen.getByText('Safeway')).toBeInTheDocument();
    expect(screen.getByText('Costco')).toBeInTheDocument();
  });

  it('shows labels only in stack layout', () => {
    const { rerender } = render(<FilterControls {...baseProps} layout="row" />);
    expect(screen.queryByText('Category')).not.toBeInTheDocument();

    rerender(<FilterControls {...baseProps} layout="stack" />);
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Store')).toBeInTheDocument();
  });

  it('invokes the corresponding setter on change', () => {
    const setCategoryFilter = vi.fn();
    const setStoreFilter = vi.fn();
    render(
      <FilterControls
        {...baseProps}
        setCategoryFilter={setCategoryFilter}
        setStoreFilter={setStoreFilter}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('All Categories'), { target: { value: 'Food' } });
    expect(setCategoryFilter).toHaveBeenCalledWith('Food');

    fireEvent.change(screen.getByDisplayValue('All Stores'), { target: { value: 'Costco' } });
    expect(setStoreFilter).toHaveBeenCalledWith('Costco');
  });
});
