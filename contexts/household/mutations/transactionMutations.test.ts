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
let capturedDeletes: CapturedWrite[] = [];
let commitCount = 0;
// Errors thrown by successive commit() calls (shifted per commit) — lets a test
// exercise the trash-mirror permission-denied fallback in deleteTransaction.
let commitErrors: unknown[] = [];

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
      delete: (ref: { __path: string }) => {
        capturedDeletes.push({ ref });
      },
      commit: vi.fn(async () => {
        const err = commitErrors.shift();
        if (err) throw err;
        commitCount++;
      }),
    })),
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

import { makeAddTransaction, makeDeleteTransaction, makeUpdateTransactionCategory } from './transactionMutations';
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
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
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

describe('makeDeleteTransaction — trash mirror + balance reversal', () => {
  const verifiedTx: Transaction = {
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
  };

  const deleteDeps = (transactions: Transaction[]) => ({
    db,
    householdId: HOUSEHOLD_ID,
    transactions,
    accounts,
    user: { uid: 'user-1' },
  });

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    vi.clearAllMocks();
  });

  it('mirrors the row into trash, reverses the balance, and deletes — one batch', async () => {
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([verifiedTx]));
    await deleteTransaction('tx-1');

    expect(commitCount).toBe(1);

    // Trash mirror: full row minus the synthetic id, stamped with deletedBy.
    expect(capturedSets).toHaveLength(1);
    const mirror = capturedSets[0]!;
    expect(mirror.ref.__path).toBe(`households/${HOUSEHOLD_ID}/trash/transaction_tx-1`);
    expect(mirror.data).toMatchObject({ domain: 'transaction', originalId: 'tx-1', deletedBy: 'user-1' });
    const mirrored = mirror.data!['data'] as Record<string, unknown>;
    expect(mirrored).toMatchObject({ amount: 42.5, merchant: 'Target', status: 'verified' });
    expect(mirrored).not.toHaveProperty('id');

    // Verified untagged expense → checking credited back.
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path).toBe(accountPath('acc-check'));
    expect(capturedUpdates[0]!.data?.['balance']).toEqual({ __increment: 42.5 });

    // Original row removed in the same batch.
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`)).toBe(true);
  });

  it('moves NO balance for a pending_review row but still mirrors it', async () => {
    const pending: Transaction = { ...verifiedTx, status: 'pending_review' };
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([pending]));
    await deleteTransaction('tx-1');

    expect(capturedUpdates).toHaveLength(0);
    expect(capturedSets).toHaveLength(1);
    expect((capturedSets[0]!.data!['data'] as Record<string, unknown>).status).toBe('pending_review');
  });

  it('falls back to a plain delete (no mirror) when the trash write is permission-denied', async () => {
    commitErrors = [{ code: 'permission-denied' }];
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([verifiedTx]));
    await deleteTransaction('tx-1');

    // Second batch committed: balance reversal + delete, but NO trash mirror.
    expect(commitCount).toBe(1);
    const fallbackSets = capturedSets.filter(s => s.ref.__path.includes('/trash/'));
    expect(fallbackSets).toHaveLength(1); // only the first (failed) batch had it
    expect(capturedDeletes.filter(d => d.ref.__path.endsWith('/transactions/tx-1'))).toHaveLength(2);
  });

  it('rethrows a non-permission commit error without retrying', async () => {
    commitErrors = [new Error('network down')];
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([verifiedTx]));
    await expect(deleteTransaction('tx-1')).rejects.toThrow('network down');
    expect(commitCount).toBe(0);
  });
});

describe('makeUpdateTransactionCategory — bank-email-sync needsCategory row', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    vi.clearAllMocks();
  });

  const txnPath = (id: string) => `households/${HOUSEHOLD_ID}/transactions/${id}`;

  // A row created by bankEmailSync: born `verified` + `needsCategory`, tagged to
  // checking, category 'Uncategorized'. Categorizing it must be a bucket
  // assignment only: the flag clears and NO balance delta is applied (the
  // reverse+apply impact of an already-verified row cancels to zero).
  const bankSyncRow: Transaction = {
    id: 'tx-bank',
    amount: 42,
    merchant: 'TARGET T-2189',
    category: 'Uncategorized',
    date: '2026-07-20',
    status: 'verified',
    isRecurring: false,
    source: 'shortcut',
    autoCategorized: false,
    accountId: 'acc-check',
    needsCategory: true,
  };

  function catDeps(transactions: Transaction[]) {
    return {
      db,
      householdId: HOUSEHOLD_ID,
      currentUser: { uid: 'user-1' },
      habits: [],
      transactions,
      accounts,
      householdSettings: null,
    };
  }

  it('clears needsCategory and applies NO balance delta on categorize', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([bankSyncRow]));
    await updateTransactionCategory('tx-bank', 'Groceries');

    expect(commitCount).toBe(1);
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-bank'));
    expect(txUpdate?.data).toMatchObject({
      category: 'Groceries',
      status: 'verified',
      needsCategory: false,
    });
    // No account balance update — the row was already verified, so reverse+apply
    // cancel to a zero net delta (the account is unchanged).
    const balanceUpdates = capturedUpdates.filter(u => u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`));
    expect(balanceUpdates).toHaveLength(0);
  });
});
