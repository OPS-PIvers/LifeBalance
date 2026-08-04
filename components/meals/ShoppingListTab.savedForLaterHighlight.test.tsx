import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { ShoppingItem } from '@/types/schema';
import { ThemeProvider } from '@/contexts/ThemeContext';
import ShoppingListTab from './ShoppingListTab';

/**
 * Proves the ACTUAL timing property behind `SavedForLaterShoppingSection`'s
 * render-phase auto-expand, driven through the real parent (`ShoppingListTab`)
 * with a non-empty `savedForLaterShopping` — not just the component-level
 * tests in `SavedForLaterShoppingSection.test.tsx`, which (per review) would
 * pass identically against a `useEffect`-based implementation: RTL's
 * `render`/`rerender` are wrapped in `act()`, which cascades and fully
 * settles ALL pending effects (including any state update THEY schedule)
 * before an assertion ever runs — so checking DOM state "after everything
 * settles" cannot distinguish "opened during THIS render, before any commit"
 * from "opened one effect-cycle later, after an intermediate commit".
 *
 * The property that actually matters: at the moment
 * `useScrollToHighlight`'s effect calls `requestAnimationFrame` (the ONE
 * frame of grace it gives `onBeforeScroll`-driven state changes before it
 * queries the DOM — see hooks/useScrollToHighlight.ts), the parked row must
 * already be un-hidden. React fires a commit's passive effects in one
 * synchronous pass (children before parents) WITHOUT interleaving a
 * re-render between them — a child's `useEffect`-scheduled `setState` does
 * NOT take effect until that whole pass finishes, so if the row's own
 * collapse fix lived in a `useEffect`, the parent's `useScrollToHighlight`
 * effect (which runs AFTER the child's, since effects run bottom-up) would
 * still see the STALE (hidden) DOM at the exact moment it calls
 * `requestAnimationFrame` — even though, by the time `act()` finally returns
 * control to the test, React has already cascaded to the correct final
 * state. So the only way to observe the bug is to snapshot DOM state
 * SYNCHRONOUSLY, inside a spy on `requestAnimationFrame` itself, at
 * schedule-time rather than at fire-time (querying "after the callback
 * fires" is ALSO too late — that cascading commit completes long before a
 * real or jsdom-polyfilled animation frame actually elapses).
 */

const parkedTarget: ShoppingItem = {
  id: 'parked-target',
  name: 'Bike rack',
  category: 'Household',
  isPurchased: false,
  savedForLater: true,
};

const shoppingValue = {
  shoppingList: [] as ShoppingItem[],
  savedForLaterShopping: [parkedTarget],
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
    <MemoryRouter initialEntries={['/lists']}>
      <ThemeProvider>
        <ShoppingListTab />
        <DeepLinkTrigger highlightId={highlightId} />
      </ThemeProvider>
    </MemoryRouter>
  );

/** True when the target row exists but sits under a `hidden` ancestor. */
const targetIsHidden = (): boolean => {
  const el = document.querySelector('[data-highlight-target="parked-target"]');
  return el !== null && el.closest('[hidden]') !== null;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe('ShoppingListTab — saved-for-later highlight timing', () => {
  it('never lets requestAnimationFrame observe the parked target as hidden', async () => {
    const user = userEvent.setup();
    renderTab('parked-target');

    // Collapse the section first — the auto-expand fix is meaningless to
    // test against an already-open section.
    await user.click(screen.getByRole('button', { name: /Saved for later/ }));
    expect(screen.getByRole('button', { name: /Saved for later/ })).toHaveAttribute('aria-expanded', 'false');
    expect(targetIsHidden()).toBe(true);

    // Spy on requestAnimationFrame: snapshot the target's hidden-ness the
    // INSTANT each call is scheduled (not when the callback later fires —
    // by then a cascading commit would have already fixed things up either
    // way), then delegate to the real implementation so framer-motion and
    // the existing flush-based tests keep working normally.
    const originalRAF = window.requestAnimationFrame.bind(window);
    const hiddenAtScheduleTime: boolean[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      hiddenAtScheduleTime.push(targetIsHidden());
      return originalRAF(cb);
    });

    try {
      await user.click(screen.getByText('deep-link'));

      // Let any real animation-frame-driven work (the existing flush
      // pattern) complete too, so this test also exercises the eventual
      // scrollIntoView call — not just the scheduling instant.
      await act(async () => {
        await new Promise(resolve => originalRAF(() => resolve(null)));
      });

      expect(hiddenAtScheduleTime.length).toBeGreaterThan(0);
      expect(hiddenAtScheduleTime.every(wasHidden => wasHidden === false)).toBe(true);
      expect(targetIsHidden()).toBe(false);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });
});
