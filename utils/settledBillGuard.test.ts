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
  it.each([
    ['amount', { amount: 12 }],
    ['status', { status: 'pending_review' as const }],
    ['category', { category: 'Groceries' }],
    ['accountId', { accountId: 'acc-card' }],
    ['creditPayment', { creditPayment: true }],
  ])('flags a %s edit', (_label, updates) => {
    expect(touchesSettledBillFields(updates)).toBe(true);
  });

  it('ignores metadata-only edits, which cannot diverge the two documents', () => {
    expect(touchesSettledBillFields({ notes: 'dog food' })).toBe(false);
    expect(touchesSettledBillFields({ merchant: 'Xfinity', date: '2026-07-23' })).toBe(false);
    expect(touchesSettledBillFields({})).toBe(false);
  });

  it('flags an explicit CLEAR of a money field, not just a truthy value', () => {
    // `accountId: undefined` is the "untag me" sentinel — `in` catches it where
    // a truthiness check would not.
    expect(touchesSettledBillFields({ accountId: undefined })).toBe(true);
  });
});
