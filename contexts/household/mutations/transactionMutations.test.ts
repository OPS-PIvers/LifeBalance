import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Firestore mock --------------------------------------------------------
// Mirrors commentMutations.test.ts's mock shape: captures every batch
// set/update call so tests can assert the atomic transaction+balances batch.

interface CapturedWrite {
  ref: { __path: string };
  data?: Record<string, unknown>;
}

let capturedSets: CapturedWrite[] = [];
let capturedUpdates: CapturedWrite[] = [];
let commitCount = 0;

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((first: unknown, path?: string, id?: string) => {
      const firstRef = first as { __path?: string } | undefined;
      if (firstRef?.__path !== undefined && path === undefined) {
        return { __path: `${firstRef.__path}/__autoId` };
      }
      return { __path: id ? `${path}/${id}` : (path ?? '__autoId') };
    }),
    collection: vi.fn((_db: unknown, path: string) => {
      const ref: { __path: string; withConverter: () => typeof ref } = {
        __path: path,
        withConverter: () => ref,
      };
      return ref;
    }),
    increment: (n: number) => ({ __increment: n }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    deleteField: () => ({ __deleteField: true }),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedSets.push({ ref, data });
      },
      update: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedUpdates.push({ ref, data });
      },
      delete: vi.fn(),
      commit: vi.fn(async () => {
        commitCount++;
      }),
    })),
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

import { makeAddTransaction } from './transactionMutations';
import type { Account, Transaction } from '@/types/schema';

const HOUSEHOLD_ID = 'house1';
const db = {} as never;

const accounts: Account[] = [
  { id: 'acc-check', name: 'Checking', type: 'checking', balance: 500, lastUpdated: '' },
  { id: 'acc-save', name: 'Savings', type: 'savings', balance: 900, lastUpdated: '' },
  { id: 'acc-card', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' },
];

function makeDeps() {
  return {
    db,
    householdId: HOUSEHOLD_ID,
    user: { uid: 'user-1' },
    householdSettings: null,
    accounts,
    recentTransactionsRef: { current: [{ id: 'existing' } as Transaction] },
  };
}

const basePayment: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'> = {
  amount: 100,
  merchant: 'Visa payment',
  category: 'Credit Card',
  date: '2026-07-16',
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  accountId: 'acc-card',
  creditPayment: true,
};

const accountPath = (id: string) => `households/${HOUSEHOLD_ID}/accounts/${id}`;

describe('makeAddTransaction — credit-card payment funding transfer', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    commitCount = 0;
    vi.clearAllMocks();
  });

  it('debits the funding account AND credits the card in one batch', async () => {
    const { addTransaction } = makeAddTransaction(makeDeps());
    await addTransaction({ ...basePayment, fundingAccountId: 'acc-check' });

    expect(commitCount).toBe(1);
    // Transaction doc persists the funding account id.
    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!.data).toMatchObject({ fundingAccountId: 'acc-check', creditPayment: true });

    // Card paid down by 100, funding checking debited by 100 — same batch.
    const cardUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-card'));
    const fundingUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-check'));
    expect(cardUpdate?.data?.['balance']).toEqual({ __increment: -100 });
    expect(fundingUpdate?.data?.['balance']).toEqual({ __increment: -100 });
    expect(capturedUpdates).toHaveLength(2);
  });

  it('behaves as today (card only) when no funding account is given', async () => {
    const { addTransaction } = makeAddTransaction(makeDeps());
    await addTransaction(basePayment);

    expect(capturedSets[0]!.data).not.toHaveProperty('fundingAccountId');
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path).toBe(accountPath('acc-card'));
    expect(capturedUpdates[0]!.data?.['balance']).toEqual({ __increment: -100 });
  });

  it('ignores a credit-typed funding account', async () => {
    const { addTransaction } = makeAddTransaction(makeDeps());
    await addTransaction({ ...basePayment, fundingAccountId: 'acc-card' });

    // Only the card update (and never two writes to the same doc in one batch).
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path).toBe(accountPath('acc-card'));
  });

  it('moves NO balances for a pending_review payment, even with a funding account', async () => {
    const { addTransaction } = makeAddTransaction(makeDeps());
    await addTransaction({ ...basePayment, status: 'pending_review', fundingAccountId: 'acc-check' });

    expect(capturedUpdates).toHaveLength(0);
    // Provenance is still recorded for when the row is later verified.
    expect(capturedSets[0]!.data).toMatchObject({ fundingAccountId: 'acc-check' });
  });

  it('does not persist fundingAccountId on a plain charge', async () => {
    const { addTransaction } = makeAddTransaction(makeDeps());
    await addTransaction({ ...basePayment, creditPayment: undefined, fundingAccountId: 'acc-check' });

    expect(capturedSets[0]!.data).not.toHaveProperty('fundingAccountId');
    // Charge raises the card's debt; funding untouched.
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path).toBe(accountPath('acc-card'));
    expect(capturedUpdates[0]!.data?.['balance']).toEqual({ __increment: 100 });
  });
});
