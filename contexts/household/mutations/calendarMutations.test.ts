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
        const ref: { __path: string; withConverter: () => typeof ref } = {
          __path: `${firstRef.__path}/__autoId`,
          withConverter: () => ref,
        };
        return ref;
      }
      return { __path: id ? `${path}/${id}` : (path ?? '__autoId') };
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

import { makeLinkBankTransactionToBill } from './calendarMutations';
import type { CalendarItem, Transaction } from '@/types/schema';

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
