import { describe, it, expect } from 'vitest';
import {
  TRASH_RETENTION_DAYS,
  TRASH_DOMAIN_META,
  trashDocId,
  isTrashDomain,
  isTrashExpired,
  daysUntilPurge,
  trashItemTitle,
  trashItemSubtitle,
  transactionTrashData,
  transactionRestoreImpact,
  type TrashedItem,
} from '@/utils/trash';
import type { Account, Transaction } from '@/types/schema';

const DAY = 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<TrashedItem> = {}): TrashedItem {
  return {
    id: 'todo_abc',
    domain: 'todo',
    originalId: 'abc',
    data: {},
    deletedAt: '2026-07-01T12:00:00.000Z',
    deletedBy: 'user-1',
    ...overrides,
  };
}

describe('trashDocId', () => {
  it('is deterministic per domain + original id', () => {
    expect(trashDocId('meal', 'm1')).toBe('meal_m1');
    expect(trashDocId('todo', 'm1')).not.toBe(trashDocId('meal', 'm1'));
  });
});

describe('isTrashDomain', () => {
  it('accepts known domains and rejects everything else', () => {
    for (const key of Object.keys(TRASH_DOMAIN_META)) {
      expect(isTrashDomain(key)).toBe(true);
    }
    expect(isTrashDomain('transaction')).toBe(true);
    expect(isTrashDomain('account')).toBe(false);
    expect(isTrashDomain(42)).toBe(false);
    expect(isTrashDomain(null)).toBe(false);
  });
});

describe('isTrashExpired', () => {
  const deletedAt = '2026-07-01T00:00:00.000Z';
  it('is false before the retention window closes', () => {
    const now = new Date(new Date(deletedAt).getTime() + (TRASH_RETENTION_DAYS - 1) * DAY);
    expect(isTrashExpired(deletedAt, now)).toBe(false);
  });
  it('is true once the retention window has fully elapsed', () => {
    const now = new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY);
    expect(isTrashExpired(deletedAt, now)).toBe(true);
  });
  it('fails safe (not expired) for a malformed timestamp', () => {
    expect(isTrashExpired('not-a-date', new Date())).toBe(false);
  });
});

describe('daysUntilPurge', () => {
  const deletedAt = '2026-07-01T00:00:00.000Z';
  it('reports the full window right after deletion', () => {
    const now = new Date(deletedAt);
    expect(daysUntilPurge(deletedAt, now)).toBe(TRASH_RETENTION_DAYS);
  });
  it('counts down and clamps to 0 past expiry', () => {
    const midway = new Date(new Date(deletedAt).getTime() + 10 * DAY);
    expect(daysUntilPurge(deletedAt, midway)).toBe(TRASH_RETENTION_DAYS - 10);
    const past = new Date(new Date(deletedAt).getTime() + 40 * DAY);
    expect(daysUntilPurge(deletedAt, past)).toBe(0);
  });
  it('returns 0 for a malformed timestamp', () => {
    expect(daysUntilPurge('nonsense', new Date())).toBe(0);
  });
});

describe('trashItemTitle', () => {
  it('probes name-like fields across domains', () => {
    expect(trashItemTitle(makeItem({ data: { name: 'Milk' } }))).toBe('Milk');
    expect(trashItemTitle(makeItem({ data: { title: 'Pay rent' } }))).toBe('Pay rent');
    expect(trashItemTitle(makeItem({ data: { text: 'Take out trash' } }))).toBe('Take out trash');
    expect(trashItemTitle(makeItem({ data: { merchant: 'Target' } }))).toBe('Target');
  });
  it('prefers name over other fields', () => {
    expect(trashItemTitle(makeItem({ data: { name: 'A', title: 'B' } }))).toBe('A');
  });
  it('falls back to the domain label when nothing usable is present', () => {
    expect(trashItemTitle(makeItem({ domain: 'habit', data: {} }))).toBe('Habit');
    expect(trashItemTitle(makeItem({ domain: 'meal', data: { name: '   ' } }))).toBe('Meal');
    expect(trashItemTitle(makeItem({ domain: 'transaction', data: {} }))).toBe('Transaction');
  });
});

// ---------------------------------------------------------------------------
// Transaction-domain helpers (Recently Deleted parity for transactions)
// ---------------------------------------------------------------------------

describe('TRASH_DOMAIN_META — transaction', () => {
  it('maps the transaction domain to the transactions subcollection', () => {
    expect(TRASH_DOMAIN_META.transaction).toEqual({ collection: 'transactions', label: 'Transaction' });
  });
});

