import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { captureDeferUndo, findRecurringDeferArtifacts, type DeferUndoDescriptor } from './bulkDeferUndo';
import { generateRecurringId } from '@/utils/calendarRecurrence';
import type { CalendarItem } from '@/types/schema';
import type {
  ActionQueueItem,
  CalendarQueueItem,
  ToDoActionQueueItem,
  TransactionQueueItem,
} from '@/hooks/useActionQueue';

// Fixed "today" so nextDeferDate-derived expectations are deterministic.
const TODAY = parseISO('2026-07-10');

const makeTodoItem = (overrides: Partial<ToDoActionQueueItem> = {}): ToDoActionQueueItem => ({
  id: 'todo-1',
  queueType: 'todo',
  text: 'Call plumber',
  date: '2026-07-09',
  assignedTo: 'u1',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const makeTransactionItem = (
  overrides: Partial<TransactionQueueItem> = {}
): TransactionQueueItem => ({
  id: 'tx-1',
  queueType: 'transaction',
  amount: 12.34,
  merchant: 'Coffee Shop',
  category: '',
  date: '2026-07-10',
  status: 'pending_review',
  isRecurring: false,
  source: 'shortcut',
  autoCategorized: false,
  ...overrides,
});

const makeCalendarItem = (overrides: Partial<CalendarItem> = {}): CalendarItem => ({
  id: 'cal-1',
  title: 'Internet',
  amount: 80,
  date: '2026-07-10',
  type: 'expense',
  isPaid: false,
  ...overrides,
});

const asCalendarQueueItem = (item: CalendarItem): CalendarQueueItem => ({
  ...item,
  queueType: 'calendar',
});

describe('captureDeferUndo', () => {
  it('captures a to-do prior due date from the queue item date', () => {
    const undo = captureDeferUndo(makeTodoItem({ date: '2026-07-08' }), TODAY);
    expect(undo).toEqual({ kind: 'todo', id: 'todo-1', previousDate: '2026-07-08' });
  });

  it('captures a transaction prior snooze (undefined when never snoozed)', () => {
    expect(captureDeferUndo(makeTransactionItem(), TODAY)).toEqual({
      kind: 'transaction',
      id: 'tx-1',
      previousSnooze: undefined,
    });
    expect(
      captureDeferUndo(makeTransactionItem({ reviewSnoozedUntil: '2026-07-09' }), TODAY)
    ).toEqual({ kind: 'transaction', id: 'tx-1', previousSnooze: '2026-07-09' });
  });

  it('snapshots a one-time calendar item doc without the queueType discriminator', () => {
    const doc = makeCalendarItem();
    const undo = captureDeferUndo(asCalendarQueueItem(doc), TODAY) as Extract<
      DeferUndoDescriptor,
      { kind: 'calendar-single' }
    >;
    expect(undo).toEqual({ kind: 'calendar-single', item: doc });
    expect(undo.item).not.toHaveProperty('queueType');
  });

  it('describes a recurring instance defer with template id, dates, and identity fields', () => {
    const instance = asCalendarQueueItem(
      makeCalendarItem({ id: generateRecurringId('tmpl-9', '2026-07-09'), date: '2026-07-09' })
    );
    const undo = captureDeferUndo(instance, TODAY);
    expect(undo).toEqual({
      kind: 'calendar-recurring',
      templateId: 'tmpl-9',
      instanceDate: '2026-07-09',
      // Overdue instance defers to tomorrow (matches deferCalendarItem's rule).
      deferredDate: '2026-07-11',
      title: 'Internet',
      type: 'expense',
    });
  });

  it('pushes a future-dated recurring instance one day past its own date', () => {
    const instance = asCalendarQueueItem(
      makeCalendarItem({ id: generateRecurringId('tmpl-9', '2026-07-20'), date: '2026-07-20' })
    );
    const undo = captureDeferUndo(instance, TODAY) as Extract<
      DeferUndoDescriptor,
      { kind: 'calendar-recurring' }
    >;
    expect(undo.deferredDate).toBe('2026-07-21');
  });
});

describe('findRecurringDeferArtifacts', () => {
  const descriptor: Extract<DeferUndoDescriptor, { kind: 'calendar-recurring' }> = {
    kind: 'calendar-recurring',
    templateId: 'tmpl-9',
    instanceDate: '2026-07-09',
    deferredDate: '2026-07-11',
    title: 'Internet',
    type: 'expense',
  };

  const template = makeCalendarItem({
    id: 'tmpl-9',
    isRecurring: true,
    frequency: 'monthly',
    date: '2026-07-09',
  });
  const tombstone = makeCalendarItem({
    id: 'new-tomb',
    date: '2026-07-09',
    isDeleted: true,
    parentRecurringId: 'tmpl-9',
  });
  const deferredCopy = makeCalendarItem({ id: 'new-copy', date: '2026-07-11' });

  it('finds the tombstone and deferred copy among newly created docs', () => {
    const preIds = new Set([template.id]);
    const result = findRecurringDeferArtifacts(
      [template, tombstone, deferredCopy],
      preIds,
      descriptor
    );
    expect(result).toEqual({ deferredCopyId: 'new-copy', tombstoneId: 'new-tomb' });
  });

  it('never matches docs that existed before the defer', () => {
    // Same shapes, but both docs pre-date the bulk run.
    const preIds = new Set([template.id, tombstone.id, deferredCopy.id]);
    expect(
      findRecurringDeferArtifacts([template, tombstone, deferredCopy], preIds, descriptor)
    ).toBeNull();
  });

  it('returns null when the deferred copy is ambiguous (two candidates)', () => {
    const duplicate = makeCalendarItem({ id: 'new-copy-2', date: '2026-07-11' });
    expect(
      findRecurringDeferArtifacts(
        [template, tombstone, deferredCopy, duplicate],
        new Set([template.id]),
        descriptor
      )
    ).toBeNull();
  });

  it('returns null when either artifact is missing', () => {
    const preIds = new Set([template.id]);
    expect(findRecurringDeferArtifacts([template, tombstone], preIds, descriptor)).toBeNull();
    expect(findRecurringDeferArtifacts([template, deferredCopy], preIds, descriptor)).toBeNull();
  });

  it('ignores near-miss candidates (paid, recurring, wrong title/date/type)', () => {
    const preIds = new Set([template.id]);
    const nearMisses: CalendarItem[] = [
      makeCalendarItem({ id: 'nm-paid', date: '2026-07-11', isPaid: true }),
      makeCalendarItem({ id: 'nm-recurring', date: '2026-07-11', isRecurring: true, frequency: 'weekly' }),
      makeCalendarItem({ id: 'nm-title', date: '2026-07-11', title: 'Water' }),
      makeCalendarItem({ id: 'nm-date', date: '2026-07-12' }),
      makeCalendarItem({ id: 'nm-type', date: '2026-07-11', type: 'income' }),
      makeCalendarItem({ id: 'nm-child', date: '2026-07-11', parentRecurringId: 'tmpl-other' }),
    ];
    const result = findRecurringDeferArtifacts(
      [template, tombstone, deferredCopy, ...nearMisses],
      preIds,
      descriptor
    );
    expect(result).toEqual({ deferredCopyId: 'new-copy', tombstoneId: 'new-tomb' });
  });
});

describe('captureDeferUndo type dispatch', () => {
  it('handles each queue item kind through the shared union', () => {
    const items: ActionQueueItem[] = [
      makeTodoItem(),
      makeTransactionItem(),
      asCalendarQueueItem(makeCalendarItem()),
    ];
    const kinds = items.map(i => captureDeferUndo(i, TODAY).kind);
    expect(kinds).toEqual(['todo', 'transaction', 'calendar-single']);
  });
});
