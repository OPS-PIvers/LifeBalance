import { describe, it, expect } from 'vitest';
import { shouldOfferBalanceAdoption, PLAID_BALANCE_DIVERGENCE_THRESHOLD } from './plaidBalance';
import type { Account } from '@/types/schema';

const baseAccount: Account = {
  id: 'acc1',
  name: 'Checking',
  type: 'checking',
  balance: 100,
  lastUpdated: '2026-06-20T00:00:00.000Z',
};

describe('shouldOfferBalanceAdoption', () => {
  it('returns false when the account has no Plaid balance reading', () => {
    expect(shouldOfferBalanceAdoption(baseAccount)).toBe(false);
  });

  it('returns false when the Plaid balance matches the manual balance exactly', () => {
    expect(shouldOfferBalanceAdoption({ ...baseAccount, plaidBalanceCurrent: 100 })).toBe(false);
  });

  it(`returns false when the divergence is at or under the ${PLAID_BALANCE_DIVERGENCE_THRESHOLD} threshold`, () => {
    expect(shouldOfferBalanceAdoption({ ...baseAccount, plaidBalanceCurrent: 101 })).toBe(false);
  });

  it('returns true when the divergence exceeds the threshold (higher)', () => {
    expect(shouldOfferBalanceAdoption({ ...baseAccount, plaidBalanceCurrent: 101.5 })).toBe(true);
  });

  it('returns true when the divergence exceeds the threshold (lower)', () => {
    expect(shouldOfferBalanceAdoption({ ...baseAccount, plaidBalanceCurrent: 98 })).toBe(true);
  });

  it('is symmetric — a lower Plaid balance also triggers the affordance', () => {
    expect(shouldOfferBalanceAdoption({ ...baseAccount, plaidBalanceCurrent: 50 })).toBe(true);
  });
});
