import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShoppingSettingsModal from './ShoppingSettingsModal';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

// Mock Drawer to render children directly
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ children, isOpen, title }: { children: React.ReactNode; isOpen: boolean; title: string }) =>
    isOpen ? (
      <div data-testid="drawer">
        <h1>{title}</h1>
        {children}
      </div>
    ) : null,
}));

// Mock Lucide icons
vi.mock('lucide-react', () => {
  const icons = [
    'Store', 'Plus', 'Trash2', 'Save', 'RotateCcw', 'Search', 'Check', 'ShoppingBag', 'X',
    'Coffee', 'Baby', 'Home', 'Utensils', 'Zap', 'Car', 'Dog', 'Gift', 'Briefcase',
    'Apple', 'Beer', 'Book', 'Cake', 'Camera', 'Cat', 'Clock', 'CreditCard', 'Dumbbell', 'Flower',
    'Gamepad', 'Hammer', 'Heart', 'Laptop', 'Lightbulb', 'Map', 'Music', 'Package', 'Palette',
    'Pill', 'Pizza', 'Plane', 'Shirt', 'Smartphone', 'Snowflake', 'Sofa', 'Sun', 'Tent', 'Train',
    'Truck', 'Tv', 'Umbrella', 'Wine', 'Wrench'
  ];

  const mockIcons: Record<string, any> = {};
  icons.forEach(icon => {
    mockIcons[icon] = (props: any) => <div data-testid={`${icon}-icon`} {...props} />;
  });

  return mockIcons;
});

describe('ShoppingSettingsModal', () => {
  const mockAddStore = vi.fn();
  const mockUpdateStore = vi.fn();
  const mockDeleteStore = vi.fn();
  const mockUpdateGroceryCategories = vi.fn();
  const mockAddQuickStockList = vi.fn();
  const mockUpdateQuickStockList = vi.fn();
  const mockDeleteQuickStockList = vi.fn();
  const mockAddGroceryCatalogItem = vi.fn();

  const mockStores = [
    { id: '1', name: 'Safeway', color: 'blue' },
    { id: '2', name: 'Costco', color: 'red' },
  ];

  const mockGroceryCategories = ['Produce', 'Dairy', 'Meat'];

  const mockQuickStockLists = [
    { id: '1', name: 'Weekly Basics', items: ['item1'], icon: 'ShoppingBag', color: 'blue' },
  ];

  const mockGroceryCatalog = [
    { id: 'item1', name: 'Milk', purchaseCount: 5 },
    { id: 'item2', name: 'Eggs', purchaseCount: 3 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHousehold).mockReturnValue({
      stores: mockStores,
      addStore: mockAddStore,
      updateStore: mockUpdateStore,
      deleteStore: mockDeleteStore,
      groceryCategories: mockGroceryCategories,
      updateGroceryCategories: mockUpdateGroceryCategories,
      groceryCatalog: mockGroceryCatalog,
      quickStockLists: mockQuickStockLists,
      addQuickStockList: mockAddQuickStockList,
      updateQuickStockList: mockUpdateQuickStockList,
      deleteQuickStockList: mockDeleteQuickStockList,
      addGroceryCatalogItem: mockAddGroceryCatalogItem,
    } as any);
  });

  it('renders stores tab by default', () => {
    render(<ShoppingSettingsModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByText('Shopping List Settings')).toBeInTheDocument();

    // Check for Stores tab content
    expect(screen.getByText('Add New Store')).toBeInTheDocument();
    expect(screen.getByText('Safeway')).toBeInTheDocument();
    expect(screen.getByText('Costco')).toBeInTheDocument();
  });

  it('switches to categories tab', async () => {
    render(<ShoppingSettingsModal isOpen={true} onClose={() => {}} />);

    const categoriesTab = screen.getByText('Categories');
    fireEvent.click(categoriesTab);

    expect(screen.getByText('Add Category')).toBeInTheDocument();
    expect(await screen.findByText('Produce')).toBeInTheDocument();
    expect(screen.getByText('Dairy')).toBeInTheDocument();
  });

  it('switches to templates tab', () => {
    render(<ShoppingSettingsModal isOpen={true} onClose={() => {}} />);

    const templatesTab = screen.getByText('Templates');
    fireEvent.click(templatesTab);

    expect(screen.getByText('Create New Template')).toBeInTheDocument();
    expect(screen.getByText('Weekly Basics')).toBeInTheDocument();
  });

  it('adds a new store', async () => {
    render(<ShoppingSettingsModal isOpen={true} onClose={() => {}} />);

    const input = screen.getByPlaceholderText('Store Name (e.g. Costco)');
    fireEvent.change(input, { target: { value: 'Trader Joes' } });

    const addButton = screen.getByText('Add');
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockAddStore).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Trader Joes',
        icon: 'Store',
      }));
    });
  });

  it('adds a new category', async () => {
    render(<ShoppingSettingsModal isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('Categories'));

    // Wait for initial categories to load
    await screen.findByText('Produce');

    const input = screen.getByPlaceholderText('Category Name');
    fireEvent.change(input, { target: { value: 'Snacks' } });

    // The component has a button with disabled state dependent on input
    // In the raw button version, we find the button inside the "Add Category" section
    const buttons = screen.getAllByRole('button');
    // We look for the one with the Plus icon
    const addButton = buttons.find(b => b.querySelector('[data-testid="Plus-icon"]'));

    if (addButton) {
        fireEvent.click(addButton);
    }

    expect(await screen.findByText('Snacks')).toBeInTheDocument();

    // Verify save button enables
    const saveButton = screen.getByText('Save Category Changes');
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateGroceryCategories).toHaveBeenCalledWith([...mockGroceryCategories, 'Snacks']);
    });
  });
});
