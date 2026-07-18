import {
  doc,
  updateDoc,
  deleteField,
  collection,
  writeBatch,
  increment,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import React from 'react';
import { Star } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { Account, Habit, Household, SplitParticipant, Transaction } from '@/types/schema';
import type { MutationOpts } from '@/contexts/household/types';
import { effectiveAccountImpact, resolveTargetAccount } from '@/utils/accountImpact';
import { splitParticipantKey } from '@/utils/settlement';
import { mergeTransactions as buildMergeUpdates } from '@/utils/transactionMerge';
import { processToggleHabit } from '@/utils/habitLogic';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { roundMoney } from '@/utils/money';
import { trashDocId, transactionTrashData } from '@/utils/trash';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { track } from '@/services/analytics';
import { shouldTrackFirstTime, FIRST_TRANSACTION_FLAG } from '@/utils/firstTimeFlags';

// Pure-ish factories for the TRANSACTION mutation family — the writeBatch
// atomicity paths documented in CLAUDE.md (checking-balance delta + habits +
// points co-committed with the transaction write). Moved verbatim out of
// FirebaseHouseholdContext. See advisor-plans/08-context-decomposition.md
// step 5. Account/bucket/calendar/pay-period mutations live in the sibling
// financeMutations.ts.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * addTransaction — original closure captured `householdId`, `user`,
 * `householdSettings`, `accounts`, plus the `recentTransactionsRef` read
 * (for the first-transaction analytics flag).
 */
export function makeAddTransaction(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  householdSettings: Household | null;
  accounts: Account[];
  recentTransactionsRef: { current: Transaction[] };
}) {
  const { db, householdId, user, householdSettings, accounts, recentTransactionsRef } = deps;

  const addTransaction = async (tx: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>) => {
    if (!householdId) {
      console.error('[addTransaction] No household selected');
      throw new Error('No household selected');
    }
    if (!user) {
      console.error('[addTransaction] Not authenticated');
      throw new Error('Not authenticated');
    }

    // Validate required fields before attempting Firestore write.
    // Note: a falsy check would wrongly reject a legitimate $0 transaction, so
    // we only reject non-numbers / NaN here (negative amounts are valid too,
    // e.g. refunds).
    if (typeof tx.amount !== 'number' || isNaN(tx.amount)) {
      console.error('[addTransaction] Invalid amount:', tx.amount, typeof tx.amount);
      throw new Error('Invalid amount');
    }
    if (!tx.merchant || typeof tx.merchant !== 'string' || !tx.merchant.trim()) {
      console.error('[addTransaction] Invalid merchant:', tx.merchant, typeof tx.merchant);
      throw new Error('Invalid merchant');
    }
    if (!tx.category || typeof tx.category !== 'string') {
      console.error('[addTransaction] Invalid category:', tx.category, typeof tx.category);
      throw new Error('Invalid category');
    }
    if (!tx.date || typeof tx.date !== 'string') {
      console.error('[addTransaction] Invalid date:', tx.date, typeof tx.date);
      throw new Error('Invalid date');
    }
    if (!['verified', 'pending_review'].includes(tx.status)) {
      console.error('[addTransaction] Invalid status:', tx.status);
      throw new Error('Invalid status');
    }
    if (typeof tx.isRecurring !== 'boolean') {
      console.error('[addTransaction] isRecurring must be boolean, got:', tx.isRecurring, typeof tx.isRecurring);
      throw new Error('isRecurring must be boolean');
    }
    if (typeof tx.autoCategorized !== 'boolean') {
      console.error('[addTransaction] autoCategorized must be boolean, got:', tx.autoCategorized, typeof tx.autoCategorized);
      throw new Error('autoCategorized must be boolean');
    }

    try {
      // Round to whole cents once so the stored amount and the balance delta are
      // guaranteed to match exactly (no float drift between doc and account).
      const roundedAmount = roundMoney(tx.amount);

      // Assign pay period ID based on paycheck approval
      const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

      // Build the document data explicitly to ensure compliance with Firestore rules
      const docData: Record<string, unknown> = {
        amount: roundedAmount,
        merchant: tx.merchant.trim(),
        category: tx.category,
        date: tx.date,
        status: tx.status,
        isRecurring: tx.isRecurring,
        source: tx.source || 'manual',
        autoCategorized: tx.autoCategorized,
        payPeriodId: payPeriodId || null,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      };

      // Add optional fields only if they exist and are not empty strings
      if (tx.relatedHabitIds && tx.relatedHabitIds.length > 0) {
        docData.relatedHabitIds = tx.relatedHabitIds;
      }
      if (tx.store && tx.store.trim()) {
        docData.store = tx.store.trim();
      }
      const trimmedAccountId = tx.accountId && tx.accountId.trim() ? tx.accountId.trim() : undefined;
      if (trimmedAccountId) {
        docData.accountId = trimmedAccountId;
      }
      // creditPayment only matters on a credit account; persist only when true
      // (absent ⇒ charge), matching the optional-field convention above.
      if (tx.creditPayment === true) {
        docData.creditPayment = true;
      }
      if (tx.notes && tx.notes.trim()) {
        docData.notes = tx.notes.trim();
      }
      // F-DASH-04: grouping key shared by all transactions split from one receipt.
      if (tx.receiptGroupId && tx.receiptGroupId.trim()) {
        docData.receiptGroupId = tx.receiptGroupId.trim();
      }

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: a new transaction touches a
      // balance only if it is created `verified`. A `pending_review` capture
      // (receipt / AI scan / Apple Pay stub) does NOT move any balance — it
      // influences Safe-to-Spend solely via the calculator's pendingSpend term,
      // so moving a balance here too would subtract it twice. The impact lands
      // on the TAGGED account (credit charges raise the card's debt; checking
      // expenses debit checking), falling back to checking when untagged.
      const target = resolveTargetAccount(trimmedAccountId, accounts);
      const balanceDelta = effectiveAccountImpact(
        { amount: roundedAmount, category: tx.category, creditPayment: tx.creditPayment, status: tx.status },
        target
      );

      // Commit the new transaction and the account-balance delta in a SINGLE
      // writeBatch so they can never partially apply. Pre-allocate the
      // transaction ref so it participates in the batch.
      const batch = writeBatch(db);
      const txRef = doc(collection(db, `households/${householdId}/transactions`));
      batch.set(txRef, docData);

      // Update the target account balance only when the (verified) impact is
      // non-zero (server-side delta avoids lost updates from concurrent edits).
      if (balanceDelta !== 0 && target) {
        batch.update(doc(db, `households/${householdId}/accounts`, target.id), {
          balance: increment(roundMoney(balanceDelta)),
          lastUpdated: serverTimestamp(),
        });
      }

      // CREDIT-CARD PAYMENT AS A TRANSFER: when a payment on a credit account
      // names a funding account, debit that (non-credit) account by the same
      // amount in the SAME batch, so card credit + funding debit can never
      // partially apply. Verified-only (a pending payment moves no balance),
      // and skipped when the funding account is missing/credit/the same doc
      // (a batch must not write one doc twice) — those degrade to today's
      // card-only behavior. The id is persisted only when it actually applies
      // to a credit payment, matching the optional-field convention.
      const trimmedFundingId = tx.fundingAccountId?.trim() || undefined;
      const fundingAccount = trimmedFundingId ? accounts.find(a => a.id === trimmedFundingId) : undefined;
      const isCreditPaymentOnCard = tx.creditPayment === true && target?.type === 'credit';
      if (trimmedFundingId && isCreditPaymentOnCard) {
        docData.fundingAccountId = trimmedFundingId;
      }
      if (
        isCreditPaymentOnCard &&
        fundingAccount &&
        fundingAccount.type !== 'credit' &&
        fundingAccount.id !== target.id &&
        tx.status === 'verified'
      ) {
        batch.update(doc(db, `households/${householdId}/accounts`, fundingAccount.id), {
          balance: increment(-roundedAmount),
          lastUpdated: serverTimestamp(),
        });
      }

      // Read the live window BEFORE the commit so latency-compensated listeners
      // can't already include this write (ref, not `transactions`, to keep the
      // callback's deps free of per-transaction churn).
      const wasFirstTransaction = recentTransactionsRef.current.length === 0;

      await batch.commit();

      track('transaction_added', { source: tx.source || 'manual' });
      if (shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, wasFirstTransaction)) track('first_transaction_added');

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions
      // The bucketSpentMap effect will automatically recalculate when transactions change
    } catch (error) {
      console.error('Error adding transaction:', error);
      throw error; // Re-throw to let caller handle
    }
  };

  return { addTransaction };
}

