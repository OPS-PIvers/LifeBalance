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
interface MockWhere { field: string; op: string; value: unknown }
// Stored habit submissions, keyed by subcollection path, served to getDocs.
// Back-dated fires read these (a threshold habit's prior-period unit count) and
// the undo reads them to find what a given transaction actually credited.
let submissionDocs: Record<string, ({ id: string } & Record<string, unknown>)[]> = {};

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
    arrayUnion: (...vals: unknown[]) => ({ __arrayUnion: vals }),
    arrayRemove: (...vals: unknown[]) => ({ __arrayRemove: vals }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    deleteField: () => ({ __deleteField: true }),
    updateDoc: vi.fn(),
    // Submission reads (back-dated habit fires + their undo). The `where`
    // clauses are actually EVALUATED — the undo's correctness depends on
    // filtering by sourceTransactionId (so it can't consume a hand-logged or
    // another transaction's submission), so a mock that ignored filters would
    // pass while the real query misbehaved. Seed via `submissionDocs[path]`.
    query: vi.fn((ref: { __path: string }, ...constraints: MockWhere[]) => ({
      __path: ref.__path,
      __where: constraints,
    })),
    where: vi.fn((field: string, op: string, value: unknown): MockWhere => ({ field, op, value })),
    getDocs: vi.fn(async (ref: { __path: string; __where?: MockWhere[] }) => {
      const matches = (d: Record<string, unknown>) =>
        (ref.__where ?? []).every(({ field, op, value }) => {
          const actual = d[field];
          if (op === '==') return actual === value;
          if (op === '>=') return String(actual) >= String(value);
          if (op === '<=') return String(actual) <= String(value);
          if (op === 'in') return (value as unknown[]).includes(actual);
          throw new Error(`Unsupported mock query operator: ${op}`);
        });
      return {
        docs: (submissionDocs[ref.__path] ?? [])
          .filter(matches)
          .map(d => ({ id: d.id, data: () => d })),
      };
    }),
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

import { updateDoc } from 'firebase/firestore';
import { makeAddTransaction, makeDeleteTransaction, makeKeepBothTransactions, makeMergeTransactions, makeSplitTransaction, makeUpdateTransaction, makeUpdateTransactionCategory, makeReverseTransactionApproval } from './transactionMutations';
import { getLocalDateString } from '@/utils/dateHelpers';
import { addDays, format, parseISO, subDays } from 'date-fns';
import type { Account, CalendarItem, FreezeBank, Habit, Transaction } from '@/types/schema';

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
    submissionDocs = {};
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

  const deleteDeps = (transactions: Transaction[], calendarItems: CalendarItem[] = []) => ({
    db,
    householdId: HOUSEHOLD_ID,
    transactions,
    accounts,
    user: { uid: 'user-1' },
    calendarItems,
  });

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
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

  // BANK-SYNC: the sync sets the account balance authoritatively from the bank
  // email's ENDING BALANCE (already reflecting the row), so deleting the row
  // must NOT credit the balance back — the bank's stated balance stays correct.
  it('reverses NO balance for a verified bank-sync row (source arm) but still mirrors + deletes', async () => {
    const bankRow: Transaction = { ...verifiedTx, source: 'bank-sync', bankRef: 'P0000123', accountId: 'acc-check' };
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([bankRow]));
    await deleteTransaction('tx-1');

    expect(commitCount).toBe(1);
    expect(capturedUpdates).toHaveLength(0); // no account write at all
    expect(capturedSets).toHaveLength(1); // trash mirror still happens
    expect(capturedDeletes.some(d => d.ref.__path.endsWith('/transactions/tx-1'))).toBe(true);
  });

  it('reverses NO balance for a bankRef-stamped row even when source is not bank-sync', async () => {
    const filledRow: Transaction = { ...verifiedTx, source: 'shortcut', bankRef: 'synth:abc', accountId: 'acc-check' };
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([filledRow]));
    await deleteTransaction('tx-1');

    expect(capturedUpdates).toHaveLength(0);
  });

  it('reverses the MANUAL account for a stamped bank-sync row re-tagged away from its home', async () => {
    // Home (acc-check) is email-authoritative; the row now sits on acc-save,
    // whose balance WAS accumulated from this row on re-tag — delete must
    // reverse acc-save and never touch acc-check.
    const retagged: Transaction = {
      ...verifiedTx,
      source: 'bank-sync',
      bankRef: 'P0000123',
      accountId: 'acc-save',
      bankSyncAccountId: 'acc-check',
    };
    const { deleteTransaction } = makeDeleteTransaction(deleteDeps([retagged]));
    await deleteTransaction('tx-1');

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path.endsWith('/accounts/acc-save')).toBe(true);
    expect(capturedUpdates[0]!.data?.balance).toEqual({ __increment: 42.5 });
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
    submissionDocs = {};
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
      freezeBank: null,
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

  it('applies NO balance delta even with an inline amount override on a bank-sync row (source arm)', async () => {
    const realBankRow: Transaction = { ...bankSyncRow, source: 'bank-sync', bankRef: 'P0000123' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([realBankRow]));
    await updateTransactionCategory('tx-bank', 'Groceries', undefined, undefined, { amount: 55 });

    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-bank'));
    expect(txUpdate?.data).toMatchObject({ category: 'Groceries', amount: 55 });
    // The bank's ending balance already reflects the settled transaction;
    // correcting our recorded amount must not move any account.
    const balanceUpdates = capturedUpdates.filter(u => u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`));
    expect(balanceUpdates).toHaveLength(0);
  });

  it('applies NO balance delta for a bankRef-stamped row even when source is not bank-sync', async () => {
    // Guards against narrowing isBankSyncTransaction's OR to an AND.
    const filledRow: Transaction = { ...bankSyncRow, source: 'shortcut', bankRef: 'synth:abc' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([filledRow]));
    await updateTransactionCategory('tx-bank', 'Groceries', undefined, undefined, { amount: 55 });

    const balanceUpdates = capturedUpdates.filter(u => u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`));
    expect(balanceUpdates).toHaveLength(0);
  });

  // HIGH finding fix: re-tagging (Action Queue smart-approve) to a manual
  // account must debit that destination, not silently drop the money.
  it('re-tagging a bank-sync row to a manual account applies the delta to the destination and stamps the home', async () => {
    const bankRow: Transaction = { ...bankSyncRow, source: 'bank-sync', bankRef: 'P0000123', accountId: 'acc-check' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([bankRow]));
    await updateTransactionCategory('tx-bank', 'Groceries', undefined, 'acc-save');

    expect(capturedUpdates.some(u => u.ref.__path === accountPath('acc-check'))).toBe(false);
    const savingsUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-save'));
    expect(savingsUpdate?.data?.['balance']).toEqual({ __increment: -42 });
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-bank'));
    expect(txUpdate?.data).toMatchObject({ bankSyncAccountId: 'acc-check' });
  });
});

