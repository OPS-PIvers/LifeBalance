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
  addShoppingItem: vi.fn(),
  updateGroceryCatalogItem: vi.fn(),
  deleteGroceryCatalogItem: vi.fn()
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockHousehold
}));

// Mock Drawer to verify it's being used
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ children, isOpen, title }: { children: React.ReactNode, isOpen: boolean, title?: string }) => isOpen ? (
    <div data-testid="drawer">
      {title && <h1>{title}</h1>}
      {children}
    </div>
  ) : null
}));

describe('GroceryCatalogModal Mobile Optimization', () => {
  it('renders without crashing', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Previously Purchased')).toBeInTheDocument();
  });

  it('renders mobile action button for each item', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);

    // Look for the "More options" button which we will add
    // Since we have 2 items in mock data, we expect 2 buttons
    const moreButtons = screen.getAllByLabelText('More options');
    expect(moreButtons.length).toBe(2);
  });

  it('opens action drawer when mobile button is clicked', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={vi.fn()} />);

    const moreButtons = screen.getAllByLabelText('More options');
    fireEvent.click(moreButtons[0]);

    // Check if the drawer with "Item Options" title appears
    expect(screen.getByText('Item Options')).toBeInTheDocument();

    // Check for action buttons
    expect(screen.getByText('Edit Details')).toBeInTheDocument();
    expect(screen.getByText('Remove from History')).toBeInTheDocument();
  });
});
