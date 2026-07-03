import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewPendingDrawer from './ReviewPendingDrawer';
import type { Transaction } from '@/types/schema';

const mockUpdateCategory = vi.fn(() => Promise.resolve());
const mockDeleteTransaction = vi.fn(() => Promise.resolve());

// ReviewPendingDrawer renders TransactionReviewForm, which consumes
// useFinance/useGamification directly. Mocking these two is sufficient.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    buckets: [{ id: 'b1', name: 'Groceries' }, { id: 'b2', name: 'Gas' }],
    accounts: [],
    transactions: [],
    updateTransactionCategory: mockUpdateCategory,
    deleteTransaction: mockDeleteTransaction,
  }),
  useGamification: () => ({ habits: [] }),
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

describe('ReviewPendingDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the first pending transaction prefilled (no doc-stamping on open)', () => {
    const transactions = [tx('t1', 'Shell Gas'), tx('t2', 'Target')];
    render(<ReviewPendingDrawer transactions={transactions} isOpen onClose={vi.fn()} />);

    expect(screen.getByDisplayValue('Shell Gas')).toBeInTheDocument();
    // A real amount prefills (only $0 stubs open blank).
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('25');
  });

  it('approving verifies via a single call then advances to the next card', async () => {
    const transactions = [tx('t1', 'Shell Gas'), tx('t2', 'Target')];
    const onClose = vi.fn();
    render(<ReviewPendingDrawer transactions={transactions} isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /Approve Transaction/ }));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
    // Unedited real transaction → category 'Groceries' preselected, no overrides.
    expect(mockUpdateCategory).toHaveBeenCalledWith('t1', 'Groceries', [], undefined, undefined);

    // Advances to the SECOND card (a single approve must not double-advance).
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('Shell Gas')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends an amount override (once) when approving a $0 needsAmount stub', async () => {
    const transactions = [tx('t1', 'Shell Gas', { amount: 0, needsAmount: true })];
    render(<ReviewPendingDrawer transactions={transactions} isOpen onClose={vi.fn()} />);

    // Stub opens blank; the CTA reads "Add amount & approve" and is disabled.
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /Add amount & approve/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.50' } });
    fireEvent.click(screen.getByRole('button', { name: /Approve Transaction/ }));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(1));
    expect(mockUpdateCategory).toHaveBeenCalledWith(
      't1',
      'Groceries',
      [],
      undefined,
      expect.objectContaining({ amount: 45.5, clearNeedsAmount: true }),
    );
  });

  it('skip advances without verifying; finishing the last card closes the drawer', async () => {
    const transactions = [tx('t1', 'Shell Gas'), tx('t2', 'Target')];
    const onClose = vi.fn();
    render(<ReviewPendingDrawer transactions={transactions} isOpen onClose={onClose} />);

    // Card 1 is not the last → "Skip — add later"; advances without a write.
    fireEvent.click(screen.getByText('Skip — add later'));
    expect(mockUpdateCategory).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());

    // Card 2 is the last → "Done for now" closes the whole drawer.
    fireEvent.click(screen.getByText('Done for now'));
    expect(onClose).toHaveBeenCalled();
  });
});
