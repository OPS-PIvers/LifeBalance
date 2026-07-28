import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Firestore mock (mirrors transactionMutations.test.ts) -----------------
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
        // collection(...) ref passed to doc() → auto-id child. withConverter
        // passthrough matches appendActivityLog's `doc(collection(...)).withConverter(...)` chain.
        // `id` mirrors the real DocumentReference: settleBillWithTransaction
        // reads it off the pre-allocated paid-instance ref to stamp
        // `Transaction.paidCalendarItemId`.
        const ref: { __path: string; id: string; withConverter: () => typeof ref } = {
          __path: `${firstRef.__path}/__autoId`,
          id: '__autoId',
          withConverter: () => ref,
        };
        return ref;
      }
      return { __path: id ? `${path}/${id}` : (path ?? '__autoId'), id: id ?? '__autoId' };
    }),
    collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
    increment: (n: number) => ({ __increment: n }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    deleteField: () => ({ __deleteField: true }),
    arrayUnion: (...vals: unknown[]) => ({ __arrayUnion: vals }),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    addDoc: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedSets.push({ ref, data });
      },
      update: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedUpdates.push({ ref, data });
      },
      delete: () => {},
      commit: vi.fn(async () => {
        commitCount++;
      }),
    })),
  };
});

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/utils/firestoreSanitizer', () => ({
  sanitizeFirestoreData: (d: Record<string, unknown>) => d,
}));

import { makeLinkBankTransactionToBill, makeSettleBillWithTransaction } from './calendarMutations';
import type { Account, CalendarItem, Transaction } from '@/types/schema';

const HOUSEHOLD_ID = 'house1';
const db = {} as never;

const bankTx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-bank',
  amount: 153.95,
  merchant: 'COMCAST-XFINITY CABLE SVCS',
  category: 'Uncategorized',
  date: '2026-07-20',
  status: 'verified',
  isRecurring: false,
  source: 'shortcut',
  autoCategorized: false,
  accountId: 'acc-check',
  bankRef: 'P0001',
  needsCategory: true,
  ...over,
});

const oneOffBill = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  id: 'bill-1',
  title: 'Comcast Internet',
  amount: 150,
  date: '2026-07-18',
  type: 'expense',
  isPaid: false,
  ...over,
});

const calPath = (id: string) => `households/${HOUSEHOLD_ID}/calendarItems/${id}`;
const txPath = (id: string) => `households/${HOUSEHOLD_ID}/transactions/${id}`;
const activityLogPathPrefix = `households/${HOUSEHOLD_ID}/activityLog/`;
const USER = { uid: 'user-1' };