// Habit-history clobber guard (2026-07-15 incident): a transaction that fires
// a habit must write completion history as arrayUnion/arrayRemove DELTAS and
// the counters as increment() — NEVER whole client-computed arrays/scalars, or
// a stale-cache device wipes another device's completions.
describe('habit firing writes DELTAS, never whole values', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
    vi.clearAllMocks();
  });

  const habitPath = (id: string) => `households/${HOUSEHOLD_ID}/habits/${id}`;
  const txnPath = (id: string) => `households/${HOUSEHOLD_ID}/transactions/${id}`;
  const submissionsPath = (id: string) => `${habitPath(id)}/submissions`;
  const today = getLocalDateString();
  // A transaction dated a few days ago — the shape the nightly bankEmailSync
  // produces. The fire must credit THIS date, not today.
  const backDate = format(subDays(parseISO(today), 4), 'yyyy-MM-dd');

  const threshHabit: Habit = {
    id: 'h1',
    title: 'Groceries under budget',
    category: 'Finance',
    type: 'positive',
    scoringType: 'threshold',
    period: 'daily',
    basePoints: 10,
    targetCount: 1,
    count: 0,
    totalCount: 4,
    completedDates: ['2020-01-01'],
    streakDays: 0,
    // Non-stale (updated today) so the forward fire exercises the normal
    // increment() delta path; the stale lazy-reset path is covered separately.
    lastUpdated: new Date().toISOString(),
  };

  const pendingTx: Transaction = {
    id: 'tx-9',
    amount: 30,
    merchant: 'Whole Foods',
    category: 'Groceries',
    date: backDate,
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    accountId: 'acc-check',
  };
  // Same row, dated today — the live-counter path.
  const todayTx: Transaction = { ...pendingTx, id: 'tx-today', date: today };

  const catDeps = (transactions: Transaction[], habits: Habit[]) => ({
    db,
    householdId: HOUSEHOLD_ID,
    currentUser: { uid: 'user-1' },
    habits,
    transactions,
    accounts,
    householdSettings: null,
    freezeBank: null,
  });

  it('BACK-DATES the fire to the transaction date, leaving the live counter alone', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([pendingTx], [threshHabit]));
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    expect(habitUpdate).toBeDefined();
    const data = habitUpdate!.data!;
    // THE BUG THIS FIXES: the completion lands on the transaction's date, not on
    // the day the row happened to be reviewed.
    expect(data['completedDates']).toEqual({ __arrayUnion: [backDate] });
    expect(data['completedDates']).not.toEqual({ __arrayUnion: [today] });
    // Completion history moves ONLY via an arrayUnion delta — never a whole
    // array that a stale cache could use to clobber other completions.
    expect(Array.isArray(data['completedDates'])).toBe(false);
    // A PAST-period fire must not touch the live counter at all: it describes a
    // later period than the one being credited.
    expect(data['count']).toBeUndefined();
    // The lifetime counter is period-independent, so it still increments.
    expect(data['totalCount']).toEqual({ __increment: 1 });
    // Fired ledger recorded on the transaction (arrayUnion delta).
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-9'));
    expect(txUpdate!.data!['firedHabitIds']).toEqual({ __arrayUnion: ['h1'] });
  });

  it('gates the points buckets by fire date: total only, never a past day into today', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([pendingTx], [threshHabit]));
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const householdUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    // Lifetime total absorbs it...
    expect(householdUpdate!.data!['points.total']).toEqual({ __increment: 10 });
    // ...but a 4-day-old fire must not inflate today's daily total.
    expect(householdUpdate!.data!['points.daily']).toBeUndefined();
  });

  it('writes a submission doc carrying the fire date, points and source transaction', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([pendingTx], [threshHabit]));
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')));
    expect(submission).toBeDefined();
    expect(submission!.data).toMatchObject({
      habitId: 'h1',
      date: backDate,
      count: 1,
      pointsEarned: 10,
      // What makes the undo exact rather than a recomputation.
      sourceTransactionId: 'tx-9',
    });
    // And the habit is flagged so the calendar reads its stored per-date units.
    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    expect(habitUpdate!.data!['hasSubmissionTracking']).toBe(true);
  });

  it('records the association but fires NOTHING beyond the back-date window', async () => {
    const ancientTx: Transaction = {
      ...pendingTx,
      id: 'tx-old',
      date: format(subDays(parseISO(today), 45), 'yyyy-MM-dd'),
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([ancientTx], [threshHabit]));
    await updateTransactionCategory('tx-old', 'Groceries', ['h1']);

    // No habit write, no submission, no points — a 45-day-old row must not
    // rewrite settled streak history.
    expect(capturedUpdates.find(u => u.ref.__path === habitPath('h1'))).toBeUndefined();
    expect(capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))).toBeUndefined();
    // But the association IS still recorded on the transaction.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-old'));
    expect(txUpdate!.data!['relatedHabitIds']).toEqual(['h1']);
    expect(txUpdate!.data!['firedHabitIds']).toBeUndefined();
  });

  it('refuses to fire a FUTURE-dated transaction (would corrupt the streak chain)', async () => {
    const futureTx: Transaction = {
      ...pendingTx,
      id: 'tx-future',
      date: format(addDays(parseISO(today), 3), 'yyyy-MM-dd'),
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([futureTx], [threshHabit]));
    await updateTransactionCategory('tx-future', 'Groceries', ['h1']);

    expect(capturedUpdates.find(u => u.ref.__path === habitPath('h1'))).toBeUndefined();
  });

  it('lazy-resets a STALE habit on a SAME-DAY fire: counter written absolutely (0 + delta)', async () => {
    // A period-rolled-over habit whose leftover counter is 5 from a prior day.
    // A same-day fire must start from 0 (parity with the to-do / manual paths)
    // and write `count` ABSOLUTELY so the reset discards the stale stored value
    // instead of increment()-ing on top of it. Only a CURRENT-period fire can
    // reach this path — a back-dated one never touches the live counter.
    const staleHabit: Habit = {
      ...threshHabit,
      count: 5,
      totalCount: 4,
      completedDates: ['2020-01-01'],
      lastUpdated: '2020-01-01T00:00:00.000Z',
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([todayTx], [staleHabit]));
    await updateTransactionCategory('tx-today', 'Groceries', ['h1']);

    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    const data = habitUpdate!.data!;
    // Absolute reset to 1 (0 + one fire), NOT increment (which would land on 6).
    expect(data['count']).toBe(1);
    // Lifetime counter is never reset — still a plain +1 increment.
    expect(data['totalCount']).toEqual({ __increment: 1 });
    expect(data['completedDates']).toEqual({ __arrayUnion: [today] });
    // A same-day fire DOES credit today's daily bucket.
    const householdUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    expect(householdUpdate!.data!['points.daily']).toEqual({ __increment: 10 });
  });

  it('un-freezes and refunds a token when the fire completes an auto-frozen day', async () => {
    // The midnight pass burned a token to protect backDate as a "miss"; the
    // transaction proves the habit was actually completed that day.
    const frozenHabit: Habit = {
      ...threshHabit,
      frozenDates: [backDate],
      completedDates: [format(subDays(parseISO(backDate), 1), 'yyyy-MM-dd')],
    };
    const bank: FreezeBank = {
      tokens: 1,
      maxTokens: 2,
      lastRolloverDate: today,
      lastRolloverMonth: today.slice(0, 7),
      history: [],
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory({
      ...catDeps([pendingTx], [frozenHabit]),
      freezeBank: bank,
    });
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    // The date moves OUT of frozenDates and INTO completedDates — the schema's
    // invariant is that a frozen date never appears in completedDates.
    expect(habitUpdate!.data!['frozenDates']).toEqual({ __arrayRemove: [backDate] });
    expect(habitUpdate!.data!['completedDates']).toEqual({ __arrayUnion: [backDate] });
    // And the token spent protecting a miss that didn't happen comes back.
    const householdUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    const nextBank = householdUpdate!.data!['freezeBank'] as FreezeBank;
    expect(nextBank.tokens).toBe(2);
    expect(nextBank.history).toHaveLength(1);
    expect(nextBank.history[0]).toMatchObject({ type: 'earned', amount: 1, habitDate: backDate });
  });

  it('caps a freeze refund at the bank maximum', async () => {
    const frozenHabit: Habit = { ...threshHabit, frozenDates: [backDate], completedDates: [] };
    const fullBank: FreezeBank = {
      tokens: 2,
      maxTokens: 2,
      lastRolloverDate: today,
      lastRolloverMonth: today.slice(0, 7),
      history: [],
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory({
      ...catDeps([pendingTx], [frozenHabit]),
      freezeBank: fullBank,
    });
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const householdUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    expect((householdUpdate!.data!['freezeBank'] as FreezeBank).tokens).toBe(2);
  });

  it('commits the habit, submission, points and freeze refund in ONE batch', async () => {
    const frozenHabit: Habit = { ...threshHabit, frozenDates: [backDate], completedDates: [] };
    const bank: FreezeBank = {
      tokens: 0,
      maxTokens: 2,
      lastRolloverDate: today,
      lastRolloverMonth: today.slice(0, 7),
      history: [],
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory({
      ...catDeps([pendingTx], [frozenHabit]),
      freezeBank: bank,
    });
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    // The atomicity invariant: everything lands together or not at all.
    expect(commitCount).toBe(1);
    // And the household doc is written exactly ONCE — a batch may not write the
    // same document twice, so points and the freeze refund must be merged.
    const householdWrites = capturedUpdates.filter(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    expect(householdWrites).toHaveLength(1);
  });

  it('never fires an ARCHIVED habit referenced by a transaction (skips, completes normally)', async () => {
    const archivedHabit: Habit = {
      ...threshHabit,
      archivedAt: '2026-07-21T00:00:00.000Z',
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(catDeps([pendingTx], [archivedHabit]));
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    // No habit write at all — the archived habit is skipped.
    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    expect(habitUpdate).toBeUndefined();
    // And it is not recorded on the fired ledger.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-9'));
    expect(txUpdate!.data!['firedHabitIds']).toBeUndefined();
  });

  it('reverseTransactionApproval falls back to a same-day un-fire when NO submission exists', async () => {
    // Backward compatibility: a fire made before back-dating shipped left no
    // submission behind, and those fires all landed on the day of approval — so
    // the legacy same-day decrement is exactly right for them.
    const verifiedTx: Transaction = {
      ...pendingTx,
      status: 'verified',
      category: 'Groceries',
      relatedHabitIds: ['h1'],
      firedHabitIds: ['h1'],
    };
    // The habit as it now stands (today counted once).
    const firedHabit: Habit = {
      ...threshHabit,
      count: 1,
      totalCount: 5,
      completedDates: [today, '2020-01-01'],
      streakDays: 1,
    };
    const { reverseTransactionApproval } = makeReverseTransactionApproval({
      db,
      householdId: HOUSEHOLD_ID,
      habits: [firedHabit],
      transactions: [verifiedTx],
      accounts,
      calendarItems: [],
    });
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    expect(habitUpdate).toBeDefined();
    const data = habitUpdate!.data!;
    expect(data['count']).toEqual({ __increment: -1 });
    expect(data['totalCount']).toEqual({ __increment: -1 });
    // Today removed via arrayRemove delta — never a whole array.
    expect(data['completedDates']).toEqual({ __arrayRemove: [today] });
    expect(Array.isArray(data['completedDates'])).toBe(false);
    // Points reversed.
    const pointsUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    expect(pointsUpdate!.data!['points.total']).toEqual({ __increment: -10 });
    // Fired ledger cleared so the row can be re-approved cleanly.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txnPath('tx-9'));
    expect(txUpdate!.data!['firedHabitIds']).toEqual({ __deleteField: true });
  });

  // --- Undo of a BACK-DATED fire, reversed from its submission -------------

  const verifiedBackdatedTx: Transaction = {
    ...pendingTx,
    status: 'verified',
    category: 'Groceries',
    relatedHabitIds: ['h1'],
    firedHabitIds: ['h1'],
  };

  /** The submission a back-dated fire would have written for `tx-9`. */
  const firedSubmission = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    habitId: 'h1',
    habitTitle: 'Groceries under budget',
    timestamp: `${backDate}T12:00:00.000Z`,
    date: backDate,
    count: 1,
    pointsEarned: 15,
    streakDaysAtTime: 3,
    multiplierApplied: 1.5,
    createdBy: 'user-1',
    createdAt: `${backDate}T12:00:00.000Z`,
    sourceTransactionId: 'tx-9',
    ...overrides,
  });

  const reverseDeps = (habits: Habit[], transactions: Transaction[], calendarItems: CalendarItem[] = []) => ({
    db,
    householdId: HOUSEHOLD_ID,
    habits,
    transactions,
    accounts,
    calendarItems,
  });

  it('reverses the EXACT points the submission credited, not a recomputation', async () => {
    // The submission recorded 15 (a 1.5x day). Recomputing today could easily
    // land on 10 — the stored value is the only reliable source.
    submissionDocs[submissionsPath('h1')] = [firedSubmission()];
    const firedHabit: Habit = {
      ...threshHabit,
      count: 0,
      totalCount: 5,
      completedDates: [backDate],
    };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [verifiedBackdatedTx])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    const householdUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    expect(householdUpdate!.data!['points.total']).toEqual({ __increment: -15 });
    // A past-dated reversal must not drain TODAY's daily bucket.
    expect(householdUpdate!.data!['points.daily']).toBeUndefined();
  });

  it('removes the BACK-DATED completion, not today’s, and leaves the live counter alone', async () => {
    submissionDocs[submissionsPath('h1')] = [firedSubmission()];
    // The habit has since been completed today by hand — that must survive.
    const firedHabit: Habit = {
      ...threshHabit,
      count: 1,
      totalCount: 6,
      completedDates: [today, backDate],
    };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [verifiedBackdatedTx])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    const data = capturedUpdates.find(u => u.ref.__path === habitPath('h1'))!.data!;
    expect(data['completedDates']).toEqual({ __arrayRemove: [backDate] });
    // The live counter belongs to today's period, which this reversal isn't
    // undoing — touching it would corrupt today's count.
    expect(data['count']).toBeUndefined();
    expect(data['totalCount']).toEqual({ __increment: -1 });
  });

  it('deletes the submission so a re-approve can fire cleanly', async () => {
    submissionDocs[submissionsPath('h1')] = [firedSubmission()];
    const firedHabit: Habit = { ...threshHabit, completedDates: [backDate], totalCount: 5 };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [verifiedBackdatedTx])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    expect(capturedDeletes.some(d => d.ref.__path === `${submissionsPath('h1')}/sub-1`)).toBe(true);
  });

  it('KEEPS the date completed when another submission still justifies it', async () => {
    // A hand-logged submission on the same date (no sourceTransactionId) must not
    // be erased by undoing the transaction's own fire.
    submissionDocs[submissionsPath('h1')] = [
      firedSubmission(),
      { ...firedSubmission({ pointsEarned: 10 }), id: 'sub-manual', sourceTransactionId: undefined },
    ];
    const firedHabit: Habit = { ...threshHabit, completedDates: [backDate], totalCount: 6 };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [verifiedBackdatedTx])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    const data = capturedUpdates.find(u => u.ref.__path === habitPath('h1'))!.data!;
    // Date stays — the manual log still stands on its own.
    expect(data['completedDates']).toBeUndefined();
    // Only the transaction's own submission is deleted and refunded.
    expect(capturedDeletes.some(d => d.ref.__path === `${submissionsPath('h1')}/sub-manual`)).toBe(false);
    const householdUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}`);
    expect(householdUpdate!.data!['points.total']).toEqual({ __increment: -15 });
  });

  it('ignores a submission belonging to a DIFFERENT transaction', async () => {
    submissionDocs[submissionsPath('h1')] = [
      { ...firedSubmission(), id: 'sub-other', sourceTransactionId: 'tx-somebody-else' },
    ];
    const firedHabit: Habit = { ...threshHabit, count: 1, completedDates: [today], totalCount: 5 };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [verifiedBackdatedTx])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    // No submission matched tx-9, so it takes the legacy same-day path and never
    // consumes another transaction's record.
    expect(capturedDeletes.some(d => d.ref.__path.includes('sub-other'))).toBe(false);
  });

  it('reverses in ONE batch', async () => {
    submissionDocs[submissionsPath('h1')] = [firedSubmission()];
    const firedHabit: Habit = { ...threshHabit, completedDates: [backDate], totalCount: 5 };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [verifiedBackdatedTx])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    expect(commitCount).toBe(1);
  });

  it('REFUSES to reverse a transaction that settled a STILL-PAID bill (TODO.md 2H(a) guard)', async () => {
    // This undo knows nothing about bills: reversing would send the row back to
    // pending_review and credit the balance back while leaving the bill marked
    // paid and its paid-instance doc orphaned. Full unlink is out of scope, so
    // it must refuse rather than silently orphan.
    submissionDocs[submissionsPath('h1')] = [firedSubmission()];
    const firedHabit: Habit = { ...threshHabit, completedDates: [backDate], totalCount: 5 };
    const settledTx: Transaction = { ...verifiedBackdatedTx, paidCalendarItemId: 'paid-instance-1' };
    const paidInstance: CalendarItem = {
      id: 'paid-instance-1',
      title: 'Comcast Internet',
      amount: 153.95,
      date: '2026-07-18',
      type: 'expense',
      isPaid: true,
    };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [settledTx], [paidInstance])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    // Nothing written at all — not the transaction, not the habit, not points.
    expect(commitCount).toBe(0);
    expect(capturedUpdates).toHaveLength(0);
    expect(capturedDeletes).toHaveLength(0);
  });

  it('ALLOWS the reverse once the settled bill is gone — a dangling link has nothing left to orphan', async () => {
    submissionDocs[submissionsPath('h1')] = [firedSubmission()];
    const firedHabit: Habit = { ...threshHabit, completedDates: [backDate], totalCount: 5 };
    const settledTx: Transaction = { ...verifiedBackdatedTx, paidCalendarItemId: 'paid-instance-1' };
    const { reverseTransactionApproval } = makeReverseTransactionApproval(
      reverseDeps([firedHabit], [settledTx], [])
    );
    await reverseTransactionApproval('tx-9', { category: 'Uncategorized' }, ['h1']);

    expect(commitCount).toBe(1);
  });
});

describe('makeUpdateTransaction — bank-sync rows never delta a balance', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
    vi.clearAllMocks();
  });

  const baseVerified: Transaction = {
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
    accountId: 'acc-check',
  };

  const updateDeps = (transactions: Transaction[], calendarItems: CalendarItem[] = []) => ({
    db,
    householdId: HOUSEHOLD_ID,
    transactions,
    householdSettings: null,
    accounts,
    calendarItems,
  });

  it('control: an amount edit on a verified MANUAL row deltas the account by (old − new) impact', async () => {
    const { updateTransaction } = makeUpdateTransaction(updateDeps([baseVerified]));
    await updateTransaction('tx-1', { amount: 50 });

    // Reverse +42.5, apply −50 → net −7.5 on checking.
    const balanceUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-check'));
    expect(balanceUpdate?.data?.['balance']).toEqual({ __increment: -7.5 });
  });

  it('an amount edit on a bank-sync row (source arm) applies NO balance delta', async () => {
    const bankRow: Transaction = { ...baseVerified, source: 'bank-sync', bankRef: 'P0000123' };
    const { updateTransaction } = makeUpdateTransaction(updateDeps([bankRow]));
    await updateTransaction('tx-1', { amount: 50 });

    // The doc amount updates, but no account is touched — the account balance
    // was set from the bank email's ending balance, not from this row.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`);
    expect(txUpdate?.data).toMatchObject({ amount: 50 });
    const balanceUpdates = capturedUpdates.filter(u => u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`));
    expect(balanceUpdates).toHaveLength(0);
  });

  it('an amount edit on a bankRef-stamped row applies NO balance delta even when source is not bank-sync', async () => {
    // Guards against narrowing isBankSyncTransaction's OR to an AND: a row the
    // sync FILLED (not created) carries only bankRef, not source: 'bank-sync'.
    const filledRow: Transaction = { ...baseVerified, source: 'shortcut', bankRef: 'synth:abc' };
    const { updateTransaction } = makeUpdateTransaction(updateDeps([filledRow]));
    await updateTransaction('tx-1', { amount: 50 });

    const balanceUpdates = capturedUpdates.filter(u => u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`));
    expect(balanceUpdates).toHaveLength(0);
  });

  // HIGH finding fix: re-tagging a bank-sync row must NOT silently drop its
  // impact everywhere. Only the OLD (authoritative) account is exempt from
  // the delta; the NEW (manual) destination account must be debited/credited
  // normally, or the move is a permanent under-count on the destination.
  it('re-tagging a bank-sync row to a manual account debits the destination and stamps bankSyncAccountId, leaving the source untouched', async () => {
    const bankRow: Transaction = { ...baseVerified, source: 'bank-sync', bankRef: 'P0000123', accountId: 'acc-check' };
    const { updateTransaction } = makeUpdateTransaction(updateDeps([bankRow]));
    await updateTransaction('tx-1', { accountId: 'acc-save' });

    // Old (checking) account: no reversal — it's still the bank-sync home.
    expect(capturedUpdates.some(u => u.ref.__path === accountPath('acc-check'))).toBe(false);
    // New (savings) account: debited by the row's full effective impact
    // (expense → −amount), exactly like an ordinary re-tag.
    const savingsUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-save'));
    expect(savingsUpdate?.data?.['balance']).toEqual({ __increment: -42.5 });
    // The doc is stamped with its authoritative home so a later re-tag can
    // still tell checking apart from an ordinary manual account.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`);
    expect(txUpdate?.data).toMatchObject({ bankSyncAccountId: 'acc-check' });
  });

  it('re-tagging a bank-sync row back to its stamped home reverses the manual account and applies NO delta to the home', async () => {
    // Simulates the round trip: already re-tagged to Savings once (so
    // bankSyncAccountId was stamped to checking on that earlier edit).
    const retaggedRow: Transaction = {
      ...baseVerified,
      source: 'bank-sync',
      bankRef: 'P0000123',
      accountId: 'acc-save',
      bankSyncAccountId: 'acc-check',
    };
    const { updateTransaction } = makeUpdateTransaction(updateDeps([retaggedRow]));
    await updateTransaction('tx-1', { accountId: 'acc-check' });

    // Savings (current tag, NOT the stamped home) must be reversed — it was
    // ordinary bookkeeping that would otherwise stay overstated forever.
    const savingsUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-save'));
    expect(savingsUpdate?.data?.['balance']).toEqual({ __increment: 42.5 });
    // Checking (the stamped home) receives NO delta — its balance is still
    // authoritative from the bank email.
    expect(capturedUpdates.some(u => u.ref.__path === accountPath('acc-check'))).toBe(false);
    // Already stamped — the write must not re-stamp it.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`);
    expect(txUpdate?.data).not.toHaveProperty('bankSyncAccountId');
  });

  it('a pure amount edit on an unmoved bank-sync row applies no deltas and does not re-stamp an already-known home', async () => {
    const bankRow: Transaction = {
      ...baseVerified,
      source: 'bank-sync',
      bankRef: 'P0000123',
      accountId: 'acc-check',
      bankSyncAccountId: 'acc-check',
    };
    const { updateTransaction } = makeUpdateTransaction(updateDeps([bankRow]));
    await updateTransaction('tx-1', { amount: 50 });

    const balanceUpdates = capturedUpdates.filter(u => u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`));
    expect(balanceUpdates).toHaveLength(0);
    const txUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`);
    expect(txUpdate?.data).not.toHaveProperty('bankSyncAccountId');
  });
});

