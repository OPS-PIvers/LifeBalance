import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ShoppingItem } from '@/types/schema';
import { ShoppingItemForm } from './ShoppingItemForm';

const baseItem: ShoppingItem = {
  id: 'item-1',
  name: 'Milk',
  category: 'Dairy',
  isPurchased: false,
};

const baseProps = {
  onSave: vi.fn(),
  stores: [],
  categories: ['Uncategorized', 'Dairy'],
};

describe('ShoppingItemForm quantity stepper', () => {
  it('shows an em-dash (not "1") when no quantity is set', () => {
    render(<ShoppingItemForm item={baseItem} onChange={vi.fn()} {...baseProps} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('increments straight from "none" to 2, skipping displaying an implicit 1', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ShoppingItemForm item={baseItem} onChange={onChange} {...baseProps} />);
    await user.click(screen.getByLabelText('Increase quantity'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ quantity: '2' }));
  });

  it('decrementing from an explicit quantity of 1 lands on "none" in one tap, clearing the unit too', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item: ShoppingItem = { ...baseItem, quantity: '1 lbs' };
    render(<ShoppingItemForm item={item} onChange={onChange} {...baseProps} />);
    await user.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ quantity: undefined }));
  });

  it('decrementing "2 lbs" goes to "1 lbs" first (still showing the unit)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item: ShoppingItem = { ...baseItem, quantity: '2 lbs' };
    render(<ShoppingItemForm item={item} onChange={onChange} {...baseProps} />);
    await user.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ quantity: '1 lbs' }));
  });

  it('a second decrement from "1 lbs" clears both the count and the unit in one action', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Simulate the drawer re-rendering with the item.quantity that the
    // previous decrement produced ("1 lbs"), then decrementing again.
    const item: ShoppingItem = { ...baseItem, quantity: '1 lbs' };
    render(<ShoppingItemForm item={item} onChange={onChange} {...baseProps} />);
    await user.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ quantity: undefined }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows the count and unit normally once a quantity is explicitly set', () => {
    const item: ShoppingItem = { ...baseItem, quantity: '3 lbs' };
    render(<ShoppingItemForm item={item} onChange={vi.fn()} {...baseProps} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity unit')).toHaveValue('lbs');
  });

  it('renders without throwing when quantity is a legacy raw Firestore number (not the typed string)', () => {
    // ShoppingItem.quantity is typed `string`, but rows written by the
    // quickAdd Cloud Function before this fix (or approved via
    // ShoppingReviewForm without editing the quantity) hold a raw number.
    // The cast mirrors how that legacy shape actually arrives at runtime,
    // bypassing the compile-time type.
    const item: ShoppingItem = { ...baseItem, quantity: 2 as unknown as string };
    render(<ShoppingItemForm item={item} onChange={vi.fn()} {...baseProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
