import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ShoppingReviewForm from './ShoppingReviewForm';
import { ShoppingItem } from '@/types/schema';

const {
  mockApproveShoppingItem,
  mockDeleteShoppingItem,
  mockOnDone,
  mockOnDeleted,
  mockToast,
  mockRequestDeleteConfirmation,
} = vi.hoisted(() => ({
  mockApproveShoppingItem: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockDeleteShoppingItem: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockOnDone: vi.fn(),
  mockOnDeleted: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  mockRequestDeleteConfirmation: vi.fn(),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useShopping: () => ({
    approveShoppingItem: mockApproveShoppingItem,
    deleteShoppingItem: mockDeleteShoppingItem,
    stores: [{ id: 's1', name: 'Costco' }, { id: 's2', name: 'Target' }],
    groceryCategories: [],
  }),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast }));

// showDeleteConfirmation forwards to the imperative confirm-dialog store —
// stub it to immediately invoke onConfirm, mirroring how other component
// tests in this repo (e.g. ToDosPage) exercise the delete path.
vi.mock('@/components/ui/confirmDialogStore', () => ({
  requestDeleteConfirmation: (request: { onConfirm: () => void | Promise<void> }) => {
    mockRequestDeleteConfirmation(request);
    return request.onConfirm();
  },
}));

const baseItem: ShoppingItem = {
  id: 'item-1',
  name: 'Milk',
  category: 'Dairy',
  quantity: '1',
  store: 'Costco',
  isPurchased: false,
  needsReview: true,
};

describe('ShoppingReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills fields from the item', () => {
    render(<ShoppingReviewForm item={baseItem} onDone={mockOnDone} />);

    expect(screen.getByLabelText(/item name/i)).toHaveValue('Milk');
    expect(screen.getByLabelText(/category/i)).toHaveValue('Dairy');
    expect(screen.getByLabelText(/quantity/i)).toHaveValue('1');
    expect(screen.getByLabelText(/store/i)).toHaveValue('Costco');
  });

  it('approves with no overrides when nothing was edited', async () => {
    const user = userEvent.setup();
    render(<ShoppingReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.click(screen.getByRole('button', { name: /add to list/i }));

    expect(mockApproveShoppingItem).toHaveBeenCalledWith('item-1', undefined);
    expect(mockOnDone).toHaveBeenCalled();
  });

  it('renders and approves a server-captured item whose quantity is a number, without throwing', async () => {
    // The quick-add server store spreads `quantity` unchanged, so a
    // held item can arrive with a NUMERIC quantity even though the schema
    // types it as a string (see ShoppingReviewForm's seeding comment).
    const numericQuantityItem = { ...baseItem, quantity: 2 } as unknown as ShoppingItem;
    const user = userEvent.setup();
    render(<ShoppingReviewForm item={numericQuantityItem} onDone={mockOnDone} />);

    expect(screen.getByLabelText(/quantity/i)).toHaveValue('2');

    await expect(
      user.click(screen.getByRole('button', { name: /add to list/i }))
    ).resolves.not.toThrow();

    expect(mockApproveShoppingItem).toHaveBeenCalledWith('item-1', undefined);
    expect(mockOnDone).toHaveBeenCalled();
  });

  it('sends only the changed fields as overrides', async () => {
    const user = userEvent.setup();
    render(<ShoppingReviewForm item={baseItem} onDone={mockOnDone} />);

    const nameInput = screen.getByLabelText(/item name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Whole milk');
    await user.click(screen.getByRole('button', { name: /add to list/i }));

    expect(mockApproveShoppingItem).toHaveBeenCalledWith('item-1', { name: 'Whole milk' });
  });

  it('disables Add to list when the name is emptied', async () => {
    const user = userEvent.setup();
    render(<ShoppingReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.clear(screen.getByLabelText(/item name/i));
    expect(screen.getByRole('button', { name: /add to list/i })).toBeDisabled();
  });

  it('Discard deletes the item and calls onDeleted', async () => {
    const user = userEvent.setup();
    render(<ShoppingReviewForm item={baseItem} onDone={mockOnDone} onDeleted={mockOnDeleted} />);

    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(mockRequestDeleteConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ itemName: 'Milk' })
    );
    expect(mockDeleteShoppingItem).toHaveBeenCalledWith('item-1');
    expect(mockOnDeleted).toHaveBeenCalled();
    expect(mockOnDone).not.toHaveBeenCalled();
  });

  it('Discard falls back to onDone when onDeleted is omitted', async () => {
    const user = userEvent.setup();
    render(<ShoppingReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(mockDeleteShoppingItem).toHaveBeenCalledWith('item-1');
    expect(mockOnDone).toHaveBeenCalled();
  });
});
