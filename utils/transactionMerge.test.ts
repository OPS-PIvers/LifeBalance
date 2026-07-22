import { describe, it, expect } from 'vitest';
import { pickKeeper, mergeTransactions } from '@/utils/transactionMerge';
import type { Transaction } from '@/types/schema';

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx1',
  amount: 42.5,
  merchant: 'Amatista Cookhouse',
  category: 'Dining',
  date: '2026-06-27',
  status: 'pending_review',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  ...overrides,
});

describe('pickKeeper', () => {
  it('prefers a verified row over a pending one, regardless of order', () => {
    const verified = tx({ id: 'v', status: 'verified' });
    const pending = tx({ id: 'p', status: 'pending_review' });
    expect(pickKeeper(verified, pending)).toEqual({ keeper: verified, dupe: pending });
    expect(pickKeeper(pending, verified)).toEqual({ keeper: verified, dupe: pending });
  });

  it('prefers the richer row (accountId + store) when statuses tie', () => {
    const rich = tx({ id: 'rich', accountId: 'acct1', store: 'Trader Joes #12' });
    const plain = tx({ id: 'plain' });
    expect(pickKeeper(rich, plain)).toEqual({ keeper: rich, dupe: plain });
    expect(pickKeeper(plain, rich)).toEqual({ keeper: rich, dupe: plain });
  });

  it('prefers the earlier-created row when status and richness tie', () => {
    const earlier = tx({ id: 'earlier', createdAt: '2026-06-27T10:00:00.000Z' });
    const later = tx({ id: 'later', createdAt: '2026-06-27T12:00:00.000Z' });
    expect(pickKeeper(earlier, later)).toEqual({ keeper: earlier, dupe: later });
    expect(pickKeeper(later, earlier)).toEqual({ keeper: earlier, dupe: later });
  });

  it('falls back to keeping the first argument when fully tied', () => {
    const a = tx({ id: 'a' });
    const b = tx({ id: 'b' });
    expect(pickKeeper(a, b)).toEqual({ keeper: a, dupe: b });
  });

  it('richness beats createdAt ordering', () => {
    const richButLater = tx({ id: 'rich', accountId: 'acct1', createdAt: '2026-06-27T12:00:00.000Z' });
    const plainButEarlier = tx({ id: 'plain', createdAt: '2026-06-27T10:00:00.000Z' });
    expect(pickKeeper(richButLater, plainButEarlier)).toEqual({ keeper: richButLater, dupe: plainButEarlier });
  });
});

