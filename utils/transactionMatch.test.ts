import { describe, it, expect } from 'vitest';

import type { ReceiptData } from '@/services/geminiService.types';
import type { Transaction } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { findMatchingPendingTransaction, buildReceiptMergeUpdates } from './transactionMatch';

// Minimal Transaction factory — only fields the matcher reads, plus required
// schema fields, with sensible defaults overridable per-test.
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  amount: 1234,
  merchant: "Trader Joe's",
  category: 'Groceries',
  date: '2026-06-27',
  status: 'pending_review',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  ...over,
});

const receipt = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  merchant: "Trader Joe's",
  amount: 1234,
  category: 'Groceries',
  date: '2026-06-27',
  ...over,
});

describe('findMatchingPendingTransaction', () => {
  it('matches a same-store pending transaction within the date window', () => {
    const t = tx({ id: 'match', date: '2026-06-25' }); // 2 days off, default window 3
    expect(findMatchingPendingTransaction(receipt(), [t])?.id).toBe('match');
  });

  it('matches store/merchant case- and punctuation-insensitively', () => {
    const t = tx({ id: 'match', merchant: 'trader joes' });
    expect(findMatchingPendingTransaction(receipt({ merchant: "Trader Joe's" }), [t])?.id).toBe('match');
  });

  it('excludes a transaction outside the date window', () => {
    const t = tx({ date: '2026-06-20' }); // 7 days off > default 3
    expect(findMatchingPendingTransaction(receipt({ date: '2026-06-27' }), [t])).toBeUndefined();
  });

  it('honors a custom windowDays', () => {
    const t = tx({ id: 'match', date: '2026-06-20' }); // 7 days off
    expect(
      findMatchingPendingTransaction(receipt({ date: '2026-06-27' }), [t], { windowDays: 10 })?.id,
    ).toBe('match');
  });

  it('excludes a different store even inside the window', () => {
    const t = tx({ merchant: 'Costco' });
    expect(findMatchingPendingTransaction(receipt({ merchant: "Trader Joe's" }), [t])).toBeUndefined();
  });

  it('excludes verified transactions', () => {
    const t = tx({ status: 'verified' });
    expect(findMatchingPendingTransaction(receipt(), [t])).toBeUndefined();
  });

  it('matches an Apple Pay $0 needsAmount stub by store+date despite amount mismatch', () => {
    const stub = tx({ id: 'stub', amount: 0, needsAmount: true });
    expect(findMatchingPendingTransaction(receipt({ amount: 5240 }), [stub])?.id).toBe('stub');
  });

  it('prefers a needsAmount stub over a regular pending transaction', () => {
    const regular = tx({ id: 'regular', needsAmount: false, date: '2026-06-27' });
    const stub = tx({ id: 'stub', needsAmount: true, date: '2026-06-26' }); // 1 day off but stub
    expect(findMatchingPendingTransaction(receipt({ date: '2026-06-27' }), [regular, stub])?.id).toBe('stub');
  });

  it('falls back to closest date when neither is a stub', () => {
    const far = tx({ id: 'far', date: '2026-06-24' }); // 3 days
    const near = tx({ id: 'near', date: '2026-06-26' }); // 1 day
    expect(findMatchingPendingTransaction(receipt({ date: '2026-06-27' }), [far, near])?.id).toBe('near');
  });

  it('uses opts.today when the receipt has no date', () => {
    const t = tx({ id: 'match', date: '2026-06-10' });
    expect(
      findMatchingPendingTransaction(receipt({ date: undefined }), [t], { today: '2026-06-11' })?.id,
    ).toBe('match');
  });

  it('uses real local today when the receipt has no date and no opts.today', () => {
    const today = getLocalDateString();
    const t = tx({ id: 'match', date: today });
    expect(findMatchingPendingTransaction(receipt({ date: undefined }), [t])?.id).toBe('match');
  });

  it('resolves store/merchant fallback on both sides (store preferred)', () => {
    const t = tx({ id: 'match', merchant: 'TJ #123', store: "Trader Joe's" });
    expect(
      findMatchingPendingTransaction(receipt({ merchant: 'Trader Joes', store: undefined }), [t])?.id,
    ).toBe('match');
  });

  it('returns undefined when there are no transactions', () => {
    expect(findMatchingPendingTransaction(receipt(), [])).toBeUndefined();
  });

  it('returns undefined when the receipt has no usable store/merchant', () => {
    expect(findMatchingPendingTransaction(receipt({ merchant: '', store: undefined }), [tx()])).toBeUndefined();
  });

  it('returns undefined for a malformed receipt date (no NaN slip-through)', () => {
    expect(findMatchingPendingTransaction(receipt({ date: 'not-a-date' }), [tx()])).toBeUndefined();
  });

  it('skips a candidate with a malformed date instead of matching it on NaN', () => {
    const bad = tx({ id: 'bad', date: 'garbage' });
    const good = tx({ id: 'good', date: '2026-06-27' });
    expect(findMatchingPendingTransaction(receipt({ date: '2026-06-27' }), [bad, good])?.id).toBe('good');
    expect(findMatchingPendingTransaction(receipt({ date: '2026-06-27' }), [bad])).toBeUndefined();
  });
});

