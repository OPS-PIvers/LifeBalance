import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Firestore mock (mirrors transactionMutations.test.ts) -----------------
interface CapturedWrite {
  ref: { __path: string };
  data?: Record<string, unknown>;
}

let capturedSets: CapturedWrite[] = [];
let capturedUpdates: CapturedWrite[] = [];
let capturedDeletes: { __path: string }[] = [];
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
    arrayRemove: (...vals: unknown[]) => ({ __arrayRemove: vals }),
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
      delete: (ref: { __path: string }) => {
        capturedDeletes.push(ref);
      },
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

import { addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import {
  makeAcknowledgeBillPriceChange,
  makeForgetBillDescriptorAlias,
  makeLinkBankTransactionToBill,
  makePayCalendarItem,
  makeSettleBillWithTransaction,
  makeAddCalendarItem,
  makeUpdateCalendarItem,
  makeSetOccurrenceAmount,
  makeCalendarDeleteMutations,
  makeEditCalendarEntry,
} from './calendarMutations';
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

  it("refuses a recurring TEMPLATE's real doc id — settling it would rewrite the whole series' amount", async () => {
    const template = oneOffBill({ id: 'tmpl-1', amount: 142, isRecurring: true, date: '2026-07-05' });
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx()], [template]),
    );
    // The plain doc id (NOT a synthetic occurrence id) takes the one-off branch,
    // where `isPaid: true` + the scanned amount would land on the TEMPLATE.
    const result = await settleBillWithTransaction('tx-scan', 'tmpl-1');

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

  // The review form's amount field is LIVE state the stored row has not seen. A
  // user who corrects a mis-OCR'd 379.10 to 37.91 and then taps settle must
  // settle at 37.91 — the stale figure would mark the bill paid at, and debit,
  // ten times the real charge.
  it('settles at the CALLER-SUPPLIED amount and co-commits it onto the transaction', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx({ amount: 379.1, accountId: 'acc-check' })], [oneOffBill({ amount: 142 })]),
    );
    const result = await settleBillWithTransaction('tx-scan', 'bill-1', undefined, 37.91);

    expect(result).toBe(true);
    // The bill records the CORRECTED amount...
    const billUpdate = capturedUpdates.find(u => u.ref.__path === calPath('bill-1'));
    expect(billUpdate?.data).toMatchObject({ isPaid: true, amount: 37.91 });
    // ...the row is re-priced to match in the SAME batch...
    const txUpdate = capturedUpdates.find(u => u.ref.__path === txPath('tx-scan'));
    expect(txUpdate?.data?.amount).toBe(37.91);
    // ...and the balance moves by the corrected figure, not the stale 379.10.
    const accUpdate = capturedUpdates.find(u => u.ref.__path === accountPath('acc-check'));
    expect(accUpdate?.data?.balance).toEqual({ __increment: -37.91 });
    expect(commitCount).toBe(1);
  });

  it('leaves the stored amount alone when no override is passed', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx()], [oneOffBill({ amount: 142 })]),
    );
    await settleBillWithTransaction('tx-scan', 'bill-1');

    const txUpdate = capturedUpdates.find(u => u.ref.__path === txPath('tx-scan'));
    expect(txUpdate?.data).not.toHaveProperty('amount');
  });

  it('refuses a non-positive override even when the stored amount is fine', async () => {
    const { settleBillWithTransaction } = makeSettleBillWithTransaction(
      settleDeps([scannedTx()], [oneOffBill()]),
    );
    expect(await settleBillWithTransaction('tx-scan', 'bill-1', undefined, 0)).toBe(false);
    expect(await settleBillWithTransaction('tx-scan', 'bill-1', undefined, Number.NaN)).toBe(false);
    expect(commitCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// payCalendarItem stamps `paidCalendarItemId` on the transaction it creates, so
// a bill payment is recognisable AS one: without it a $1,200 Rent payment stayed
// an eligible candidate in the calendar-side settle picker and could be used to
// mark an unrelated $95 storage bill paid at $1,200.
// ---------------------------------------------------------------------------
describe('makePayCalendarItem — paidCalendarItemId stamp', () => {
  const payDeps = (calendarItems: CalendarItem[]) => ({
    db,
    householdId: HOUSEHOLD_ID,
    user: USER,
    actorName: 'Paul',
    accounts,
    calendarItems,
    householdSettings: null,
    handlePaycheckApproval: vi.fn(async () => {}),
  });

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    commitCount = 0;
    vi.clearAllMocks();
  });

  it('stamps the ONE-OFF bill’s own doc id onto the transaction it creates', async () => {
    const { payCalendarItem } = makePayCalendarItem(payDeps([oneOffBill()]));
    await payCalendarItem('bill-1', 'acc-check');

    const txSet = capturedSets.find(s => s.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/transactions`));
    expect(txSet?.data?.paidCalendarItemId).toBe('bill-1');
  });

  it('stamps the NEW paid-instance doc id for a recurring occurrence', async () => {
    const template = oneOffBill({ id: 'tmpl-1', isRecurring: true, frequency: 'monthly' });
    const { payCalendarItem } = makePayCalendarItem(payDeps([template]));
    await payCalendarItem('tmpl-1_instance_2026-07-18', 'acc-check');

    // The mocked auto-id ref resolves to `__autoId` (see the doc() mock above).
    const txSet = capturedSets.find(s => s.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/transactions`));
    expect(txSet?.data?.paidCalendarItemId).toBe('__autoId');
  });

  it('does NOT stamp an income (paycheck) approval — the field, its guards and their copy are about bills', async () => {
    const paycheck = oneOffBill({ id: 'inc-1', type: 'income', title: 'Paycheck' });
    const { payCalendarItem } = makePayCalendarItem(payDeps([paycheck]));
    await payCalendarItem('inc-1', 'acc-check');

    const txSet = capturedSets.find(s => s.ref.__path.startsWith(`households/${HOUSEHOLD_ID}/transactions`));
    expect(txSet?.data).not.toHaveProperty('paidCalendarItemId');
  });
});

