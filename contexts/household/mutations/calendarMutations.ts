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
  arrayUnion,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import type { Transaction } from '@/types/schema';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { format, parseISO, addDays, startOfToday, isAfter, isValid } from 'date-fns';
import { Account, CalendarItem, Household, INCOME_CATEGORY } from '@/types/schema';
import type { MutationOpts } from '@/contexts/household/types';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { BUDGETED_IN_CALENDAR } from '@/utils/categories';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { parseRecurringId, isRecurringId, rollRecurringAnchorForward } from '@/utils/calendarRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { appendActivityLog, composeSummary } from '@/utils/activityLog';
import { emitPayPeriodCeremony, type PayPeriodCeremonyEvent } from '@/utils/payPeriodCeremony';
import { roundMoney } from '@/utils/money';
import { computePriceChangeNudge } from '@/utils/priceChangeNudge';
import {
  effectiveAccountImpact,
  isBankSyncTransaction,
  resolveTargetAccount,
  shouldSkipBankSyncDelta,
} from '@/utils/accountImpact';

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
      toast.error(describeError(error, 'add the event'));
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

  const updateCalendarItem = async (item: CalendarItem, opts?: MutationOpts) => {
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

      // Subscription flag: store true or remove the field entirely (keeps
      // legacy docs clean and lets the rules treat it as optional).
      updates.isSubscription = item.isSubscription ? true : deleteField();

      const sanitizedUpdates = sanitizeFirestoreData(updates);
      await updateDoc(doc(db, `households/${householdId}/calendarItems`, item.id), sanitizedUpdates);
      if (!opts?.silent) toast.success('Event updated');
    } catch (error) {
      console.error('[updateCalendarItem] Failed:', error);
      toast.error(describeError(error, 'update the event'));
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
      toast.error(describeError(error, 'delete this occurrence'));
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
      toast.error(describeError(error, 'delete the event'));
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
  /** Display name for the F-XCUT-01 activity-log actor (resolved by the provider). */
  actorName?: string | null;
  accounts: Account[];
  calendarItems: CalendarItem[];
  householdSettings: Household | null;
  handlePaycheckApproval: (paycheckDate: string, externalBatch?: WriteBatch) => Promise<void>;
}) {
  const { db, householdId, user, actorName, accounts, calendarItems, householdSettings, handlePaycheckApproval } = deps;

  const payCalendarItem = async (
    itemId: string,
    accountId: string,
    opts?: MutationOpts & { actualAmount?: number }
  ) => {
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
      let payPeriodId = getPayPeriodForTransaction(transactionDate, effectiveLastPaycheck);
      // Retroactive attribution: a bill dated BEFORE the current period start
      // (e.g. an overdue bill approved from the Action Queue after the period
      // rolled) belongs to the pay period it was due in, not the active one.
      // getPayPeriodForTransaction returns '' for pre-period dates; recover the
      // real prior period id — the latest APPROVED paycheck on/before the bill's
      // date (paychecks are paid income calendar items; yyyy-MM-dd compares
      // lexically). No such paycheck → keep '' (untracked history), the prior
      // behavior.
      if (!payPeriodId && item.type === 'expense') {
        payPeriodId = calendarItems.reduce(
          (latest, i) =>
            i.type === 'income' && i.isPaid && !i.isDeleted && i.date <= transactionDate && i.date > latest
              ? i.date
              : latest,
          ''
        );
      }

      // Pay-period ceremony: decide BEFORE the commit whether this approval
      // rolls the period (mirrors handlePaycheckApproval's own branch logic —
      // no prior period → first init; paycheck dated after the current period
      // start → roll; on/before → no-op, no ceremony). Emitted only AFTER the
      // batch commits successfully, so the ceremony can never fire for a roll
      // that didn't happen.
      const ceremonyKind: PayPeriodCeremonyEvent['kind'] | null =
        item.type !== 'income'
          ? null
          : !priorPeriodId
            ? 'first'
            : specificDate > priorPeriodId
              ? 'roll'
              : null;

      // What was ACTUALLY paid — an explicit override (variable bills edited at
      // pay-time) wins over the item's budgeted amount. Non-finite / non-positive
      // overrides are ignored rather than corrupting the balance. The recurring
      // TEMPLATE's own amount is never touched, so future occurrences keep the
      // budgeted figure.
      const paidAmount =
        opts?.actualAmount !== undefined && Number.isFinite(opts.actualAmount) && opts.actualAmount > 0
          ? roundMoney(opts.actualAmount)
          : item.amount;

      // Account balance delta. Using increment() (a server-side delta) instead of
      // writing an absolute balance computed from local state prevents lost
      // updates when household members act concurrently.
      const balanceDelta = item.type === 'expense' ? -paidAmount : paidAmount;

      // 1. Create or update the paid calendar item
      // The doc id of whichever calendar doc ends up marked paid — stamped onto
      // the transaction below so the pair is traceable from both sides.
      let paidCalendarItemId: string;
      if (isRecurringInstance) {
        // Create a new paid instance record
        const newCalendarRef = doc(collection(db, `households/${householdId}/calendarItems`));
        paidCalendarItemId = newCalendarRef.id;
        payBatch.set(newCalendarRef, {
          title: item.title,
          amount: paidAmount,
          date: specificDate,
          type: item.type,
          isPaid: true,
          isRecurring: false, // Individual instances are not recurring
          parentRecurringId: parentRecurringId,
          createdBy: user.uid,
        });
      } else {
        paidCalendarItemId = itemId;
        // Mark non-recurring item as paid — recording the actual amount so the
        // calendar reflects what really cleared.
        payBatch.update(doc(db, `households/${householdId}/calendarItems`, itemId), {
          isPaid: true,
          amount: paidAmount,
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
      //
      // `paidCalendarItemId` marks this row as ALREADY BEING a bill payment
      // (expenses only — the field, its guards and their copy are all about
      // bills; an approved paycheck is not one). Without it, a $1,200 Rent
      // payment stayed an eligible candidate in the calendar-side
      // `TransactionLinkPicker` and could be picked to "settle" an unrelated $95
      // storage bill, marking it paid at $1,200 off a payment that was never for
      // it. It also brings this row under the shared settled-bill guard
      // (utils/settledBillGuard.ts), so deleting/splitting it can no longer
      // silently orphan the calendar doc it paid.
      const newTransactionRef = doc(collection(db, `households/${householdId}/transactions`));
      payBatch.set(newTransactionRef, {
        amount: paidAmount,
        merchant: item.title,
        category: category,
        date: transactionDate,
        status: 'verified',
        isRecurring: !!item.isRecurring,
        source: 'recurring',
        autoCategorized: true,
        payPeriodId,
        accountId,
        ...(item.type === 'expense' ? { paidCalendarItemId } : {}),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      // F-XCUT-01: log the payment INSIDE the same batch so the audit entry
      // co-commits atomically with the balance/calendar/transaction writes.
      appendActivityLog(payBatch, db, householdId, { uid: user.uid, name: actorName ?? '' }, {
        domain: 'money',
        action: item.type === 'expense' ? 'bill_paid' : 'income_received',
        summary: composeSummary(
          actorName ?? '',
          item.type === 'expense' ? 'paid' : 'received',
          item.title,
          paidAmount
        ),
      });

      await payBatch.commit();

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions

      // Device-local ceremony for the member who confirmed the paycheck.
      // Deliberately NOT gated on opts.silent: bulk Action-Queue approvals
      // suppress per-item toasts but should still surface the period reset.
      if (ceremonyKind) {
        emitPayPeriodCeremony({
          kind: ceremonyKind,
          previousPeriodId: ceremonyKind === 'roll' ? (priorPeriodId ?? null) : null,
          newPeriodId: specificDate,
          paycheckTitle: item.title,
          paycheckAmount: paidAmount,
        });
      }

      if (!opts?.silent) toast.success(item.type === 'expense' ? 'Bill Paid' : 'Income Received');

      // Price-change nudge: only meaningful for an explicit at-pay-time override
      // on an expense (income "actual amount" overrides aren't part of this
      // flow's UI). Reference amount is the most recent PAID instance of this
      // recurring bill when one exists (closer to "last time" than the
      // template's budgeted figure), else the item/template's own amount.
      if (item.type === 'expense' && opts?.actualAmount !== undefined && !opts?.silent) {
        const recurringId = parentRecurringId ?? (item.isRecurring ? item.id : undefined);
        const lastPaidInstance = recurringId
          ? calendarItems
              .filter(i => i.parentRecurringId === recurringId && i.isPaid && i.date < specificDate)
              .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
          : undefined;
        const referenceAmount = lastPaidInstance?.amount ?? item.amount;
        const nudge = computePriceChangeNudge(paidAmount, referenceAmount, householdSettings?.currency);
        if (nudge) toast(nudge.message, { icon: nudge.delta > 0 ? '📈' : '📉' });
      }
    } catch (error) {
      console.error('[payCalendarItem] Failed:', error);
      toast.error(describeError(error, 'record the payment'));
      throw error;
    }
  };

  return { payCalendarItem };
}

/**
 * linkBankTransactionToBill — manual reconcile that teaches the nightly
 * bank-email sync (item 9 of the bankEmailSync review). When a user, reviewing a
 * bank-SYNCED transaction (one carrying a `bankRef`), says "this actually pays a
 * bill" and picks an unpaid calendar item, we:
 *
 *   1. Mark that bill PAID at the transaction's actual amount — reusing the
 *      payCalendarItem shape (recurring occurrence → a paid-instance record that
 *      suppresses the synthetic occurrence; one-off → isPaid/amount on the doc)
 *      but WITHOUT any account-balance delta: the row is already `verified` and
 *      the account balance is authoritative from the email's ending balance, so
 *      touching the balance here would double-count. This preserves the pipeline
 *      invariant (no per-line balance delta, ever, for a row this sync touches).
 *   2. File the transaction as the bill payment (category `Budgeted in Calendar`,
 *      clear `needsCategory`) so it leaves the review surface.
 *   3. Append the transaction's merchant/descriptor to the bill's
 *      `bankDescriptorAliases` (on the recurring TEMPLATE when applicable) so a
 *      future nightly sync auto-matches this descriptor via `matchesAlias`.
 *   4. Log the payment to the activity feed (F-XCUT-01), same as payCalendarItem.
 *
 * All four writes commit in ONE batch so they can never partially apply. Pure
 * factory (mirrors the sibling calendar factories); NO account write is ever
 * staged. Wired to the review-surface "Link to bill" affordance in
 * TransactionReviewForm.
 *
 * Returns `true` only when the batch actually committed, `false` for every
 * guard early-return (bad/missing transaction, unparsable synthetic id,
 * non-expense item, already-paid bill). Callers MUST check the return value
 * before treating the link as having happened — a `false` means nothing was
 * written.
 */
export function makeLinkBankTransactionToBill(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  actorName?: string | null;
  transactions: Transaction[];
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, user, actorName, transactions, calendarItems } = deps;

  const linkBankTransactionToBill = async (transactionId: string, calendarItemId: string): Promise<boolean> => {
    if (!householdId || !user) return false;

    const tx = transactions.find((t) => t.id === transactionId);
    // Only a bank-synced row (carries a bankRef) whose balance is already
    // authoritative may be linked without a balance delta.
    if (!tx || !tx.bankRef || tx.status !== 'verified') return false;
    const descriptor = (tx.merchant || '').trim();
    if (!descriptor) return false;

    const paidAmount = roundMoney(tx.amount);
    const isRecurringInstance = isRecurringId(calendarItemId);

    let item: CalendarItem | undefined;
    let templateId: string | undefined;
    let specificDate: string | undefined;

    if (isRecurringInstance) {
      const parsed = parseRecurringId(calendarItemId);
      if (!parsed) return false;
      templateId = parsed.templateId;
      specificDate = parsed.date;
      const template = calendarItems.find((i) => i.id === templateId);
      if (!template || template.type !== 'expense') return false;
      // Already-paid guard (matches payCalendarItem).
      const alreadyPaid = calendarItems.find(
        (i) => i.parentRecurringId === templateId && i.date === specificDate && i.isPaid,
      );
      if (alreadyPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }
      item = { ...template, date: specificDate };
    } else {
      item = calendarItems.find((i) => i.id === calendarItemId);
      if (!item || item.type !== 'expense') return false;
      if (item.isPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }
    }

    try {
      const batch = writeBatch(db);
      const calPath = `households/${householdId}/calendarItems`;
      const txPath = `households/${householdId}/transactions`;

      // 1. Mark the bill paid at the actual amount — NO account-balance write.
      if (isRecurringInstance && templateId && specificDate) {
        batch.set(doc(collection(db, calPath)), sanitizeFirestoreData({
          title: item.title,
          amount: paidAmount,
          date: specificDate,
          type: 'expense',
          isPaid: true,
          isRecurring: false,
          parentRecurringId: templateId,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        }));
      } else {
        batch.update(doc(db, calPath, calendarItemId), { isPaid: true, amount: paidAmount });
      }

      // 2. File the transaction as the bill payment; it leaves the review surface.
      batch.update(doc(db, txPath, transactionId), {
        category: BUDGETED_IN_CALENDAR,
        needsCategory: deleteField(),
      });

      // 3. Learn the descriptor onto the bill (template for a recurring occurrence)
      //    so future nightly syncs auto-match it.
      const aliasTargetId = templateId ?? calendarItemId;
      batch.update(doc(db, calPath, aliasTargetId), {
        bankDescriptorAliases: arrayUnion(descriptor),
      });

      // 4. F-XCUT-01: log the payment INSIDE the same batch (mirrors payCalendarItem).
      appendActivityLog(batch, db, householdId, { uid: user.uid, name: actorName ?? '' }, {
        domain: 'money',
        action: 'bill_paid',
        summary: composeSummary(actorName ?? '', 'paid', item.title, paidAmount),
      });

      await batch.commit();
      toast.success('Linked to bill — future syncs will match automatically');
      return true;
    } catch (error) {
      console.error('[linkBankTransactionToBill] Failed:', error);
      toast.error(describeError(error, 'Failed to link transaction to bill'));
      return false;
    }
  };

  return { linkBankTransactionToBill };
}

/**
 * settleBillWithTransaction (TODO.md 2H(a)) — "this charge IS that planned
 * bill". The merge for the OTHER road a charge takes into this app: a bank/card
 * SCREENSHOT import (CaptureModal → parseBankStatement) writes `pending_review`
 * rows with no `bankRef`, so a recurring bill entered by hand and the imported
 * charge that pays it surface as two unrelated rows. The user picks one and the
 * pair collapses to ONE record.
 *
 * WHY NOT the two mutations that already exist:
 *   - `linkBankTransactionToBill` (above) writes NO balance delta, which is only
 *     sound because a bank-synced row's balance is already authoritative from
 *     the nightly email's ending balance. A `pending_review` row's is not (see
 *     `utils/accountImpact.ts` — `effectiveAccountImpact` is 0 until verified),
 *     so it MUST move the balance. Its gate stays as-is for its existing caller.
 *   - `payCalendarItem` unconditionally CREATES a second transaction, derives
 *     its delta from `item.type` rather than from an existing row, and carries
 *     income / paycheck-approval / pay-period-ceremony branches that are dead
 *     weight here. Creating exactly ZERO new transactions is the whole point of
 *     this path.
 *
 * In ONE writeBatch:
 *   1. the bill is marked PAID at the SCANNED amount — a recurring occurrence
 *      becomes a new paid-instance doc dated to the OCCURRENCE'S DUE DATE (that
 *      is what `expandCalendarItems` suppression keys on; dating it to the
 *      transaction's date would miss and the bill would reappear), a one-off
 *      gets `isPaid`/`amount` on its own doc. The recurring TEMPLATE's amount is
 *      NEVER touched, so next month still budgets the scheduled figure;
 *   2. the transaction is verified, filed as `Budgeted in Calendar`, and stamped
 *      with `paidCalendarItemId` (the real paid doc id) — its `payPeriodId` is
 *      left alone (see the call site comment), and so is its amount UNLESS the
 *      caller passed a corrected `amount`, which then drives all three of the
 *      row, the bill and the balance delta;
 *   3. the account balance moves by the row's now-effective impact, routed
 *      through `resolveTargetAccount`/`effectiveAccountImpact`/
 *      `shouldSkipBankSyncDelta` so credit-tagged rows and bank-sync rows keep
 *      their existing correct behaviour for free (a pending row nets
 *      −scannedAmount; an already-authoritative bank-sync row nets 0);
 *   4. the transaction's descriptor is learned onto the bill's
 *      `bankDescriptorAliases` (the recurring TEMPLATE when applicable);
 *   5. the payment is logged to the activity feed (F-XCUT-01).
 *
 * DELIBERATELY NOT DONE HERE: no habits are fired (unlike
 * `updateTransactionCategory` — this is a bill reconciliation, not a spending
 * review, and the row's habit tags are untouched so a later ordinary edit can
 * still fire them), and no price-change nudge is shown (unlike
 * `payCalendarItem` — the amount here is what the bank already charged, not a
 * figure the user just typed, so there is no decision to nudge). No
 * `MerchantRule` is written either; that is deferred.
 *
 * Returns `true` only when the batch committed. `false` for every guard
 * early-return (missing transaction/bill, non-expense item, non-positive
 * amount, already-paid bill, already-settled transaction) — callers MUST check
 * it, a `false` means nothing was written.
 */
export function makeSettleBillWithTransaction(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  actorName?: string | null;
  transactions: Transaction[];
  calendarItems: CalendarItem[];
  accounts: Account[];
}) {
  const { db, householdId, user, actorName, transactions, calendarItems, accounts } = deps;

  const settleBillWithTransaction = async (
    transactionId: string,
    calendarItemId: string,
    accountId?: string,
    amount?: number,
  ): Promise<boolean> => {
    if (!householdId || !user) return false;

    const tx = transactions.find((t) => t.id === transactionId);
    if (!tx) return false;
    // A credit cannot pay an expense — filing income as `Budgeted in Calendar`
    // would flip its balance sign from credit to debit.
    if (tx.category === INCOME_CATEGORY) return false;
    // Idempotence: a second settle would create a SECOND paid instance for the
    // same occurrence and double-debit the account.
    if (tx.paidCalendarItemId) {
      toast.error('That transaction is already linked to a bill');
      return false;
    }
    // `amount` is the caller's LIVE figure (the review form's amount field),
    // which the stored row has not seen yet — a user who corrects a mis-OCR'd
    // 379.10 to 37.91 and taps settle must settle at 37.91, not at the stale
    // stored value. It drives the bill's paid amount, the balance delta AND the
    // transaction's own amount, all in the one batch below, so the three can
    // never disagree. Undefined ⇒ the stored amount, exactly as before.
    const paidAmount = roundMoney(amount ?? tx.amount);
    // A $0 Apple Pay stub has no charge yet — settling one would mark the bill
    // paid for nothing and move no money.
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      toast.error('Add the real amount before linking this to a bill');
      return false;
    }
    const amountChanged = paidAmount !== roundMoney(tx.amount);
    const descriptor = (tx.merchant || '').trim();

    const isRecurringInstance = isRecurringId(calendarItemId);

    let item: CalendarItem | undefined;
    let templateId: string | undefined;
    let specificDate: string | undefined;

    if (isRecurringInstance) {
      const parsed = parseRecurringId(calendarItemId);
      if (!parsed) return false;
      templateId = parsed.templateId;
      specificDate = parsed.date;
      const template = calendarItems.find((i) => i.id === templateId);
      if (!template || template.type !== 'expense') return false;
      // Already-paid guard (matches payCalendarItem / linkBankTransactionToBill):
      // without it a double-merge writes two paid instances for one occurrence.
      const alreadyPaid = calendarItems.find(
        (i) => i.parentRecurringId === templateId && i.date === specificDate && i.isPaid,
      );
      if (alreadyPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }
      item = { ...template, date: specificDate };
    } else {
      item = calendarItems.find((i) => i.id === calendarItemId);
      if (!item || item.type !== 'expense') return false;
      // A recurring TEMPLATE's real doc id must never reach this branch: it
      // would write `isPaid` onto the template and rewrite its `amount` to the
      // scanned figure, corrupting every future occurrence's budgeted amount
      // (and therefore Safe-to-Spend) while suppressing nothing — the bill
      // would still show unpaid. Both callers already refuse it, but this is a
      // money-path invariant, so it is enforced HERE too. `isRecurring` is the
      // distinguishing flag: a paid-instance doc is always written with
      // `isRecurring: false`.
      if (item.isRecurring) return false;
      if (item.isPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }
    }

    // --- Balance model -----------------------------------------------------
    // Mirrors updateTransactionCategory's reverse/apply pair: reverse the row's
    // CURRENT effective impact off the account it currently lands on, apply its
    // verified impact to the (possibly re-tagged) target. A `pending_review` row
    // reverses 0 and applies −amount; a row already `verified` on the same
    // account nets 0; a bank-sync row's authoritative account is skipped on both
    // sides. Merged per account so one batch never writes the same doc twice.
    const requestedAccountId = accountId?.trim() || undefined;
    const oldTarget = resolveTargetAccount(tx.accountId, accounts);
    const newTarget = resolveTargetAccount(requestedAccountId ?? tx.accountId, accounts);
    const isBankSync = isBankSyncTransaction(tx);
    const bankSyncHomeId = isBankSync ? (tx.bankSyncAccountId ?? oldTarget?.id) : undefined;
    const reverseDelta = shouldSkipBankSyncDelta(tx, oldTarget?.id, oldTarget?.id)
      ? 0
      : -effectiveAccountImpact(tx, oldTarget);
    const applyDelta = shouldSkipBankSyncDelta(tx, newTarget?.id, oldTarget?.id)
      ? 0
      : effectiveAccountImpact(
          {
            amount: paidAmount,
            category: BUDGETED_IN_CALENDAR,
            creditPayment: tx.creditPayment,
            status: 'verified',
          },
          newTarget,
        );
    const deltasByAccountId = new Map<string, number>();
    if (oldTarget) deltasByAccountId.set(oldTarget.id, (deltasByAccountId.get(oldTarget.id) ?? 0) + reverseDelta);
    if (newTarget) deltasByAccountId.set(newTarget.id, (deltasByAccountId.get(newTarget.id) ?? 0) + applyDelta);

    try {
      const batch = writeBatch(db);
      const calPath = `households/${householdId}/calendarItems`;
      const txPath = `households/${householdId}/transactions`;

      // 1. Mark the bill paid at the SCANNED amount.
      let paidCalendarItemId: string;
      if (isRecurringInstance && templateId && specificDate) {
        const paidInstanceRef = doc(collection(db, calPath));
        paidCalendarItemId = paidInstanceRef.id;
        batch.set(paidInstanceRef, sanitizeFirestoreData({
          title: item.title,
          amount: paidAmount,
          // The OCCURRENCE's due date, NOT tx.date — expandCalendarItems keys
          // its paid-occurrence suppression on {templateId, date}.
          date: specificDate,
          type: 'expense',
          isPaid: true,
          isRecurring: false,
          parentRecurringId: templateId,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        }));
      } else {
        paidCalendarItemId = calendarItemId;
        batch.update(doc(db, calPath, calendarItemId), {
          isPaid: true,
          amount: paidAmount,
          // 4. Learn the descriptor in the SAME update — a one-off bill is both
          //    the paid doc and the alias target.
          ...(descriptor ? { bankDescriptorAliases: arrayUnion(descriptor) } : {}),
        });
      }

      // 2. File the transaction as the bill payment. The AMOUNT is untouched
      //    unless the caller passed a corrected one (see `paidAmount` above), in
      //    which case it is co-committed HERE so the row, the bill and the
      //    balance delta all carry the same figure. `payPeriodId` is untouched
      //    either way: unlike payCalendarItem — which CREATES the transaction and
      //    therefore has to choose a period — this row already exists and its own
      //    date is the authoritative charge date, so retro-filing it under the
      //    bill's due-date period would move real spend into a closed period.
      batch.update(doc(db, txPath, transactionId), {
        status: 'verified',
        category: BUDGETED_IN_CALENDAR,
        paidCalendarItemId,
        ...(amountChanged ? { amount: paidAmount } : {}),
        // A settled row is no longer awaiting an amount. Written as `false` (not
        // deleted) to match updateTransactionCategory's `clearNeedsAmount`.
        ...(tx.needsAmount ? { needsAmount: false } : {}),
        ...(requestedAccountId ? { accountId: requestedAccountId } : {}),
        ...(tx.needsCategory ? { needsCategory: deleteField() } : {}),
        ...(tx.reviewSnoozedUntil ? { reviewSnoozedUntil: deleteField() } : {}),
        // Backfill-on-write, same rule as updateTransactionCategory: stamp the
        // bank-sync row's authoritative account the first time it is edited.
        ...(isBankSync && !tx.bankSyncAccountId && bankSyncHomeId ? { bankSyncAccountId: bankSyncHomeId } : {}),
      });

      // 3. Account balance delta(s).
      for (const [accId, delta] of deltasByAccountId) {
        const rounded = roundMoney(delta);
        if (rounded !== 0) {
          batch.update(doc(db, `households/${householdId}/accounts`, accId), {
            balance: increment(rounded),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      // 4. Learn the descriptor onto the recurring TEMPLATE (the one-off case
      //    folded it into the update above). Free, and it does help the
      //    fixed-amount bills the ±10%/±$25 matcher tolerance can reach.
      if (isRecurringInstance && templateId && descriptor) {
        batch.update(doc(db, calPath, templateId), {
          bankDescriptorAliases: arrayUnion(descriptor),
        });
      }

      // 5. F-XCUT-01: log the payment INSIDE the same batch.
      appendActivityLog(batch, db, householdId, { uid: user.uid, name: actorName ?? '' }, {
        domain: 'money',
        action: 'bill_paid',
        summary: composeSummary(actorName ?? '', 'paid', item.title, paidAmount),
      });

      await batch.commit();
      toast.success(`Linked to ${item.title} — one record, not two`);
      return true;
    } catch (error) {
      console.error('[settleBillWithTransaction] Failed:', error);
      toast.error(describeError(error, 'link this transaction to the bill'));
      return false;
    }
  };

  return { settleBillWithTransaction };
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
