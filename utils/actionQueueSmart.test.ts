import { describe, it, expect } from 'vitest';

import type { Account, Transaction } from '@/types/schema';
import {
  suggestAccountForCalendarItem,
  suggestAccountIdForTransaction,
  suggestCategoryForTransaction,
  nextDeferDate,
} from '@/utils/actionQueueSmart';

const makeAccount = (overrides: Partial<Account>): Account => ({
  id: 'acc-checking',
  name: 'Checking',
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

const checking = makeAccount({ id: 'acc-checking', name: 'Checking', type: 'checking' });
const savings = makeAccount({ id: 'acc-savings', name: 'Savings', type: 'savings' });
const credit = makeAccount({ id: 'acc-credit', name: 'Card', type: 'credit' });
const accounts = [checking, savings, credit];

describe('suggestAccountForCalendarItem', () => {
  it('prefers the account the item is explicitly tagged to', () => {
    const result = suggestAccountForCalendarItem(
      { title: 'Rent', accountId: 'acc-savings' },
      accounts,
      []
    );
    expect(result?.id).toBe('acc-savings');
  });

  it('never suggests a credit card, even when tagged', () => {
    const result = suggestAccountForCalendarItem(
      { title: 'Rent', accountId: 'acc-credit' },
      accounts,
      []
    );
    expect(result?.id).toBe('acc-checking');
  });

  it('uses the account from the most recent same-titled paid bill', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Rent', accountId: 'acc-savings', date: '2026-05-01', source: 'recurring' }),
      makeTx({ id: 't2', merchant: 'Rent', accountId: 'acc-checking', date: '2026-04-01', source: 'recurring' }),
    ];
    const result = suggestAccountForCalendarItem({ title: 'Rent' }, accounts, history);
    expect(result?.id).toBe('acc-savings');
  });

  it('ignores pending / differently-named / credit-tagged history', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Rent', accountId: 'acc-savings', status: 'pending_review' }),
      makeTx({ id: 't2', merchant: 'Electric', accountId: 'acc-savings' }),
      makeTx({ id: 't3', merchant: 'Rent', accountId: 'acc-credit' }),
    ];
    const result = suggestAccountForCalendarItem({ title: 'Rent' }, accounts, history);
    expect(result?.id).toBe('acc-checking');
  });

  it('matches titles after store-name normalization', () => {
    const history = [makeTx({ merchant: "Joe's Rent Co.", accountId: 'acc-savings' })];
    const result = suggestAccountForCalendarItem({ title: 'joes rent co' }, accounts, history);
    expect(result?.id).toBe('acc-savings');
  });

  it('falls back to checking, and to undefined when no payable account exists', () => {
    expect(suggestAccountForCalendarItem({ title: 'Rent' }, accounts, [])?.id).toBe('acc-checking');
    expect(suggestAccountForCalendarItem({ title: 'Rent' }, [credit], [])).toBeUndefined();
  });
});

describe('suggestAccountIdForTransaction', () => {
  it('returns undefined when the transaction is already tagged to a live account', () => {
    const result = suggestAccountIdForTransaction(
      { merchant: 'Target', accountId: 'acc-credit' },
      accounts,
      [makeTx({ merchant: 'Target', accountId: 'acc-savings' })]
    );
    expect(result).toBeUndefined();
  });

  it('suggests the most recently used account for the merchant when untagged', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Target', accountId: 'acc-credit', date: '2026-06-01' }),
      makeTx({ id: 't2', merchant: 'Target', accountId: 'acc-checking', date: '2026-05-01' }),
    ];
    const result = suggestAccountIdForTransaction({ merchant: 'Target' }, accounts, history);
    expect(result).toBe('acc-credit');
  });

  it('skips history pointing at deleted accounts', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Target', accountId: 'acc-gone', date: '2026-06-01' }),
      makeTx({ id: 't2', merchant: 'Target', accountId: 'acc-savings', date: '2026-05-01' }),
    ];
    const result = suggestAccountIdForTransaction({ merchant: 'Target' }, accounts, history);
    expect(result).toBe('acc-savings');
  });

  it('returns undefined with no usable history (implicit checking fallback)', () => {
    expect(suggestAccountIdForTransaction({ merchant: 'Target' }, accounts, [])).toBeUndefined();
  });
});

