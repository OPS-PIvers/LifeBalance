import { describe, it, expect } from 'vitest';

import { findSettledBill, settledBillRefusal, touchesSettledBillFields } from '@/utils/settledBillGuard';
import type { CalendarItem, Transaction } from '@/types/schema';

const bill = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  id: 'bill-1',
  title: 'Comcast Internet',
  amount: 150,
  date: '2026-07-18',
  type: 'expense',
  isPaid: true,
  ...over,
});

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  amount: 37.91,
  merchant: 'Cpenergy Mngco',
  category: 'Budgeted in Calendar',
  date: '2026-07-22',
  status: 'verified',
  isRecurring: false,
  source: 'image-capture',
  autoCategorized: false,
  ...over,
});

describe('findSettledBill', () => {
  it('returns nothing for a row that never settled a bill', () => {
    expect(findSettledBill(tx(), [bill()])).toBeUndefined();
  });

  it('returns the still-paid bill a row settled', () => {
    const found = findSettledBill(tx({ paidCalendarItemId: 'bill-1' }), [bill()]);
    expect(found?.id).toBe('bill-1');
  });

  it('returns nothing once the bill doc is gone — the reference dangles, so there is nothing left to orphan', () => {
    // Without this, undoing from the calendar (the ONLY undo) would leave the
    // transaction permanently un-deletable: a trap with no exit anywhere.
    expect(findSettledBill(tx({ paidCalendarItemId: 'bill-1' }), [])).toBeUndefined();
  });

  it('returns nothing when the bill is no longer paid, or is soft-deleted', () => {
    const settled = tx({ paidCalendarItemId: 'bill-1' });
    expect(findSettledBill(settled, [bill({ isPaid: false })])).toBeUndefined();
    expect(findSettledBill(settled, [bill({ isDeleted: true })])).toBeUndefined();
  });
});

describe('settledBillRefusal', () => {
  it('names both the blocked action and where to undo it', () => {
    const message = settledBillRefusal('delete', 'Comcast Internet');
    expect(message).toContain('delete');
    expect(message).toContain('Comcast Internet');
    expect(message).toContain('calendar');
  });

  it('falls back to a generic noun with no title', () => {
    expect(settledBillRefusal('merge away')).toContain('a bill');
  });
});

describe('touchesSettledBillFields', () => {
  // The row as stored: what every patch below is compared against.
  const stored = {
    amount: 153.95,
    status: 'verified' as const,
    category: 'Budgeted in Calendar',
    accountId: 'acc-checking',
  };

  it.each([
    ['amount', { amount: 12 }],
    ['status', { status: 'pending_review' as const }],
    ['category', { category: 'Groceries' }],
    ['accountId', { accountId: 'acc-card' }],
    ['creditPayment', { creditPayment: true }],
  ])('flags a %s edit', (_label, updates) => {
    expect(touchesSettledBillFields(updates, stored)).toBe(true);
  });

  it('ignores metadata-only edits, which cannot diverge the two documents', () => {
    expect(touchesSettledBillFields({ notes: 'dog food' }, stored)).toBe(false);
    expect(touchesSettledBillFields({ merchant: 'Xfinity', date: '2026-07-23' }, stored)).toBe(false);
    expect(touchesSettledBillFields({}, stored)).toBe(false);
  });

  it('flags an explicit CLEAR of a money field', () => {
    // `accountId: undefined` is the "untag me" sentinel, and the row IS tagged,
    // so this is a real change.
    expect(touchesSettledBillFields({ accountId: undefined }, stored)).toBe(true);
  });

  // REGRESSION — the shape the ONLY edit surface actually sends.
  // EditTransactionModal.handleSave always passes the whole form, so a
  // presence-only check refused a settled row for a pure notes edit and made it
  // permanently uneditable in the app.
  it('allows a notes-only edit sent as EditTransactionModal sends it — the FULL form', () => {
    expect(
      touchesSettledBillFields(
        {
          amount: 153.95,
          merchant: 'Comcast',
          notes: "autopay, don't reconcile",
          category: 'Budgeted in Calendar',
          accountId: 'acc-checking',
          creditPayment: undefined,
          date: '2026-07-23',
        },
        stored,
      ),
    ).toBe(false);
  });

  it('treats unchanged-but-differently-shaped values as unchanged', () => {
    // cent-equal amount, absent-vs-false creditPayment, ''-vs-undefined accountId
    expect(touchesSettledBillFields({ amount: 153.9500000001 }, stored)).toBe(false);
    expect(touchesSettledBillFields({ creditPayment: false }, stored)).toBe(false);
    expect(touchesSettledBillFields({ accountId: undefined }, { ...stored, accountId: '' })).toBe(false);
  });

  it('still flags a real change hidden inside a full-form payload', () => {
    expect(
      touchesSettledBillFields(
        { amount: 99.99, merchant: 'Comcast', category: 'Budgeted in Calendar', accountId: 'acc-checking' },
        stored,
      ),
    ).toBe(true);
  });
});
