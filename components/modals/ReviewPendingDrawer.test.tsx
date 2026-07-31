import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReviewPendingDrawer from './ReviewPendingDrawer';
import type { ReviewQueueItem } from '@/utils/reviewQueue';
import type { ShoppingItem, ToDo, Transaction } from '@/types/schema';

const mockUpdateCategory = vi.fn(() => Promise.resolve());
const mockDeleteTransaction = vi.fn(() => Promise.resolve());
const mockAddCalendarItem = vi.fn(() => Promise.resolve());
const mockLinkBankTransactionToBill = vi.fn(() => Promise.resolve());
const mockApproveShoppingItem = vi.fn(() => Promise.resolve());
const mockDeleteShoppingItem = vi.fn(() => Promise.resolve());
const mockApproveTodo = vi.fn(() => Promise.resolve());
const mockDeleteToDo = vi.fn(() => Promise.resolve());

// ReviewPendingDrawer renders TransactionReviewForm / ShoppingReviewForm /
// TodoReviewForm, which each consume context slices directly. Mock the slices
// each form reads.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    buckets: [{ id: 'b1', name: 'Groceries' }, { id: 'b2', name: 'Gas' }],
    accounts: [],
    transactions: [],
    updateTransactionCategory: mockUpdateCategory,
    deleteTransaction: mockDeleteTransaction,
    addCalendarItem: mockAddCalendarItem,
    linkBankTransactionToBill: mockLinkBankTransactionToBill,
  }),
  useGamification: () => ({ habits: [] }),
  useExpandedCalendarItems: () => [],
  useShopping: () => ({
    approveShoppingItem: mockApproveShoppingItem,
    deleteShoppingItem: mockDeleteShoppingItem,
    stores: [],
    groceryCategories: [],
  }),
  useTodos: () => ({
    approveTodo: mockApproveTodo,
    deleteToDo: mockDeleteToDo,
  }),
  useHouseholdCore: () => ({ members: [{ uid: 'u1', displayName: 'Alice' }] }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const tx = (id: string, merchant: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  amount: 25,
  merchant,
  category: 'Groceries',
  date: '2026-06-27',
  status: 'pending_review',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  ...extra,
});

const txItem = (id: string, merchant: string, extra: Partial<Transaction> = {}): ReviewQueueItem => ({
  kind: 'transaction',
  id,
  transaction: tx(id, merchant, extra),
});

const todoItem = (id: string, text: string): ReviewQueueItem => ({
  kind: 'todo',
  id,
  item: {
    id,
    text,
    completeByDate: '2026-07-01',
    assignedTo: 'u1',
    isCompleted: false,
    createdBy: 'u1',
    createdAt: '2026-06-27T00:00:00.000Z',
    needsReview: true,
  } satisfies ToDo,
});

const shoppingItem = (id: string, name: string): ReviewQueueItem => ({
  kind: 'shopping',
  id,
  item: {
    id,
    name,
    category: 'Produce',
    isPurchased: false,
    needsReview: true,
  } satisfies ShoppingItem,
});