// ---------------------------------------------------------------------------
// SETTLED-BILL GUARD (utils/settledBillGuard.ts). A row carrying
// `paidCalendarItemId` is one half of a pair: the transaction, and the calendar
// doc it marked PAID. Every mutation that would delete, replace or re-price the
// row from the transaction side must REFUSE while that bill is still paid —
// otherwise the calendar doc is orphaned, `expandCalendarItems` keeps
// suppressing the occurrence, and Safe-to-Spend overstates cash by the bill's
// amount every period, forever.
// ---------------------------------------------------------------------------
describe('settled-bill guard across every mutation that could orphan the bill', () => {
  const paidBill: CalendarItem = {
    id: 'bill-1',
    title: 'Comcast Internet',
    amount: 153.95,
    date: '2026-07-18',
    type: 'expense',
    isPaid: true,
  };

  const settledTx: Transaction = {
    id: 'tx-1',
    amount: 153.95,
    merchant: 'COMCAST-XFINITY',
    category: 'Budgeted in Calendar',
    date: '2026-07-20',
    status: 'verified',
    isRecurring: false,
    source: 'image-capture',
    autoCategorized: false,
    createdBy: 'user-1',
    createdAt: '2026-07-20T00:00:00.000Z',
    payPeriodId: 'pp-1',
    accountId: 'acc-check',
    paidCalendarItemId: 'bill-1',
  };

  const plainDupe: Transaction = { ...settledTx, id: 'tx-2', paidCalendarItemId: undefined };

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
    vi.clearAllMocks();
  });

  const deleteGuardDeps = (calendarItems: CalendarItem[]) => ({
    db,
    householdId: HOUSEHOLD_ID,
    transactions: [settledTx],
    accounts,
    user: { uid: 'user-1' },
    calendarItems,
  });

  it('deleteTransaction refuses — no balance credit, no delete, no trash mirror', async () => {
    const { deleteTransaction } = makeDeleteTransaction(deleteGuardDeps([paidBill]));
    await deleteTransaction('tx-1');

    expect(commitCount).toBe(0);
    expect(capturedDeletes).toHaveLength(0);
    expect(capturedSets).toHaveLength(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  it('deleteTransaction ALLOWS the delete once the bill it settled is gone (no dead end)', async () => {
    const { deleteTransaction } = makeDeleteTransaction(deleteGuardDeps([]));
    await deleteTransaction('tx-1');

    expect(commitCount).toBe(1);
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`)).toBe(true);
  });

  it('mergeTransactions refuses when the DUPE (the row it deletes) settled a bill', async () => {
    const { mergeTransactions } = makeMergeTransactions({
      db,
      householdId: HOUSEHOLD_ID,
      transactions: [plainDupe, settledTx],
      accounts,
      user: { uid: 'user-1' },
      calendarItems: [paidBill],
    });
    const merged = await mergeTransactions('tx-2', 'tx-1');

    // FALSE, not void: the review UI must not advance on a refusal.
    expect(merged).toBe(false);
    expect(commitCount).toBe(0);
    expect(capturedDeletes).toHaveLength(0);
  });

  it('mergeTransactions still runs when only the KEEPER settled a bill — the keeper survives untouched', async () => {
    const { mergeTransactions } = makeMergeTransactions({
      db,
      householdId: HOUSEHOLD_ID,
      transactions: [settledTx, plainDupe],
      accounts,
      user: { uid: 'user-1' },
      calendarItems: [paidBill],
    });
    expect(await mergeTransactions('tx-1', 'tx-2')).toBe(true);

    expect(commitCount).toBe(1);
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-2`)).toBe(true);
  });

  it('splitTransaction refuses — the split DELETES the original, orphaning the bill', async () => {
    const { splitTransaction } = makeSplitTransaction({
      db,
      householdId: HOUSEHOLD_ID,
      user: { uid: 'user-1' },
      transactions: [settledTx],
      householdSettings: null,
      accounts,
      calendarItems: [paidBill],
    });
    await splitTransaction('tx-1', [
      { amount: 100, merchant: 'A', category: 'Groceries', date: '2026-07-20', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
      { amount: 53.95, merchant: 'B', category: 'Groceries', date: '2026-07-20', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
    ]);

    expect(commitCount).toBe(0);
    expect(capturedDeletes).toHaveLength(0);
  });

  it('updateTransaction refuses a MONEY edit but allows a metadata-only one', async () => {
    const deps = {
      db,
      householdId: HOUSEHOLD_ID,
      transactions: [settledTx],
      householdSettings: null,
      accounts,
      calendarItems: [paidBill],
    };

    await makeUpdateTransaction(deps).updateTransaction('tx-1', { amount: 12 });
    expect(commitCount).toBe(0);

    await makeUpdateTransaction(deps).updateTransaction('tx-1', { status: 'pending_review' });
    expect(commitCount).toBe(0);

    // Notes carry no money and can't diverge the pair — still editable.
    await makeUpdateTransaction(deps).updateTransaction('tx-1', { notes: 'July bill' });
    expect(commitCount).toBe(1);
    const txUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`);
    expect(txUpdate?.data?.['notes']).toBe('July bill');
  });

  it('reverseTransactionApproval refuses — the undo would credit the balance back with the bill still paid', async () => {
    const { reverseTransactionApproval } = makeReverseTransactionApproval({
      db,
      householdId: HOUSEHOLD_ID,
      habits: [],
      transactions: [settledTx],
      accounts,
      calendarItems: [paidBill],
    });
    await reverseTransactionApproval('tx-1', { category: 'Uncategorized' }, []);

    expect(commitCount).toBe(0);
    expect(capturedUpdates).toHaveLength(0);
  });
});

// The settled-bill DUPLICATE arm (utils/settledBillDuplicate.ts): the user
// confirms the nightly sync's row is the bank's own copy of a bill they already
// paid by hand, so the merge also LEARNS the bank's descriptor onto the bill.
describe('makeMergeTransactions — learning a bank descriptor in the merge batch', () => {
  const calPath = `households/${HOUSEHOLD_ID}/calendarItems`;

  const template: CalendarItem = {
    id: 'cal-tmpl',
    title: 'Centerpoint Energy (Natural Gas)',
    amount: 142,
    date: '2026-07-05',
    type: 'expense',
    isPaid: false,
    isRecurring: true,
    frequency: 'monthly',
  };

  const paidInstance: CalendarItem = {
    id: 'cal-paid',
    title: 'Centerpoint Energy (Natural Gas)',
    amount: 142,
    date: '2026-07-05',
    type: 'expense',
    isPaid: true,
    isRecurring: false,
    parentRecurringId: 'cal-tmpl',
  };

  // The hand-paid row (the KEEPER on this arm — never chosen by pickKeeper).
  const settledRow: Transaction = {
    id: 'tx-manual',
    amount: 142,
    merchant: 'Centerpoint Energy (Natural Gas)',
    category: 'Budgeted in Calendar',
    date: '2026-07-05',
    status: 'verified',
    isRecurring: true,
    source: 'recurring',
    autoCategorized: true,
    accountId: 'acc-check',
    paidCalendarItemId: 'cal-paid',
    createdAt: '2026-07-05T12:00:00.000Z',
  };

  // The bank-sync copy (the DUPE — deleted by the merge).
  const bankRow: Transaction = {
    id: 'tx-bank',
    amount: 142,
    merchant: 'CPENERGY MNGCO 260805',
    category: 'Uncategorized',
    date: '2026-07-09',
    status: 'verified',
    isRecurring: false,
    source: 'bank-sync',
    autoCategorized: false,
    accountId: 'acc-check',
    needsCategory: true,
    bankRef: 'synth:cpenergy',
    createdAt: '2026-07-04T12:00:00.000Z',
  };

  const deps = () => ({
    db,
    householdId: HOUSEHOLD_ID,
    transactions: [settledRow, bankRow],
    accounts,
    user: { uid: 'user-1' },
    calendarItems: [template, paidInstance],
  });

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
    vi.clearAllMocks();
  });

  it('stages the alias arrayUnion onto the recurring TEMPLATE in the same batch as the merge', async () => {
    const { mergeTransactions } = makeMergeTransactions(deps());
    await mergeTransactions('tx-manual', 'tx-bank', {
      calendarItemId: 'cal-tmpl',
      descriptor: 'CPENERGY MNGCO 260805',
    });

    // ONE batch: the keeper update, the alias write and the dupe delete.
    expect(commitCount).toBe(1);
    const aliasWrite = capturedUpdates.find(u => u.ref.__path === `${calPath}/cal-tmpl`);
    expect(aliasWrite?.data?.['bankDescriptorAliases']).toEqual({
      __arrayUnion: ['CPENERGY MNGCO 260805'],
    });
    // NEVER the one-shot paid-instance doc — an alias there teaches nothing
    // about next month's occurrence.
    expect(capturedUpdates.some(u => u.ref.__path === `${calPath}/cal-paid`)).toBe(false);
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-bank`)).toBe(true);
  });

  it('writes no calendar update at all when no learnAlias is passed', async () => {
    const { mergeTransactions } = makeMergeTransactions(deps());
    expect(await mergeTransactions('tx-manual', 'tx-bank')).toBe(true);

    expect(commitCount).toBe(1);
    expect(capturedUpdates.some(u => u.ref.__path.startsWith(calPath))).toBe(false);
    // The only update is the keeper's `possibleDuplicateOf` clear.
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path).toBe(`households/${HOUSEHOLD_ID}/transactions/tx-manual`);
    expect(capturedUpdates[0]!.data?.['possibleDuplicateOf']).toEqual({ __deleteField: true });
  });

  // A merge DELETES the dupe, so it owes the same recoverability as
  // `deleteTransaction` — a mis-merge on a hunch is the one delete in this app
  // the UI actively invites, and it was the only unrecoverable one.
  it('mirrors the merged-away dupe into trash, in the SAME batch', async () => {
    const { mergeTransactions } = makeMergeTransactions(deps());
    await mergeTransactions('tx-manual', 'tx-bank');

    expect(commitCount).toBe(1);
    expect(capturedSets).toHaveLength(1);
    const mirror = capturedSets[0]!;
    expect(mirror.ref.__path).toBe(`households/${HOUSEHOLD_ID}/trash/transaction_tx-bank`);
    expect(mirror.data).toMatchObject({ domain: 'transaction', originalId: 'tx-bank', deletedBy: 'user-1' });
    const mirrored = mirror.data!['data'] as Record<string, unknown>;
    expect(mirrored).toMatchObject({ amount: 142, merchant: 'CPENERGY MNGCO 260805', bankRef: 'synth:cpenergy' });
    expect(mirrored).not.toHaveProperty('id');
  });

  it('falls back to a merge WITHOUT the mirror when the trash write is permission-denied', async () => {
    // Same graceful degradation as deleteTransaction: losing Recently Deleted
    // must never cost the user the merge itself.
    commitErrors = [{ code: 'permission-denied' }];
    const { mergeTransactions } = makeMergeTransactions(deps());
    expect(await mergeTransactions('tx-manual', 'tx-bank')).toBe(true);

    expect(commitCount).toBe(1);
    expect(capturedSets.filter(s => s.ref.__path.includes('/trash/'))).toHaveLength(1);
    expect(capturedDeletes.filter(d => d.ref.__path.endsWith('/transactions/tx-bank'))).toHaveLength(2);
  });

  it('ignores an empty descriptor rather than learning a blank alias', async () => {
    const { mergeTransactions } = makeMergeTransactions(deps());
    await mergeTransactions('tx-manual', 'tx-bank', { calendarItemId: 'cal-tmpl', descriptor: '   ' });

    expect(commitCount).toBe(1);
    expect(capturedUpdates.some(u => u.ref.__path.startsWith(calPath))).toBe(false);
  });

  it('applies NO balance delta for the bank-sync dupe — the bank already stated the balance', async () => {
    const { mergeTransactions } = makeMergeTransactions(deps());
    await mergeTransactions('tx-manual', 'tx-bank', {
      calendarItemId: 'cal-tmpl',
      descriptor: 'CPENERGY MNGCO 260805',
    });

    expect(capturedUpdates.some(u => u.ref.__path === accountPath('acc-check'))).toBe(false);
  });

  it('DOES reverse the dupe balance for a non-bank-sync verified dupe (the skip is bank-sync-only)', async () => {
    const manualDupe: Transaction = {
      ...bankRow, id: 'tx-manual-dupe', source: 'manual', bankRef: undefined, needsCategory: undefined,
    };
    const { mergeTransactions } = makeMergeTransactions({
      ...deps(),
      transactions: [settledRow, manualDupe],
    });
    await mergeTransactions('tx-manual', 'tx-manual-dupe');

    const balanceWrite = capturedUpdates.find(u => u.ref.__path === accountPath('acc-check'));
    // A verified expense debited 142; deleting it credits 142 back.
    expect(balanceWrite?.data?.['balance']).toEqual({ __increment: 142 });
  });
});