describe('makeLinkBankTransactionToBill', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    commitCount = 0;
    vi.clearAllMocks();
  });

  it('marks a one-off bill paid at the txn amount, files the txn, learns the alias — NO balance write; returns true', async () => {
    const { linkBankTransactionToBill } = makeLinkBankTransactionToBill({
      db,
      householdId: HOUSEHOLD_ID,
      user: USER,
      actorName: 'Paul',
      transactions: [bankTx()],
      calendarItems: [oneOffBill()],
    });
    const result = await linkBankTransactionToBill('tx-bank', 'bill-1');

    expect(result).toBe(true);
    expect(commitCount).toBe(1);

    // Bill marked paid at the ACTUAL charge (153.95), not its budgeted 150.
    const billUpdate = capturedUpdates.find((u) => u.ref.__path === calPath('bill-1') && 'isPaid' in (u.data ?? {}));
    expect(billUpdate?.data).toMatchObject({ isPaid: true, amount: 153.95 });

    // Transaction filed as the bill payment; needsCategory cleared.
    const txUpdate = capturedUpdates.find((u) => u.ref.__path === txPath('tx-bank'));
    expect(txUpdate?.data).toMatchObject({
      category: 'Budgeted in Calendar',
      needsCategory: { __deleteField: true },
    });

    // Alias learned onto the bill.
    const aliasUpdate = capturedUpdates.find(
      (u) => u.ref.__path === calPath('bill-1') && 'bankDescriptorAliases' in (u.data ?? {}),
    );
    expect(aliasUpdate?.data?.bankDescriptorAliases).toEqual({
      __arrayUnion: ['COMCAST-XFINITY CABLE SVCS'],
    });

    // F-XCUT-01: the payment is logged to the activity feed in the same batch.
    const activityLogSet = capturedSets.find((s) => s.ref.__path.startsWith(activityLogPathPrefix));
    expect(activityLogSet?.data).toMatchObject({
      actorUid: 'user-1',
      actorName: 'Paul',
      domain: 'money',
      action: 'bill_paid',
    });

    // INVARIANT: no account-balance write anywhere.
    const balanceWrites = capturedUpdates.filter((u) =>
      u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`),
    );
    expect(balanceWrites).toHaveLength(0);
  });

  it('writes a paid-instance record (with createdBy) and learns the alias onto the TEMPLATE for a recurring occurrence', async () => {
    const template = oneOffBill({ id: 'tmpl-1', isRecurring: true });
    const recurringId = 'tmpl-1_instance_2026-07-18';
    const { linkBankTransactionToBill } = makeLinkBankTransactionToBill({
      db,
      householdId: HOUSEHOLD_ID,
      user: USER,
      actorName: 'Paul',
      transactions: [bankTx()],
      calendarItems: [template],
    });
    const result = await linkBankTransactionToBill('tx-bank', recurringId);

    expect(result).toBe(true);
    expect(commitCount).toBe(1);
    // Paid-instance record created (set) referencing the template, with createdBy
    // stamped (matches makePayCalendarItem's paid-instance shape). It's staged
    // before the activity-log set (step 4), so it's the first captured `set`.
    const paidInstance = capturedSets.find((s) => 'parentRecurringId' in (s.data ?? {}));
    expect(paidInstance?.data).toMatchObject({
      isPaid: true,
      amount: 153.95,
      parentRecurringId: 'tmpl-1',
      date: '2026-07-18',
      createdBy: 'user-1',
    });
    // Alias learned onto the TEMPLATE doc, not the synthetic occurrence id.
    const aliasUpdate = capturedUpdates.find((u) => u.ref.__path === calPath('tmpl-1'));
    expect(aliasUpdate?.data?.bankDescriptorAliases).toEqual({
      __arrayUnion: ['COMCAST-XFINITY CABLE SVCS'],
    });
  });

  it('no-ops for a non-bank-synced transaction (no bankRef); returns false', async () => {
    const { linkBankTransactionToBill } = makeLinkBankTransactionToBill({
      db,
      householdId: HOUSEHOLD_ID,
      user: USER,
      transactions: [bankTx({ bankRef: undefined })],
      calendarItems: [oneOffBill()],
    });
    const result = await linkBankTransactionToBill('tx-bank', 'bill-1');
    expect(result).toBe(false);
    expect(commitCount).toBe(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  it('no-ops when the bill is already paid; returns false', async () => {
    const { linkBankTransactionToBill } = makeLinkBankTransactionToBill({
      db,
      householdId: HOUSEHOLD_ID,
      user: USER,
      transactions: [bankTx()],
      calendarItems: [oneOffBill({ isPaid: true })],
    });
    const result = await linkBankTransactionToBill('tx-bank', 'bill-1');
    expect(result).toBe(false);
    expect(commitCount).toBe(0);
  });

  it('no-ops when there is no authenticated user; returns false', async () => {
    const { linkBankTransactionToBill } = makeLinkBankTransactionToBill({
      db,
      householdId: HOUSEHOLD_ID,
      user: null,
      transactions: [bankTx()],
      calendarItems: [oneOffBill()],
    });
    const result = await linkBankTransactionToBill('tx-bank', 'bill-1');
    expect(result).toBe(false);
    expect(commitCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// settleBillWithTransaction (TODO.md 2H(a)) — "this charge IS that bill".
// The distinguishing behaviours vs. linkBankTransactionToBill: it DOES move the
// balance for a not-yet-verified row, it creates NO transaction, and it stamps
// the real paid-doc id onto the transaction.
// ---------------------------------------------------------------------------

const accounts: Account[] = [
  { id: 'acc-check', name: 'Checking', type: 'checking', balance: 1000, lastUpdated: '' },
  { id: 'acc-card', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' },
];

const accountPath = (id: string) => `households/${HOUSEHOLD_ID}/accounts/${id}`;

/** The screenshot-import shape: pending_review, no bankRef, ugly descriptor. */
const scannedTx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-scan',
  amount: 37.91,
  merchant: 'Cpenergy Mngco',
  category: 'Uncategorized',
  date: '2026-07-22',
  status: 'pending_review',
  isRecurring: false,
  source: 'image-capture',
  autoCategorized: false,
  ...over,
});

const settleDeps = (transactions: Transaction[], calendarItems: CalendarItem[]) => ({
  db,
  householdId: HOUSEHOLD_ID,
  user: USER,
  actorName: 'Paul',
  transactions,
  calendarItems,
  accounts,
});

describe('makeSettleBillWithTransaction', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    commitCount = 0;
    vi.clearAllMocks();
  });

  it('debits the account for a pending_review row, creates NO transaction, and stamps the paid doc id', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx()], [oneOffBill({ amount: 142 })]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'bill-1');

    expect(result).toBe(true);
    // ONE batch — atomicity is the whole contract.
    expect(commitCount).toBe(1);

    // The bill records the SCANNED amount, not its budgeted 142.
    const billUpdate = capturedUpdates.find(u => u.ref.__path === calPath('bill-1'));
    expect(billUpdate?.data).toMatchObject({ isPaid: true, amount: 37.91 });
    // The one-off case folds the alias learn into the same update.
    expect(billUpdate?.data?.bankDescriptorAliases).toEqual({ __arrayUnion: ['Cpenergy Mngco'] });

    // The transaction is verified + filed, with the REAL paid doc id (the
    // one-off's own id here) — and its amount is NOT rewritten.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txPath('tx-scan'));
    expect(txUpdate?.data).toMatchObject({
      status: 'verified',
      category: 'Budgeted in Calendar',
      paidCalendarItemId: 'bill-1',
    });
    expect(txUpdate?.data).not.toHaveProperty('amount');
    // payPeriodId stays the transaction's own (never retro-filed to the bill's).
    expect(txUpdate?.data).not.toHaveProperty('payPeriodId');

    // A pending row had NOT touched any balance, so the merge must debit it now.
    const balanceUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-check'));
    expect(balanceUpdate?.data?.balance).toEqual({ __increment: -37.91 });

    // No new transaction doc anywhere — exactly one record, which is what
    // distinguishes this from payCalendarItem.
    const txSets = capturedSets.filter(s => s.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/transactions`));
    expect(txSets).toHaveLength(0);

    // F-XCUT-01 audit entry rides the same batch.
    const activityLogSet = capturedSets.find(s => s.ref.__path.startsWith(activityLogPathPrefix));
    expect(activityLogSet?.data).toMatchObject({ domain: 'money', action: 'bill_paid' });
  });

  it('writes NO balance delta for a bank-sync row whose account balance is already authoritative', async () => {
    const bankRow = scannedTx({
      status: 'verified',
      bankRef: 'P0001',
      source: 'bank-sync',
      accountId: 'acc-check',
      needsCategory: true,
    });
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([bankRow], [oneOffBill({ amount: 142 })]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'bill-1');

    expect(result).toBe(true);
    const balanceWrites = capturedUpdates.filter(u =>
      u.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/accounts/`),
    );
    expect(balanceWrites).toHaveLength(0);
    // The needsCategory flag is cleared so the row leaves the review surface.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txPath('tx-scan'));
    expect(txUpdate?.data?.needsCategory).toEqual({ __deleteField: true });
  });

  it('writes a paid INSTANCE dated to the occurrence due date and never touches the template amount', async () => {
    const template = oneOffBill({ id: 'tmpl-1', amount: 142, isRecurring: true, date: '2026-07-05' });
    // The transaction is dated the 22nd; the occurrence is due on the 18th.
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx({ date: '2026-07-22' })], [template]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'tmpl-1_instance_2026-07-18');

    expect(result).toBe(true);
    expect(commitCount).toBe(1);

    const paidInstance = capturedSets.find(s => 'parentRecurringId' in (s.data ?? {}));
    expect(paidInstance?.data).toMatchObject({
      isPaid: true,
      amount: 37.91,
      parentRecurringId: 'tmpl-1',
      // The OCCURRENCE's due date — NOT the transaction's 2026-07-22. Dating it
      // to the charge date would miss expandCalendarItems' {templateId, date}
      // suppression and the bill would come back as unpaid.
      date: '2026-07-18',
      createdBy: 'user-1',
    });

    // The TEMPLATE is only ever touched to learn the alias — its `amount` must
    // survive so next month still budgets $142.
    const templateUpdates = capturedUpdates.filter(u => u.ref.__path === calPath('tmpl-1'));
    expect(templateUpdates).toHaveLength(1);
    expect(templateUpdates[0]?.data).toEqual({ bankDescriptorAliases: { __arrayUnion: ['Cpenergy Mngco'] } });
    expect(templateUpdates[0]?.data).not.toHaveProperty('amount');
    expect(templateUpdates[0]?.data).not.toHaveProperty('isPaid');

    // The transaction points at the NEW paid-instance doc (a real Firestore id),
    // never at the synthetic `..._instance_...` id.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txPath('tx-scan'));
    expect(txUpdate?.data?.paidCalendarItemId).toBe('__autoId');
  });

  it('refuses a DOUBLE merge — an already-paid occurrence writes nothing', async () => {
    const template = oneOffBill({ id: 'tmpl-1', amount: 142, isRecurring: true, date: '2026-07-05' });
    const alreadyPaid = oneOffBill({
      id: 'paid-1', amount: 37.91, date: '2026-07-18', isPaid: true, parentRecurringId: 'tmpl-1',
    });
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx()], [template, alreadyPaid]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'tmpl-1_instance_2026-07-18');

    expect(result).toBe(false);
    expect(commitCount).toBe(0);
    expect(capturedUpdates).toHaveLength(0);
    expect(capturedSets).toHaveLength(0);
  });

  it('refuses a transaction that already settled a bill (idempotence guard)', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx({ paidCalendarItemId: 'some-paid-doc' })], [oneOffBill()]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'bill-1');

    expect(result).toBe(false);
    expect(commitCount).toBe(0);
  });

  it('refuses a $0 needsAmount stub (nothing was actually charged)', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx({ amount: 0, needsAmount: true })], [oneOffBill()]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'bill-1');

    expect(result).toBe(false);
    expect(commitCount).toBe(0);
  });

  it('routes the delta to a CONFIRMED account, raising the debt when it is a credit card', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx()], [oneOffBill({ amount: 142 })]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'bill-1', 'acc-card');

    expect(result).toBe(true);
    // Credit balances are debt stored positive: a charge RAISES it.
    const cardUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-card'));
    expect(cardUpdate?.data?.balance).toEqual({ __increment: 37.91 });
    // ...and checking is untouched.
    expect(capturedUpdates.find(u => u.ref.__path === accountPath('acc-check'))).toBeUndefined();
    // The confirmed account is persisted onto the row.
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txPath('tx-scan'));
    expect(txUpdate?.data?.accountId).toBe('acc-card');
  });

  it('no-ops for an INCOME calendar item, an INCOME transaction, and a missing transaction', async () => {
    const income = oneOffBill({ id: 'inc-1', type: 'income' });
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx(), scannedTx({ id: 'tx-pay', category: 'Income' })], [income, oneOffBill()]),
    );
    expect(await settleBillWithTransaction('tx-scan', 'inc-1')).toBe(false);
    // A credit can't pay an expense — filing it would flip its balance sign.
    expect(await settleBillWithTransaction('tx-pay', 'bill-1')).toBe(false);
    expect(await settleBillWithTransaction('nope', 'inc-1')).toBe(false);
    expect(commitCount).toBe(0);
  });
});