describe('ReviewPendingDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the first pending transaction prefilled (no doc-stamping on open)', () => {
    const items = [txItem('t1', 'Shell Gas'), txItem('t2', 'Target')];
    render(<ReviewPendingDrawer items={items} isOpen onClose={vi.fn()} />);

    expect(screen.getByDisplayValue('Shell Gas')).toBeInTheDocument();
    // A real amount prefills (only $0 stubs open blank).
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('25');
  });

  it('pins Approve in the sticky footer beside Skip (never below the body scroll)', async () => {
    const items = [txItem('t1', 'Shell Gas'), txItem('t2', 'Target')];
    render(<ReviewPendingDrawer items={items} isOpen onClose={vi.fn()} />);

    const footer = screen.getByTestId('review-drawer-footer');
    const approve = await within(footer).findByRole('button', { name: /^Approve$/ });
    // The form's own Delete joins it there, carrying its visible word rather
    // than reading as a bare icon; Skip stays the last row.
    expect(within(footer).getByRole('button', { name: /Delete/ })).toHaveTextContent('Delete');
    expect(within(footer).getByText('Skip — add later')).toBeInTheDocument();

    // Approving from the footer is the SAME action as before — one write, then advance.
    fireEvent.click(approve);
    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
    expect(mockUpdateCategory).toHaveBeenCalledWith('t1', 'Groceries', [], undefined, undefined);
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());
  });

  it('leaves the footer to Skip alone for a non-transaction card', () => {
    render(<ReviewPendingDrawer items={[todoItem('d1', 'Call plumber')]} isOpen onClose={vi.fn()} />);

    const footer = screen.getByTestId('review-drawer-footer');
    expect(within(footer).getByText('Skip — add later')).toBeInTheDocument();
    expect(within(footer).queryByRole('button', { name: /^Approve$/ })).toBeNull();
  });

  it('approving verifies via a single call then advances to the next card', async () => {
    const items = [txItem('t1', 'Shell Gas'), txItem('t2', 'Target')];
    const onClose = vi.fn();
    render(<ReviewPendingDrawer items={items} isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
    // Unedited real transaction → category 'Groceries' preselected, no overrides.
    expect(mockUpdateCategory).toHaveBeenCalledWith('t1', 'Groceries', [], undefined, undefined);

    // Advances to the SECOND card (a single approve must not double-advance).
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('Shell Gas')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends an amount override (once) when approving a $0 needsAmount stub', async () => {
    const items = [txItem('t1', 'Shell Gas', { amount: 0, needsAmount: true })];
    render(<ReviewPendingDrawer items={items} isOpen onClose={vi.fn()} />);

    // Stub opens blank; the CTA reads "Add amount" and is disabled.
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /^Add amount$/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.50' } });
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
    expect(mockUpdateCategory).toHaveBeenCalledWith(
      't1',
      'Groceries',
      [],
      undefined,
      expect.objectContaining({ amount: 45.5, clearNeedsAmount: true }),
    );
  });

  it('resets the Recurring toggle between review items and only flags the item it was ON for', async () => {
    const items = [txItem('t1', 'Peacock Premium'), txItem('t2', 'Target')];
    render(<ReviewPendingDrawer items={items} isOpen onClose={vi.fn()} />);

    // Flip Recurring ON for the first card and approve it.
    fireEvent.click(screen.getByRole('checkbox', { name: /recurring transaction/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
    expect(mockUpdateCategory).toHaveBeenCalledWith(
      't1', 'Groceries', [], undefined,
      expect.objectContaining({ isRecurring: true }),
    );
    await waitFor(() => expect(mockAddCalendarItem).toHaveBeenCalledTimes(1));
    expect(mockAddCalendarItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Peacock Premium', frequency: 'monthly', isSubscription: true }),
    );

    // The next card remounts the form — the toggle is OFF again.
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /recurring transaction/i })).not.toBeChecked();

    // Approving the second card untouched sends no overrides / no calendar item.
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(2));
    expect(mockUpdateCategory).toHaveBeenLastCalledWith('t2', 'Groceries', [], undefined, undefined);
    expect(mockAddCalendarItem).toHaveBeenCalledTimes(1);
  });

  it('skip advances without verifying; finishing the last card closes the drawer', async () => {
    const items = [txItem('t1', 'Shell Gas'), txItem('t2', 'Target')];
    const onClose = vi.fn();
    render(<ReviewPendingDrawer items={items} isOpen onClose={onClose} />);

    // Card 1 is not the last: Skip advances without a write.
    fireEvent.click(screen.getByText('Skip — add later'));
    expect(mockUpdateCategory).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());

    // Card 2 is the last: the SAME label closes the whole drawer.
    fireEvent.click(screen.getByText('Skip — add later'));
    expect(onClose).toHaveBeenCalled();
  });

  it('cycles a mixed queue in order (transaction → todo → shopping); last Skip closes', async () => {
    const items = [
      txItem('t1', 'Shell Gas'),
      todoItem('d1', 'Call plumber'),
      shoppingItem('s1', 'Bananas'),
    ];
    const onClose = vi.fn();
    render(<ReviewPendingDrawer items={items} isOpen onClose={onClose} />);

    // 1 of 3 → the transaction form.
    expect(screen.getByText('Review (1 of 3)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shell Gas')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Skip — add later'));

    // 2 of 3 → the to-do form.
    await waitFor(() => expect(screen.getByDisplayValue('Call plumber')).toBeInTheDocument());
    expect(screen.getByText('Review (2 of 3)')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Shell Gas')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Skip — add later'));

    // 3 of 3 → the shopping form (last card).
    await waitFor(() => expect(screen.getByDisplayValue('Bananas')).toBeInTheDocument());
    expect(screen.getByText('Review (3 of 3)')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Call plumber')).not.toBeInTheDocument();

    // Last card's footer closes the drawer, under the same label as every
    // other card.
    fireEvent.click(screen.getByText('Skip — add later'));
    expect(onClose).toHaveBeenCalled();
  });

  it('approving a held to-do then a held shopping item advances through each form', async () => {
    const items = [todoItem('d1', 'Call plumber'), shoppingItem('s1', 'Bananas')];
    const onClose = vi.fn();
    render(<ReviewPendingDrawer items={items} isOpen onClose={onClose} />);

    // Approve the to-do (unedited → approve with no overrides), then advance.
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    await waitFor(() => expect(mockApproveTodo).toHaveBeenCalledTimes(1));
    expect(mockApproveTodo).toHaveBeenCalledWith('d1', undefined);
    await waitFor(() => expect(screen.getByDisplayValue('Bananas')).toBeInTheDocument());

    // Approve the shopping item → resolves the last card and closes the drawer.
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    await waitFor(() => expect(mockApproveShoppingItem).toHaveBeenCalledTimes(1));
    expect(mockApproveShoppingItem).toHaveBeenCalledWith('s1', undefined);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