describe('mergeTransactions', () => {
  it('returns an empty patch when the keeper already has everything', () => {
    const keeper = tx({
      plaidTransactionId: 'p1',
      payPeriodId: '2026-06-15',
      store: 'Trader Joes',
      accountId: 'acct1',
      notes: 'note',
      relatedHabitIds: ['h1'],
    });
    const dupe = tx({ id: 'dupe' });
    expect(mergeTransactions(keeper, dupe)).toEqual({});
  });

  it('inherits plaidTransactionId from the dupe when the keeper lacks one', () => {
    const keeper = tx();
    const dupe = tx({ id: 'dupe', plaidTransactionId: 'p1' });
    expect(mergeTransactions(keeper, dupe)).toEqual({ plaidTransactionId: 'p1' });
  });

  it('inherits payPeriodId, store, accountId, and notes from the dupe when the keeper lacks them', () => {
    const keeper = tx();
    const dupe = tx({
      id: 'dupe',
      payPeriodId: '2026-06-15',
      store: 'Trader Joes',
      accountId: 'acct1',
      notes: 'from dupe',
    });
    expect(mergeTransactions(keeper, dupe)).toEqual({
      payPeriodId: '2026-06-15',
      store: 'Trader Joes',
      accountId: 'acct1',
      notes: 'from dupe',
    });
  });

  it('never overwrites a keeper field that already has a value', () => {
    const keeper = tx({ store: 'Keeper Store', accountId: 'keeperAcct' });
    const dupe = tx({ id: 'dupe', store: 'Dupe Store', accountId: 'dupeAcct' });
    const updates = mergeTransactions(keeper, dupe);
    expect(updates.store).toBeUndefined();
    expect(updates.accountId).toBeUndefined();
  });

  it('unions relatedHabitIds from both rows, deduped', () => {
    const keeper = tx({ relatedHabitIds: ['h1', 'h2'] });
    const dupe = tx({ id: 'dupe', relatedHabitIds: ['h2', 'h3'] });
    expect(mergeTransactions(keeper, dupe).relatedHabitIds).toEqual(['h1', 'h2', 'h3']);
  });

  it('omits relatedHabitIds when the dupe adds nothing new', () => {
    const keeper = tx({ relatedHabitIds: ['h1'] });
    const dupe = tx({ id: 'dupe', relatedHabitIds: ['h1'] });
    expect(mergeTransactions(keeper, dupe).relatedHabitIds).toBeUndefined();
  });

  it('adopts the dupe habit list when the keeper has none', () => {
    const keeper = tx();
    const dupe = tx({ id: 'dupe', relatedHabitIds: ['h1'] });
    expect(mergeTransactions(keeper, dupe).relatedHabitIds).toEqual(['h1']);
  });

  // PR #1072: the fired-habit LEDGER must survive the merge, or the merged row
  // could later re-fire a habit the dupe had already fired.
  it('unions firedHabitIds from both rows, deduped', () => {
    const keeper = tx({ firedHabitIds: ['h1'] });
    const dupe = tx({ id: 'dupe', firedHabitIds: ['h1', 'h2'] });
    expect(mergeTransactions(keeper, dupe).firedHabitIds).toEqual(['h1', 'h2']);
  });

  it('adopts the dupe fired ledger when the keeper has none', () => {
    const keeper = tx();
    const dupe = tx({ id: 'dupe', firedHabitIds: ['h1'] });
    expect(mergeTransactions(keeper, dupe).firedHabitIds).toEqual(['h1']);
  });

  it('omits firedHabitIds when the dupe adds nothing new', () => {
    const keeper = tx({ firedHabitIds: ['h1'] });
    const dupe = tx({ id: 'dupe', firedHabitIds: ['h1'] });
    expect(mergeTransactions(keeper, dupe).firedHabitIds).toBeUndefined();
  });

  it('inherits bankRef + bank-sync home from a bank-sync dupe so the merged row stays exempt', () => {
    const keeper = tx({ store: 'Cub Foods' }); // richer, but not bank-sync, no accountId
    const dupe = tx({ id: 'dupe', bankRef: 'P0000123', accountId: 'acc-check' });
    const patch = mergeTransactions(keeper, dupe);
    expect(patch.bankRef).toBe('P0000123');
    expect(patch.bankSyncAccountId).toBe('acc-check');
    expect(patch.accountId).toBe('acc-check');
  });

  it('prefers the dupe\'s persisted bankSyncAccountId over its current (re-tagged) accountId', () => {
    const keeper = tx();
    const dupe = tx({ id: 'dupe', bankRef: 'P0000123', accountId: 'acc-save', bankSyncAccountId: 'acc-check' });
    const patch = mergeTransactions(keeper, dupe);
    expect(patch.bankSyncAccountId).toBe('acc-check');
  });

  it('never overwrites the keeper\'s own bankRef or home stamp', () => {
    const keeper = tx({ bankRef: 'K111', bankSyncAccountId: 'acc-a' });
    const dupe = tx({ id: 'dupe', bankRef: 'D222', bankSyncAccountId: 'acc-b' });
    const patch = mergeTransactions(keeper, dupe);
    expect(patch.bankRef).toBeUndefined();
    expect(patch.bankSyncAccountId).toBeUndefined();
  });

  it('never includes possibleDuplicateOf in the pure patch (Firestore rejects undefined; caller clears via deleteField())', () => {
    const keeper = tx();
    const dupe = tx({ id: 'dupe' });
    expect('possibleDuplicateOf' in mergeTransactions(keeper, dupe)).toBe(false);
  });
});
