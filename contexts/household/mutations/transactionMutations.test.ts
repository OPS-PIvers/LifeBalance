import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Firestore mock --------------------------------------------------------
// Mirrors commentMutations.test.ts's mock shape: captures every batch
// set/update call so tests can assert the atomic transaction+balances batch.

interface CapturedWrite {
  ref: { __path: string };
  data?: Record<string, unknown>;
}

/**
 * Snapshot a write payload the way real Firestore does: `WriteBatch.set/update`
 * SERIALIZE their argument at call time, so anything the caller assigns to that
 * object afterwards never reaches the server. Storing the live reference instead
 * made post-`set` mutations visible to assertions, which is exactly how a
 * `docData.fundingAccountId = …` written after `batch.set` passed its test while
 * never persisting in production. Deep-cloned so a nested mutation is caught too;
 * the sentinels the mock emits (`{ __increment }`, `{ __serverTimestamp }`, …)
 * are plain data and survive the clone, keeping `toEqual` assertions valid.
 */
function snapshotPayload(data: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(data);
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
    // `id` is exposed alongside `__path` because makeAddTransaction pre-allocates
    // the new transaction's ref and stamps `txRef.id` onto every habit
    // submission it fires (sourceTransactionId) — a real DocumentReference
    // always carries one.
    doc: vi.fn((first: unknown, path?: string, id?: string) => {
      const firstRef = first as { __path?: string } | undefined;
      if (firstRef?.__path !== undefined && path === undefined) {
        return { __path: `${firstRef.__path}/__autoId`, id: '__autoId' };
      }
      return id
        ? { __path: `${path}/${id}`, id }
        : { __path: path ?? '__autoId', id: (path ?? '__autoId').split('/').pop() };
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
        capturedSets.push({ ref, data: snapshotPayload(data) });
      },
      update: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedUpdates.push({ ref, data: snapshotPayload(data) });
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
import type { Account, CalendarItem, FreezeBank, Habit, Household, Transaction } from '@/types/schema';

const HOUSEHOLD_ID = 'house1';
const db = {} as never;

// ATTR-1: the household roster every maker is handed. A card owner must be on
// it to be credited (`currentMemberPredicate` fails CLOSED), so every existing
// test below stays UNATTRIBUTED simply by tagging no card owner.
const MEMBERS = [{ uid: 'user-1' }, { uid: 'user-2' }];

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
    // Habit-firing deps (see the manual-entry describe below). Empty here so
    // these balance/funding cases exercise the no-habit path unchanged.
    habits: [] as Habit[],
    members: MEMBERS,
    freezeBank: null as FreezeBank | null,
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

  // REGRESSION (write ordering): `fundingAccountId` must land on the doc payload
  // BEFORE `batch.set` runs. Firestore serializes a set payload at call time, so
  // an assignment made afterwards never reaches the server — and the symptom is
  // invisible from behavior, because the balance transfer reads the local id
  // rather than the stored doc. `capturedSets` holds a snapshot taken inside the
  // `set` mock, so this can only pass if the field was already on the object.
  it('persists fundingAccountId in the payload AS CAPTURED AT set() time', async () => {
    const { addTransaction } = makeAddTransaction(makeDeps());
    await addTransaction({ ...basePayment, fundingAccountId: '  acc-check  ' });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!.data?.['fundingAccountId']).toBe('acc-check');
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

// THE MANUAL-ENTRY BUG: the capture modal stamps a hand-entered transaction
// `verified`, so it never enters the Action Queue and never reaches
// updateTransactionCategory — the only place that used to fire habits from a
// transaction. Attaching a habit at entry saved the association and fired
// nothing at all; the user had to increment the habit by hand.
describe('makeAddTransaction — fires the habits attached at manual entry', () => {
  const habitPath = (id: string) => `households/${HOUSEHOLD_ID}/habits/${id}`;
  const submissionsPath = (id: string) => `${habitPath(id)}/submissions`;
  const householdPath = `households/${HOUSEHOLD_ID}`;
  const today = getLocalDateString();

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
    // Non-stale so the fire takes the ordinary increment() path.
    lastUpdated: new Date().toISOString(),
  };

  // Exactly what CaptureTransactionManual builds: verified, dated today,
  // carrying the habit ids the user ticked.
  const manualTx: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'> = {
    amount: 30,
    merchant: 'Target',
    category: 'Groceries',
    date: today,
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    accountId: 'acc-check',
    relatedHabitIds: ['h1'],
  };

  const addDeps = (habits: Habit[], freezeBank: FreezeBank | null = null) => ({
    ...makeDeps(),
    habits,
    freezeBank,
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

  it('fires the habit, writes a submission and increments household points — all in ONE batch', async () => {
    const { addTransaction } = makeAddTransaction(addDeps([threshHabit]));
    await addTransaction(manualTx);

    // Atomicity: transaction + balance + habit + submission + points together.
    expect(commitCount).toBe(1);

    // Habit doc: DELTA writes only (2026-07-15 clobber incident).
    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    expect(habitUpdate).toBeDefined();
    const data = habitUpdate!.data!;
    expect(data['count']).toEqual({ __increment: 1 });
    expect(data['totalCount']).toEqual({ __increment: 1 });
    expect(data['completedDates']).toEqual({ __arrayUnion: [today] });
    expect(Array.isArray(data['completedDates'])).toBe(false);
    expect(data['hasSubmissionTracking']).toBe(true);

    // Submission doc, stamped with the NEW transaction's own id.
    const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')));
    expect(submission).toBeDefined();
    expect(submission!.data).toMatchObject({
      habitId: 'h1',
      date: today,
      count: 1,
      pointsEarned: 10,
      sourceTransactionId: '__autoId',
    });

    // Household points: a same-day fire credits all three buckets.
    const householdUpdate = capturedUpdates.find(u => u.ref.__path === householdPath);
    expect(householdUpdate!.data!['points.daily']).toEqual({ __increment: 10 });
    expect(householdUpdate!.data!['points.weekly']).toEqual({ __increment: 10 });
    expect(householdUpdate!.data!['points.total']).toEqual({ __increment: 10 });
    // The household doc is written exactly once (a batch may not write a doc twice).
    expect(capturedUpdates.filter(u => u.ref.__path === householdPath)).toHaveLength(1);
  });

  it('persists firedHabitIds on the new doc as a PLAIN ARRAY (a set has nothing to union against)', async () => {
    const { addTransaction } = makeAddTransaction(addDeps([threshHabit]));
    await addTransaction(manualTx);

    const txSet = capturedSets.find(s => s.ref.__path === `households/${HOUSEHOLD_ID}/transactions/__autoId`);
    expect(txSet!.data!['firedHabitIds']).toEqual(['h1']);
    // Association still recorded too.
    expect(txSet!.data!['relatedHabitIds']).toEqual(['h1']);
  });

  it('back-dates the fire to the TRANSACTION date, never today', async () => {
    const backDate = format(subDays(parseISO(today), 4), 'yyyy-MM-dd');
    const { addTransaction } = makeAddTransaction(addDeps([threshHabit]));
    await addTransaction({ ...manualTx, date: backDate });

    const data = capturedUpdates.find(u => u.ref.__path === habitPath('h1'))!.data!;
    expect(data['completedDates']).toEqual({ __arrayUnion: [backDate] });
    // A past-period fire leaves the live counter alone entirely.
    expect(data['count']).toBeUndefined();
    // ...and must not inflate today's daily bucket.
    const householdUpdate = capturedUpdates.find(u => u.ref.__path === householdPath);
    expect(householdUpdate!.data!['points.total']).toEqual({ __increment: 10 });
    expect(householdUpdate!.data!['points.daily']).toBeUndefined();
  });

  it('never fires an ARCHIVED habit, and keeps it off the fired ledger', async () => {
    const archived: Habit = { ...threshHabit, archivedAt: '2026-07-21T00:00:00.000Z' };
    const { addTransaction } = makeAddTransaction(addDeps([archived]));
    await addTransaction(manualTx);

    expect(capturedUpdates.find(u => u.ref.__path === habitPath('h1'))).toBeUndefined();
    expect(capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))).toBeUndefined();
    expect(capturedUpdates.find(u => u.ref.__path === householdPath)).toBeUndefined();
    const txSet = capturedSets.find(s => s.ref.__path === `households/${HOUSEHOLD_ID}/transactions/__autoId`);
    expect(txSet!.data).not.toHaveProperty('firedHabitIds');
    // The association is still persisted.
    expect(txSet!.data!['relatedHabitIds']).toEqual(['h1']);
  });

  // Regression fence for the no-habit path: it must be byte-identical to the
  // pre-firing behavior — one transaction set, one account delta, and NOTHING
  // written to the household doc (this mutation never touched it before).
  it('writes exactly what it always did when no habits are attached', async () => {
    const { addTransaction } = makeAddTransaction(addDeps([threshHabit]));
    await addTransaction({ ...manualTx, relatedHabitIds: undefined });

    expect(commitCount).toBe(1);
    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!.ref.__path).toBe(`households/${HOUSEHOLD_ID}/transactions/__autoId`);
    expect(capturedSets[0]!.data).not.toHaveProperty('firedHabitIds');
    expect(capturedSets[0]!.data).not.toHaveProperty('relatedHabitIds');
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]!.ref.__path).toBe(accountPath('acc-check'));
    expect(capturedUpdates[0]!.data?.['balance']).toEqual({ __increment: -30 });
  });

  it('an empty relatedHabitIds array is the same no-op', async () => {
    const { addTransaction } = makeAddTransaction(addDeps([threshHabit]));
    await addTransaction({ ...manualTx, relatedHabitIds: [] });

    expect(capturedUpdates.find(u => u.ref.__path === habitPath('h1'))).toBeUndefined();
    expect(capturedUpdates.find(u => u.ref.__path === householdPath)).toBeUndefined();
  });

  // DELIBERATE NARROWING: a pending_review capture (receipt / statement scan)
  // carries AI-SUGGESTED habit ids the review card exists to let the user
  // confirm or untick, and every such row reaches updateTransactionCategory on
  // approval. Firing at import time would pre-empt that review and — because a
  // statement scan writes one row per purchase, each carrying the same
  // suggestions — log a single habit once per row.
  it('does NOT fire for a pending_review capture (its habits are AI suggestions awaiting review)', async () => {
    const { addTransaction } = makeAddTransaction(addDeps([threshHabit]));
    await addTransaction({ ...manualTx, status: 'pending_review' });

    expect(capturedUpdates.find(u => u.ref.__path === habitPath('h1'))).toBeUndefined();
    expect(capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))).toBeUndefined();
    expect(capturedUpdates.find(u => u.ref.__path === householdPath)).toBeUndefined();
    // The association still rides along so the review card can pre-check it.
    const txSet = capturedSets.find(s => s.ref.__path === `households/${HOUSEHOLD_ID}/transactions/__autoId`);
    expect(txSet!.data!['relatedHabitIds']).toEqual(['h1']);
    expect(txSet!.data).not.toHaveProperty('firedHabitIds');
  });

  it('un-freezes and refunds a token in the SAME batch when the fire completes a frozen day', async () => {
    const backDate = format(subDays(parseISO(today), 4), 'yyyy-MM-dd');
    const frozenHabit: Habit = { ...threshHabit, frozenDates: [backDate], completedDates: [] };
    const bank: FreezeBank = {
      tokens: 1,
      maxTokens: 2,
      lastRolloverDate: today,
      lastRolloverMonth: today.slice(0, 7),
      history: [],
    };
    const { addTransaction } = makeAddTransaction(addDeps([frozenHabit], bank));
    await addTransaction({ ...manualTx, date: backDate });

    const habitUpdate = capturedUpdates.find(u => u.ref.__path === habitPath('h1'));
    expect(habitUpdate!.data!['frozenDates']).toEqual({ __arrayRemove: [backDate] });
    // Points and the refund merge into the SINGLE household write.
    const householdWrites = capturedUpdates.filter(u => u.ref.__path === householdPath);
    expect(householdWrites).toHaveLength(1);
    expect((householdWrites[0]!.data!['freezeBank'] as FreezeBank).tokens).toBe(2);
    expect(commitCount).toBe(1);
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
      members: MEMBERS,
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
    members: MEMBERS,
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
      members: MEMBERS,
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
    members: MEMBERS,
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

  // DELETE is the ONE guarded mutation that un-settles instead of refusing (the
  // caller confirms the extra effect first): the row is destroyed, which has
  // exactly one coherent counterpart on the calendar.
  it('deleteTransaction UN-SETTLES a one-off bill and deletes the row in ONE batch', async () => {
    const { deleteTransaction } = makeDeleteTransaction(deleteGuardDeps([paidBill]));
    await deleteTransaction('tx-1');

    expect(commitCount).toBe(1);
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/transactions/tx-1`)).toBe(true);

    // The bill's own doc pre-existed, so it goes back to unpaid in place.
    const billUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/calendarItems/bill-1`);
    expect(billUpdate?.data).toEqual({ isPaid: false });
    // The doc survives — deleting a one-off bill's own record would lose the bill.
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/calendarItems/bill-1`)).toBe(false);

    // Balance still reversed exactly as for an unsettled row.
    const balanceUpdate = capturedUpdates.find(u => u.ref.__path === `households/${HOUSEHOLD_ID}/accounts/acc-check`);
    expect(balanceUpdate?.data?.['balance']).toEqual({ __increment: 153.95 });

    // A restore must not resurrect a link to a bill that is now unpaid.
    const mirror = capturedSets.find(s => s.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/trash/`));
    expect(mirror?.data?.['data']).not.toHaveProperty('paidCalendarItemId');
  });

  it('deleteTransaction DELETES the paid-instance doc a recurring occurrence created', async () => {
    // payCalendarItem pays a recurring occurrence by CREATING this doc; its only
    // job is to suppress the occurrence in expandCalendarItems, so un-settling
    // means removing it — clearing isPaid would leave a phantom bill behind.
    const paidInstance: CalendarItem = {
      ...paidBill,
      id: 'bill-inst',
      isRecurring: false,
      parentRecurringId: 'bill-tmpl',
    };
    const { deleteTransaction } = makeDeleteTransaction({
      ...deleteGuardDeps([paidInstance]),
      transactions: [{ ...settledTx, paidCalendarItemId: 'bill-inst' }],
    });
    await deleteTransaction('tx-1');

    expect(commitCount).toBe(1);
    expect(capturedDeletes.some(d => d.ref.__path === `households/${HOUSEHOLD_ID}/calendarItems/bill-inst`)).toBe(true);
    expect(capturedUpdates.some(u => u.ref.__path === `households/${HOUSEHOLD_ID}/calendarItems/bill-inst`)).toBe(false);
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
      members: MEMBERS,
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

// Stage 6 — `Household.freezeMode: 'per_member'`. Each adult holds their OWN
// token bank (`freezeBanksByMember.<uid>`) and their OWN frozen dates
// (`Habit.frozenDatesBy`, date → uid[]); the shared `freezeBank` /
// `Habit.frozenDates` are not in use. A transaction fire that completes a day
// the ACTING member's token was protecting has to un-freeze that member and
// refund THAT bank — and must leave every other member alone.
describe('transaction habit fires under freezeMode: per_member', () => {
  const ALICE = 'user-1'; // the acting uid both makers run as
  const BOB = 'user-2';
  const habitPath = (id: string) => `households/${HOUSEHOLD_ID}/habits/${id}`;
  const submissionsPath = (id: string) => `${habitPath(id)}/submissions`;
  const householdPath = `households/${HOUSEHOLD_ID}`;
  const today = getLocalDateString();
  const backDate = format(subDays(parseISO(today), 4), 'yyyy-MM-dd');
  const dayBefore = (n: number) => format(subDays(parseISO(today), n), 'yyyy-MM-dd');

  const bank = (tokens: number): FreezeBank => ({
    tokens,
    maxTokens: 2,
    lastRolloverDate: today,
    lastRolloverMonth: today.slice(0, 7),
    history: [],
  });

  /** A Household carrying only what these paths read: the mode + the banks. */
  const household = (
    freezeMode: Household['freezeMode'],
    freezeBanksByMember?: Record<string, FreezeBank>,
  ): Household => ({
    id: HOUSEHOLD_ID,
    name: 'Test household',
    inviteCode: 'ABC123',
    members: [],
    freezeBank: bank(0),
    accounts: [],
    rewardsInventory: [],
    coreTemplates: { expenses: [], buckets: [] },
    ...(freezeMode ? { freezeMode } : {}),
    ...(freezeBanksByMember ? { freezeBanksByMember } : {}),
  });

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
    completedDates: [],
    streakDays: 0,
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

  const catDeps = (
    habits: Habit[],
    householdSettings: Household | null,
    freezeBank: FreezeBank | null,
  ) => ({
    db,
    householdId: HOUSEHOLD_ID,
    currentUser: { uid: ALICE },
    habits,
    transactions: [pendingTx],
    accounts,
    members: MEMBERS,
    householdSettings,
    freezeBank,
  });

  const habitData = () => capturedUpdates.find(u => u.ref.__path === habitPath('h1'))!.data!;
  const householdWrites = () => capturedUpdates.filter(u => u.ref.__path === householdPath);

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
    vi.clearAllMocks();
  });

  it('un-freezes ONLY the acting member at the frozenDatesBy DOT PATH and refunds only their bank', async () => {
    const frozenHabit: Habit = { ...threshHabit, frozenDatesBy: { [backDate]: [ALICE, BOB] } };
    const settings = household('per_member', { [ALICE]: bank(0), [BOB]: bank(1) });
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([frozenHabit], settings, null),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const data = habitData();
    // The uid is arrayRemove'd from the DATE's own node — never a whole-map
    // write, so BOB's entry on the same date survives untouched.
    expect(data[`frozenDatesBy.${backDate}`]).toEqual({ __arrayRemove: [ALICE] });
    expect(data).not.toHaveProperty('frozenDatesBy');
    // The shared list is not in use in this mode and must not be touched.
    expect(data).not.toHaveProperty('frozenDates');
    expect(data['completedDates']).toEqual({ __arrayUnion: [backDate] });

    // Refund: Alice's own bank, by dot path, capped at her max.
    const hh = householdWrites();
    expect(hh).toHaveLength(1);
    const hhData = hh[0]!.data!;
    expect(hhData[`freezeBanksByMember.${ALICE}.tokens`]).toBe(1);
    expect(hhData[`freezeBanksByMember.${ALICE}.maxTokens`]).toBe(2);
    expect(hhData[`freezeBanksByMember.${ALICE}.history`]).toEqual({
      __arrayUnion: [expect.objectContaining({ type: 'earned', amount: 1, habitDate: backDate })],
    });
    // Nothing whole-map, and nothing of Bob's.
    expect(hhData).not.toHaveProperty('freezeBanksByMember');
    expect(hhData).not.toHaveProperty('freezeBank');
    expect(Object.keys(hhData).some(k => k.includes(BOB))).toBe(false);
    // Points and the refund merged into that single household write.
    expect(hhData['points.total']).toEqual({ __increment: 10 });
    expect(commitCount).toBe(1);
  });

  it('does NOT un-freeze or refund when a DIFFERENT member holds the frozen date', async () => {
    const frozenHabit: Habit = { ...threshHabit, frozenDatesBy: { [backDate]: [BOB] } };
    const settings = household('per_member', { [ALICE]: bank(0), [BOB]: bank(0) });
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([frozenHabit], settings, null),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const data = habitData();
    expect(data).not.toHaveProperty(`frozenDatesBy.${backDate}`);
    // The completion still lands — only the freeze belonged to someone else.
    expect(data['completedDates']).toEqual({ __arrayUnion: [backDate] });

    const hhData = householdWrites()[0]!.data!;
    expect(Object.keys(hhData).some(k => k.startsWith('freezeBanksByMember'))).toBe(false);
    expect(hhData).not.toHaveProperty('freezeBank');
  });

  it('seeds a full bank for a member who has never spent a freeze (no migration write needed)', async () => {
    const frozenHabit: Habit = { ...threshHabit, frozenDatesBy: { [backDate]: [ALICE] } };
    // No `freezeBanksByMember` node at all for Alice.
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([frozenHabit], household('per_member'), null),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    // Seeded at the max (2), so the refund is capped there rather than 3.
    const hhData = householdWrites()[0]!.data!;
    expect(hhData[`freezeBanksByMember.${ALICE}.tokens`]).toBe(2);
  });

  it('scores the multiplier off the ACTING member’s own frozen bridge', async () => {
    // Completed 7 and 6 days ago, MISSED 5 days ago (Alice's own token froze
    // it), firing 4 days ago. Habit-level the gap breaks the chain → streak 1,
    // 10 pts. Bridged by Alice's token → streak 3 → 2.0x → 20 pts.
    const habit: Habit = {
      ...threshHabit,
      completedDates: [dayBefore(7), dayBefore(6)],
      frozenDatesBy: { [dayBefore(5)]: [ALICE] },
    };
    const settings = household('per_member', { [ALICE]: bank(1) });

    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([habit], settings, null),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')));
    expect(submission!.data).toMatchObject({
      pointsEarned: 20,
      multiplierApplied: 2.0,
      streakDaysAtTime: 3,
    });
    expect(householdWrites()[0]!.data!['points.total']).toEqual({ __increment: 20 });
  });

  it('the SAME habit under the shared mode still scores the habit-level streak (the regression fence)', async () => {
    const habit: Habit = {
      ...threshHabit,
      completedDates: [dayBefore(7), dayBefore(6)],
      frozenDatesBy: { [dayBefore(5)]: [ALICE] },
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([habit], household('shared'), null),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')));
    // Alice's personal token does NOT bridge the habit-level walk.
    expect(submission!.data).toMatchObject({ pointsEarned: 10, multiplierApplied: 1.0 });
    // ...and nothing per-member is written anywhere.
    expect(habitData()).not.toHaveProperty(`frozenDatesBy.${dayBefore(5)}`);
  });

  it('shared mode is unchanged: frozenDates arrayRemove + the whole-object freezeBank refund', async () => {
    const frozenHabit: Habit = {
      ...threshHabit,
      frozenDates: [backDate],
      // Present but IRRELEVANT in a shared mode — proves the branch is on the
      // resolved mode, not on the mere presence of per-member data.
      frozenDatesBy: { [backDate]: [ALICE] },
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([frozenHabit], household('freeze_both'), bank(1)),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    const data = habitData();
    expect(data['frozenDates']).toEqual({ __arrayRemove: [backDate] });
    expect(data).not.toHaveProperty(`frozenDatesBy.${backDate}`);

    const hh = householdWrites();
    expect(hh).toHaveLength(1);
    expect((hh[0]!.data!['freezeBank'] as FreezeBank).tokens).toBe(2);
    expect(Object.keys(hh[0]!.data!).some(k => k.startsWith('freezeBanksByMember'))).toBe(false);
  });

  it('an ABSENT freezeMode behaves exactly as shared (the inertness contract)', async () => {
    const frozenHabit: Habit = {
      ...threshHabit,
      frozenDates: [backDate],
      frozenDatesBy: { [backDate]: [ALICE] },
    };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      catDeps([frozenHabit], household(undefined), bank(1)),
    );
    await updateTransactionCategory('tx-9', 'Groceries', ['h1']);

    expect(habitData()['frozenDates']).toEqual({ __arrayRemove: [backDate] });
    expect((householdWrites()[0]!.data!['freezeBank'] as FreezeBank).tokens).toBe(2);
  });

  it('makeAddTransaction refunds the acting member too, in the SAME single household write', async () => {
    const frozenHabit: Habit = { ...threshHabit, frozenDatesBy: { [backDate]: [ALICE] } };
    const { addTransaction } = makeAddTransaction({
      ...makeDeps(),
      householdSettings: household('per_member', { [ALICE]: bank(0) }),
      habits: [frozenHabit],
      freezeBank: null,
    });
    await addTransaction({
      amount: 30,
      merchant: 'Target',
      category: 'Groceries',
      date: backDate,
      status: 'verified',
      isRecurring: false,
      source: 'manual',
      autoCategorized: false,
      accountId: 'acc-check',
      relatedHabitIds: ['h1'],
    });

    expect(habitData()[`frozenDatesBy.${backDate}`]).toEqual({ __arrayRemove: [ALICE] });
    const hh = householdWrites();
    expect(hh).toHaveLength(1);
    expect(hh[0]!.data![`freezeBanksByMember.${ALICE}.tokens`]).toBe(1);
    expect(hh[0]!.data!['points.total']).toEqual({ __increment: 10 });
    expect(commitCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ATTR-1 — card-owner attribution of transaction-fired habit completions
// ---------------------------------------------------------------------------

/**
 * The production symptom this closes: a week of 47 habit completions produced
 * only 26 attributed, and the entire gap was AUTOMATED fires — a
 * transaction-fired completion wrote no `Habit.completedBy` entry, so it landed
 * in the weekly recap's "unattributed" bucket with nobody's name on it.
 *
 * The card is the only signal a transaction carries about who spent the money
 * (two adults, separate debit cards, one shared checking account), so
 * `Account.cardOwners[Transaction.cardLast4]` is the creditee — never the
 * person who happened to approve the nightly sync.
 */
describe('ATTR-1 — transaction-fired habits credit the card owner', () => {
  const APPROVER = 'user-1'; // the acting uid every maker below runs as
  const CARDHOLDER = 'user-2';
  const GHOST = 'user-departed';
  const today = getLocalDateString();

  const habitPath = (id: string) => `households/${HOUSEHOLD_ID}/habits/${id}`;
  const submissionsPath = (id: string) => `${habitPath(id)}/submissions`;
  const householdPath = `households/${HOUSEHOLD_ID}`;
  const memberPath = (uid: string) => `households/${HOUSEHOLD_ID}/members/${uid}`;

  // CARDHOLDER holds card ...8899 on the shared checking account; ...1234 is
  // a second card on the SAME account with no owner tagged.
  const cardAccounts: Account[] = [
    {
      id: 'acc-check',
      name: 'Checking',
      type: 'checking',
      balance: 500,
      lastUpdated: '',
      cardLast4s: ['8899', '1234'],
      cardOwners: { '8899': CARDHOLDER },
    },
  ];

  const baseHabit: Habit = {
    id: 'h1',
    title: 'Order from Target/Amazon',
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
    // Non-stale so the fire takes the ordinary increment() path.
    lastUpdated: new Date().toISOString(),
  };

  /** A pending bank-sync row on the CARDHOLDER's card, awaiting review. */
  const cardTx: Transaction = {
    id: 'tx-card',
    amount: 30,
    merchant: 'TARGET T-2189',
    category: 'Uncategorized',
    date: today,
    status: 'pending_review',
    isRecurring: false,
    source: 'shortcut',
    autoCategorized: false,
    accountId: 'acc-check',
    cardLast4: '8899',
    createdAt: '',
    createdBy: APPROVER,
  };

  const deps = (
    habits: Habit[],
    transactions: Transaction[] = [cardTx],
    members: { uid: string }[] = [{ uid: APPROVER }, { uid: CARDHOLDER }],
    accountList: Account[] = cardAccounts,
  ) => ({
    db,
    householdId: HOUSEHOLD_ID,
    currentUser: { uid: APPROVER },
    habits,
    transactions,
    accounts: accountList,
    members,
    householdSettings: null,
    freezeBank: null,
  });

  const habitData = () => capturedUpdates.find(u => u.ref.__path === habitPath('h1'))!.data!;
  const attributionKeys = () =>
    Object.keys(habitData()).filter(k => k === 'completedBy' || k.startsWith('completedBy.'));

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    capturedDeletes = [];
    commitCount = 0;
    commitErrors = [];
    submissionDocs = {};
    vi.clearAllMocks();
  });

  it('credits the CARD OWNER, not the approver, via a completedBy DOT PATH', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([baseHabit]));
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(habitData()[`completedBy.${today}.${CARDHOLDER}`]).toEqual({ __increment: 1 });
    expect(habitData()[`completedBy.${today}.${APPROVER}`]).toBeUndefined();
  });

  // 🛡️ 2026-07-15 clobber class: a whole-map write from a stale offline cache
  // wipes another device's attribution. Only dot paths may ever be written.
  it('writes ONLY dot paths — never a bare `completedBy` key', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([baseHabit]));
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(attributionKeys()).toEqual([`completedBy.${today}.${CARDHOLDER}`]);
    expect(habitData()).not.toHaveProperty('completedBy');
  });

  // 🏁 THE RULE MOST LIKELY TO REGRESS. Groceries and the liquor store are done
  // FOR the household; pinning one spouse's name to them is the outcome
  // `creditMode: 'household'` exists to prevent.
  it('writes NO completedBy for a creditMode: "household" habit fired by the SAME card', async () => {
    const shared: Habit = { ...baseHabit, title: 'Grocery Store', creditMode: 'household' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([shared]));
    await updateTransactionCategory('tx-card', 'Groceries', ['h1']);

    // It still FIRES — it just credits nobody individually.
    expect(habitData()['totalCount']).toEqual({ __increment: 1 });
    expect(attributionKeys()).toEqual([]);
    const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))!;
    expect(submission.data).not.toHaveProperty('attributedTo');
    // Points stay on the pool at the habit-level figure, exactly as before.
    const hh = capturedUpdates.find(u => u.ref.__path === householdPath)!;
    expect(hh.data!['points.total']).toEqual({ __increment: 10 });
    expect(capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))).toBeUndefined();
  });

  it('an ASSIGNED chore is unchanged — creditMode is inert and no member is named', async () => {
    const chore: Habit = { ...baseHabit, assignedTo: CARDHOLDER, creditMode: 'household' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([chore]));
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(attributionKeys()).toEqual([]);
    expect(capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))).toBeUndefined();
    const hh = capturedUpdates.find(u => u.ref.__path === householdPath)!;
    expect(hh.data!['points.total']).toEqual({ __increment: 10 });
  });

  it('an UNTAGGED card credits nobody and does not crash', async () => {
    const untagged: Transaction = { ...cardTx, cardLast4: '1234' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      deps([baseHabit], [untagged]),
    );
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(attributionKeys()).toEqual([]);
    expect(habitData()['totalCount']).toEqual({ __increment: 1 });
    expect(commitCount).toBe(1);
  });

  // Attribution is FORWARD-ONLY: every transaction written before
  // `Transaction.cardLast4` shipped has no value, and nothing is inferred.
  it('a row with NO cardLast4 (every legacy row) credits nobody and does not crash', async () => {
    const legacy: Transaction = { ...cardTx };
    delete legacy.cardLast4;
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      deps([baseHabit], [legacy]),
    );
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(attributionKeys()).toEqual([]);
    expect(habitData()['totalCount']).toEqual({ __increment: 1 });
    expect(commitCount).toBe(1);
  });

  // 🛡️ `cardOwners` is member-writable and `firestore.rules` carries no key
  // allowlist for the accounts collection, so the roster is the only authority.
  it('credits nobody when cardOwners names a uid that is NOT a current member', async () => {
    const strangersCard: Account[] = [{ ...cardAccounts[0]!, cardOwners: { '8899': GHOST } }];
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      deps([baseHabit], [cardTx], [{ uid: APPROVER }, { uid: CARDHOLDER }], strangersCard),
    );
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(attributionKeys()).toEqual([]);
    expect(capturedUpdates.find(u => u.ref.__path === memberPath(GHOST))).toBeUndefined();
  });

  it('credits nobody when the roster has not loaded (fails CLOSED)', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      deps([baseHabit], [cardTx], []),
    );
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(attributionKeys()).toEqual([]);
  });

  it('snapshots attributedTo on the submission so the undo reverses the right member', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([baseHabit]));
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))!;
    expect(submission.data!.attributedTo).toBe(CARDHOLDER);
    // `createdBy` stays the OPERATOR — the two legitimately differ here.
    expect(submission.data!.createdBy).toBe(APPROVER);
    expect(submission.data!.date).toBe(today);
  });

  it('commits the habit, its submission, household points AND the member points in ONE batch', async () => {
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([baseHabit]));
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(commitCount).toBe(1);
    expect(habitData()[`completedBy.${today}.${CARDHOLDER}`]).toEqual({ __increment: 1 });
    expect(capturedSets.some(s => s.ref.__path.startsWith(submissionsPath('h1')))).toBe(true);
    const hh = capturedUpdates.find(u => u.ref.__path === householdPath)!;
    expect(hh.data!['points.total']).toEqual({ __increment: 10 });
    const cardholderPoints = capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))!;
    expect(cardholderPoints.data!['points.total']).toEqual({ __increment: 10 });
    expect(cardholderPoints.data!['points.daily']).toEqual({ __increment: 10 });
  });

  it('writes ONE member update even when the same card fires TWO habits', async () => {
    const second: Habit = { ...baseHabit, id: 'h2', title: 'Impulse purchase' };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      deps([baseHabit, second]),
    );
    await updateTransactionCategory('tx-card', 'Shopping', ['h1', 'h2']);

    const memberWrites = capturedUpdates.filter(u => u.ref.__path === memberPath(CARDHOLDER));
    expect(memberWrites).toHaveLength(1);
    expect(memberWrites[0]!.data!['points.total']).toEqual({ __increment: 20 });
    expect(commitCount).toBe(1);
  });

  // 🛡️ THE SIDE-EFFECT MEMBER. A threshold period whose crossing COMPLETES it
  // flips an EARLIER member's award from 0 to a full one, so the pool pays BOTH
  // while the submission stores only the creditee's own share. That second
  // member has no submission of their own, so an undo that reversed from the
  // stored doc alone left them permanently over-credited — `points.total` is a
  // lifetime counter `writeSyncedMemberPoints` never writes. The undo therefore
  // DERIVES its debit from the live habit's before/after decomposition, exactly
  // as `deleteHabitSubmission` does.
  describe('a threshold period that also flips a second member’s award on', () => {
    // targetCount 2: the APPROVER already banked the period's first unit
    // (attributed to them), and the CARDHOLDER's card crosses the target now,
    // so BOTH earn a full award at their own multiplier. Both units sit on
    // `today`, which keeps the fixture free of any weekday dependence.
    const twoStepHabit: Habit = {
      ...baseHabit,
      targetCount: 2,
      count: 1,
      completedBy: { [today]: { [APPROVER]: 1 } },
    };

    /** Every `points.*` increment captured for one doc, summed across writes. */
    const pointsFor = (path: string) => {
      const out = { daily: 0, weekly: 0, total: 0 };
      for (const write of capturedUpdates.filter(u => u.ref.__path === path)) {
        for (const bucket of ['daily', 'weekly', 'total'] as const) {
          const value = write.data?.[`points.${bucket}`] as { __increment: number } | undefined;
          out[bucket] += value?.__increment ?? 0;
        }
      }
      return out;
    };
    const negated = (b: { daily: number; weekly: number; total: number }) => ({
      daily: -b.daily,
      weekly: -b.weekly,
      total: -b.total,
    });

    /**
     * The habit as a write LEFT it, replayed from the deltas that write actually
     * captured — so the undo below is fed the fire's own output (and the re-fire
     * the undo's own output) rather than a hand-written guess that could quietly
     * diverge from either.
     *
     * A node decremented to zero is DROPPED, matching `withAttributionDelta` and
     * `memberCompletionCount`, for which a ≤0 count means "absent".
     */
    const applyHabitWrite = (habit: Habit): Habit => {
      const data = habitData();
      const inc = (value: unknown) =>
        (value as { __increment?: number } | undefined)?.__increment ?? 0;
      const completedBy: NonNullable<Habit['completedBy']> = {};
      for (const [date, day] of Object.entries(habit.completedBy ?? {})) {
        completedBy[date] = { ...day };
      }
      for (const [key, value] of Object.entries(data)) {
        const parts = key.split('.');
        const [root, date, uid] = parts;
        if (root !== 'completedBy' || parts.length !== 3 || !date || !uid) continue;
        const day = { ...(completedBy[date] ?? {}) };
        const next = (day[uid] ?? 0) + inc(value);
        if (next > 0) day[uid] = next;
        else delete day[uid];
        if (Object.keys(day).length > 0) completedBy[date] = day;
        else delete completedBy[date];
      }
      const dates = data.completedDates as
        | { __arrayUnion?: string[]; __arrayRemove?: string[] }
        | undefined;
      const removed = new Set(dates?.__arrayRemove ?? []);
      return {
        ...habit,
        count: typeof data.count === 'number' ? data.count : habit.count + inc(data.count),
        totalCount: habit.totalCount + inc(data.totalCount),
        completedDates: [
          ...new Set([...habit.completedDates, ...(dates?.__arrayUnion ?? [])]),
        ].filter(d => !removed.has(d)),
        completedBy,
      };
    };

    /** Seed the undo's submission read with the doc the fire actually wrote. */
    const seedFiredSubmission = () => {
      const fired = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))!;
      submissionDocs[submissionsPath('h1')] = [{ id: 'sub-1', ...fired.data! }];
    };

    const undoDeps = (
      habits: Habit[],
      members: { uid: string }[] = [{ uid: APPROVER }, { uid: CARDHOLDER }],
    ) => ({
      db,
      householdId: HOUSEHOLD_ID,
      habits,
      transactions: [{ ...cardTx, status: 'verified' as const, firedHabitIds: ['h1'] }],
      accounts: cardAccounts,
      members,
      calendarItems: [] as CalendarItem[],
    });

    it('pays the pool BOTH awards while the submission stores only the creditee’s', async () => {
      const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([twoStepHabit]));
      await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

      const submission = capturedSets.find(s => s.ref.__path.startsWith(submissionsPath('h1')))!;
      // The doc stores ONE share; the pool receives the sum of both.
      expect(submission.data!.pointsEarned).toBe(10);
      expect(pointsFor(householdPath).total).toBe(20);
      expect(pointsFor(memberPath(APPROVER)).total).toBe(10);
      expect(pointsFor(memberPath(CARDHOLDER)).total).toBe(10);
    });

    // 🛡️ THE REGRESSION THIS PR'S FIRST DRAFT SHIPPED: the undo debited the
    // creditee and the pool but wrote NOTHING to the side-effect member, and
    // `points.total` has no corrective recompute to clean up after it.
    it('fire → undo returns the pool AND every member it touched to zero', async () => {
      const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([twoStepHabit]));
      await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

      const afterFire = applyHabitWrite(twoStepHabit);
      const firePool = pointsFor(householdPath);
      const fireApprover = pointsFor(memberPath(APPROVER));
      const fireCardholder = pointsFor(memberPath(CARDHOLDER));
      // Guard the fixture: if the fire stopped paying a SIDE-EFFECT member the
      // round-trip below would pass while testing nothing.
      expect(fireApprover.total).toBeGreaterThan(0);
      expect(firePool.total).toBe(fireApprover.total + fireCardholder.total);

      seedFiredSubmission();
      capturedUpdates = [];
      const { reverseTransactionApproval } = makeReverseTransactionApproval(undoDeps([afterFire]));
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      // Every touched doc back to its pre-fire figure, bucket for bucket —
      // `points.total` included, which is the field nothing else recovers.
      expect(pointsFor(householdPath)).toEqual(negated(firePool));
      expect(pointsFor(memberPath(APPROVER))).toEqual(negated(fireApprover));
      expect(pointsFor(memberPath(CARDHOLDER))).toEqual(negated(fireCardholder));
    });

    it('returns TWO side-effect members to zero, not just the first', async () => {
      const THIRD = 'user-3';
      const roster = [{ uid: APPROVER }, { uid: CARDHOLDER }, { uid: THIRD }];
      const threeStep: Habit = {
        ...baseHabit,
        targetCount: 3,
        count: 2,
        completedBy: { [today]: { [APPROVER]: 1, [THIRD]: 1 } },
      };
      const { updateTransactionCategory } = makeUpdateTransactionCategory(
        deps([threeStep], [cardTx], roster),
      );
      await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

      const afterFire = applyHabitWrite(threeStep);
      const fire = {
        pool: pointsFor(householdPath),
        approver: pointsFor(memberPath(APPROVER)),
        third: pointsFor(memberPath(THIRD)),
        cardholder: pointsFor(memberPath(CARDHOLDER)),
      };
      expect(fire.approver.total).toBeGreaterThan(0);
      expect(fire.third.total).toBeGreaterThan(0);

      seedFiredSubmission();
      capturedUpdates = [];
      const { reverseTransactionApproval } = makeReverseTransactionApproval(
        undoDeps([afterFire], roster),
      );
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      expect(pointsFor(householdPath)).toEqual(negated(fire.pool));
      expect(pointsFor(memberPath(APPROVER))).toEqual(negated(fire.approver));
      expect(pointsFor(memberPath(THIRD))).toEqual(negated(fire.third));
      expect(pointsFor(memberPath(CARDHOLDER))).toEqual(negated(fire.cardholder));
    });

    // The side-effect member's award is NOT assumed equal to the creditee's:
    // each is scored at their OWN streak multiplier. APPROVER carries a 7-day
    // attributed chain (3.0x) into a period the CARDHOLDER enters cold (1.0x).
    it('debits a side-effect member their OWN award, not the creditee’s', async () => {
      const priorDays = Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map(n => [
          format(subDays(parseISO(today), n), 'yyyy-MM-dd'),
          { [APPROVER]: 1 },
        ]),
      );
      const streakedHabit: Habit = {
        ...baseHabit,
        targetCount: 2,
        count: 1,
        // A streak period is one that was COMPLETED, not merely touched (see
        // `memberStreakDates`), so the six prior days have to be real
        // completions for APPROVER to carry a chain into today — which is
        // exactly what production writes once a day crosses its target.
        // TODAY is deliberately absent: the fire is what completes it.
        completedDates: [...baseHabit.completedDates, ...Object.keys(priorDays)],
        completedBy: { ...priorDays, [today]: { [APPROVER]: 1 } },
      };
      const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([streakedHabit]));
      await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

      const afterFire = applyHabitWrite(streakedHabit);
      const fireApprover = pointsFor(memberPath(APPROVER));
      const fireCardholder = pointsFor(memberPath(CARDHOLDER));
      const firePool = pointsFor(householdPath);
      // 7-day chain → 3.0x → 30, against the cardholder's first-ever 1.0x → 10.
      expect(fireApprover.total).toBe(30);
      expect(fireCardholder.total).toBe(10);
      expect(firePool.total).toBe(40);

      seedFiredSubmission();
      capturedUpdates = [];
      const { reverseTransactionApproval } = makeReverseTransactionApproval(undoDeps([afterFire]));
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      expect(pointsFor(memberPath(APPROVER)).total).toBe(-30);
      expect(pointsFor(memberPath(CARDHOLDER)).total).toBe(-10);
      expect(pointsFor(householdPath).total).toBe(-40);
    });

    // 🛡️ A side-effect member who WAS current at fire time but has left the
    // roster by the time the undo runs. `resolveReversalSources` still names
    // them — the STORED `completedBy` on the reversed habit doesn't change
    // just because a member departed — so `periodPointsMove` still returns
    // their share in `move.perMember`. The undo's `isCurrentMember` guard is
    // what keeps that `batch.update` from rejecting NOT_FOUND and aborting the
    // whole all-or-nothing batch (distinct from the `GHOST` fixture elsewhere
    // in this file, which covers a non-current `attributedTo` at FIRE time).
    it('a side-effect member who departed before the undo — no write to their doc, pool still nets to zero', async () => {
      const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([twoStepHabit]));
      await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

      const afterFire = applyHabitWrite(twoStepHabit);
      const firePool = pointsFor(householdPath);
      const fireApprover = pointsFor(memberPath(APPROVER));
      const fireCardholder = pointsFor(memberPath(CARDHOLDER));
      // Guard the fixture: APPROVER really was paid a side-effect award, and
      // the pool is the sum of both — otherwise this round-trip would test
      // nothing (the guard would never be reached).
      expect(fireApprover.total).toBeGreaterThan(0);
      expect(firePool.total).toBe(fireApprover.total + fireCardholder.total);

      seedFiredSubmission();
      capturedUpdates = [];
      // APPROVER has left the household by the time of the undo — the roster
      // handed to the undo holds only CARDHOLDER.
      const { reverseTransactionApproval } = makeReverseTransactionApproval(
        undoDeps([afterFire], [{ uid: CARDHOLDER }]),
      );
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      // Negative: the departed member's doc is never touched.
      expect(capturedUpdates.find(u => u.ref.__path === memberPath(APPROVER))).toBeUndefined();
      // Positive control, value-checked (not just "a write happened"): the
      // still-current CARDHOLDER's debit lands at exactly what the fire paid.
      expect(pointsFor(memberPath(CARDHOLDER))).toEqual(negated(fireCardholder));
      // Conservation: the pool receives the FULL move.household delta
      // regardless of membership, so it nets to zero even though one member's
      // write was skipped.
      expect(pointsFor(householdPath)).toEqual(negated(firePool));
    });

    it('re-firing after an undo credits exactly what the first fire did', async () => {
      const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([twoStepHabit]));
      await updateTransactionCategory('tx-card', 'Shopping', ['h1']);
      const afterFire = applyHabitWrite(twoStepHabit);
      const first = {
        pool: pointsFor(householdPath),
        approver: pointsFor(memberPath(APPROVER)),
        cardholder: pointsFor(memberPath(CARDHOLDER)),
      };

      seedFiredSubmission();
      capturedUpdates = [];
      const { reverseTransactionApproval } = makeReverseTransactionApproval(undoDeps([afterFire]));
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);
      const afterUndo = applyHabitWrite(afterFire);

      // The undo restored the habit itself, so the re-approve starts level.
      expect(afterUndo.count).toBe(twoStepHabit.count);
      expect(afterUndo.completedBy).toEqual(twoStepHabit.completedBy);

      submissionDocs = {};
      capturedUpdates = [];
      capturedSets = [];
      const refire = makeUpdateTransactionCategory(deps([afterUndo]));
      await refire.updateTransactionCategory('tx-card', 'Shopping', ['h1']);

      expect(pointsFor(householdPath)).toEqual(first.pool);
      expect(pointsFor(memberPath(APPROVER))).toEqual(first.approver);
      expect(pointsFor(memberPath(CARDHOLDER))).toEqual(first.cardholder);
    });
  });

  // 🛡️ A GHOST holding a PRIOR unit of a threshold habit — still sitting in
  // the habit's stored `completedBy` from before they left the household —
  // when a CURRENT member's tagged card crosses the threshold. `resolveCard-
  // FireAttribution` fails closed for the attributedTo candidate (the `GHOST`
  // fixture used elsewhere in this file), but here the ghost is only a
  // SIDE-EFFECT holder: `periodPointsMove` derives their share purely from
  // the habit's before/after decomposition, not from the roster, so it still
  // returns it in `move.perMember`. `fireHabitsIntoBatch`'s `isCurrentMember`
  // guard is what keeps that `batch.update` from rejecting NOT_FOUND and
  // aborting the whole all-or-nothing batch.
  it('a GHOST holding a prior unit is skipped at fire time — no write to their doc, pool still nets the full award', async () => {
    const ghostHeldHabit: Habit = {
      ...baseHabit,
      targetCount: 2,
      count: 1,
      completedBy: { [today]: { [GHOST]: 1 } },
    };
    // GHOST is not on the roster handed to this fire — only APPROVER + CARDHOLDER.
    const { updateTransactionCategory } = makeUpdateTransactionCategory(
      deps([ghostHeldHabit], [cardTx], [{ uid: APPROVER }, { uid: CARDHOLDER }]),
    );
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    // Negative: no write ever lands on the departed member's doc.
    expect(capturedUpdates.find(u => u.ref.__path === memberPath(GHOST))).toBeUndefined();
    // Positive control, value-checked (not just "a write happened"): CARDHOLDER
    // — the current member whose card actually crossed the threshold — is
    // still credited their own share.
    const cardholderWrite = capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))!;
    expect(cardholderWrite.data!['points.total']).toEqual({ __increment: 10 });
    // Conservation: the pool receives BOTH shares — the ghost's side-effect
    // award included — even though the ghost's own doc write was skipped.
    const hh = capturedUpdates.find(u => u.ref.__path === householdPath)!;
    expect(hh.data!['points.total']).toEqual({ __increment: 20 });
  });

  it('back-dates the attribution to the TRANSACTION date, never today', async () => {
    const backDate = format(subDays(parseISO(today), 3), 'yyyy-MM-dd');
    const oldTx: Transaction = { ...cardTx, date: backDate };
    const { updateTransactionCategory } = makeUpdateTransactionCategory(deps([baseHabit], [oldTx]));
    await updateTransactionCategory('tx-card', 'Shopping', ['h1']);

    expect(habitData()[`completedBy.${backDate}.${CARDHOLDER}`]).toEqual({ __increment: 1 });
    expect(habitData()[`completedBy.${today}.${CARDHOLDER}`]).toBeUndefined();
  });

  it('the manual-entry path (addTransaction) attributes by card too', async () => {
    const { addTransaction } = makeAddTransaction({
      db,
      householdId: HOUSEHOLD_ID,
      user: { uid: APPROVER },
      householdSettings: null,
      accounts: cardAccounts,
      habits: [baseHabit],
      members: [{ uid: APPROVER }, { uid: CARDHOLDER }],
      freezeBank: null,
      recentTransactionsRef: { current: [{ id: 'existing' } as Transaction] },
    });
    await addTransaction({
      amount: 30,
      merchant: 'Target',
      category: 'Shopping',
      date: today,
      status: 'verified',
      isRecurring: false,
      source: 'manual',
      autoCategorized: false,
      accountId: 'acc-check',
      cardLast4: '8899',
      relatedHabitIds: ['h1'],
    });

    expect(habitData()[`completedBy.${today}.${CARDHOLDER}`]).toEqual({ __increment: 1 });
    expect(commitCount).toBe(1);
  });

  describe('the undo un-writes exactly what the fire wrote', () => {
    const firedHabit: Habit = {
      ...baseHabit,
      count: 1,
      totalCount: 5,
      completedDates: [today, '2020-01-01'],
      streakDays: 1,
      completedBy: { [today]: { [CARDHOLDER]: 1 } },
    };
    const verifiedTx: Transaction = {
      ...cardTx,
      status: 'verified',
      category: 'Shopping',
      relatedHabitIds: ['h1'],
      firedHabitIds: ['h1'],
    };

    const seedSubmission = (over: Record<string, unknown> = {}) => {
      submissionDocs[submissionsPath('h1')] = [{
        id: 'sub-1',
        habitId: 'h1',
        habitTitle: baseHabit.title,
        timestamp: `${today}T12:00:00.000Z`,
        date: today,
        count: 1,
        pointsEarned: 10,
        streakDaysAtTime: 1,
        multiplierApplied: 1,
        createdBy: APPROVER,
        attributedTo: CARDHOLDER,
        createdAt: `${today}T12:00:00.000Z`,
        sourceTransactionId: 'tx-card',
        ...over,
      }];
    };

    const reverseDeps = (habits: Habit[]) => ({
      db,
      householdId: HOUSEHOLD_ID,
      habits,
      transactions: [verifiedTx],
      accounts: cardAccounts,
      members: [{ uid: APPROVER }, { uid: CARDHOLDER }],
      calendarItems: [] as CalendarItem[],
    });

    it('decrements the credited member via a DOT PATH and debits their points', async () => {
      seedSubmission();
      const { reverseTransactionApproval } = makeReverseTransactionApproval(
        reverseDeps([firedHabit]),
      );
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      const data = habitData();
      expect(data[`completedBy.${today}.${CARDHOLDER}`]).toEqual({ __increment: -1 });
      expect(data).not.toHaveProperty('completedBy');
      const memberWrite = capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))!;
      expect(memberWrite.data!['points.total']).toEqual({ __increment: -10 });
      expect(commitCount).toBe(1);
    });

    // Bounded by the STORED attribution: a doc naming a member who holds no
    // units on that date takes back nothing rather than driving a node negative.
    it('takes back nothing — points included — when the habit records no attribution', async () => {
      seedSubmission();
      const noAttribution: Habit = { ...firedHabit, completedBy: {} };
      const { reverseTransactionApproval } = makeReverseTransactionApproval(
        reverseDeps([noAttribution]),
      );
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      expect(Object.keys(habitData()).filter(k => k.startsWith('completedBy'))).toEqual([]);
      // 🛡️ No member debit either: some other path already reversed them, and
      // debiting again off `attributedTo` alone would double-charge.
      expect(capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))).toBeUndefined();
    });

    // `resolveReversalSources` falls through to the date's other holders when
    // the named member holds nothing — the points must follow the same holder.
    it('debits whoever the stored attribution actually names, not the submission', async () => {
      seedSubmission();
      const heldByApprover: Habit = {
        ...firedHabit,
        completedBy: { [today]: { [APPROVER]: 1 } },
      };
      const { reverseTransactionApproval } = makeReverseTransactionApproval(
        reverseDeps([heldByApprover]),
      );
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      expect(habitData()[`completedBy.${today}.${APPROVER}`]).toEqual({ __increment: -1 });
      expect(habitData()[`completedBy.${today}.${CARDHOLDER}`]).toBeUndefined();
      const approverWrite = capturedUpdates.find(u => u.ref.__path === memberPath(APPROVER))!;
      expect(approverWrite.data!['points.total']).toEqual({ __increment: -10 });
      expect(capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))).toBeUndefined();
    });

    // Every fire written before ATTR-1, plus every household-credit / chore /
    // untagged-card fire: no `attributedTo`, so no member moves either way.
    it('moves no member for a submission with no attributedTo', async () => {
      seedSubmission({ attributedTo: undefined });
      const { reverseTransactionApproval } = makeReverseTransactionApproval(
        reverseDeps([firedHabit]),
      );
      await reverseTransactionApproval('tx-card', { category: 'Uncategorized' }, ['h1']);

      expect(Object.keys(habitData()).filter(k => k.startsWith('completedBy'))).toEqual([]);
      expect(capturedUpdates.find(u => u.ref.__path === memberPath(CARDHOLDER))).toBeUndefined();
      // The pool reversal is unchanged.
      const hh = capturedUpdates.find(u => u.ref.__path === householdPath)!;
      expect(hh.data!['points.total']).toEqual({ __increment: -10 });
    });
  });
});
