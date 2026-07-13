import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reorder } from 'framer-motion';
import { ShoppingItem } from '@/types/schema';
import { ShoppingItemRow } from './ShoppingItemRow';

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
});