describe('buildReceiptMergeUpdates', () => {
  const receiptTx = (over: Partial<Transaction> = {}): Transaction =>
    tx({ id: 'receipt', amount: 5240, merchant: 'Target', category: 'Shopping', date: '2026-06-27', store: 'Target', source: 'camera-scan', autoCategorized: true, relatedHabitIds: [], ...over });

  it('fills the amount and clears needsAmount when merging into a $0 Apple Pay stub', () => {
    const stub = tx({ id: 'stub', amount: 0, needsAmount: true });
    const updates = buildReceiptMergeUpdates(receiptTx(), stub);
    expect(updates.amount).toBe(5240);
    expect(updates.needsAmount).toBe(false);
    expect(updates.merchant).toBe('Target');
    expect(updates.store).toBe('Target');
    expect(updates.autoCategorized).toBe(true);
  });

  it('omits amount (delta-safe) when merging into an equal-amount pending row, and never sets needsAmount', () => {
    const equal = tx({ id: 'equal', amount: 5240, needsAmount: false });
    const updates = buildReceiptMergeUpdates(receiptTx({ amount: 5240 }), equal);
    expect('amount' in updates).toBe(false);
    expect('needsAmount' in updates).toBe(false);
    // still enriches the other fields
    expect(updates.category).toBe('Shopping');
  });

  it('sends the corrected amount (but not needsAmount) when a non-stub pending amount differs', () => {
    const different = tx({ id: 'diff', amount: 4800, needsAmount: false });
    const updates = buildReceiptMergeUpdates(receiptTx({ amount: 5240 }), different);
    expect(updates.amount).toBe(5240);
    expect('needsAmount' in updates).toBe(false);
  });

  it("preserves the candidate's existing store/subBucket/habits when the receipt lacks them (no wipe, no undefined)", () => {
    const candidate = tx({
      id: 'stub', amount: 0, needsAmount: true,
      store: 'Target', subBucketId: 'sb1', relatedHabitIds: ['h1'],
    });
    // receipt has none of those optional fields
    const updates = buildReceiptMergeUpdates(
      receiptTx({ store: undefined, subBucketId: undefined, relatedHabitIds: [] }),
      candidate,
    );
    expect(updates.store).toBe('Target');
    expect(updates.subBucketId).toBe('sb1');
    expect(updates.relatedHabitIds).toEqual(['h1']);
    // never writes undefined (Firestore rejects it)
    expect(Object.values(updates).every((v) => v !== undefined)).toBe(true);
  });

  it("uses the receipt's metadata when present (overrides candidate)", () => {
    const candidate = tx({ id: 'stub', amount: 0, needsAmount: true, store: 'Old', subBucketId: 'sbOld' });
    const updates = buildReceiptMergeUpdates(
      receiptTx({ store: 'Target', subBucketId: 'sbNew', relatedHabitIds: ['h2'] }),
      candidate,
    );
    expect(updates.store).toBe('Target');
    expect(updates.subBucketId).toBe('sbNew');
    expect(updates.relatedHabitIds).toEqual(['h2']);
  });
});