// ---------------------------------------------------------------------------
// forgetBillDescriptorAlias — the retract half of alias learning. A wrong alias
// makes the nightly sync auto-mark this bill paid off an unrelated charge every
// period; these pin the ONE write that undoes it.
// ---------------------------------------------------------------------------
describe('makeForgetBillDescriptorAlias', () => {
  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    commitCount = 0;
    vi.clearAllMocks();
  });

  it('removes the EXACT stored descriptor with arrayRemove, and touches nothing else', async () => {
    const { forgetBillDescriptorAlias } = makeForgetBillDescriptorAlias({
      db,
      householdId: HOUSEHOLD_ID,
    });
    await forgetBillDescriptorAlias('bill-1', 'CPENERGY MNGCO 4471');

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = vi.mocked(updateDoc).mock.calls[0] as unknown as [
      { __path: string },
      Record<string, unknown>,
    ];
    expect(ref.__path).toBe(calPath('bill-1'));
    // Exactly one field, and it is the arrayRemove sentinel — a whole-array
    // write here would drop an alias the nightly sync learned concurrently.
    expect(payload).toEqual({
      bankDescriptorAliases: { __arrayRemove: ['CPENERGY MNGCO 4471'] },
    });
    // Nothing is batched: this is a standalone, immediate write.
    expect(commitCount).toBe(0);
  });

  it('passes the raw descriptor through UNNORMALIZED — arrayRemove matches by exact equality', async () => {
    const { forgetBillDescriptorAlias } = makeForgetBillDescriptorAlias({
      db,
      householdId: HOUSEHOLD_ID,
    });
    // Mixed case and doubled inner whitespace: `matchesAlias` would normalize
    // both away, but the STORED string is what has to be removed.
    await forgetBillDescriptorAlias('bill-1', 'Cpenergy  Mngco');

    const [, payload] = vi.mocked(updateDoc).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(payload).toEqual({ bankDescriptorAliases: { __arrayRemove: ['Cpenergy  Mngco'] } });
  });

  it('no-ops without a household — writes nothing', async () => {
    const { forgetBillDescriptorAlias } = makeForgetBillDescriptorAlias({ db, householdId: null });
    await forgetBillDescriptorAlias('bill-1', 'CPENERGY MNGCO');
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('rethrows so the caller can leave the row in place when the write fails', async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('permission-denied'));
    const { forgetBillDescriptorAlias } = makeForgetBillDescriptorAlias({
      db,
      householdId: HOUSEHOLD_ID,
    });
    await expect(forgetBillDescriptorAlias('bill-1', 'CPENERGY MNGCO')).rejects.toThrow();
  });
});

