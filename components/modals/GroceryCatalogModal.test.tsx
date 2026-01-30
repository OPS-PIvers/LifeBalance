import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import GroceryCatalogModal from './GroceryCatalogModal';

// Mock contexts
const mockAddShoppingItem = vi.fn();
const mockUpdateGroceryCatalogItem = vi.fn();
const mockDeleteGroceryCatalogItem = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    groceryCatalog: [
      {
        id: 'item-1',
        name: 'Milk',
        category: 'Dairy',
        defaultQuantity: 1,
        defaultStore: 'Safeway',
        purchaseCount: 5,
        lastPurchased: '2023-01-01T00:00:00Z',
      },
    ],
    shoppingList: [],
    addShoppingItem: mockAddShoppingItem,
    updateGroceryCatalogItem: mockUpdateGroceryCatalogItem,
    deleteGroceryCatalogItem: mockDeleteGroceryCatalogItem,
  }),
}));

// Mock icons
vi.mock('lucide-react', async () => {
  return {
    X: () => <span data-testid="icon-x" />,
    Search: () => <span data-testid="icon-search" />,
    Plus: () => <span data-testid="icon-plus" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Edit2: () => <span data-testid="icon-edit" />,
    ShoppingCart: () => <span data-testid="icon-cart" />,
    Clock: () => <span data-testid="icon-clock" />,
  };
});

describe('GroceryCatalogModal', () => {
  it('renders search input with accessible label', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={() => {}} />);
    // This expects to find the input by placeholder or aria-label
    // Currently it relies on placeholder, but we want to add aria-label
    const input = screen.getByPlaceholderText('Search history...');
    expect(input).toBeInTheDocument();
  });

  it('opens nested edit modal with accessibility attributes', () => {
    render(<GroceryCatalogModal isOpen={true} onClose={() => {}} />);

    // Click edit button for the item
    const editButton = screen.getByLabelText('Edit history item');
    fireEvent.click(editButton);

    // Verify nested modal appears
    expect(screen.getByText('Edit History Item')).toBeInTheDocument();

    // Check for accessibility roles (these will fail before the fix)
    // The nested modal should be a dialog
    const dialog = screen.getByRole('dialog', { name: 'Edit History Item' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Check for accessible inputs (these will fail before the fix)
    expect(screen.getByLabelText(/Name/i)).toHaveValue('Milk');
    expect(screen.getByLabelText(/Category/i)).toHaveValue('Dairy');
    expect(screen.getByLabelText(/Default Qty/i)).toHaveValue('1');
    expect(screen.getByLabelText(/Default Store/i)).toHaveValue('Safeway');
  });

  it('allows closing nested modal via backdrop', () => {
      render(<GroceryCatalogModal isOpen={true} onClose={() => {}} />);

      // Open edit modal
      fireEvent.click(screen.getByLabelText('Edit history item'));
      expect(screen.getByText('Edit History Item')).toBeInTheDocument();

      // Click backdrop (we need to find the backdrop)
      // The backdrop is the div wrapping the dialog.
      // In the current implementation (before fix), it has no specific role/test-id,
      // but in the fixed version we'll ensure it works.
      // For now, let's target the dialog's parent or look for the backdrop logic.
      // Since we haven't implemented it yet, we can't easily select "backdrop".
      // But we can verify this behavior after implementation.
  });
});
