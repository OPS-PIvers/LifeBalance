import {
  doc,
  updateDoc,
  deleteDoc,
  deleteField,
  addDoc,
  collection,
  writeBatch,
  increment,
  serverTimestamp,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { format, parseISO, addDays, startOfToday, isAfter, isValid } from 'date-fns';
import { Account, CalendarItem, Household } from '@/types/schema';
import type { MutationOpts } from '@/contexts/household/types';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { BUDGETED_IN_CALENDAR } from '@/utils/categories';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { parseRecurringId, isRecurringId, rollRecurringAnchorForward } from '@/utils/calendarRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { roundMoney } from '@/utils/money';

// Pure-ish factories for the CALENDAR-ITEM mutation family (add/update/delete/
// pay/defer) — moved verbatim out of FirebaseHouseholdContext. See
// advisor-plans/08-context-decomposition.md step 5. Split out of the sibling
// financeMutations.ts (accounts/buckets/pay-period/loaders) to stay under the
// ~800-line-per-file guideline.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * addCalendarItem — original closure captured `householdId`, `user`.
 */
export function makeAddCalendarItem(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
}) {
  const { db, householdId, user } = deps;

  const addCalendarItem = async (item: CalendarItem) => {
    if (!householdId || !user) return;

    try {
      // Exclude 'id' field - it's not stored in Firestore (document ID is separate)
      const { id: _id, ...itemWithoutId } = item;
      const sanitizedItem = sanitizeFirestoreData(itemWithoutId);

      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        ...sanitizedItem,
        createdBy: user.uid,
      });
      toast.success('Event added');
    } catch (error) {
      console.error('[addCalendarItem] Failed:', error);
      toast.error('Failed to add event. Please try again.');
      throw error;
    }
  };

  return { addCalendarItem };
}

/**
 * updateCalendarItem — captures `householdId` and `calendarItems` (the latter
 * to detect schedule changes on recurring templates).
 */
export function makeUpdateCalendarItem(deps: {
  db: Firestore;
  householdId: string | null;
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, calendarItems } = deps;

  const updateCalendarItem = async (item: CalendarItem) => {
    if (!householdId) return;

    try {
      // Forward-only schedule edits: when a recurring template's date or
      // frequency CHANGES, roll the anchor to the first occurrence on/after
      // today. Re-anchoring a template into the past re-generates old
      // occurrences on the new schedule, and the paid/deleted suppression
      // records (keyed by the OLD occurrence dates) no longer match — already-
      // paid bills resurrect as unpaid overdue items. When the schedule is
      // untouched (e.g. a title or amount edit), the anchor is left alone so a
      // genuinely overdue occurrence stays visible.
      let effectiveDate = item.date;
      if (item.isRecurring && item.frequency) {
        // If the existing doc can't be found in local state (e.g. listener
        // not yet resolved), do NOT roll — silently rewriting the date on a
        // possibly-unchanged schedule is worse than the (edit-UI-impossible)
        // resurrect case, since edit surfaces always operate on loaded items.
        const existing = calendarItems.find(i => i.id === item.id);
        const scheduleChanged =
          !!existing &&
          (!existing.isRecurring ||
            existing.date !== item.date ||
            existing.frequency !== item.frequency);
        if (scheduleChanged) {
          effectiveDate = rollRecurringAnchorForward(item.date, item.frequency, getLocalDateString());
        }
      }

      const updates: Record<string, unknown> = {
        title: item.title,
        amount: item.amount,
        date: effectiveDate,
        type: item.type,
        isPaid: item.isPaid,
        isRecurring: item.isRecurring,
      };

      // Handle frequency field: delete it if not recurring, otherwise include it
      if (item.isRecurring && item.frequency) {
        updates.frequency = item.frequency;
      } else if (!item.isRecurring) {
        // Explicitly delete the frequency field when toggling off recurring
        updates.frequency = deleteField();
      }

      const sanitizedUpdates = sanitizeFirestoreData(updates);
      await updateDoc(doc(db, `households/${householdId}/calendarItems`, item.id), sanitizedUpdates);
      toast.success('Event updated');
    } catch (error) {
      console.error('[updateCalendarItem] Failed:', error);
      toast.error('Failed to update event. Please try again.');
      throw error;
    }
  };

  return { updateCalendarItem };
}

