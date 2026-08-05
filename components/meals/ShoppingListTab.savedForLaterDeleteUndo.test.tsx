import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import type { ShoppingItem } from '@/types/schema';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ShoppingListTab from './ShoppingListTab';

/**
 * Review finding: a parked item was never on the active shopping list, so
 * `handleDelete`'s "Deleted"/undo's "Added to shopping list" copy (and the
 * mutation's OLD literal "Removed from shopping list" wording) is false for
 * it — the item goes back to Saved for later on undo, not the list. Proven
 * end-to-end here (real `ShoppingListTab`, real `Toaster`, real click-through
 * to the drawer's Delete button and the toast's Undo button) rather than only
 * at the `DeleteUndoToast` component level, so the wiring inside
 * `showDeleteUndoToast` (which computes `isParked` and threads the matching
 * `addShoppingItem` successMessage) is exercised too, not just the render.
 */

const parkedItem: ShoppingItem = {
  id: 'parked-1',
  name: 'Bike rack',
  category: 'Household',
  isPurchased: false,
  savedForLater: true,
};

const activeItem: ShoppingItem = {
  id: 'active-1',
  name: 'Milk',
  category: 'Dairy',
  isPurchased: false,
  order: 1,
};

const shoppingValue = {
  shoppingList: [activeItem],
  savedForLaterShopping: [parkedItem],
  setShoppingItemSavedForLater: vi.fn(),
  addShoppingItem: vi.fn(),
  addShoppingItems: vi.fn(),
  deleteShoppingItem: vi.fn(),
  toggleShoppingItemPurchased: vi.fn(),
  updateShoppingItem: vi.fn(),
  reorderShoppingItems: vi.fn(),
  clearPurchasedShoppingItems: vi.fn(),
  stores: [] as { id: string; name: string }[],
  groceryCategories: [] as string[],
  groceryCatalog: [],
  loadFullGroceryCatalog: vi.fn(),
  quickStockLists: [],
  addGroceryCatalogItem: vi.fn(),
  updateQuickStockLists: vi.fn(),
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useShopping: () => shoppingValue,
  useHouseholdCore: () => ({ householdId: 'household-1', isLoading: false }),
}));

vi.mock('@/hooks/usePowerToolsEnabled', () => ({
  usePowerToolsEnabled: () => false,
}));

vi.mock('@/components/modals/GroceryCatalogModal', () => ({ default: () => null }));
vi.mock('@/components/meals/ShoppingSettingsModal', () => ({ default: () => null }));
vi.mock('@/components/meals/QuickRestockDrawer', () => ({ QuickRestockDrawer: () => null }));
vi.mock('@/components/meals/PasteImportDrawer', () => ({ PasteImportDrawer: () => null }));

const renderTab = () =>
  render(
    <MemoryRouter initialEntries={['/lists']}>
      <ThemeProvider>
        <ShoppingListTab />
        <Toaster />
      </ThemeProvider>
    </MemoryRouter>
  );

/** Drives a delete through the row's kebab -> edit drawer -> Delete button.
 *  More reliable in jsdom than simulating the swipe gesture, and both paths
 *  call the exact same `handleDelete`/`showDeleteUndoToast`. */
const deleteViaDrawer = async (user: ReturnType<typeof userEvent.setup>, itemName: string) => {
  await user.click(screen.getByRole('button', { name: `Options for ${itemName}` }));
  await user.click(await screen.findByRole('button', { name: 'Delete item' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement matchMedia; react-hot-toast's own <Toaster/>
  // calls it directly (prefersReducedMotion) to pick its enter/exit
  // animation, unrelated to our own useMediaQuery/useReducedMotion hooks.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  // react-hot-toast keeps a module-level store — clear it so one test's
  // toast can't leak into the next.
  toast.remove();
  cleanup();
});

describe('ShoppingListTab — savedForLater delete/undo toast copy', () => {
  it('parked delete shows "Removed ... from Saved for later" and undo re-adds with matching copy', async () => {
    const user = userEvent.setup();
    renderTab();

    await deleteViaDrawer(user, 'Bike rack');

    expect(await screen.findByText('Removed "Bike rack" from Saved for later')).toBeInTheDocument();
    expect(screen.queryByText(/^Deleted /)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(shoppingValue.addShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bike rack', savedForLater: true }),
      'Saved for later'
    );
  });

  it('active-item delete keeps the plain "Deleted" copy and undo passes no override (unchanged behavior)', async () => {
    const user = userEvent.setup();
    renderTab();

    await deleteViaDrawer(user, 'Milk');

    // Exact match (not a substring/regex query) — the page ALSO renders a
    // "Saved for later" SECTION HEADER unconditionally, so a broad "does the
    // toast avoid mentioning Saved for later" check would false-positive
    // against that unrelated text.
    expect(await screen.findByText('Deleted "Milk"')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(shoppingValue.addShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Milk' }),
      undefined
    );
  });
});