describe('suggestCategoryForTransaction', () => {
  const buckets = [{ name: 'Groceries' }, { name: 'Gas' }, { name: 'Fun' }];

  it('uses the majority category from same-merchant verified history', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Costco', category: 'Groceries', date: '2026-06-01' }),
      makeTx({ id: 't2', merchant: 'Costco', category: 'Groceries', date: '2026-05-20' }),
      makeTx({ id: 't3', merchant: 'Costco', category: 'Gas', date: '2026-06-02' }),
    ];
    const result = suggestCategoryForTransaction(
      { merchant: 'Costco', category: 'Uncategorized' },
      buckets,
      history
    );
    expect(result).toBe('Groceries');
  });

  it('breaks history ties toward the most recently used category', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Costco', category: 'Gas', date: '2026-06-02' }),
      makeTx({ id: 't2', merchant: 'Costco', category: 'Groceries', date: '2026-05-20' }),
    ];
    const result = suggestCategoryForTransaction(
      { merchant: 'Costco', category: 'Uncategorized' },
      buckets,
      history
    );
    expect(result).toBe('Gas');
  });

  it('never suggests the Credit Card sentinel — from history or the transaction itself', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Costco', category: 'Credit Card', date: '2026-06-02' }),
      makeTx({ id: 't2', merchant: 'Costco', category: 'Credit Card', date: '2026-05-25' }),
      makeTx({ id: 't3', merchant: 'Costco', category: 'Groceries', date: '2026-05-20' }),
    ];
    expect(
      suggestCategoryForTransaction({ merchant: 'Costco', category: 'Credit Card' }, buckets, history)
    ).toBe('Groceries');
    // With only sentinel history and a sentinel own-category, nothing usable remains.
    expect(
      suggestCategoryForTransaction({ merchant: 'Costco', category: 'Credit Card' }, buckets, history.slice(0, 2))
    ).toBeUndefined();
  });

  it('ignores Uncategorized rows in history', () => {
    const history = [
      makeTx({ id: 't1', merchant: 'Costco', category: 'Uncategorized', date: '2026-06-02' }),
      makeTx({ id: 't2', merchant: 'Costco', category: 'Groceries', date: '2026-05-20' }),
    ];
    const result = suggestCategoryForTransaction(
      { merchant: 'Costco', category: 'Uncategorized' },
      buckets,
      history
    );
    expect(result).toBe('Groceries');
  });

  it("keeps the transaction's own category when there is no history", () => {
    const result = suggestCategoryForTransaction(
      { merchant: 'New Place', category: 'Fun' },
      buckets,
      []
    );
    expect(result).toBe('Fun');
  });

  it('falls back to a bucket name found in the merchant', () => {
    const result = suggestCategoryForTransaction(
      { merchant: 'Shell Gas Station', category: 'Uncategorized' },
      buckets,
      []
    );
    expect(result).toBe('Gas');
  });

  it('never matches bucket names shorter than 3 characters', () => {
    const result = suggestCategoryForTransaction(
      { merchant: 'GoGo Cafe', category: 'Uncategorized' },
      [{ name: 'Go' }],
      []
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when nothing applies', () => {
    const result = suggestCategoryForTransaction(
      { merchant: 'Mystery', category: 'Uncategorized' },
      buckets,
      []
    );
    expect(result).toBeUndefined();
  });
});

describe('nextDeferDate', () => {
  const today = new Date(2026, 5, 16); // 2026-06-16 local

  it('defers past/today dates to tomorrow', () => {
    expect(nextDeferDate('2026-06-01', today)).toBe('2026-06-17');
    expect(nextDeferDate('2026-06-16', today)).toBe('2026-06-17');
  });

  it('defers future dates by one day from their current date', () => {
    expect(nextDeferDate('2026-06-20', today)).toBe('2026-06-21');
  });

  it('defers invalid dates to tomorrow', () => {
    expect(nextDeferDate('not-a-date', today)).toBe('2026-06-17');
  });
});