/**
 * deleteRecurringInstance — original closure captured `householdId`, `user`,
 * `calendarItems`.
 */
export function makeCalendarDeleteMutations(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, user, calendarItems } = deps;

  const deleteRecurringInstance = async (syntheticId: string, opts?: MutationOpts) => {
    if (!householdId || !user) return;

    try {
      // Parse synthetic ID to get template ID and date
      const parsed = parseRecurringId(syntheticId);
      if (!parsed) return;
      const { templateId: parentRecurringId, date: specificDate } = parsed;

      // Find the recurring template to get item details
      const template = calendarItems.find(i => i.id === parentRecurringId);
      if (!template) return;

      // Check if this specific date has already been deleted or paid
      const existingInstance = calendarItems.find(
        i => i.parentRecurringId === parentRecurringId && i.date === specificDate
      );
      if (existingInstance) {
        // If it's already a paid/deleted instance, just delete that record
        await deleteDoc(doc(db, `households/${householdId}/calendarItems`, existingInstance.id));
        if (!opts?.silent) toast.success('Instance deleted');
        return;
      }

      // Create a deleted instance marker
      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        title: template.title,
        amount: template.amount,
        date: specificDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        isDeleted: true,
        parentRecurringId: parentRecurringId,
        createdBy: user.uid,
      });

      if (!opts?.silent) toast.success('Instance deleted');
    } catch (error) {
      console.error('[deleteRecurringInstance] Failed:', error);
      toast.error('Failed to delete instance. Please try again.');
      throw error;
    }
  };

  return { deleteRecurringInstance };
}

/**
 * deleteCalendarItem — original closure captured `householdId`, plus
 * `deleteRecurringInstance` (the `useCallback`-wrapped function, not raw
 * state).
 */
export function makeDeleteCalendarItem(deps: {
  db: Firestore;
  householdId: string | null;
  deleteRecurringInstance: (syntheticId: string, opts?: MutationOpts) => Promise<void>;
}) {
  const { db, householdId, deleteRecurringInstance } = deps;

  const deleteCalendarItem = async (id: string, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      // Check if this is a recurring instance (synthetic ID with date suffix)
      const isRecurringInstance = isRecurringId(id);

      if (isRecurringInstance) {
        // Delete only this instance, not the entire series
        await deleteRecurringInstance(id, opts);
      } else {
        // Direct deletion for non-recurring items or templates
        await deleteDoc(doc(db, `households/${householdId}/calendarItems`, id));
        if (!opts?.silent) toast.success('Event deleted');
      }
    } catch (error) {
      console.error('[deleteCalendarItem] Failed:', error);
      toast.error('Failed to delete event. Please try again.');
      throw error;
    }
  };

  return { deleteCalendarItem };
}

/**
 * payCalendarItem — original closure captured `householdId`, `user`,
 * `accounts`, `calendarItems`, `householdSettings`, plus
 * `handlePaycheckApproval` (passed in so the paycheck-approval family stays a
 * single source of truth in financeMutations.ts).
 */
