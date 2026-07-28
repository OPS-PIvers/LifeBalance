import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useSettleBill } from '@/hooks/useSettleBill';
import type { Account, Transaction } from '@/types/schema';

const settleBillWithTransaction = vi.fn(async () => true);
const mockUseHousehold = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

const accounts: Account[] = [
  { id: 'acc-check', name: 'Checking', type: 'checking', balance: 1000, lastUpdated: '' },
];

const taggedTx: Transaction = {
  id: 'tx-scan',
  amount: 379.1,
  merchant: 'Cpenergy Mngco',
  category: 'Uncategorized',
  date: '2026-07-22',
  status: 'pending_review',
  isRecurring: false,
  source: 'image-capture',
  autoCategorized: false,
  accountId: 'acc-check',
};

describe('useSettleBill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settleBillWithTransaction.mockResolvedValue(true);
    mockUseHousehold.mockReturnValue({
      accounts,
      transactions: [taggedTx],
      settleBillWithTransaction,
      householdSettings: null,
    });
  });

  it('forwards the caller’s LIVE amount to the mutation, not the stored one', async () => {
    // The review form's amount field may hold an unsaved correction (379.10 →
    // 37.91). Settling at the stored figure would debit ten times the real
    // charge with no warning.
    const { result } = renderHook(() => useSettleBill());
    act(() => {
      result.current.begin({ transactionId: 'tx-scan', calendarItemId: 'bill-1', amount: 37.91 });
    });

    await waitFor(() => expect(settleBillWithTransaction).toHaveBeenCalled());
    expect(settleBillWithTransaction).toHaveBeenCalledWith('tx-scan', 'bill-1', undefined, 37.91);
  });

  it('passes undefined when the host has no live amount (the calendar-side settle)', async () => {
    const { result } = renderHook(() => useSettleBill());
    act(() => {
      result.current.begin({ transactionId: 'tx-scan', calendarItemId: 'bill-1' });
    });

    await waitFor(() => expect(settleBillWithTransaction).toHaveBeenCalled());
    expect(settleBillWithTransaction).toHaveBeenCalledWith('tx-scan', 'bill-1', undefined, undefined);
  });

  it('carries the amount through the AccountPicker detour for an untagged row', async () => {
    mockUseHousehold.mockReturnValue({
      accounts,
      transactions: [{ ...taggedTx, accountId: undefined }],
      settleBillWithTransaction,
      householdSettings: null,
    });
    const { result } = renderHook(() => useSettleBill());
    act(() => {
      result.current.begin({ transactionId: 'tx-scan', calendarItemId: 'bill-1', amount: 37.91 });
    });
    expect(result.current.needsAccount).toBe(true);
    expect(settleBillWithTransaction).not.toHaveBeenCalled();

    act(() => {
      result.current.confirmAccount('acc-check');
    });
    await waitFor(() => expect(settleBillWithTransaction).toHaveBeenCalled());
    expect(settleBillWithTransaction).toHaveBeenCalledWith('tx-scan', 'bill-1', 'acc-check', 37.91);
  });
});
