import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { ShoppingItem } from '@/types/schema';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SavedForLaterShoppingSection } from './SavedForLaterShoppingSection';

const CONTENT_ID = 'saved-for-later-shopping-content';

// Rows nest ShoppingItemRow, whose SwipeActionRow reads the resolved theme.
const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);

const parkedItem = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: overrides.id ?? 'parked-1',
  name: overrides.name ?? 'Cast iron skillet',
  category: overrides.category ?? 'Household',
  isPurchased: false,
  savedForLater: true,
  ...overrides,
});

const handlers = {
  onPromote: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onReorder: vi.fn(),
  onAddValueChange: vi.fn(),
  onAddSubmit: vi.fn(),
};

const baseProps = {
  sortMode: 'entry' as const,
  filterStore: null,
  categories: [] as string[],
  storeOrder: new Map<string, number>(),
  addValue: '',
  ...handlers,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SavedForLaterShoppingSection', () => {
  it('always renders the header and add bar, even with zero parked items', () => {
    render(<SavedForLaterShoppingSection {...baseProps} items={[]} />);
    expect(screen.getByText('Saved for later')).toBeInTheDocument();
    expect(screen.getByText('· 0')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Save something for later...')).toBeInTheDocument();
    expect(screen.getByText('Nothing saved for later.')).toBeInTheDocument();
  });

  it('shows a plain total count when no filter narrows the section', () => {
    const items = [parkedItem({ id: 'a' }), parkedItem({ id: 'b', name: 'Batteries' })];
    render(<SavedForLaterShoppingSection {...baseProps} items={items} />);
    expect(screen.getByText('· 2')).toBeInTheDocument();
  });

  it('shows "N of M" when the active store filter narrows the section', () => {
    const items = [
      parkedItem({ id: 'a', store: 'Costco' }),
      parkedItem({ id: 'b', name: 'Batteries', store: 'Target' }),
      parkedItem({ id: 'c', name: 'Lightbulbs', store: 'Costco' }),
    ];
    render(<SavedForLaterShoppingSection {...baseProps} items={items} filterStore="Costco" />);
    expect(screen.getByText('· 2 of 3')).toBeInTheDocument();
  });

  it('shows the plain count when the filter matches every item (no narrowing)', () => {
    const items = [parkedItem({ id: 'a', store: 'Costco' }), parkedItem({ id: 'b', name: 'Batteries', store: 'Costco' })];
    render(<SavedForLaterShoppingSection {...baseProps} items={items} filterStore="Costco" />);
    expect(screen.getByText('· 2')).toBeInTheDocument();
  });

  it('promoting a row calls onPromote with that item', async () => {
    const user = userEvent.setup();
    const item = parkedItem();
    render(<SavedForLaterShoppingSection {...baseProps} items={[item]} />);
    await user.click(screen.getByLabelText('Move Cast iron skillet to your shopping list'));
    expect(handlers.onPromote).toHaveBeenCalledWith(item);
  });

  it('is drag-reorderable in entry sort with no store filter', () => {
    const items = [parkedItem({ id: 'a' }), parkedItem({ id: 'b', name: 'Batteries' })];
    const { container } = render(
      <SavedForLaterShoppingSection {...baseProps} items={items} sortMode="entry" filterStore={null} />
    );
    expect(container.querySelector('.cursor-grab')).not.toBeNull();
  });

  it('is NOT reorderable in a non-entry sort mode', () => {
    const items = [parkedItem({ id: 'a' }), parkedItem({ id: 'b', name: 'Batteries' })];
    const { container } = render(
      <SavedForLaterShoppingSection {...baseProps} items={items} sortMode="alpha" filterStore={null} />
    );
    expect(container.querySelector('.cursor-grab')).toBeNull();
  });

  it('is NOT reorderable when a store filter is active, even in entry sort', () => {
    const items = [parkedItem({ id: 'a', store: 'Costco' }), parkedItem({ id: 'b', name: 'Batteries', store: 'Costco' })];
    const { container } = render(
      <SavedForLaterShoppingSection {...baseProps} items={items} sortMode="entry" filterStore="Costco" />
    );
    expect(container.querySelector('.cursor-grab')).toBeNull();
  });

  it('collapses the content region without unmounting it (aria-controls stays valid)', async () => {
    const user = userEvent.setup();
    const items = [parkedItem()];
    render(<SavedForLaterShoppingSection {...baseProps} items={items} />);
    const toggle = screen.getByRole('button', { name: /Saved for later/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const content = document.getElementById(CONTENT_ID);
    expect(content).not.toBeNull();
    expect(content).toHaveAttribute('hidden');
  });

  // Review finding: the add bar previously sat ABOVE the `hidden`-when-
  // collapsed region, so collapsing left it floating — a visual AND semantic
  // mismatch with the header's `aria-expanded="false"`. It must collapse
  // WITH the rest of the card.
  it('hides the add bar along with the rest of the section when collapsed', async () => {
    const user = userEvent.setup();
    render(<SavedForLaterShoppingSection {...baseProps} items={[]} />);

    expect(screen.getByPlaceholderText('Save something for later...')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Saved for later/ }));

    const addBar = screen.getByPlaceholderText('Save something for later...');
    // Not just "gone from view" — genuinely inside the same hidden
    // (display:none) subtree the header now claims is closed.
    expect(addBar.closest('[hidden]')).not.toBeNull();
  });

  // Addendum (PR-5 search dependency): a collapsed section renders its content
  // `hidden` (display:none) rather than unmounting it, and `scrollIntoView` /
  // the flash class on a `display:none` subtree is a silent no-op. So an
  // incoming `highlightId` naming one of this section's OWN rows must force
  // it open, synchronously — before useScrollToHighlight's single rAF looks
  // for the row in the DOM.
  describe('auto-expand on highlightId', () => {
    it('expands a collapsed section when highlightId names one of its own rows', () => {
      const items = [parkedItem({ id: 'target-1' })];
      // rtlRender directly (not the local `render` wrapper, which would
      // double-wrap ThemeProvider) — `rerender` must see the IDENTICAL tree
      // shape on every call or React remounts the subtree from scratch,
      // silently resetting `collapsed` back to its default instead of
      // exercising the highlightId prop change.
      const { rerender } = rtlRender(
        <ThemeProvider>
          <SavedForLaterShoppingSection {...baseProps} items={items} highlightId={null} />
        </ThemeProvider>
      );

      // Start collapsed.
      const toggle = () => screen.getByRole('button', { name: /Saved for later/ });
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');

      // A highlight arrives naming the row inside — must expand synchronously,
      // in the SAME render pass that receives the new prop (no intervening
      // effect/rAF may be required).
      rerender(
        <ThemeProvider>
          <SavedForLaterShoppingSection {...baseProps} items={items} highlightId="target-1" />
        </ThemeProvider>
      );

      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
      const content = document.getElementById(CONTENT_ID);
      expect(content).not.toHaveAttribute('hidden');
    });

    it('does not expand for a highlightId naming a row in a DIFFERENT section', () => {
      const items = [parkedItem({ id: 'target-1' })];
      // rtlRender directly (not the local `render` wrapper, which would
      // double-wrap ThemeProvider) — `rerender` must see the IDENTICAL tree
      // shape on every call or React remounts the subtree from scratch,
      // silently resetting `collapsed` back to its default instead of
      // exercising the highlightId prop change.
      const { rerender } = rtlRender(
        <ThemeProvider>
          <SavedForLaterShoppingSection {...baseProps} items={items} highlightId={null} />
        </ThemeProvider>
      );

      const toggle = () => screen.getByRole('button', { name: /Saved for later/ });
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');

      rerender(
        <ThemeProvider>
          <SavedForLaterShoppingSection {...baseProps} items={items} highlightId="some-other-row" />
        </ThemeProvider>
      );

      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not re-collapse an already-open section when the highlight fades', () => {
      const items = [parkedItem({ id: 'target-1' })];
      // rtlRender directly (not the local `render` wrapper, which would
      // double-wrap ThemeProvider) — `rerender` must see the IDENTICAL tree
      // shape on every call or React remounts the subtree from scratch,
      // silently resetting `collapsed` back to its default instead of
      // exercising the highlightId prop change.
      const { rerender } = rtlRender(
        <ThemeProvider>
          <SavedForLaterShoppingSection {...baseProps} items={items} highlightId="target-1" />
        </ThemeProvider>
      );
      const toggle = () => screen.getByRole('button', { name: /Saved for later/ });
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');

      // useDeepLinkHighlight self-clears back to null after its window.
      rerender(
        <ThemeProvider>
          <SavedForLaterShoppingSection {...baseProps} items={items} highlightId={null} />
        </ThemeProvider>
      );
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