describe('transactionTrashData', () => {
  it('mirrors the full row minus the synthetic id and undefined fields', () => {
    const tx: Transaction = {
      id: 'tx-1',
      amount: 42.5,
      merchant: 'Target',
      category: 'Shopping',
      date: '2026-07-10',
      status: 'verified',
      isRecurring: false,
      source: 'manual',
      autoCategorized: false,
      createdBy: 'user-1',
      createdAt: '2026-07-10T00:00:00.000Z',
      payPeriodId: 'pp-1',
      accountId: undefined,
    };
    const data = transactionTrashData(tx);
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('accountId'); // undefined dropped
    expect(data).toMatchObject({
      amount: 42.5,
      merchant: 'Target',
      category: 'Shopping',
      status: 'verified',
      payPeriodId: 'pp-1',
    });
  });
});

describe('trashItemSubtitle', () => {
  it('is amount · date for a transaction', () => {
    const item = makeItem({
      domain: 'transaction',
      data: { merchant: 'Target', amount: 45.2, date: '2026-07-03' },
    });
    expect(trashItemSubtitle(item)).toBe('$45.20 · 2026-07-03');
  });
  it('degrades to just the pieces that exist', () => {
    expect(trashItemSubtitle(makeItem({ domain: 'transaction', data: { amount: 5 } }))).toBe('$5.00');
    expect(trashItemSubtitle(makeItem({ domain: 'transaction', data: { date: '2026-01-02' } }))).toBe('2026-01-02');
    expect(trashItemSubtitle(makeItem({ domain: 'transaction', data: {} }))).toBeNull();
  });
  it('is null for every other domain', () => {
    expect(trashItemSubtitle(makeItem({ domain: 'todo', data: { amount: 5, date: '2026-01-02' } }))).toBeNull();
  });
});

describe('transactionRestoreImpact', () => {
  const accounts: Account[] = [
    { id: 'acc-check', name: 'Checking', type: 'checking', balance: 500, lastUpdated: '' },
    { id: 'acc-save', name: 'Savings', type: 'savings', balance: 900, lastUpdated: '' },
    { id: 'acc-card', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' },
  ];

  it('re-applies a verified untagged expense as a checking debit', () => {
    expect(
      transactionRestoreImpact({ amount: 42.5, category: 'Shopping', status: 'verified' }, accounts)
    ).toEqual({ outcome: 'apply', accountId: 'acc-check', delta: -42.5 });
  });

  it('re-applies verified income as a checking credit', () => {
    expect(
      transactionRestoreImpact({ amount: 5000, category: 'Income', status: 'verified' }, accounts)
    ).toEqual({ outcome: 'apply', accountId: 'acc-check', delta: 5000 });
  });

  it('re-applies a verified credit-card charge as debt (+amount on the card)', () => {
    expect(
      transactionRestoreImpact(
        { amount: 30, category: 'Dining', status: 'verified', accountId: 'acc-card' },
        accounts
      )
    ).toEqual({ outcome: 'apply', accountId: 'acc-card', delta: 30 });
  });

  it('re-applies a verified credit-card payment as −amount on the card', () => {
    expect(
      transactionRestoreImpact(
        { amount: 100, category: 'Credit Card', status: 'verified', accountId: 'acc-card', creditPayment: true },
        accounts
      )
    ).toEqual({ outcome: 'apply', accountId: 'acc-card', delta: -100 });
  });

  it('never moves a balance for a pending_review row (it never debited)', () => {
    expect(
      transactionRestoreImpact({ amount: 42.5, category: 'Shopping', status: 'pending_review' }, accounts)
    ).toEqual({ outcome: 'none' });
  });

  it('reports missing-account when the TAGGED account has been deleted since', () => {
    expect(
      transactionRestoreImpact(
        { amount: 42.5, category: 'Shopping', status: 'verified', accountId: 'acc-gone' },
        accounts
      )
    ).toEqual({ outcome: 'missing-account' });
  });

  it('is none when there is no account to route to at all', () => {
    expect(
      transactionRestoreImpact({ amount: 42.5, category: 'Shopping', status: 'verified' }, [])
    ).toEqual({ outcome: 'none' });
  });

  it('is none for a zero or malformed amount', () => {
    expect(transactionRestoreImpact({ amount: 0, category: 'Shopping', status: 'verified' }, accounts)).toEqual({ outcome: 'none' });
    expect(transactionRestoreImpact({ amount: 'x', category: 'Shopping', status: 'verified' }, accounts)).toEqual({ outcome: 'none' });
    expect(transactionRestoreImpact({ category: 'Shopping', status: 'verified' }, accounts)).toEqual({ outcome: 'none' });
  });

  it('rounds the delta to whole cents', () => {
    expect(
      transactionRestoreImpact({ amount: 10.001, category: 'Shopping', status: 'verified' }, accounts)
    ).toEqual({ outcome: 'apply', accountId: 'acc-check', delta: -10 });
  });
});