describe('makeAcknowledgeBillPriceChange', () => {
  beforeEach(() => {
    vi.mocked(updateDoc).mockClear();
  });

  it('clears only the price-change marker — no money field is written', async () => {
    const { acknowledgeBillPriceChange } = makeAcknowledgeBillPriceChange({ db, householdId: HOUSEHOLD_ID });
    await acknowledgeBillPriceChange('tx-1');

    const [ref, payload] = vi.mocked(updateDoc).mock.calls[0] as unknown as [
      { __path: string },
      Record<string, unknown>,
    ];
    expect(ref.__path).toBe(`households/${HOUSEHOLD_ID}/transactions/tx-1`);
    expect(payload).toEqual({ billPriceChange: { __deleteField: true } });
  });

  it('no-ops without a household', async () => {
    const { acknowledgeBillPriceChange } = makeAcknowledgeBillPriceChange({ db, householdId: null });
    await acknowledgeBillPriceChange('tx-1');
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

// updateDoc's second argument is typed as a union (field path | data); the
// mutation always passes a data object, so narrow to it for assertions.
function writtenUpdates(): Record<string, unknown> {
  const arg: unknown = vi.mocked(updateDoc).mock.calls[0]?.[1];
  if (typeof arg !== 'object' || arg === null) throw new Error('updateDoc was not called with data');
  return Object.fromEntries(Object.entries(arg));
}

describe('twice-a-month paychecks — schedule fields', () => {
  const paycheck: CalendarItem = {
    id: 'pay',
    title: 'Paycheck',
    amount: 2851.5,
    date: '2026-01-01',
    type: 'income',
    isPaid: false,
    isRecurring: true,
    frequency: 'semi-monthly',
    semiMonthlyDays: [1, 16],
    weekendShift: 'before',
    earnerId: 'jen',
  };

  beforeEach(() => {
    vi.mocked(updateDoc).mockReset();
    vi.mocked(addDoc).mockReset();
  });

  it('stores the day pair on create (derived from the date when missing) and never the expansion-only nominalDate', async () => {
    const { addCalendarItem } = makeAddCalendarItem({ db, householdId: HOUSEHOLD_ID, user: { uid: 'paul' } });
    await addCalendarItem({ ...paycheck, semiMonthlyDays: undefined, date: '2026-10-15', nominalDate: '2026-10-15' });
    const written: unknown = vi.mocked(addDoc).mock.calls[0]?.[1];
    expect(written).toMatchObject({ semiMonthlyDays: [15, 30] });
    expect(written).not.toHaveProperty('nominalDate');
    expect(written).not.toHaveProperty('id');
  });

  it('writes the schedule and earner, keeping the day pair when the anchor rolls forward', async () => {
    const existing = { ...paycheck, weekendShift: undefined };
    const { updateCalendarItem } = makeUpdateCalendarItem({ db, householdId: HOUSEHOLD_ID, calendarItems: [existing] });
    await updateCalendarItem(paycheck, { silent: true });
    const updates = writtenUpdates();
    expect(updates.semiMonthlyDays).toEqual([1, 16]);
    expect(updates.weekendShift).toBe('before');
    expect(updates.earnerId).toBe('jen');
    // The weekend rule changed, so the anchor rolled to an upcoming nominal 1st or 16th.
    expect(String(updates.date)).toMatch(/-(01|16)$/);
    expect(String(updates.date) > '2026-01-01').toBe(true);
  });

  it('clears the schedule fields when a bill stops repeating, and the earner on an expense', async () => {
    const { updateCalendarItem } = makeUpdateCalendarItem({ db, householdId: HOUSEHOLD_ID, calendarItems: [paycheck] });
    await updateCalendarItem({ ...paycheck, type: 'expense', isRecurring: false, frequency: undefined }, { silent: true });
    const updates = writtenUpdates();
    expect(updates.semiMonthlyDays).toEqual({ __deleteField: true });
    expect(updates.weekendShift).toEqual({ __deleteField: true });
    expect(updates.earnerId).toEqual({ __deleteField: true });
  });
});

describe('one-month amount changes', () => {
  const xcel: CalendarItem = {
    id: 'xcel',
    title: 'Xcel',
    amount: 120,
    date: '2026-01-28',
    type: 'expense',
    isPaid: false,
    isRecurring: true,
    frequency: 'monthly',
  };
  const override: CalendarItem = {
    id: 'ovr',
    title: 'Xcel',
    amount: 98.68,
    date: '2026-10-28',
    type: 'expense',
    isPaid: false,
    isRecurring: false,
    isOverride: true,
    parentRecurringId: 'xcel',
  };
  const user = { uid: 'paul' };

  beforeEach(() => {
    vi.mocked(updateDoc).mockReset();
    vi.mocked(addDoc).mockReset();
    vi.mocked(deleteDoc).mockReset();
  });

  it('"Just this month" writes an override for that one date', async () => {
    const { setOccurrenceAmount } = makeSetOccurrenceAmount({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [xcel] });
    await setOccurrenceAmount('xcel_instance_2026-10-28', 98.684, { silent: true });
    expect(vi.mocked(addDoc).mock.calls[0]?.[1]).toMatchObject({
      amount: 98.68,
      date: '2026-10-28',
      isOverride: true,
      isPaid: false,
      parentRecurringId: 'xcel',
    });
  });

  it('changes an existing override, and removes it when set back to the series amount', async () => {
    const { setOccurrenceAmount } = makeSetOccurrenceAmount({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [xcel, override] });
    await setOccurrenceAmount('xcel_instance_2026-10-28', 110, { silent: true });
    expect(writtenUpdates()).toEqual({ amount: 110 });
    await setOccurrenceAmount('xcel_instance_2026-10-28', 120, { silent: true });
    expect(vi.mocked(deleteDoc)).toHaveBeenCalledTimes(1);
    expect(addDoc).not.toHaveBeenCalled();
  });

  it('"This and future months" keeps what earlier months cost', async () => {
    const { updateCalendarItem } = makeUpdateCalendarItem({ db, householdId: HOUSEHOLD_ID, calendarItems: [xcel] });
    await updateCalendarItem({ ...xcel, amount: 135 }, { silent: true, amountFrom: '2026-11-28' });
    const updates = writtenUpdates();
    expect(updates.amount).toBe(135);
    expect(updates.earlierAmounts).toEqual([{ before: '2026-11-28', amount: 120 }]);
  });

  it('"This and future months" on a month with an override also deletes that override, in one batch', async () => {
    capturedUpdates = [];
    capturedDeletes = [];
    const commitsBefore = commitCount;
    const { updateCalendarItem } = makeUpdateCalendarItem({ db, householdId: HOUSEHOLD_ID, calendarItems: [xcel, override] });
    await updateCalendarItem({ ...xcel, amount: 135 }, { silent: true, amountFrom: '2026-10-28' });
    expect(commitCount - commitsBefore).toBe(1);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe(`households/${HOUSEHOLD_ID}/calendarItems/xcel`);
    expect(capturedUpdates[0]?.data).toMatchObject({ amount: 135, earlierAmounts: [{ before: '2026-10-28', amount: 120 }] });
    expect(capturedDeletes.map(r => r.__path)).toEqual([`households/${HOUSEHOLD_ID}/calendarItems/ovr`]);
  });

  it('keepOverride leaves the override for a move to turn into the tombstone', async () => {
    capturedDeletes = [];
    const commitsBefore = commitCount;
    const { updateCalendarItem } = makeUpdateCalendarItem({ db, householdId: HOUSEHOLD_ID, calendarItems: [xcel, override] });
    await updateCalendarItem({ ...xcel, amount: 135 }, { silent: true, amountFrom: '2026-10-28', keepOverride: true });
    expect(commitCount).toBe(commitsBefore);
    expect(capturedDeletes).toEqual([]);
    expect(writtenUpdates().amount).toBe(135);
  });

  it('an override on a different month is left alone', async () => {
    capturedDeletes = [];
    const commitsBefore = commitCount;
    const { updateCalendarItem } = makeUpdateCalendarItem({ db, householdId: HOUSEHOLD_ID, calendarItems: [xcel, override] });
    await updateCalendarItem({ ...xcel, amount: 135 }, { silent: true, amountFrom: '2026-09-28' });
    expect(commitCount).toBe(commitsBefore);
    expect(capturedDeletes).toEqual([]);
    expect(writtenUpdates().amount).toBe(135);
  });

  it('deleting an occurrence with an override turns the override into the tombstone', async () => {
    const { deleteRecurringInstance } = makeCalendarDeleteMutations({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [xcel, override] });
    await deleteRecurringInstance('xcel_instance_2026-10-28', { silent: true });
    expect(writtenUpdates()).toEqual({ isDeleted: true });
    expect(addDoc).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});

describe('makeEditCalendarEntry', () => {
  const xcel: CalendarItem = {
    id: 'xcel', title: 'Xcel', amount: 120, date: '2026-01-28', type: 'expense', isPaid: false,
    isRecurring: true, frequency: 'monthly',
  };
  const paidPaycheck: CalendarItem = {
    id: 'paid-pay', title: 'Paycheck', amount: 5703, date: '2026-10-14', type: 'income', isPaid: true,
    isRecurring: false, parentRecurringId: 'pay',
  };
  const user = { uid: 'paul' };

  beforeEach(() => {
    capturedSets = [];
    capturedUpdates = [];
    commitCount = 0;
    vi.mocked(updateDoc).mockReset();
  });

  it("moves one occurrence in one batch: hides it and lands a one-off on the new date", async () => {
    const { editCalendarEntry } = makeEditCalendarEntry({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [xcel] });
    await editCalendarEntry('xcel_instance_2026-10-28', { date: '2026-10-30' });
    expect(capturedSets.map(w => w.data)).toEqual([
      expect.objectContaining({ isDeleted: true, parentRecurringId: 'xcel', date: '2026-10-28' }),
      expect.objectContaining({ title: 'Xcel', amount: 120, date: '2026-10-30', isRecurring: false, isPaid: false }),
    ]);
    expect(commitCount).toBe(1);
  });

  it('renames the series from any occurrence', async () => {
    const { editCalendarEntry } = makeEditCalendarEntry({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [xcel] });
    await editCalendarEntry('xcel_instance_2026-10-28', { title: 'Xcel Energy' });
    expect(capturedUpdates).toEqual([{ ref: expect.objectContaining({ __path: `households/${HOUSEHOLD_ID}/calendarItems/xcel` }), data: { title: 'Xcel Energy' } }]);
    expect(capturedSets).toEqual([]);
  });

  it('writes a one-off bill\'s new name, date and amount in one update', async () => {
    const water: CalendarItem = { id: 'water', title: 'Water', amount: 36.56, date: '2026-10-01', type: 'expense', isPaid: false };
    const { editCalendarEntry } = makeEditCalendarEntry({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [water] });
    await editCalendarEntry('water', { title: 'City water', date: '2026-10-03', amount: 40 });
    expect(writtenUpdates()).toEqual({ title: 'City water', date: '2026-10-03', amount: 40 });
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('moves an occurrence at a new amount without touching the series', async () => {
    const { editCalendarEntry } = makeEditCalendarEntry({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [xcel] });
    await editCalendarEntry('xcel_instance_2026-10-28', { date: '2026-10-30', amount: 131.2 });
    expect(capturedSets.map(w => w.data)).toEqual([
      expect.objectContaining({ isDeleted: true, amount: 120, date: '2026-10-28' }),
      expect.objectContaining({ amount: 131.2, date: '2026-10-30', isRecurring: false }),
    ]);
    expect(capturedUpdates).toEqual([]);
  });

  it("re-dates a paid row in place, but never into the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    const { editCalendarEntry } = makeEditCalendarEntry({ db, householdId: HOUSEHOLD_ID, user, calendarItems: [paidPaycheck] });
    await editCalendarEntry('paid-pay', { date: '2026-10-01' });
    expect(writtenUpdates()).toEqual({ date: '2026-10-01' });
    vi.mocked(updateDoc).mockReset();
    await editCalendarEntry('paid-pay', { date: '2026-10-16' });
    expect(updateDoc).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
