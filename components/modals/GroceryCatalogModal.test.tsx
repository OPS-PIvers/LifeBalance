import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GroceryCatalogModal from './GroceryCatalogModal';

// Mock dependencies
const mockHousehold = {
  groceryCatalog: [
    {
      id: '1',
      name: 'Milk',
      category: 'Dairy',
      defaultQuantity: '1',
      defaultStore: 'Store A',
      purchaseCount: 5,
      lastPurchased: new Date().toISOString()
    },
    {
      id: '2',
      name: 'Bread',
      category: 'Bakery',
      defaultQuantity: '1',
      defaultStore: 'Store B',
      purchaseCount: 3,
      lastPurchased: new Date().toISOString()
    }
  ],
  shoppingList: [] as unknown[],
  loadFullGroceryCatalog: vi.fn(async () => {}),
  addShoppingItem: vi.fn(),
  updateGroceryCatalogItem: vi.fn(),
  deleteGroceryCatalogItem: vi.fn()
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useShopping: () => mockHousehold
}));

// Mock Drawer to verify it's being used, while still rendering the fixed
// header/footer slots so the single-sheet view-swap can be exercised.
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({
    children,
    isOpen,
    header,
    footer,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    header?: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="drawer">
        {header}
        {children}
        {footer}
      </div>
    ) : null,
}));

describe('GroceryCatalogModal', () => {
  it('renders without crashing', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Previously Purchased')).toBeInTheDocument();
  });

  it('renders always-visible edit and delete actions for each item (no action sheet)', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);

    // Since we have 2 items in mock data, we expect 2 of each action.
    expect(screen.getAllByLabelText(/^Edit /).length).toBe(2);
    expect(screen.getAllByLabelText(/from history$/).length).toBe(2);

    // The old "More options" action-sheet trigger is gone entirely.
    expect(screen.queryByLabelText('More options')).not.toBeInTheDocument();
    expect(screen.queryByText('Item Options')).not.toBeInTheDocument();
  });

  it('swaps to an in-sheet edit view (single sheet, no nested Drawer) when Edit is clicked', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Edit Milk'));

    // Only one Drawer instance should ever be rendered.
    expect(screen.getAllByTestId('drawer').length).toBe(1);

    expect(screen.getByText('Edit History Item')).toBeInTheDocument();
    expect(screen.getByLabelText('Back to history')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument();

    // The list view (and its "Previously Purchased" header) is no longer shown.
    expect(screen.queryByText('Previously Purchased')).not.toBeInTheDocument();
  });

  it('returns to the list view when the back button is clicked', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Edit Milk'));
    expect(screen.getByText('Edit History Item')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Back to history'));

    expect(screen.getByText('Previously Purchased')).toBeInTheDocument();
    expect(screen.queryByText('Edit History Item')).not.toBeInTheDocument();
  });

  it('opens the remove confirmation when Delete is clicked', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Delete Milk from history'));

    expect(screen.getByText('Remove from History')).toBeInTheDocument();
  });
});
