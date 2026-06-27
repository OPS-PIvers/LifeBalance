import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AwaitingAmountDrawer from './AwaitingAmountDrawer';
import type { Transaction } from '@/types/schema';

const mockUpdateTransaction = vi.fn(() => Promise.resolve());
const mockMarkPrompted = vi.fn(() => Promise.resolve());

// AwaitingAmountDrawer reads useFinance/useGamification/useShopping. The nested
// CaptureTransactionManual receives everything via props (no context import), so
// mocking these three is sufficient.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    buckets: [{ id: 'b1', name: 'Groceries' }],
    transactions: [],
    accounts: [],
    updateTransaction: mockUpdateTransaction,
    markNeedsAmountPrompted: mockMarkPrompted,
  }),
  useGamification: () => ({ habits: [] }),
  useShopping: () => ({ stores: [] }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const stub = (id: string, merchant: string): Transaction => ({
  id,
  amount: 0,
  merchant,
  category: 'Uncategorized',
  date: '2026-06-27',
  status: 'pending_review',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  needsAmount: true,
});

describe('AwaitingAmountDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the batch prompted on open and prefills the first card', () => {
    const stubs = [stub('s1', 'Shell Gas'), stub('s2', 'Target')];
    render(<AwaitingAmountDrawer stubs={stubs} isOpen onClose={vi.fn()} />);

    // Suppression write fires once for all stubs in the batch.
    expect(mockMarkPrompted).toHaveBeenCalledWith(['s1', 's2']);

    // First card prefilled with merchant; amount left blank for the user.
    expect(screen.getByDisplayValue('Shell Gas')).toBeInTheDocument();
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('');
  });

  it('promotes the existing stub on save (no duplicate) and advances exactly once', async () => {
    const stubs = [stub('s1', 'Shell Gas'), stub('s2', 'Target')];
    const onClose = vi.fn();
    render(<AwaitingAmountDrawer stubs={stubs} isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.50' } });
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => expect(mockUpdateTransaction).toHaveBeenCalledTimes(1));
    // Patches the EXISTING stub by id → verified + amount + flag cleared.
    expect(mockUpdateTransaction).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ amount: 45.5, status: 'verified', needsAmount: false }),
    );

    // Advances to the SECOND card (regression: a single save must not double-advance).
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('Shell Gas')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('skip advances without saving; finishing the last card closes the drawer', async () => {
    const stubs = [stub('s1', 'Shell Gas'), stub('s2', 'Target')];
    const onClose = vi.fn();
    render(<AwaitingAmountDrawer stubs={stubs} isOpen onClose={onClose} />);

    // Card 1 is not the last → "Skip — add later"; advances without a write.
    fireEvent.click(screen.getByText('Skip — add later'));
    expect(mockUpdateTransaction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByDisplayValue('Target')).toBeInTheDocument());

    // Card 2 is the last → "Done for now" closes the whole drawer.
    fireEvent.click(screen.getByText('Done for now'));
    expect(onClose).toHaveBeenCalled();
  });
});
