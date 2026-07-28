import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reorder } from 'framer-motion';
import type { ReactElement } from 'react';
import { ShoppingItem } from '@/types/schema';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ShoppingItemRow } from './ShoppingItemRow';

// The row's SwipeActionRow reads the resolved theme from ThemeContext.
const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);

const item: ShoppingItem = {
  id: 'item-1',
  name: 'Milk',
  category: 'Dairy',
  isPurchased: false,
};

const handlers = {
  onCheck: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ShoppingItemRow', () => {
  it('renders the standard row anatomy: checkbox first, kebab last', () => {
    render(<ShoppingItemRow item={item} {...handlers} isReorderable={false} />);
    expect(screen.getByLabelText('Mark Milk as purchased')).toBeInTheDocument();
    expect(screen.getByText('Milk')).toBeInTheDocument();
    const kebab = screen.getByRole('button', { name: 'Options for Milk' });
    expect(kebab).toHaveAttribute('aria-haspopup', 'dialog');
    // The checkbox input must precede the kebab in DOM (and therefore tab) order.
    const checkbox = screen.getByLabelText('Mark Milk as purchased');
    expect(checkbox.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the reorder grip when not reorderable', () => {
    const { container } = render(<ShoppingItemRow item={item} {...handlers} isReorderable={false} />);
    expect(container.querySelector('.cursor-grab')).toBeNull();
  });

  it('renders the grip in the right rail (after content, before kebab) when reorderable', () => {
    const { container } = render(
      <Reorder.Group axis="y" values={[item]} onReorder={() => {}}>
        <ShoppingItemRow item={item} {...handlers} />
      </Reorder.Group>
    );
    // The grip is a pointer-only decoration (aria-hidden), so query by class.
    const grip = container.querySelector('.cursor-grab') as HTMLElement;
    expect(grip).toHaveAttribute('aria-hidden', 'true');
    const kebab = screen.getByRole('button', { name: 'Options for Milk' });
    const name = screen.getByText('Milk');
    expect(name.compareDocumentPosition(grip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grip.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the edit drawer from the kebab', async () => {
    const user = userEvent.setup();
    render(<ShoppingItemRow item={item} {...handlers} isReorderable={false} />);
    await user.click(screen.getByRole('button', { name: 'Options for Milk' }));
    expect(handlers.onEdit).toHaveBeenCalledWith(item);
    expect(handlers.onCheck).not.toHaveBeenCalled();
  });

  it('toggles purchased from a tap on the content area', async () => {
    const user = userEvent.setup();
    render(<ShoppingItemRow item={item} {...handlers} isReorderable={false} />);
    await user.click(screen.getByText('Milk'));
    expect(handlers.onCheck).toHaveBeenCalledWith(item);
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it('toggles purchased from the checkbox control', async () => {
    const user = userEvent.setup();
    render(<ShoppingItemRow item={item} {...handlers} isReorderable={false} />);
    await user.click(screen.getByLabelText('Mark Milk as purchased'));
    expect(handlers.onCheck).toHaveBeenCalledWith(item);
  });

  it('never renders the quantity in the row, even when set', () => {
    const itemWithQuantity: ShoppingItem = { ...item, quantity: '2 lbs' };
    render(<ShoppingItemRow item={itemWithQuantity} {...handlers} isReorderable={false} />);
    expect(screen.queryByText('2 lbs')).not.toBeInTheDocument();
    expect(screen.queryByText('2', { exact: true })).not.toBeInTheDocument();
  });

  it('renders no metadata row at all when quantity is the only thing set', () => {
    const itemWithQuantity: ShoppingItem = { ...item, quantity: '3' };
    const { container } = render(
      <ShoppingItemRow item={itemWithQuantity} {...handlers} isReorderable={false} />
    );
    // hasMeta must not fire on quantity alone now that the row never shows it.
    expect(container.querySelector('.flex-wrap')).not.toBeInTheDocument();
  });

  // Paper cut PC#2 (owner decision): store and quick-list chips are filter/
  // metrics info, not needed at a glance — both are gone from the row now,
  // even with a store set. The full detail (store, quick lists) still lives
  // in the edit drawer.
  it('never renders a store chip in the row, even when store and quantity are both set', () => {
    const itemWithBoth: ShoppingItem = { ...item, quantity: '2 lbs', store: 'Costco' };
    render(<ShoppingItemRow item={itemWithBoth} {...handlers} isReorderable={false} />);
    expect(screen.queryByText('Costco')).not.toBeInTheDocument();
    expect(screen.queryByText('2 lbs')).not.toBeInTheDocument();
  });

  // Global search deep-link (v1.2): both render branches must be findable by
  // `useScrollToHighlight`'s `[data-highlight-target]` query — the plain-div
  // branch is what every non-'entry' sort mode and any active store filter
  // renders, so tagging only the draggable branch would silently lose the
  // highlight in exactly the filtered views a deep link most often lands in.
  it('tags the reorderable row as a deep-link highlight target', () => {
    const { container } = render(
      <Reorder.Group axis="y" values={[item]} onReorder={() => {}}>
        <ShoppingItemRow item={item} {...handlers} />
      </Reorder.Group>
    );
    expect(container.querySelector('[data-highlight-target="item-1"]')).not.toBeNull();
  });

  it('tags the non-reorderable row as a deep-link highlight target', () => {
    const { container } = render(
      <ShoppingItemRow item={item} {...handlers} isReorderable={false} />
    );
    expect(container.querySelector('[data-highlight-target="item-1"]')).not.toBeNull();
  });
});