export function makePayCalendarItem(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  accounts: Account[];
  calendarItems: CalendarItem[];
  householdSettings: Household | null;
  handlePaycheckApproval: (paycheckDate: string, externalBatch?: WriteBatch) => Promise<void>;
}) {
  const { db, householdId, user, accounts, calendarItems, householdSettings, handlePaycheckApproval } = deps;

  const payCalendarItem = async (itemId: string, accountId: string, opts?: MutationOpts) => {
    if (!householdId || !user) return;

    try {
      const account = accounts.find(a => a.id === accountId);
      if (!account) return;

      // Check if this is a recurring instance
      const isRecurringInstance = isRecurringId(itemId);

      let item: CalendarItem | undefined;
      let parentRecurringId: string | undefined;
      let specificDate: string;

      if (isRecurringInstance) {
        // Parse synthetic ID to get original template ID and date
        const parsed = parseRecurringId(itemId);
        if (!parsed) return;
        parentRecurringId = parsed.templateId;
        specificDate = parsed.date;

        // Find the recurring template
        const template = calendarItems.find(i => i.id === parentRecurringId);
        if (!template) return;

        // Check if this specific date has already been paid
        const existingPaidInstance = calendarItems.find(
          i => i.parentRecurringId === parentRecurringId && i.date === specificDate && i.isPaid
        );
        if (existingPaidInstance) return;

        // Create item object for this specific instance
        item = {
          ...template,
          date: specificDate,
        };
      } else {
        // Non-recurring item
        item = calendarItems.find(i => i.id === itemId);
        if (!item || item.isPaid) return;
        specificDate = item.date;
      }

      // Atomically commit the calendar item, account balance, and transaction —
      // and, for an income item, the paycheck-approval period roll — in a single
      // writeBatch so they can never partially apply (e.g. the pay period
      // advances but the paycheck is never credited, or the balance moves but
      // the bill isn't marked paid). Created BEFORE the approval so its writes
      // can be staged into the same batch.
      const payBatch = writeBatch(db);

      // If this is an income item (paycheck), stage the period reset writes
      // BEFORE the transaction writes. Staged mode defers the commit (and the
      // period-roll toast) to this function.
      if (item.type === 'income') {
        await handlePaycheckApproval(specificDate, payBatch);
      }

      // Buckets and the calendar are separate domains (Plan 016): a paid bill is
      // already accounted for on the calendar and never lands in a budget bucket.
      const category: string = item.type === 'expense' ? BUDGETED_IN_CALENDAR : 'Income';

      // Transaction dated to when the item was actually due/scheduled
      // (specificDate), not "today" — so a bill due on the 10th but paid on the
      // 15th records against the 10th and lands in the correct pay period.
      const transactionDate = specificDate;
      // For an INCOME item we already awaited handlePaycheckApproval(specificDate)
      // above. When it ADVANCED the period (paycheck dated after the current
      // period start), the closure-captured householdSettings still holds the OLD
      // date, so deriving the period from it would file the opening paycheck into
      // the period that just closed — use the just-approved date directly:
      // getPayPeriodForTransaction(specificDate, specificDate) === specificDate,
      // i.e. the new period this paycheck opens. When the approval was a no-op
      // (paycheck dated on/before the current period start — the pointer must not
      // rewind), keep the current period so the income files as historical rather
      // than opening a resurrected period.
      const priorPeriodId = householdSettings?.lastPaycheckDate;
      const effectiveLastPaycheck =
        item.type === 'income' && (!priorPeriodId || specificDate > priorPeriodId)
          ? specificDate
          : priorPeriodId;
      const payPeriodId = getPayPeriodForTransaction(transactionDate, effectiveLastPaycheck);

      // Account balance delta. Using increment() (a server-side delta) instead of
      // writing an absolute balance computed from local state prevents lost
      // updates when household members act concurrently.
      const balanceDelta = item.type === 'expense' ? -item.amount : item.amount;

      // 1. Create or update the paid calendar item
      if (isRecurringInstance) {
        // Create a new paid instance record
        const newCalendarRef = doc(collection(db, `households/${householdId}/calendarItems`));
        payBatch.set(newCalendarRef, {
          title: item.title,
          amount: item.amount,
          date: specificDate,
          type: item.type,
          isPaid: true,
          isRecurring: false, // Individual instances are not recurring
          parentRecurringId: parentRecurringId,
          createdBy: user.uid,
        });
      } else {
        // Mark non-recurring item as paid
        payBatch.update(doc(db, `households/${householdId}/calendarItems`, itemId), {
          isPaid: true,
        });
      }

      // 2. Update account balance
      payBatch.update(doc(db, `households/${householdId}/accounts`, accountId), {
        balance: increment(roundMoney(balanceDelta)),
        lastUpdated: serverTimestamp(),
      });

      // 3. Create transaction. `accountId` records which account the bill was
      // paid from — it's what lets the Action Queue's swipe-approve suggest
      // "the account you used last time" for this bill going forward.
      const newTransactionRef = doc(collection(db, `households/${householdId}/transactions`));
      payBatch.set(newTransactionRef, {
        amount: item.amount,
        merchant: item.title,
        category: category,
        date: transactionDate,
        status: 'verified',
        isRecurring: !!item.isRecurring,
        source: 'recurring',
        autoCategorized: true,
        payPeriodId,
        accountId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      await payBatch.commit();

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions

      if (!opts?.silent) toast.success(item.type === 'expense' ? 'Bill Paid' : 'Income Received');
    } catch (error) {
      console.error('[payCalendarItem] Failed:', error);
      toast.error('Failed to process payment. Please try again.');
      throw error;
    }
  };

  return { payCalendarItem };
}

/**
 * deferCalendarItem — original closure captured `householdId`, `user`,
 * `calendarItems`.
 */
export function makeDeferCalendarItem(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, user, calendarItems } = deps;

  const deferCalendarItem = async (itemId: string, opts?: MutationOpts) => {
    if (!householdId || !user) return;

    // Common date calculation logic:
    // "Tomorrow", unless the item is already in the future, then +1 day from item date.
    // This ensures deferring always pushes it forward relative to today.
    const calculateDeferredDate = (currentDateString: string): string => {
      const today = startOfToday();
      const tomorrowDate = addDays(today, 1);
      const originalDate = parseISO(currentDateString);

      if (!isValid(originalDate)) {
        return format(tomorrowDate, 'yyyy-MM-dd');
      }

      // Default: defer to tomorrow relative to TODAY
      // If original date is in the future (after today), add 1 day to it
      // So if due Jan 10 (and today is Jan 5), deferring makes it Jan 11.
      // If due Jan 1 (and today is Jan 5), deferring makes it Jan 6 (tomorrow).
      const deferredFromOriginal = addDays(originalDate, 1);

      // If deferredFromOriginal is after tomorrow, use it. Otherwise use tomorrow.
      const newDate = isAfter(deferredFromOriginal, tomorrowDate)
        ? deferredFromOriginal
        : tomorrowDate;

      return format(newDate, 'yyyy-MM-dd');
    };

    // Check if this is a recurring instance
    const isRecurringInstance = isRecurringId(itemId);

    if (isRecurringInstance) {
      // For recurring instances:
      // 1. Create a one-time deferred item
      // 2. Hide (delete) the original recurring instance to prevent duplication

      const parsed = parseRecurringId(itemId);
      if (!parsed) return;
      const { templateId: parentRecurringId, date: specificDate } = parsed;

      // Find the recurring template
      const template = calendarItems.find(i => i.id === parentRecurringId);
      if (!template) return;

      const newDate = calculateDeferredDate(specificDate);

      // Commit the deferred item and the tombstone in a single batch so a
      // partial write can never duplicate the instance (deferred copy created
      // but the original never hidden) or vanish it (hidden but never
      // re-created). Pre-allocate refs so both creates participate in the batch.
      const deferBatch = writeBatch(db);

      // 1. Create deferred item
      deferBatch.set(doc(collection(db, `households/${householdId}/calendarItems`)), {
        title: template.title,
        amount: template.amount,
        date: newDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        createdBy: user.uid,
      });

      // 2. Delete/Hide original instance
      // We create a "tombstone" with isDeleted: true to hide this specific instance from expansion
      deferBatch.set(doc(collection(db, `households/${householdId}/calendarItems`)), {
        title: template.title,
        amount: template.amount,
        date: specificDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        isDeleted: true,
        parentRecurringId: parentRecurringId,
        createdBy: user.uid,
      });

      await deferBatch.commit();

      if (!opts?.silent) {
        toast.success(`Deferred to ${format(parseISO(newDate), 'MMM d')}`);
      }
    } else {
      // Non-recurring item - just move the date
      const item = calendarItems.find(i => i.id === itemId);
      if (!item) return;

      const newDate = calculateDeferredDate(item.date);

      await updateDoc(doc(db, `households/${householdId}/calendarItems`, itemId), {
        date: newDate,
      });

      if (!opts?.silent) {
        toast.success(`Deferred to ${format(parseISO(newDate), 'MMM d')}`);
      }
    }
  };

  return { deferCalendarItem };
}