describe('makeKeepBothTransactions — the dismissal is scoped to the arm that asked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears ONLY the stored flag for the ordinary duplicate arm', async () => {
    // Writing a settled-bill dismissal here suppressed a question the user was
    // never asked, on that row, forever — and nothing ever cleared it.
    const { keepBothTransactions } = makeKeepBothTransactions({ db, householdId: HOUSEHOLD_ID });
    await keepBothTransactions('tx-bank');

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = vi.mocked(updateDoc).mock.calls[0]!;
    expect((ref as unknown as { __path: string }).__path).toBe(`households/${HOUSEHOLD_ID}/transactions/tx-bank`);
    expect(data).toEqual({ possibleDuplicateOf: { __deleteField: true } });
  });

  it('persists the COUNTERPART id when the settled-bill arm dismisses', async () => {
    const { keepBothTransactions } = makeKeepBothTransactions({ db, householdId: HOUSEHOLD_ID });
    await keepBothTransactions('tx-bank', 'tx-manual');

    const [, data] = vi.mocked(updateDoc).mock.calls[0]!;
    // Scoped, not a bare boolean: a different bill payment next month is a
    // different question, and deserves to be asked.
    expect(data).toEqual({
      possibleDuplicateOf: { __deleteField: true },
      duplicateDismissedFor: 'tx-manual',
    });
  });
});
