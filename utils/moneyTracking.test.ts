import { describe, it, expect } from 'vitest';
import { balanceLineCopy, isBankSyncOnly, resolveMoneyTracking } from '@/utils/moneyTracking';
import type { Household } from '@/types/schema';

describe('moneyTracking', () => {
  it('defaults absent or unrecognised values to reviewing each transaction', () => {
    expect(resolveMoneyTracking(null)).toBe('transactions');
    expect(resolveMoneyTracking({})).toBe('transactions');
    expect(resolveMoneyTracking({ moneyTracking: 'nonsense' as Household['moneyTracking'] })).toBe('transactions');
    expect(isBankSyncOnly(undefined)).toBe(false);
  });

  it('reads bank_sync', () => {
    expect(isBankSyncOnly({ moneyTracking: 'bank_sync' })).toBe(true);
  });

  it('labels the balance by mode', () => {
    expect(balanceLineCopy({})).toEqual({ label: 'Checking balance', sub: 'Available cash' });
    expect(balanceLineCopy({ bankSyncOnly: true })).toEqual({ label: 'Bank balance', sub: 'From the nightly bank sync' });
    expect(balanceLineCopy({ bankSyncOnly: true, balanceAsOf: '2026-11-02' }).sub).toBe('From the bank sync, as of Nov 2');
  });
});
