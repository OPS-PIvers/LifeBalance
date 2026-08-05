import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { ShoppingItem } from '@/types/schema';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ShoppingListTab from './ShoppingListTab';

// Global search deep-link (v1.2). Selecting a shopping result navigates to
// `/lists` with `state: { tab: 'shopping', highlightId }`; ListsPage switches
// the tab and this tab scrolls to + flashes the row. The interesting behaviour
// is `onBeforeScroll`: the row may be filtered out of view by an active store
// filter, and the deep link has to reveal it — but ONLY when the target
// actually fails that filter.

const items: ShoppingItem[] = [
  { id: 'shop-target', name: 'Tostadas', category: 'Bakery', store: 'Aldi', isPurchased: false, order: 1 },
  { id: 'shop-other', name: 'Milk', category: 'Dairy', store: 'Costco', isPurchased: false, order: 2 },
];

const shoppingValue = {
  shoppingList: items,
  // "Saved for later" (PR-2): the section always renders below the main
  // list, so its inputs need to exist even in tests that don't otherwise
  // care about it.
  savedForLaterShopping: [] as ShoppingItem[],
  setShoppingItemSavedForLater: vi.fn(),
  addShoppingItem: vi.fn(),
  addShoppingItems: vi.fn(),
  deleteShoppingItem: vi.fn(),
  toggleShoppingItemPurchased: vi.fn(),
  updateShoppingItem: vi.fn(),
  reorderShoppingItems: vi.fn(),
  clearPurchasedShoppingItems: vi.fn(),
  stores: [
    { id: 'store-aldi', name: 'Aldi' },
    { id: 'store-costco', name: 'Costco' },
  ],
  groceryCategories: ['Bakery', 'Dairy'],
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

// Flag read hits Firestore; the tab only uses it to gate one menu entry.
vi.mock('@/hooks/usePowerToolsEnabled', () => ({
  usePowerToolsEnabled: () => false,
}));

// Heavy always-mounted modals — inert here, and each pulls in its own context
// surface that this test has no reason to stand up.
vi.mock('@/components/modals/GroceryCatalogModal', () => ({ default: () => null }));
vi.mock('@/components/meals/ShoppingSettingsModal', () => ({ default: () => null }));
vi.mock('@/components/meals/QuickRestockDrawer', () => ({ QuickRestockDrawer: () => null }));
vi.mock('@/components/meals/PasteImportDrawer', () => ({ PasteImportDrawer: () => null }));

/**
 * Delivers the deep link the way the app does — a navigation into an ALREADY
 * MOUNTED `/lists`. That ordering is the whole point: the store filter is
 * component state, so it only exists to be cleared once the tab is up.
 */
const DeepLinkTrigger: React.FC<{ highlightId: string }> = ({ highlightId }) => {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/lists', { state: { tab: 'shopping', highlightId } })}>
      deep-link
    </button>
  );
};

const renderTab = (highlightId: string) =>
  render(
    // ThemeProvider: each row's SwipeActionRow reads the resolved theme.
    <MemoryRouter initialEntries={['/lists']}>
      <ThemeProvider>
        <ShoppingListTab />
        <DeepLinkTrigger highlightId={highlightId} />
      </ThemeProvider>
    </MemoryRouter>
  );

/** Applies the store filter through the real title-row control. */
const applyStoreFilter = async (user: ReturnType<typeof userEvent.setup>, store: string) => {
  await user.click(screen.getByRole('button', { name: 'Filter by store' }));
  await user.click(screen.getByRole('menuitemradio', { name: store }));
};

/** Lets `useScrollToHighlight`'s onBeforeScroll → rAF → DOM lookup complete. */
const flushHighlight = () =>
  act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe('ShoppingListTab deep-link highlight', () => {
  it('clears an active store filter that hides the deep-link target', async () => {
    const user = userEvent.setup();
    const { container } = renderTab('shop-target');

    await applyStoreFilter(user, 'Costco');
    expect(screen.queryByText('Tostadas')).not.toBeInTheDocument();

    await user.click(screen.getByText('deep-link'));
    await flushHighlight();

    expect(screen.getByText('Tostadas')).toBeInTheDocument();
    expect(container.querySelector('[data-highlight-target="shop-target"]')).not.toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('leaves a store filter alone when the deep-link target already passes it', async () => {
    const user = userEvent.setup();
    renderTab('shop-target');

    await applyStoreFilter(user, 'Aldi');
    await user.click(screen.getByText('deep-link'));
    await flushHighlight();

    // Still scoped to Aldi — the deep link had no reason to widen the view.
    expect(screen.getByText('Tostadas')).toBeInTheDocument();
    expect(screen.queryByText('Milk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by store: Aldi' })).toBeInTheDocument();
  });

  it('scrolls the target row into view with no filter in play', async () => {
    const user = userEvent.setup();
    renderTab('shop-other');

    await user.click(screen.getByText('deep-link'));
    await flushHighlight();

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
