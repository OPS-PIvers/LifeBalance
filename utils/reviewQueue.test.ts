import { describe, it, expect } from 'vitest';
import { buildReviewQueueSnapshot } from '@/utils/reviewQueue';
import type { Household, ShoppingItem, ToDo, Transaction } from '@/types/schema';

const tx = (id: string): Transaction => ({
  id,
  amount: 25,
  merchant: `Merchant ${id}`,
  category: 'Groceries',
  date: '2026-06-27',
  status: 'pending_review',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
});

const todo = (id: string): ToDo => ({
  id,
  text: `Task ${id}`,
  completeByDate: '2026-07-01',
  assignedTo: 'u1',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-06-27T00:00:00.000Z',
  needsReview: true,
});

const shopping = (id: string): ShoppingItem => ({
  id,
  name: `Item ${id}`,
  category: 'Produce',
  isPurchased: false,
  needsReview: true,
});

const settings = (expense: 'auto' | 'review' | undefined): Pick<Household, 'captureReview'> =>
  expense === undefined ? {} : { captureReview: { expense } };

describe('buildReviewQueueSnapshot', () => {
  it('includes transactions when expense mode is the default (review)', () => {
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [tx('t1')],
      todosAwaitingReview: [],
      shoppingAwaitingReview: [],
      householdSettings: settings(undefined), // no override → expense defaults to 'review'
    });
    expect(result).toEqual([{ kind: 'transaction', id: 't1', transaction: tx('t1') }]);
  });

  it('includes transactions when expense mode is explicitly review', () => {
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [tx('t1'), tx('t2')],
      todosAwaitingReview: [],
      shoppingAwaitingReview: [],
      householdSettings: settings('review'),
    });
    expect(result.map((i) => i.id)).toEqual(['t1', 't2']);
    expect(result.every((i) => i.kind === 'transaction')).toBe(true);
  });

  it('EXCLUDES transactions when expense mode is auto, but still opens for a held to-do', () => {
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [tx('t1'), tx('t2')],
      todosAwaitingReview: [todo('d1')],
      shoppingAwaitingReview: [],
      householdSettings: settings('auto'),
    });
    // No transactions surfaced, but the held to-do still produces a queue item.
    expect(result).toEqual([{ kind: 'todo', id: 'd1', item: todo('d1') }]);
  });

  it('gates transaction inclusion independently of held to-dos/shopping presence', () => {
    // expense auto + held todo + held shopping → todo & shopping only, no tx.
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [tx('t1')],
      todosAwaitingReview: [todo('d1')],
      shoppingAwaitingReview: [shopping('s1')],
      householdSettings: settings('auto'),
    });
    expect(result.map((i) => `${i.kind}:${i.id}`)).toEqual(['todo:d1', 'shopping:s1']);
  });

  it('orders the combined queue transactions → todos → shopping', () => {
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [tx('t1'), tx('t2')],
      todosAwaitingReview: [todo('d1')],
      shoppingAwaitingReview: [shopping('s1'), shopping('s2')],
      householdSettings: settings('review'),
    });
    expect(result.map((i) => `${i.kind}:${i.id}`)).toEqual([
      'transaction:t1',
      'transaction:t2',
      'todo:d1',
      'shopping:s1',
      'shopping:s2',
    ]);
  });

  it('returns an empty array when nothing is held for review', () => {
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [],
      todosAwaitingReview: [],
      shoppingAwaitingReview: [],
      householdSettings: settings('review'),
    });
    expect(result).toEqual([]);
  });

  it('tolerates null household settings (cold load) — expense defaults to review', () => {
    const result = buildReviewQueueSnapshot({
      pendingReviewTransactions: [tx('t1')],
      todosAwaitingReview: [],
      shoppingAwaitingReview: [],
      householdSettings: null,
    });
    expect(result.map((i) => i.id)).toEqual(['t1']);
  });
});
