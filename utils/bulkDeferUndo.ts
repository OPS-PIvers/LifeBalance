/**
 * Undo support for the Action Queue's BULK defer (impeccable critique P1,
 * heuristic 3 — every destructive-feeling bulk action needs a recovery path).
 *
 * `captureDeferUndo` snapshots what a single queue item's defer will change
 * BEFORE the mutation runs, so the UndoToast can restore it by looping the
 * existing single-item context mutations in reverse:
 *   - to-do        → restore the prior `completeByDate` via `updateToDo`
 *   - transaction  → restore the prior `reviewSnoozedUntil` via
 *                    `updateTransaction` (a cleared/absent prior snooze is
 *                    restored as "today", which `isReviewSnoozed` treats
 *                    identically to no snooze — the row re-enters the queue)
 *   - one-time calendar item → restore the prior doc via `updateCalendarItem`
 *   - recurring calendar INSTANCE → `deferCalendarItem` created two new docs
 *     (a one-time deferred copy + an `isDeleted` tombstone hiding the original
 *     occurrence); undo deletes both via `deleteCalendarItem`. Their ids are
 *     allocated inside the mutation, so `findRecurringDeferArtifacts` locates
 *     them afterwards by field-matching restricted to docs that did NOT exist
 *     before the bulk run (the caller snapshots pre-existing ids) — a doc that
 *     predates the defer can never be mis-deleted.
 *
 * Pure + dependency-light (mirrors `utils/actionQueueSmart.ts`): no React, no
 * Firestore, no toast — data in, descriptor out — so every rule here is
 * trivially unit-testable.
 */
import type { CalendarItem } from '@/types/schema';
import type { ActionQueueItem } from '@/hooks/useActionQueue';
import { isCalendarQueueItem, isTodoQueueItem } from '@/hooks/useActionQueue';
import { isRecurringId, parseRecurringId } from '@/utils/calendarRecurrence';
import { nextDeferDate } from '@/utils/actionQueueSmart';

export type DeferUndoDescriptor =
  | { kind: 'todo'; id: string; previousDate: string }
  | { kind: 'transaction'; id: string; previousSnooze: string | undefined }
  | { kind: 'calendar-single'; item: CalendarItem }
  | {
      kind: 'calendar-recurring';
      /** The recurring template's real doc id (parsed from the synthetic instance id). */
      templateId: string;
      /** The occurrence date that was deferred (= the tombstone's date). */
      instanceDate: string;
      /** Where the one-time deferred copy landed (`nextDeferDate` mirrors the
       *  mutation's internal date rule). */
      deferredDate: string;
      title: string;
      type: CalendarItem['type'];
    };

/**
 * Snapshot the prior state a defer of `item` will overwrite. Must be called
 * BEFORE the defer mutation runs. `today` is injectable for deterministic
 * boundary tests (defaults to the local start-of-today inside `nextDeferDate`).
 */
export function captureDeferUndo(item: ActionQueueItem, today?: Date): DeferUndoDescriptor {
  if (isTodoQueueItem(item)) {
    // The queue item's `date` IS the to-do's `completeByDate` (renamed by
    // useActionQueue for interface consistency).
    return { kind: 'todo', id: item.id, previousDate: item.date };
  }
  if (isCalendarQueueItem(item)) {
    const parsed = isRecurringId(item.id) ? parseRecurringId(item.id) : null;
    if (parsed) {
      return {
        kind: 'calendar-recurring',
        templateId: parsed.templateId,
        instanceDate: parsed.date,
        deferredDate: today ? nextDeferDate(parsed.date, today) : nextDeferDate(parsed.date),
        title: item.title,
        type: item.type,
      };
    }
    // One-time item (or a synthetic id that failed to parse — treated as a
    // plain doc, matching deferCalendarItem's own dispatch): snapshot the doc
    // minus the queue-only discriminator.
    const { queueType: _queueType, ...calendarItem } = item;
    return { kind: 'calendar-single', item: calendarItem };
  }
  return { kind: 'transaction', id: item.id, previousSnooze: item.reviewSnoozedUntil };
}

export interface RecurringDeferArtifacts {
  /** The one-time deferred copy `deferCalendarItem` created. */
  deferredCopyId: string;
  /** The `isDeleted` tombstone hiding the original occurrence. */
  tombstoneId: string;
}

/**
 * Locate the two docs a recurring-instance defer created, restricted to docs
 * that did not exist before the bulk run (`preExistingIds`). Returns null when
 * either artifact can't be identified UNAMBIGUOUSLY (zero or multiple
 * candidates) — the caller should skip the restore rather than guess, so a
 * wrong doc is never deleted.
 */
export function findRecurringDeferArtifacts(
  calendarItems: readonly CalendarItem[],
  preExistingIds: ReadonlySet<string>,
  descriptor: Extract<DeferUndoDescriptor, { kind: 'calendar-recurring' }>,
): RecurringDeferArtifacts | null {
  const created = calendarItems.filter(i => !preExistingIds.has(i.id));

  const tombstones = created.filter(
    i =>
      i.isDeleted === true &&
      i.parentRecurringId === descriptor.templateId &&
      i.date === descriptor.instanceDate,
  );

  const copies = created.filter(
    i =>
      !i.isDeleted &&
      !i.isRecurring &&
      !i.parentRecurringId &&
      !i.isPaid &&
      i.title === descriptor.title &&
      i.type === descriptor.type &&
      i.date === descriptor.deferredDate,
  );

  const tombstone = tombstones.length === 1 ? tombstones[0] : undefined;
  const copy = copies.length === 1 ? copies[0] : undefined;
  if (!tombstone || !copy) return null;

  return { deferredCopyId: copy.id, tombstoneId: tombstone.id };
}
