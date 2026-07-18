import { describe, it, expect } from 'vitest';

import type { Account, Transaction } from '@/types/schema';
import {
  approveTargetAccountForTransaction,
  approveDetailLabel,
  calendarApproveDetail,
  approvedToastMessage,
} from '@/utils/approveDisclosure';

const makeAccount = (overrides: Partial<Account>): Account => ({
  id: 'acc-checking',
  name: 'Joint Checking',
  type: 'checking',
  balance: 1000,
  lastUpdated: '2026-06-01T00:00:00.000Z',
  ...overrides,
});

const makeTx = (overrides: Partial<Transaction>): Transaction =>
  ({
    id: 'tx-1',
    amount: 50,
    merchant: 'Store',
    category: 'Groceries',
    date: '2026-06-10',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  } as Transaction);

const checking = makeAccount({ id: 'acc-checking', name: 'Joint Checking', type: 'checking' });
const savings = makeAccount({ id: 'acc-savings', name: 'Savings', type: 'savings' });
const credit = makeAccount({ id: 'acc-credit', name: 'Card', type: 'credit' });
const accounts = [checking, savings, credit];

describe('approveTargetAccountForTransaction', () => {
  it('keeps an explicit existing tag (never second-guessed)', () => {
    const result = approveTargetAccountForTransaction(
      { merchant: 'Target', accountId: 'acc-credit' },
      accounts,
      []
    );
    expect(result?.id).toBe('acc-credit');
  });

  it('uses the smart-suggested account from verified same-merchant history', () => {
    const history = [makeTx({ id: 't1', merchant: 'Target', accountId: 'acc-credit' })];
    const result = approveTargetAccountForTransaction(
      { merchant: 'Target', accountId: undefined },
      accounts,
      history
    );
    expect(result?.id).toBe('acc-credit');
  });

  it('falls back to checking when untagged with no history (resolveTargetAccount rule)', () => {
    const result = approveTargetAccountForTransaction(
      { merchant: 'Target', accountId: undefined },
      accounts,
      []
    );
    expect(result?.id).toBe('acc-checking');
  });

  it('returns undefined only when no checking account exists either', () => {
    const result = approveTargetAccountForTransaction(
      { merchant: 'Target', accountId: undefined },
      [credit],
      []
    );
    expect(result).toBeUndefined();
  });

  it('re-routes a tag pointing at a deleted account to checking', () => {
    const result = approveTargetAccountForTransaction(
      { merchant: 'Target', accountId: 'acc-gone' },
      accounts,
      []
    );
    expect(result?.id).toBe('acc-checking');
  });
});

describe('approveDetailLabel', () => {
  it('joins amount and account with an arrow by default', () => {
    expect(approveDetailLabel('$12.40', 'Joint Checking')).toBe('$12.40 → Joint Checking');
  });

  it('reads "from" for money paid out of an account', () => {
    expect(approveDetailLabel('$120.00', 'Joint Checking', 'from')).toBe('$120.00 from Joint Checking');
  });

  it('stands the amount alone when no account resolves', () => {
    expect(approveDetailLabel('$12.40', undefined)).toBe('$12.40');
  });
});

describe('calendarApproveDetail', () => {
  it('shows the paying account for an expense bill ("from")', () => {
    const detail = calendarApproveDetail(
      { title: 'Rent', accountId: undefined, type: 'expense', amount: 1200 },
      accounts,
      [],
      '$1,200.00'
    );
    expect(detail).toBe('$1,200.00 from Joint Checking');
  });

  it('shows the receiving account for income ("→")', () => {
    const detail = calendarApproveDetail(
      { title: 'Paycheck', accountId: 'acc-savings', type: 'income', amount: 2000 },
      accounts,
      [],
      '$2,000.00'
    );
    expect(detail).toBe('$2,000.00 → Savings');
  });

  it('falls back to the bare amount when no payable account exists', () => {
    const detail = calendarApproveDetail(
      { title: 'Rent', accountId: undefined, type: 'expense', amount: 1200 },
      [credit],
      [],
      '$1,200.00'
    );
    expect(detail).toBe('$1,200.00');
  });
});

describe('approvedToastMessage', () => {
  it('names the amount and account', () => {
    expect(approvedToastMessage('$12.40', 'Joint Checking')).toBe('Approved $12.40 → Joint Checking');
  });

  it('degrades to the amount alone', () => {
    expect(approvedToastMessage('$12.40', undefined)).toBe('Approved $12.40');
  });
});