/**
 * addTransactions (F-DASH-04) — write SEVERAL new transactions plus their
 * combined per-account balance effects in a SINGLE writeBatch, so a receipt
 * split into N categorized transactions can never partially apply (owner note:
 * keep the atomic-batch convention). Mirrors `makeAddTransaction`'s field
 * building and verified-only balance routing, accumulated per-account (a batch
 * must not write the same account doc twice). An empty list is a no-op.
 */
export function makeAddTransactions(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  householdSettings: Household | null;
  accounts: Account[];
}) {
  const { db, householdId, user, householdSettings, accounts } = deps;

  const addTransactions = async (
    txs: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[],
  ) => {
    if (!householdId) throw new Error('No household selected');
    if (!user) throw new Error('Not authenticated');
    if (txs.length === 0) return;

    // Validate every row up front so one bad item fails the whole batch cleanly
    // (all-or-nothing, matching the single-transaction validation in addTransaction).
    for (const tx of txs) {
      if (typeof tx.amount !== 'number' || isNaN(tx.amount)) throw new Error('Invalid amount');
      if (!tx.merchant || typeof tx.merchant !== 'string' || !tx.merchant.trim()) throw new Error('Invalid merchant');
      if (!tx.category || typeof tx.category !== 'string') throw new Error('Invalid category');
      if (!tx.date || typeof tx.date !== 'string') throw new Error('Invalid date');
      if (!['verified', 'pending_review'].includes(tx.status)) throw new Error('Invalid status');
    }

    try {
      const batch = writeBatch(db);
      const deltasByAccountId = new Map<string, number>();

      for (const tx of txs) {
        const roundedAmount = roundMoney(tx.amount);
        const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

        const docData: Record<string, unknown> = {
          amount: roundedAmount,
          merchant: tx.merchant.trim(),
          category: tx.category,
          date: tx.date,
          status: tx.status,
          isRecurring: tx.isRecurring ?? false,
          source: tx.source || 'camera-scan',
          autoCategorized: tx.autoCategorized ?? true,
          payPeriodId: payPeriodId || null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        };
        if (tx.relatedHabitIds && tx.relatedHabitIds.length > 0) docData.relatedHabitIds = tx.relatedHabitIds;
        if (tx.store && tx.store.trim()) docData.store = tx.store.trim();
        const trimmedAccountId = tx.accountId && tx.accountId.trim() ? tx.accountId.trim() : undefined;
        if (trimmedAccountId) docData.accountId = trimmedAccountId;
        if (tx.creditPayment === true) docData.creditPayment = true;
        if (tx.notes && tx.notes.trim()) docData.notes = tx.notes.trim();
        if (tx.receiptGroupId && tx.receiptGroupId.trim()) docData.receiptGroupId = tx.receiptGroupId.trim();

        const txRef = doc(collection(db, `households/${householdId}/transactions`));
        batch.set(txRef, docData);

        // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE (see addTransaction): a
        // pending_review row moves no balance; a verified row applies its
        // account-aware impact. Accumulate per-account so the batch writes each
        // account doc at most once.
        const target = resolveTargetAccount(trimmedAccountId, accounts);
        const balanceDelta = effectiveAccountImpact(
          { amount: roundedAmount, category: tx.category, creditPayment: tx.creditPayment, status: tx.status },
          target,
        );
        if (balanceDelta !== 0 && target) {
          deltasByAccountId.set(target.id, (deltasByAccountId.get(target.id) ?? 0) + balanceDelta);
        }
      }

      for (const [accId, delta] of deltasByAccountId) {
        const rounded = roundMoney(delta);
        if (rounded !== 0) {
          batch.update(doc(db, `households/${householdId}/accounts`, accId), {
            balance: increment(rounded),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      await batch.commit();

      for (const tx of txs) track('transaction_added', { source: tx.source || 'camera-scan' });
    } catch (error) {
      console.error('[addTransactions] Failed:', error);
      throw error;
    }
  };

  return { addTransactions };
}

/**
 * updateTransactionCategory — original closure captured `householdId`,
 * `currentUser`, `habits`, `transactions`, `accounts`, `householdSettings`.
 */
export function makeUpdateTransactionCategory(deps: {
  db: Firestore;
  householdId: string | null;
  currentUser: { uid: string } | null;
  habits: Habit[];
  transactions: Transaction[];
  accounts: Account[];
  householdSettings: Household | null;
}) {
  const { db, householdId, currentUser, habits, transactions, accounts, householdSettings } = deps;

  const updateTransactionCategory = async (
    id: string,
    category: string,
    relatedHabitIds?: string[],
    accountId?: string | null,
    overrides?: { amount?: number; merchant?: string; date?: string; clearNeedsAmount?: boolean; creditPayment?: boolean; isRecurring?: boolean },
  ) => {
    if (!householdId || !currentUser) return;

    // Verifying a pending transaction may also increment related habits and the
    // household points. Commit the transaction update, the checking-balance
    // delta, every habit update, and the points increment in a SINGLE writeBatch
    // so they can never diverge (a partial failure previously left habits/points
    // inconsistent).
    const batch = writeBatch(db);
    let totalPointsChange = 0;
    let successfulHabitsCount = 0;

    // VERIFIED-ONLY BALANCE (Plan 015): this is the primary "verify" action — it
    // sets status to `verified` and may change the category. A pending_review
    // transaction has NOT yet touched the balance, so promoting it to verified
    // must apply its (now effective) impact; if it was already verified this is a
    // pure category change (delta = newImpact − oldImpact, e.g. expense→Income
    // flips the sign). before = the existing transaction; after = same amount
    // with the new category + verified status.
    // If the transaction isn't in local state we cannot know its amount, so we
    // can't apply the correct balance delta. Bail rather than verify it with a
    // zero delta (which would mark it verified without ever debiting checking) —
    // matching updateTransaction/deleteTransaction, which also require the row.
    const existingTx = transactions.find(t => t.id === id);
    if (!existingTx) {
      toast.error('Transaction not found');
      return;
    }
    // An optional `accountId` (Action Queue smart approve) re-tags the
    // transaction, so the OLD and NEW target accounts may differ. Reverse the
    // old account's effective impact (0 for a pending row) and apply the new
    // account's, merged per-account so one batch never writes the same doc
    // twice — the same rule `updateTransaction` uses. Promoting a pending
    // credit charge to verified raises the card's debt; verifying a checking
    // expense debits checking.
    // `accountId === null` is an EXPLICIT clear of a previously-tagged account
    // (distinct from `undefined`, which leaves the existing tag untouched). A
    // clear removes the stored field and re-routes the impact to the checking
    // fallback via resolveTargetAccount(undefined, …).
    const clearAccount = accountId === null;
    const newAccountId = clearAccount ? undefined : (accountId?.trim() || undefined);
    const oldTarget = resolveTargetAccount(existingTx.accountId, accounts);
    const newTarget = resolveTargetAccount(
      clearAccount ? undefined : (newAccountId ?? existingTx.accountId),
      accounts,
    );

    // An inline edit (Action Queue / on-open review) can change the amount in the
    // same verify. Use the OVERRIDE amount (not the possibly-stale/zero stored
    // amount) for the applied impact, so a $0 "awaiting amount" stub debits the
    // entered amount exactly once (reverse 0, apply −entered). Round to whole
    // cents before it drives both the stored amount and the balance delta.
    const editedAmount = overrides?.amount !== undefined ? roundMoney(overrides.amount) : undefined;
    const effectiveAmount = editedAmount ?? existingTx.amount;

    // The review drawer can flip the Charge/Payment flag in the same verify —
    // the OVERRIDE value (when present) must drive the applied impact so a
    // credit-card payment pays the card down instead of raising its debt.
    const effectiveCreditPayment = overrides?.creditPayment ?? existingTx.creditPayment;

    const reverseDelta = -effectiveAccountImpact(existingTx, oldTarget);
    const applyDelta = effectiveAccountImpact(
      { amount: effectiveAmount, category, creditPayment: effectiveCreditPayment, status: 'verified' },
      newTarget
    );
    const deltasByAccountId = new Map<string, number>();
    if (oldTarget) deltasByAccountId.set(oldTarget.id, (deltasByAccountId.get(oldTarget.id) ?? 0) + reverseDelta);
    if (newTarget) deltasByAccountId.set(newTarget.id, (deltasByAccountId.get(newTarget.id) ?? 0) + applyDelta);

    // A date edit re-buckets the transaction into the pay period covering the new
    // date (mirrors updateTransaction).
    const editedPayPeriodId = overrides?.date
      ? getPayPeriodForTransaction(overrides.date, householdSettings?.lastPaycheckDate)
      : undefined;

    // 1. Update Transaction. Verifying resolves any Action-Queue snooze, so the
    // stale marker doesn't linger on the doc. Inline edits (amount/merchant/date)
    // and clearing the `needsAmount` stub flag co-commit here in the same op.
    batch.update(doc(db, `households/${householdId}/transactions`, id), {
      category,
      status: 'verified',
      relatedHabitIds: relatedHabitIds || [],
      // An explicit clear removes the tag; a new tag sets it; undefined leaves it.
      ...(clearAccount ? { accountId: deleteField() } : newAccountId ? { accountId: newAccountId } : {}),
      ...(existingTx.reviewSnoozedUntil ? { reviewSnoozedUntil: deleteField() } : {}),
      ...(editedAmount !== undefined ? { amount: editedAmount } : {}),
      ...(overrides?.merchant !== undefined ? { merchant: overrides.merchant } : {}),
      // Truthy guard (not `!== undefined`): a blank date must not write an
      // undefined payPeriodId (WriteBatch.update throws on undefined). With the
      // truthy guard, editedPayPeriodId is only computed when a date is present.
      ...(overrides?.date ? { date: overrides.date, payPeriodId: editedPayPeriodId } : {}),
      ...(overrides?.clearNeedsAmount ? { needsAmount: false } : {}),
      // The review drawer can flag the spend as recurring in the same verify
      // (the caller also creates the subscription CalendarItem). Only ever sent
      // as `true` — an untouched toggle leaves the stored value alone.
      ...(overrides?.isRecurring ? { isRecurring: true } : {}),
      // Persist-only-when-true convention (matches addTransaction): an explicit
      // false override removes a stored flag rather than writing `false`.
      ...(overrides?.creditPayment !== undefined
        ? (overrides.creditPayment ? { creditPayment: true } : { creditPayment: deleteField() })
        : {}),
    });

    // 1b. Apply the account-balance impact of the status/category transition in
    // the SAME batch (server-side delta avoids lost updates from concurrent edits).
    for (const [accId, delta] of deltasByAccountId) {
      const rounded = roundMoney(delta);
      if (rounded !== 0) {
        batch.update(doc(db, `households/${householdId}/accounts`, accId), {
          balance: increment(rounded),
          lastUpdated: serverTimestamp(),
        });
      }
    }

    // 2. Increment Habits if any
    if (relatedHabitIds && relatedHabitIds.length > 0) {
      for (const habitId of relatedHabitIds) {
        const habit = habits.find(h => h.id === habitId);
        if (habit) {
          // Use extracted business logic
          const result = processToggleHabit(habit, 'up');
          if (result) {
            batch.update(doc(db, `households/${householdId}/habits`, habitId), {
              count: result.updatedHabit.count,
              totalCount: result.updatedHabit.totalCount,
              completedDates: result.updatedHabit.completedDates,
              streakDays: result.updatedHabit.streakDays,
              lastUpdated: serverTimestamp(),
            });

            // Accumulate points change
            totalPointsChange += result.pointsChange;
            successfulHabitsCount++;
          }
        } else {
          console.warn(`Habit ID ${habitId} not found in habits array. Skipping habit increment.`);
        }
      }

      // 3. Update Household Points
      if (totalPointsChange !== 0) {
        batch.update(doc(db, `households/${householdId}`), {
          'points.daily': increment(totalPointsChange),
          'points.weekly': increment(totalPointsChange),
          'points.total': increment(totalPointsChange),
        });
      }
    }

    // Commit all writes atomically
    await batch.commit();

    // Only the pending→verified promotion is the engagement signal (this method
    // also handles pure category edits on already-verified rows).
    if (existingTx.status === 'pending_review') track('transaction_verified');

    // DO NOT update bucket.spent - it's now calculated in real-time from transactions
    // The bucketSpentMap effect will automatically recalculate when transactions change

    // Toast feedback for habits (only after a successful commit)
    if (totalPointsChange !== 0) {
      const sign = totalPointsChange > 0 ? '+' : '';
      toast(
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          React.createElement('span', { className: 'font-bold' }, `${sign}${totalPointsChange} pts`),
          React.createElement('span', { className: 'text-sm opacity-80' }, `from ${successfulHabitsCount} habit(s)`),
        ),
        {
          duration: 2000,
          icon: toastIcon(Star, 'text-accent-600'),
          style: {
            background: '#ECFDF5',
            color: '#065F46',
            border: '1px solid #A7F3D0',
          },
        }
      );
    }

    toast.success('Verified & Categorized!');
  };

  return { updateTransactionCategory };
}

/**
 * updateTransaction — original closure captured `householdId`, `transactions`,
 * `householdSettings`, `accounts`.
 */
export function makeUpdateTransaction(deps: {
  db: Firestore;
  householdId: string | null;
  transactions: Transaction[];
  householdSettings: Household | null;
  accounts: Account[];
}) {
  const { db, householdId, transactions, householdSettings, accounts } = deps;

  const updateTransaction = async (id: string, updates: Partial<Transaction>, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // Round any incoming amount to whole cents before it is both stored (via
      // sanitizedUpdates below) and used for the balance delta, so the persisted
      // amount and the account balance can't drift by sub-cent amounts.
      if (updates.amount !== undefined) {
        updates.amount = roundMoney(updates.amount);
      }

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: an edit can change amount,
      // category, status, accountId AND creditPayment simultaneously, and the
      // OLD and NEW target accounts may differ (and be different types). Reverse
      // the old account's effective impact and apply the new account's, then
      // merge per-account so a single batch never writes the same doc twice.
      // This single rule handles every case:
      //   - amount/category/status change on the same account → net impact delta
      //   - re-tag checking→card (or card→card)              → money moves accounts
      //   - pending → verified / verified → pending          → apply / reverse
      //   - credit charge ↔ payment toggle                   → sign flip on the card
      const newAmount = updates.amount ?? transaction.amount;
      const newCategory = updates.category ?? transaction.category;
      const newStatus = updates.status ?? transaction.status;
      const newAccountId = 'accountId' in updates
        ? (updates.accountId?.trim() || undefined)
        : transaction.accountId;
      const newCreditPayment = 'creditPayment' in updates ? updates.creditPayment : transaction.creditPayment;

      const oldTarget = resolveTargetAccount(transaction.accountId, accounts);
      const newTarget = resolveTargetAccount(newAccountId, accounts);

      const reverseDelta = -effectiveAccountImpact(transaction, oldTarget);
      const applyDelta = effectiveAccountImpact(
        { amount: newAmount, category: newCategory, creditPayment: newCreditPayment, status: newStatus },
        newTarget
      );

      // Merge by account id: when old and new resolve to the SAME doc, Firestore
      // rejects two writes to it in one batch, so collapse to a single net delta.
      const deltasByAccountId = new Map<string, number>();
      if (oldTarget) deltasByAccountId.set(oldTarget.id, (deltasByAccountId.get(oldTarget.id) ?? 0) + reverseDelta);
      if (newTarget) deltasByAccountId.set(newTarget.id, (deltasByAccountId.get(newTarget.id) ?? 0) + applyDelta);

      // Recalculate pay period if date changed
      let payPeriodId = transaction.payPeriodId;
      if (updates.date) {
        payPeriodId = getPayPeriodForTransaction(updates.date, householdSettings?.lastPaycheckDate);
      }

      // Sanitize optional string fields - remove undefined or empty strings from updates
      // This prevents Firestore validation errors for empty strings
      const sanitizedUpdates: Record<string, unknown> = { ...updates };
      if (sanitizedUpdates.store === undefined || sanitizedUpdates.store === '') {
        delete sanitizedUpdates.store;
        // Clearing a store: omitting the field leaves the old value in
        // Firestore, so a caller explicitly clearing a previously-set store
        // (present `store` key with an empty/undefined value) must remove it
        // with deleteField(). Callers that simply omit `store` are unaffected.
        if ('store' in updates && !updates.store && transaction.store) {
          sanitizedUpdates.store = deleteField();
        }
      } else if (typeof sanitizedUpdates.store === 'string') {
        sanitizedUpdates.store = sanitizedUpdates.store.trim();
      }
      if (sanitizedUpdates.accountId === undefined || sanitizedUpdates.accountId === '') {
        delete sanitizedUpdates.accountId;
        // Untagging: omitting the field leaves the old value in Firestore, so a
        // caller explicitly clearing a previously-tagged account must remove it
        // with deleteField(). (The balance delta already re-routes to checking.)
        if ('accountId' in updates && !updates.accountId && transaction.accountId) {
          sanitizedUpdates.accountId = deleteField();
        }
      } else if (typeof sanitizedUpdates.accountId === 'string') {
        sanitizedUpdates.accountId = sanitizedUpdates.accountId.trim();
      }
      // creditPayment is only persisted when true (absent ⇒ charge). If the
      // caller is explicitly clearing a previously-true flag, remove it from the
      // doc with deleteField(); otherwise just drop the non-true value.
      if (sanitizedUpdates.creditPayment !== true) {
        delete sanitizedUpdates.creditPayment;
        if ('creditPayment' in updates && updates.creditPayment !== true && transaction.creditPayment) {
          sanitizedUpdates.creditPayment = deleteField();
        }
      }
      if (sanitizedUpdates.notes === undefined || sanitizedUpdates.notes === '') {
        delete sanitizedUpdates.notes;
      } else if (typeof sanitizedUpdates.notes === 'string') {
        sanitizedUpdates.notes = sanitizedUpdates.notes.trim();
      }
      // F-MONEY-13: an explicit `splitWith` key (present in `updates`, even as
      // `null`/`[]`) co-commits the split overlay in this SAME write instead of
      // a separate updateDoc — the overlay never touches a balance, but it does
      // touch the SAME transaction doc, so folding it in here avoids a second
      // sequential write to the same document. Sanitized/rounded exactly like
      // makeSetTransactionSplit's `cleaned` path; a zero-or-negative share is
      // dropped and an empty result clears the field via deleteField().
      if ('splitWith' in updates) {
        delete sanitizedUpdates.splitWith;
        const cleaned = (updates.splitWith ?? []).filter(p => roundMoney(p.shareAmount) > 0);
        sanitizedUpdates.splitWith = cleaned.length > 0 ? cleaned.map(sanitizeSplitParticipant) : deleteField();
      }

      // Atomically commit the transaction update and the account balance deltas in
      // a single writeBatch so they can never partially apply.
      const updateBatch = writeBatch(db);

      updateBatch.update(doc(db, `households/${householdId}/transactions`, id), {
        ...sanitizedUpdates,
        payPeriodId,
      });

      // Apply each account's net effective-impact delta (atomic server-side
      // increment). A re-tag moves money off the old account and onto the new.
      for (const [accId, delta] of deltasByAccountId) {
        const rounded = roundMoney(delta);
        if (rounded !== 0) {
          updateBatch.update(doc(db, `households/${householdId}/accounts`, accId), {
            balance: increment(rounded),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      await updateBatch.commit();

      if (!opts?.silent) toast.success('Transaction updated!');
    } catch (error) {
      console.error('[updateTransaction] Failed:', error);
      toast.error(describeError(error, 'update the transaction'));
      throw error;
    }
  };

  return { updateTransaction };
}

/**
 * deleteTransaction — original closure captured `householdId`, `transactions`,
 * `accounts`; `user` was added for the trash mirror's `deletedBy` stamp.
 */
export function makeDeleteTransaction(deps: {
  db: Firestore;
  householdId: string | null;
  transactions: Transaction[];
  accounts: Account[];
  user: { uid: string } | null;
}) {
  const { db, householdId, transactions, accounts, user } = deps;

  const deleteTransaction = async (id: string, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // Atomically restore the target account balance, mirror the row into the
      // unified trash (F-XCUT-03 — Recently Deleted parity), and delete the
      // transaction in a single writeBatch so they can never partially apply
      // (server-side delta avoids lost updates from concurrent edits / stale
      // local state).
      //
      // `withTrashMirror` mirrors softDeleteDoc's graceful degradation: if the
      // trash write is permission-denied (rules not deployed for `trash`), the
      // delete is retried WITHOUT the mirror so deleting keeps working — it just
      // isn't recoverable.
      const buildDeleteBatch = (withTrashMirror: boolean) => {
        const deleteBatch = writeBatch(db);

        // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: reverse only the EFFECTIVE impact,
        // on the account the transaction was tagged to. A verified transaction had
        // applied its account-aware impact, so deleting it reverses that (e.g.
        // deleting a verified card charge lowers the card's debt again); a
        // pending_review transaction never touched any balance, so deleting it must
        // NOT move a balance (its effective impact is 0).
        const target = resolveTargetAccount(transaction.accountId, accounts);
        const balanceDelta = -effectiveAccountImpact(transaction, target);
        if (balanceDelta !== 0 && target) {
          deleteBatch.update(doc(db, `households/${householdId}/accounts`, target.id), {
            balance: increment(roundMoney(balanceDelta)),
            lastUpdated: serverTimestamp(),
          });
        }

        if (withTrashMirror) {
          // Mirror the full row (minus the synthetic id) so Recently Deleted can
          // restore it verbatim; restore re-applies the balance impact reversed
          // above (see trashMutations.restoreTrashedItem).
          deleteBatch.set(doc(db, `households/${householdId}/trash`, trashDocId('transaction', id)), {
            domain: 'transaction',
            originalId: id,
            data: sanitizeFirestoreData(transactionTrashData(transaction)),
            deletedAt: serverTimestamp(),
            deletedBy: user?.uid ?? null,
          });
        }

        deleteBatch.delete(doc(db, `households/${householdId}/transactions`, id));
        return deleteBatch;
      };

      try {
        await buildDeleteBatch(true).commit();
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== 'permission-denied') throw error;
        await buildDeleteBatch(false).commit();
      }

      if (!opts?.silent) toast.success('Transaction deleted');
    } catch (error) {
      console.error('[deleteTransaction] Failed:', error);
      toast.error(describeError(error, 'delete the transaction'));
      throw error;
    }
  };

  return { deleteTransaction };
}

/**
 * mergeTransactions — original closure captured `householdId`, `transactions`,
 * `accounts`.
 */
export function makeMergeTransactions(deps: {
  db: Firestore;
  householdId: string | null;
  transactions: Transaction[];
  accounts: Account[];
}) {
  const { db, householdId, transactions, accounts } = deps;

  const mergeTransactions = async (keeperId: string, dupeId: string) => {
    if (!householdId) return;

    try {
      const keeperTx = transactions.find(tx => tx.id === keeperId);
      const dupeTx = transactions.find(tx => tx.id === dupeId);
      if (!keeperTx || !dupeTx) {
        // Throw (not return) so callers' catch blocks run and the review UI
        // doesn't advance as if the merge succeeded. The outer catch shows
        // the failure toast and re-throws.
        throw new Error('Transaction not found');
      }

      const updates = buildMergeUpdates(keeperTx, dupeTx);

      const mergeBatch = writeBatch(db);

      mergeBatch.update(doc(db, `households/${householdId}/transactions`, keeperId), {
        ...updates,
        // Always clear the flag on the surviving row — Firestore rejects a
        // plain `undefined`, so this uses the deleteField() sentinel rather
        // than routing through the pure `buildMergeUpdates` patch.
        possibleDuplicateOf: deleteField(),
      });

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: deleting the dupe must reverse
      // its EFFECTIVE impact on the account it was tagged to — exactly the
      // same rule `deleteTransaction` applies. A pending_review dupe never
      // touched a balance, so this is a no-op for the (expected) common case
      // of merging two still-pending rows; it only fires when the dupe was
      // independently verified against a (possibly different) account than
      // the keeper, so both accounts are adjusted correctly.
      const dupeTarget = resolveTargetAccount(dupeTx.accountId, accounts);
      const dupeBalanceDelta = -effectiveAccountImpact(dupeTx, dupeTarget);
      if (dupeBalanceDelta !== 0 && dupeTarget) {
        mergeBatch.update(doc(db, `households/${householdId}/accounts`, dupeTarget.id), {
          balance: increment(roundMoney(dupeBalanceDelta)),
          lastUpdated: serverTimestamp(),
        });
      }

      mergeBatch.delete(doc(db, `households/${householdId}/transactions`, dupeId));

      await mergeBatch.commit();

      track('duplicate_merged', { source: dupeTx.source });
      toast.success('Transactions merged');
    } catch (error) {
      console.error('[mergeTransactions] Failed:', error);
      toast.error(describeError(error, 'merge the transactions'));
      throw error;
    }
  };

  return { mergeTransactions };
}

/**
 * keepBothTransactions — original closure captured only `householdId`.
 */
export function makeKeepBothTransactions(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const keepBothTransactions = async (txnId: string) => {
    if (!householdId) return;

    try {
      await updateDoc(doc(db, `households/${householdId}/transactions`, txnId), {
        possibleDuplicateOf: deleteField(),
      });
      track('duplicate_kept_both');
    } catch (error) {
      console.error('[keepBothTransactions] Failed:', error);
      toast.error(describeError(error, 'update the transaction'));
      throw error;
    }
  };

  return { keepBothTransactions };
}

/**
 * splitTransaction — original closure captured `householdId`, `user`,
 * `transactions`, `householdSettings`, `accounts`.
 */
export function makeSplitTransaction(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  transactions: Transaction[];
  householdSettings: Household | null;
  accounts: Account[];
}) {
  const { db, householdId, user, transactions, householdSettings, accounts } = deps;

  const splitTransaction = async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    if (!householdId || !user) return;

    try {
      const batch = writeBatch(db);
      const originalTx = transactions.find(t => t.id === originalTransactionId);

      if (!originalTx) {
        throw new Error('Original transaction not found');
      }

      // Round each split's STORED amount to whole cents ONCE, and use the same
      // value for the account deltas below (mirrors addTransaction). Persisting
      // the caller's raw amount (e.g. a typed "3.005") while applying a rounded
      // balance delta would desync the doc from the balance by a sub-cent forever.
      const roundedSplits = newTransactions.map(tx => ({ ...tx, amount: roundMoney(tx.amount) }));

      // 1. Delete original transaction
      const originalTxRef = doc(db, `households/${householdId}/transactions`, originalTransactionId);
      batch.delete(originalTxRef);

      // 2. Create new transactions
      roundedSplits.forEach(tx => {
        const newTxRef = doc(collection(db, `households/${householdId}/transactions`));
        const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

        batch.set(newTxRef, {
          ...tx,
          payPeriodId: payPeriodId || null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      });

      // 3. VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: the net change is
      // Σ effectiveAccountImpact(newSplit, its target) − effectiveAccountImpact(original, its target).
      // Splits may land on different accounts than the original and from each
      // other, so accumulate per-account and merge (a single batch must not write
      // the same account doc twice). When a VERIFIED expense is split into
      // verified expenses on the same account summing to the same total this nets
      // to 0 (historical no-op); splitting a PENDING_REVIEW capture into verified
      // splits applies their now-effective impact to the correct accounts.
      const deltasByAccountId = new Map<string, number>();
      const origTarget = resolveTargetAccount(originalTx.accountId, accounts);
      if (origTarget) {
        deltasByAccountId.set(origTarget.id, (deltasByAccountId.get(origTarget.id) ?? 0) - effectiveAccountImpact(originalTx, origTarget));
      }
      for (const tx of roundedSplits) {
        const t = resolveTargetAccount(tx.accountId?.trim() || undefined, accounts);
        if (t) {
          // tx.amount is already rounded to whole cents above — the SAME value
          // that was persisted — so the per-account delta can't desync from the
          // stored amount by a sub-cent.
          deltasByAccountId.set(t.id, (deltasByAccountId.get(t.id) ?? 0) + effectiveAccountImpact({ amount: tx.amount, category: tx.category, creditPayment: tx.creditPayment, status: tx.status }, t));
        }
      }
      for (const [accId, delta] of deltasByAccountId) {
        const rounded = roundMoney(delta);
        if (rounded !== 0) {
          batch.update(doc(db, `households/${householdId}/accounts`, accId), {
            balance: increment(rounded),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      // 4. Commit batch
      await batch.commit();

      toast.success('Transaction split successfully');
    } catch (error) {
      console.error('[splitTransaction] Failed:', error);
      toast.error(describeError(error, 'split the transaction'));
      throw error;
    }
  };

  return { splitTransaction };
}

/**
 * Strip a SplitParticipant down to only its defined fields, rounding the share
 * to whole cents. Firestore rejects `undefined` field values, so optional keys
 * are omitted rather than written as undefined.
 */
function sanitizeSplitParticipant(p: SplitParticipant): Record<string, unknown> {
  const out: Record<string, unknown> = { shareAmount: roundMoney(p.shareAmount) };
  if (p.memberId) out.memberId = p.memberId;
  if (p.email && p.email.trim()) out.email = p.email.trim().toLowerCase();
  if (p.name && p.name.trim()) out.name = p.name.trim();
  if (p.settled === true) out.settled = true;
  if (p.invitedAt) out.invitedAt = p.invitedAt;
  return out;
}

/**
 * setTransactionSplit — F-MONEY-13. Save (or clear) a transaction's split
 * overlay. This is a BOOKKEEPING-ONLY write: it never touches any account
 * balance (splitting is a display overlay like buckets), so a single `updateDoc`
 * is sufficient — no writeBatch is needed. Passing an empty array or `null`
 * removes the field entirely via `deleteField()`.
 */
export function makeSetTransactionSplit(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const setTransactionSplit = async (
    transactionId: string,
    split: SplitParticipant[] | null,
  ) => {
    if (!householdId) return;
    try {
      const cleaned = (split ?? []).filter(p => roundMoney(p.shareAmount) > 0);
      await updateDoc(doc(db, `households/${householdId}/transactions`, transactionId), {
        splitWith: cleaned.length > 0 ? cleaned.map(sanitizeSplitParticipant) : deleteField(),
      });
    } catch (error) {
      console.error('[setTransactionSplit] Failed:', error);
      toast.error(describeError(error, 'save the split'));
      throw error;
    }
  };

  return { setTransactionSplit };
}

/**
 * markSplitSettled — F-MONEY-13. Toggle the `settled` flag on ONE participant's
 * share of a split transaction (addressed by its `splitParticipantKey`). No
 * balance change (a split is an overlay), so this is a single `updateDoc` that
 * rewrites the whole `splitWith` array with the one participant flipped.
 */
export function makeMarkSplitSettled(deps: {
  db: Firestore;
  householdId: string | null;
  transactions: Transaction[];
}) {
  const { db, householdId, transactions } = deps;

  const markSplitSettled = async (
    transactionId: string,
    participantKey: string,
    settled: boolean = true,
  ) => {
    if (!householdId) return;
    const tx = transactions.find(t => t.id === transactionId);
    if (!tx || !tx.splitWith) {
      toast.error('Split not found');
      return;
    }
    try {
      const next = tx.splitWith.map(p =>
        splitParticipantKey(p) === participantKey ? { ...p, settled } : p,
      );
      await updateDoc(doc(db, `households/${householdId}/transactions`, transactionId), {
        splitWith: next.map(sanitizeSplitParticipant),
      });
    } catch (error) {
      console.error('[markSplitSettled] Failed:', error);
      toast.error(describeError(error, 'update the split'));
      throw error;
    }
  };

  return { markSplitSettled };
}
