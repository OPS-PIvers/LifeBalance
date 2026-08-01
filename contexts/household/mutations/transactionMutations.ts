import {
  doc,
  updateDoc,
  deleteField,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  increment,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { describeError } from '@/utils/errorMessages';
import React from 'react';
import { Star } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import {
  Account,
  CalendarItem,
  FreezeBank,
  FreezeBankHistoryEntry,
  FreezeMode,
  Habit,
  HabitSubmission,
  Household,
  SplitParticipant,
  Transaction,
} from '@/types/schema';
import type { MergeLearnAlias, MutationOpts } from '@/contexts/household/types';
import { effectiveAccountImpact, isBankSyncTransaction, resolveTargetAccount, shouldSkipBankSyncDelta } from '@/utils/accountImpact';
import { findSettledBill, settledBillRefusal, touchesSettledBillFields } from '@/utils/settledBillGuard';
import { splitParticipantKey } from '@/utils/settlement';
import { mergeTransactions as buildMergeUpdates } from '@/utils/transactionMerge';
import { processToggleHabit, habitPeriodStart, streakForHabit } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { FREEZE_MAX_TOKENS } from '@/utils/freezeBank';
import {
  memberFreezeBank,
  memberFreezeBankPatch,
  resolveFreezeMode,
} from '@/utils/freezeSettings';
import { frozenDatesByPath } from '@/utils/habitAttribution';
import { computeBackdatedHabitFire } from '@/utils/habitTriggerFire';
import {
  isWithinBackdateWindow,
  selectHabitsToFire,
  transactionAttribution,
} from '@/utils/transactionHabitFiring';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { roundMoney } from '@/utils/money';
import { trashDocId, transactionTrashData } from '@/utils/trash';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { track } from '@/services/analytics';
import { shouldTrackFirstTime, FIRST_TRANSACTION_FLAG } from '@/utils/firstTimeFlags';
import type { ToggleHabitResult } from '@/utils/habitLogic';

/**
 * Firestore patch for a habit fired (or un-fired) by a transaction approval,
 * written as DELTAS — never whole client-computed values. A stale-cache device
 * writing an absolute `completedDates` array wipes another device's completions
 * (the 2026-07-15 habit-history clobber incident), so completion history moves
 * only via arrayUnion/arrayRemove and the counters via increment(). A toggle
 * touches at most one date, so we diff old→new at the write site. `streakDays`
 * stays a derived scalar (self-correcting), defended with a fallback to the
 * habit's current value when processToggleHabit omits it.
 */
function habitDeltaUpdate(
  habit: Habit,
  result: ToggleHabitResult,
  opts?: { resetCount?: boolean },
): Record<string, unknown> {
  const prevDates = habit.completedDates;
  const nextDates = result.updatedHabit.completedDates ?? prevDates;
  const addedDate = nextDates.find(d => !prevDates.includes(d));
  const removedDate = prevDates.find(d => !nextDates.includes(d));
  const countDelta = (result.updatedHabit.count ?? habit.count) - habit.count;
  const totalCountDelta = (result.updatedHabit.totalCount ?? habit.totalCount) - habit.totalCount;

  return {
    // Counter as an increment() DELTA (stale-cache-safe). EXCEPTION: a stale
    // lazy-reset ('up' on a prior-period habit) writes the counter ABSOLUTELY —
    // `result` was computed from a zeroed effectiveHabit, so its count is
    // `0 + delta`, and the reset means to DISCARD the stale stored counter, not
    // increment it. See the call site's lazy-reset for how `resetCount` is set.
    ...(opts?.resetCount
      ? { count: result.updatedHabit.count ?? habit.count }
      : countDelta !== 0
        ? { count: increment(countDelta) }
        : {}),
    ...(totalCountDelta !== 0 ? { totalCount: increment(totalCountDelta) } : {}),
    ...(addedDate !== undefined ? { completedDates: arrayUnion(addedDate) } : {}),
    ...(removedDate !== undefined ? { completedDates: arrayRemove(removedDate) } : {}),
    streakDays: result.updatedHabit.streakDays ?? habit.streakDays,
    lastUpdated: serverTimestamp(),
  };
}

/**
 * Prior-period unit counts for the habits a transaction is about to fire.
 *
 * A threshold habit fired into a PAST period needs that period's already-
 * recorded unit count to know whether this fire crosses the target — the live
 * counter describes a later period and says nothing about it. Read the stored
 * submissions for exactly those habits, BEFORE opening any writes (Firestore
 * reads cannot participate in a batch, so every caller must await this before
 * it calls `writeBatch`). Incremental habits score per-action and
 * current-period fires use the live counter, so both skip the read.
 *
 * `logLabel` names the calling mutation in the fallback warning so the two
 * callers stay distinguishable in the console.
 */
async function readPriorPeriodCounts(deps: {
  db: Firestore;
  householdId: string;
  habits: Habit[];
  habitIdsToFire: readonly string[];
  fireDate: string;
  today: string;
  logLabel: string;
}): Promise<Map<string, number>> {
  const { db, householdId, habits, habitIdsToFire, fireDate, today, logLabel } = deps;

  const priorPeriodCounts = new Map<string, number>();
  // Loop-INVARIANT: the window depends only on the transaction's own date, so
  // an out-of-window row has nothing to read for ANY habit. Checked once here
  // rather than per-iteration (where it read as a per-habit rule, which it
  // never was); `computeBackdatedHabitFire` re-checks it per habit anyway, so
  // an out-of-window row still fires nothing.
  if (!isWithinBackdateWindow(fireDate, today)) return priorPeriodCounts;
  for (const habitId of habitIdsToFire) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habit.archivedAt || habit.scoringType === 'incremental') continue;
    const periodStart = habitPeriodStart(habit.period, fireDate);
    if (periodStart === habitPeriodStart(habit.period, today)) continue;
    const periodEnd = habit.period === 'weekly'
      ? format(addDays(parseISO(periodStart), 6), 'yyyy-MM-dd')
      : fireDate;
    try {
      const snap = await getDocs(query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        where('date', '>=', periodStart),
        where('date', '<=', periodEnd),
      ));
      priorPeriodCounts.set(
        habitId,
        snap.docs.reduce((sum, d) => sum + ((d.data() as HabitSubmission).count ?? 0), 0),
      );
    } catch (error) {
      // A failed read must not block the approval. Fall back to 0, which is
      // the pre-submissions assumption: the fire is treated as this period's
      // first unit. Worst case a threshold habit is credited a period early.
      console.warn(`${logLabel} Prior-period submission read failed:`, error);
    }
  }
  return priorPeriodCounts;
}

/** What `fireHabitsIntoBatch` accumulated across the habits it fired. */
interface HabitFireBatchResult {
  /** The ids that actually fired — the transaction's dedup ledger for them. */
  newlyFiredHabitIds: string[];
  /**
   * Points accumulated PER BUCKET, not as one scalar: a back-dated fire credits
   * `total` (lifetime) but must not touch today's `daily` or — if it predates
   * Monday — this week's `weekly`. Mirrors addHabitSubmission's date gating; the
   * pre-#1065 code incremented all three unconditionally, which was only correct
   * while every fire landed on today.
   */
  pointsDelta: { daily: number; weekly: number; total: number };
  /** Freeze tokens owed back because a fire completed an auto-frozen day. */
  freezeTokensRefunded: number;
  /** The history entries for those refunds. */
  freezeRefundEntries: FreezeBankHistoryEntry[];
  /**
   * Set only under `freezeMode: 'per_member'`: the uid whose OWN bank
   * (`freezeBanksByMember.<uid>`) is owed the refunds above. Absent means the
   * shared household `freezeBank` — the pre-stage-6 shape. `freezeRefundPatch`
   * is the single place that branches on it.
   */
  freezeRefundMemberId?: string;
  /** Signed sum of the points credited — drives the toast, not the writes. */
  totalPointsChange: number;
  /** How many habits actually fired — drives the toast, not the writes. */
  successfulHabitsCount: number;
}

/**
 * Fire `habitIdsToFire` onto `batch`, crediting each completion to `fireDate`.
 *
 * Adds the habit-doc delta update and the submission `set` for every habit that
 * fires, and RETURNS everything the caller still has to write itself — the
 * fired ledger for the transaction doc, and the points/freeze-refund figures for
 * the household doc (which must be merged into ONE update, since a batch may not
 * write the same document twice).
 *
 * Shared by the two paths that fire habits from a transaction: the review/verify
 * path (`makeUpdateTransactionCategory`) and the manual-entry create path
 * (`makeAddTransaction`), so a habit attached at entry scores exactly as one
 * attached at approval.
 *
 * FREEZE MODE. `createdByUid` — the person hand-entering or approving the row,
 * which is who this path always runs as — is ALSO the member whose freeze token
 * a fire un-freezes and refunds under `freezeMode: 'per_member'`. In the shared
 * modes (including an absent setting) `freezeMode` changes nothing here: the
 * uid is used for `HabitSubmission.createdBy` exactly as before, the un-freeze
 * reads `frozenDates`, and the refund lands on the shared household bank.
 */
function fireHabitsIntoBatch(
  batch: WriteBatch,
  deps: {
    db: Firestore;
    householdId: string;
    habits: Habit[];
    habitIdsToFire: readonly string[];
    fireDate: string;
    today: string;
    priorPeriodCounts: Map<string, number>;
    createdByUid: string;
    sourceTransactionId: string;
    /** RESOLVED via `resolveFreezeMode` — never the raw stored field. */
    freezeMode: FreezeMode;
  },
): HabitFireBatchResult {
  const {
    db, householdId, habits, habitIdsToFire, fireDate, today,
    priorPeriodCounts, createdByUid, sourceTransactionId, freezeMode,
  } = deps;

  const newlyFiredHabitIds: string[] = [];
  const pointsDelta = { daily: 0, weekly: 0, total: 0 };
  const freezeRefundEntries: FreezeBankHistoryEntry[] = [];
  let freezeTokensRefunded = 0;
  let freezeRefundMemberId: string | undefined;
  let totalPointsChange = 0;
  let successfulHabitsCount = 0;

  for (const habitId of habitIdsToFire) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) {
      console.warn(`Habit ID ${habitId} not found in habits array. Skipping habit increment.`);
      continue;
    }
    // An ARCHIVED habit must never fire (PRD #1065): a transaction's
    // relatedHabitIds may reference a habit archived after the tag was made
    // (keywordMatchedHabitIds already filters archived at suggestion time —
    // this is the defense for a persisted stale reference). Skip firing; the
    // approval completes normally with no points/streak side effect.
    // computeBackdatedHabitFire re-checks this; the explicit skip keeps the
    // habit out of firedHabitIds so a later un-archive can still fire it.
    if (habit.archivedAt) continue;

    // Out-of-window rows (older than HABIT_BACKDATE_MAX_DAYS, or future-dated)
    // record the association via relatedHabitIds but fire nothing — see
    // isWithinBackdateWindow for why an unbounded window is unsafe.
    const fire = computeBackdatedHabitFire(
      habit,
      fireDate,
      today,
      priorPeriodCounts.get(habitId) ?? 0,
      // Per-member freeze awareness. Inert in every shared mode — the delta is
      // then bit-for-bit what it was before this argument existed.
      { memberId: createdByUid, freezeMode },
    );
    if (!fire) continue;

    // DELTA WRITE (never whole client-computed values): increment() counters +
    // arrayUnion/arrayRemove completion history, so a stale-cache device can't
    // clobber another device's completions (2026-07-15 incident).
    batch.update(doc(db, `households/${householdId}/habits`, habitId), {
      // A past-period fire leaves the live counter alone entirely; a stale
      // current-period one writes it absolutely (see BackdatedHabitFireDelta).
      ...(fire.resetCount
        ? { count: fire.count }
        : fire.countDelta !== 0
          ? { count: increment(fire.countDelta) }
          : {}),
      totalCount: increment(fire.totalCountDelta),
      ...(fire.addedDate !== undefined ? { completedDates: arrayUnion(fire.addedDate) } : {}),
      ...(fire.unfrozenDate !== undefined ? { frozenDates: arrayRemove(fire.unfrozenDate) } : {}),
      // PER-MEMBER un-freeze: a DOT PATH arrayRemove of just this uid, so the
      // other members frozen on the same date keep their protection and no
      // whole-map write can clobber them (same discipline as `completedBy`).
      // Mutually exclusive with `frozenDates` above — the mode picks one.
      ...(fire.unfrozenDateFor !== undefined
        ? {
            [frozenDatesByPath(fire.unfrozenDateFor.date)]: arrayRemove(
              fire.unfrozenDateFor.memberId,
            ),
          }
        : {}),
      streakDays: fire.streakDays,
      // Every transaction fire is a submission, so the calendar/insight paths
      // know to read this habit's stored per-date units rather than inferring
      // one completion per date.
      hasSubmissionTracking: true,
      lastUpdated: serverTimestamp(),
    });

    // The submission doc IS the back-dated record: it carries the date the
    // completion belongs to, the points actually credited, and the source
    // transaction — which is what makes the undo exact rather than a
    // recomputation. Same subcollection addHabitSubmission writes to.
    const submission: Omit<HabitSubmission, 'id'> = {
      habitId,
      habitTitle: habit.title,
      // A transaction carries a DATE but no time of day, so there is no true
      // timestamp to record. Noon LOCAL on the fire date is the deliberate
      // placeholder: HabitSubmissionLogModal renders this as a clock time and
      // bins it by hour, and midday reads as "time unknown" rather than
      // implying a precise moment. Local (not noon UTC) so the timestamp's
      // calendar day always equals `date` in the user's own timezone — the
      // app's date convention — instead of rolling over for UTC+13/+14.
      timestamp: new Date(`${fireDate}T12:00:00`).toISOString(),
      date: fireDate,
      count: 1,
      pointsEarned: fire.pointsEarned,
      streakDaysAtTime: fire.streakAtFireDate,
      multiplierApplied: fire.multiplier,
      createdBy: createdByUid,
      createdAt: new Date().toISOString(),
      sourceTransactionId,
    };
    batch.set(
      doc(collection(db, `households/${householdId}/habits/${habitId}/submissions`)),
      submission,
    );

    // A day that turns out to have been completed must not stay frozen, and
    // the token spent protecting that "miss" is owed back. Collected here and
    // written once by the caller so one batch never writes the household doc
    // twice.
    // One accumulator for BOTH modes — the date and the entry are identical;
    // only which bank receives them differs, and `freezeRefundMemberId` (set
    // only on the per-member arm) is what tells the caller which.
    const unfrozen = fire.unfrozenDate ?? fire.unfrozenDateFor?.date;
    if (unfrozen !== undefined) {
      freezeTokensRefunded++;
      if (fire.unfrozenDateFor !== undefined) {
        freezeRefundMemberId = fire.unfrozenDateFor.memberId;
      }
      freezeRefundEntries.push({
        id: crypto.randomUUID(),
        type: 'earned',
        amount: 1,
        date: today,
        habitId,
        habitDate: unfrozen,
        notes: `Freeze refunded: ${habit.title} was completed on ${unfrozen} after all (logged from a transaction)`,
        createdAt: new Date().toISOString(),
      });
    }

    pointsDelta.daily += fire.pointsDelta.daily;
    pointsDelta.weekly += fire.pointsDelta.weekly;
    pointsDelta.total += fire.pointsDelta.total;
    totalPointsChange += fire.pointsEarned;
    successfulHabitsCount++;
    newlyFiredHabitIds.push(habitId);
  }

  return {
    newlyFiredHabitIds,
    pointsDelta,
    freezeTokensRefunded,
    freezeRefundEntries,
    ...(freezeRefundMemberId !== undefined ? { freezeRefundMemberId } : {}),
    totalPointsChange,
    successfulHabitsCount,
  };
}

/**
 * The household-doc patch that refunds the freeze tokens `fireHabitsIntoBatch`
 * collected — one shape per freeze mode, both destined to be MERGED into the
 * caller's single `householdUpdates` object (a batch may not write the same
 * document twice, and points already live in that object).
 *
 *  - shared / freeze_both: the pre-existing whole-object `freezeBank` write,
 *    unchanged. `freezeBank` is a nested map, not a counter, and every existing
 *    writer treats it as last-writer-wins. Capped at the max so a refund can't
 *    push the bank above its ceiling.
 *  - per_member: DOT PATHS under `freezeBanksByMember.<uid>` via
 *    `memberFreezeBankPatch`, with the history entries riding an `arrayUnion`.
 *    Never a whole-map write, so one member's refund cannot clobber another's
 *    node — the inverse of `autoApplyFreezes`' `applyPerMember` spend, and
 *    capped at that member's own max exactly as the shared arm caps.
 *
 * Returns `{}` when nothing is owed (or when the shared bank hasn't loaded),
 * so the caller's household write is untouched — including the "no habits fired
 * ⇒ no household write at all" invariant in `addTransaction`.
 */
function freezeRefundPatch(args: {
  fired: Pick<
    HabitFireBatchResult,
    'freezeTokensRefunded' | 'freezeRefundEntries' | 'freezeRefundMemberId'
  >;
  householdSettings: Household | null;
  freezeBank: FreezeBank | null;
}): Record<string, unknown> {
  const { fired, householdSettings, freezeBank } = args;
  if (fired.freezeTokensRefunded <= 0) return {};

  const memberId = fired.freezeRefundMemberId;
  if (memberId !== undefined) {
    // Seeded read-side when the member has never spent a freeze, so no
    // migration write is needed when an admin flips the mode on.
    const bank = memberFreezeBank(householdSettings, memberId);
    return memberFreezeBankPatch(
      memberId,
      {
        ...bank,
        tokens: Math.min(
          bank.maxTokens ?? FREEZE_MAX_TOKENS,
          bank.tokens + fired.freezeTokensRefunded,
        ),
      },
      arrayUnion(...fired.freezeRefundEntries),
    );
  }

  if (!freezeBank) return {};
  return {
    freezeBank: {
      ...freezeBank,
      tokens: Math.min(
        freezeBank.maxTokens ?? FREEZE_MAX_TOKENS,
        freezeBank.tokens + fired.freezeTokensRefunded,
      ),
      history: [...freezeBank.history, ...fired.freezeRefundEntries],
    } satisfies FreezeBank,
  };
}

/**
 * Toast feedback for habits fired by a transaction (call only after a
 * successful commit). The attribution names the source ("via transaction:
 * <merchant>") so the user can always answer "why did my points change?"
 * (PRD #1065 story 19). A zero net change shows nothing.
 */
function showTransactionHabitPointsToast(args: {
  totalPointsChange: number;
  successfulHabitsCount: number;
  merchant: string | undefined;
  fireDate: string;
  today: string;
}) {
  const { totalPointsChange, successfulHabitsCount, merchant, fireDate, today } = args;
  if (totalPointsChange === 0) return;

  const sign = totalPointsChange > 0 ? '+' : '';
  toast(
    React.createElement(
      'div',
      { className: 'flex flex-col' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'font-bold' }, `${sign}${totalPointsChange} pts`),
        React.createElement('span', { className: 'text-sm opacity-80' }, `from ${successfulHabitsCount} habit(s)`),
      ),
      React.createElement(
        'span',
        { className: 'text-xs opacity-70' },
        // Name the DATE too whenever the fire was back-dated. Otherwise a
        // Tuesday approval silently credits Monday and the points move with
        // no visible cause — the same "why did my points change?" gap the
        // attribution string exists to close (PRD #1065 story 19).
        fireDate === today
          ? transactionAttribution(merchant)
          : `${transactionAttribution(merchant)} · logged ${format(parseISO(fireDate), 'EEE MMM d')}`,
      ),
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
 * (for the first-transaction analytics flag). `habits` + `freezeBank` were
 * added so a hand-entered transaction can fire the habits attached to it (see
 * the HABIT AUTOMATIONS block below), exactly as `updateTransactionCategory`
 * does on approval.
 */
export function makeAddTransaction(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  householdSettings: Household | null;
  accounts: Account[];
  habits: Habit[];
  freezeBank: FreezeBank | null;
  recentTransactionsRef: { current: Transaction[] };
}) {
  const { db, householdId, user, householdSettings, accounts, habits, freezeBank, recentTransactionsRef } = deps;

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

      // HABIT AUTOMATIONS (PRD #1065) — fire the habits attached to this entry.
      //
      // A hand-entered transaction is stamped `verified` by the capture modal,
      // so it never enters the Action Queue and never reaches
      // `updateTransactionCategory` — until this block, the ONLY code that fires
      // a habit from a transaction. Attaching a habit at entry therefore saved
      // the association (`relatedHabitIds`, above) and fired nothing at all.
      //
      // Deliberately VERIFIED-ONLY. A `pending_review` capture (receipt scan,
      // statement scan, Apple Pay stub) carries AI-SUGGESTED habit ids that the
      // review card exists to let the user confirm or untick, and every one of
      // those rows does reach `updateTransactionCategory` on approval. Firing at
      // import time would both pre-empt that review and — because a statement
      // scan writes one row per purchase, each carrying the same suggestions —
      // log a single habit once per row.
      const today = getLocalDateString();
      // The transaction's OWN date, never today: a row is dated to when the
      // money moved, and the fire belongs to that day (same rule as the verify
      // path). Out-of-window/future dates fire nothing (isWithinBackdateWindow).
      const fireDate = tx.date;
      // A brand-new doc has fired nothing, so there is no ledger to dedup
      // against — routed through the shared selector anyway so both paths agree
      // on ordering and on repeats within the requested list.
      const { toFire: habitIdsToFire } = selectHabitsToFire(
        tx.status === 'verified' ? (tx.relatedHabitIds ?? []) : [],
        [],
      );
      // Reads cannot participate in a batch, so this must precede writeBatch().
      // Skipped entirely when nothing will fire, so a transaction with no
      // habits issues no extra reads and behaves exactly as it did before.
      const priorPeriodCounts = habitIdsToFire.length > 0
        ? await readPriorPeriodCounts({
            db, householdId, habits, habitIdsToFire, fireDate, today,
            logLabel: '[addTransaction]',
          })
        : new Map<string, number>();

      // Commit the new transaction and the account-balance delta in a SINGLE
      // writeBatch so they can never partially apply. Pre-allocate the
      // transaction ref so it participates in the batch.
      const batch = writeBatch(db);
      const txRef = doc(collection(db, `households/${householdId}/transactions`));

      // Fire BEFORE the transaction `set`: the fired-ledger has to be in
      // `docData` by the time it is written (a batch never writes one doc
      // twice), and `batch.set` serializes its data at call time.
      const fired = habitIdsToFire.length > 0
        ? fireHabitsIntoBatch(batch, {
            db, householdId, habits, habitIdsToFire, fireDate, today, priorPeriodCounts,
            createdByUid: user.uid,
            sourceTransactionId: txRef.id,
            // Resolved (never the raw field) so an absent/unknown setting maps
            // onto today's shared-bank behaviour.
            freezeMode: resolveFreezeMode(householdSettings),
          })
        : null;
      // A plain ARRAY, not arrayUnion: this is a `set` on a brand-new document,
      // so there is nothing to union against. Persist-only-when-present,
      // matching the optional-field convention above.
      if (fired && fired.newlyFiredHabitIds.length > 0) {
        docData.firedHabitIds = fired.newlyFiredHabitIds;
      }

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

      // Household points for the habits fired above, plus any freeze token owed
      // back. Both live on the household doc, so they are merged into a SINGLE
      // update — a batch may not write the same document twice. When nothing
      // fired, the household doc is not written at all (this mutation wrote
      // nothing to it before habit firing existed, and still must not).
      if (fired) {
        const householdUpdates: Record<string, unknown> = {};
        if (fired.pointsDelta.daily !== 0) householdUpdates['points.daily'] = increment(fired.pointsDelta.daily);
        if (fired.pointsDelta.weekly !== 0) householdUpdates['points.weekly'] = increment(fired.pointsDelta.weekly);
        if (fired.pointsDelta.total !== 0) householdUpdates['points.total'] = increment(fired.pointsDelta.total);
        // Merged into the SAME object as the points above — shared bank or the
        // acting member's own, depending on the freeze mode (freezeRefundPatch).
        Object.assign(householdUpdates, freezeRefundPatch({ fired, householdSettings, freezeBank }));
        if (Object.keys(householdUpdates).length > 0) {
          batch.update(doc(db, `households/${householdId}`), householdUpdates);
        }
      }

      // Read the live window BEFORE the commit so latency-compensated listeners
      // can't already include this write (ref, not `transactions`, to keep the
      // callback's deps free of per-transaction churn).
      const wasFirstTransaction = recentTransactionsRef.current.length === 0;

      await batch.commit();

      track('transaction_added', { source: tx.source || 'manual' });
      if (shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, wasFirstTransaction)) track('first_transaction_added');

      // Same points toast the verify path shows (only after a successful
      // commit), including the "via transaction: <merchant>" attribution and the
      // back-dated `· logged <date>` suffix.
      if (fired) {
        showTransactionHabitPointsToast({
          totalPointsChange: fired.totalPointsChange,
          successfulHabitsCount: fired.successfulHabitsCount,
          merchant: tx.merchant.trim(),
          fireDate,
          today,
        });
      }

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
 *
 * DELIBERATELY DOES NOT FIRE HABITS, unlike `makeAddTransaction`. Its only
 * caller is the receipt SPLIT (CaptureModal), which copies the receipt-level
 * suggested habits onto EVERY category row — so firing per row would log one
 * grocery trip three times. Deduping that needs a decision this path hasn't
 * made yet; the rows are `pending_review`, so each still fires normally (and
 * once) when it is approved through `updateTransactionCategory`.
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
 * `freezeBank` was added for the back-dated-fire freeze refund (PRD #1065): a
 * fire that completes an auto-frozen day owes the spent token back.
 */
export function makeUpdateTransactionCategory(deps: {
  db: Firestore;
  householdId: string | null;
  currentUser: { uid: string } | null;
  habits: Habit[];
  transactions: Transaction[];
  accounts: Account[];
  householdSettings: Household | null;
  freezeBank: FreezeBank | null;
}) {
  const { db, householdId, currentUser, habits, transactions, accounts, householdSettings, freezeBank } = deps;

  const updateTransactionCategory = async (
    id: string,
    category: string,
    relatedHabitIds?: string[],
    accountId?: string | null,
    overrides?: { amount?: number; merchant?: string; date?: string; notes?: string; clearNeedsAmount?: boolean; creditPayment?: boolean; isRecurring?: boolean },
  ) => {
    if (!householdId || !currentUser) return;

    // Verifying a pending transaction may also increment related habits and the
    // household points. Commit the transaction update, the checking-balance
    // delta, every habit update, and the points increment in a SINGLE writeBatch
    // so they can never diverge (a partial failure previously left habits/points
    // inconsistent).
    const batch = writeBatch(db);

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

    // BANK-SYNC EXCEPTION (PER-TARGET, not per-row): for a bank-email-sync row
    // the account balance was set authoritatively from the bank email's ENDING
    // BALANCE (already reflecting this transaction), not accumulated from the
    // row — so a delta destined for that AUTHORITATIVE account must be
    // skipped (see isBankSyncTransaction). But a re-tag to a DIFFERENT
    // (manual) account is ordinary bookkeeping on THAT account — its delta
    // must apply normally, or the destination account permanently under-counts
    // the move. `bankSyncHomeAccountId` resolves which account is currently
    // authoritative for this row (the persisted `bankSyncAccountId`, or — on
    // a row never yet edited/re-tagged — the OLD account itself, which is
    // also what gets stamped onto the doc below the first time).
    const isBankSync = isBankSyncTransaction(existingTx);
    const bankSyncHomeId = isBankSync ? (existingTx.bankSyncAccountId ?? oldTarget?.id) : undefined;
    const reverseDelta = shouldSkipBankSyncDelta(existingTx, oldTarget?.id, oldTarget?.id)
      ? 0
      : -effectiveAccountImpact(existingTx, oldTarget);
    const applyDelta = shouldSkipBankSyncDelta(existingTx, newTarget?.id, oldTarget?.id)
      ? 0
      : effectiveAccountImpact(
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

    // Habit Automations (PRD #1065): DEDUP the fire set. A transaction fires a
    // given habit at most once — `existingTx.firedHabitIds` is the ledger, so
    // re-editing or re-approving the same row can't double-log. Everything in
    // `relatedHabitIds` that hasn't fired before is fired now; already-fired
    // ids stay recorded as an association but are NOT re-incremented.
    const { toFire: habitIdsToFire } = selectHabitsToFire(
      relatedHabitIds ?? [],
      existingTx.firedHabitIds ?? [],
    );

    // The date the fired habits are credited to. A transaction is dated to when
    // the money actually MOVED, and the nightly bankEmailSync delivers it the
    // next morning — so crediting "today" (which is what processToggleHabit
    // does, having no date parameter) logged every automated import on the wrong
    // day. An inline date edit in this same verify wins over the stored date.
    // Falls back to today when the row carries no date at all: `date` is
    // required by the schema, but a legacy/partial doc that lacks it must still
    // approve rather than throw on an undefined parse.
    const today = getLocalDateString();
    const fireDate = overrides?.date ?? existingTx.date ?? today;

    // Reads cannot participate in a batch, so the prior-period submission read
    // happens before any write is queued (see readPriorPeriodCounts).
    const priorPeriodCounts = await readPriorPeriodCounts({
      db, householdId, habits, habitIdsToFire, fireDate, today,
      logLabel: '[updateTransactionCategory]',
    });

    // 2. Fire the to-fire habits FIRST so the transaction write below can
    // co-commit the fired-ledger update (firedHabitIds) in the SAME op.
    const fired = fireHabitsIntoBatch(batch, {
      db, householdId, habits, habitIdsToFire, fireDate, today, priorPeriodCounts,
      createdByUid: currentUser.uid,
      sourceTransactionId: id,
      // Resolved (never the raw field) so an absent/unknown setting maps onto
      // today's shared-bank behaviour.
      freezeMode: resolveFreezeMode(householdSettings),
    });
    const { newlyFiredHabitIds, pointsDelta, totalPointsChange, successfulHabitsCount } = fired;

    // 1. Update Transaction. Verifying resolves any Action-Queue snooze, so the
    // stale marker doesn't linger on the doc. Inline edits (amount/merchant/date)
    // and clearing the `needsAmount` stub flag co-commit here in the same op.
    batch.update(doc(db, `households/${householdId}/transactions`, id), {
      // Append the just-fired habit ids to the per-transaction dedup ledger
      // (arrayUnion so a concurrent editor can't clobber the set).
      ...(newlyFiredHabitIds.length > 0 ? { firedHabitIds: arrayUnion(...newlyFiredHabitIds) } : {}),
      category,
      status: 'verified',
      relatedHabitIds: relatedHabitIds || [],
      // An explicit clear removes the tag; a new tag sets it; undefined leaves it.
      ...(clearAccount ? { accountId: deleteField() } : newAccountId ? { accountId: newAccountId } : {}),
      ...(existingTx.reviewSnoozedUntil ? { reviewSnoozedUntil: deleteField() } : {}),
      ...(editedAmount !== undefined ? { amount: editedAmount } : {}),
      ...(overrides?.merchant !== undefined ? { merchant: overrides.merchant } : {}),
      // Optional "what was bought" note. Persist-only-when-non-empty: an
      // explicit '' override clears stored notes via deleteField().
      ...(overrides?.notes !== undefined
        ? (overrides.notes.trim() ? { notes: overrides.notes.trim() } : { notes: deleteField() })
        : {}),
      // Truthy guard (not `!== undefined`): a blank date must not write an
      // undefined payPeriodId (WriteBatch.update throws on undefined). With the
      // truthy guard, editedPayPeriodId is only computed when a date is present.
      ...(overrides?.date ? { date: overrides.date, payPeriodId: editedPayPeriodId } : {}),
      ...(overrides?.clearNeedsAmount ? { needsAmount: false } : {}),
      // A bank-email-sync row is born `verified` + `needsCategory` (the account
      // balance is authoritative from the email). Assigning a category clears
      // the flag; because the row is ALREADY verified, the reverse+apply impact
      // above cancels to a zero net balance delta (no double-debit) whenever the
      // account is unchanged — exactly the desired "bucket-assignment only".
      ...(existingTx.needsCategory ? { needsCategory: false } : {}),
      // The review drawer can flag the spend as recurring in the same verify
      // (the caller also creates the subscription CalendarItem). Only ever sent
      // as `true` — an untouched toggle leaves the stored value alone.
      ...(overrides?.isRecurring ? { isRecurring: true } : {}),
      // Persist-only-when-true convention (matches addTransaction): an explicit
      // false override removes a stored flag rather than writing `false`.
      ...(overrides?.creditPayment !== undefined
        ? (overrides.creditPayment ? { creditPayment: true } : { creditPayment: deleteField() })
        : {}),
      // Backfill-on-write: stamp the bank-sync row's authoritative account the
      // FIRST time it's ever edited client-side, so a later re-tag away and
      // back can still tell which account is exempt from delta bookkeeping.
      // Never overwrites an already-stamped value.
      ...(isBankSync && !existingTx.bankSyncAccountId && bankSyncHomeId ? { bankSyncAccountId: bankSyncHomeId } : {}),
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

    // 3. Update Household Points for the habits fired above, plus any freeze
    // token owed back. Both live on the household doc, so they are merged into a
    // SINGLE update — a batch may not write the same document twice.
    const householdUpdates: Record<string, unknown> = {};
    if (pointsDelta.daily !== 0) householdUpdates['points.daily'] = increment(pointsDelta.daily);
    if (pointsDelta.weekly !== 0) householdUpdates['points.weekly'] = increment(pointsDelta.weekly);
    if (pointsDelta.total !== 0) householdUpdates['points.total'] = increment(pointsDelta.total);
    // Merged into the SAME object as the points above — shared bank or the
    // acting member's own, depending on the freeze mode (freezeRefundPatch).
    Object.assign(householdUpdates, freezeRefundPatch({ fired, householdSettings, freezeBank }));
    if (Object.keys(householdUpdates).length > 0) {
      batch.update(doc(db, `households/${householdId}`), householdUpdates);
    }

    // Commit all writes atomically
    await batch.commit();

    // Only the pending→verified promotion is the engagement signal (this method
    // also handles pure category edits on already-verified rows).
    if (existingTx.status === 'pending_review') track('transaction_verified');

    // DO NOT update bucket.spent - it's now calculated in real-time from transactions
    // The bucketSpentMap effect will automatically recalculate when transactions change

    // Toast feedback for habits (only after a successful commit).
    showTransactionHabitPointsToast({
      totalPointsChange,
      successfulHabitsCount,
      merchant: overrides?.merchant ?? existingTx.merchant,
      fireDate,
      today,
    });

    toast.success('Verified & Categorized!');
  };

  return { updateTransactionCategory };
}

/**
 * reverseTransactionApproval (Habit Automations, PRD #1065) — the atomic UNDO
 * for a swipe-approve that fired habits. In ONE writeBatch it:
 *   1. reverses the transaction back to `pending_review`, restoring the prior
 *      category / account tag / relatedHabitIds and crediting back the balance
 *      delta the approve applied (verified → pending has an effective impact of
 *      0, so the applied amount is reversed off the target account);
 *   2. reverses every habit the approve fired from the SUBMISSION doc that fire
 *      wrote — exact points, exact date — deleting those submissions;
 *   3. clears the `firedHabitIds` ledger so a later re-approve can legitimately
 *      fire again.
 * `firedHabitIds` is passed explicitly (the ids we just fired) rather than read
 * from the possibly-not-yet-synced transaction doc, so the undo is race-free.
 *
 * KNOWN GAP: a forward fire that completed an auto-FROZEN day removes that date
 * from `frozenDates` and refunds the token. This undo does not re-freeze it, so
 * undoing that specific approval leaves the streak broken where the freeze had
 * been protecting it. Re-freezing has its own unanswered questions (the token
 * may since have been spent elsewhere; the bank may be full), and
 * `autoApplyFreezes` only ever considers YESTERDAY so it won't self-heal an
 * older day. Rare enough to name rather than build machinery for.
 */
export function makeReverseTransactionApproval(deps: {
  db: Firestore;
  householdId: string | null;
  habits: Habit[];
  transactions: Transaction[];
  accounts: Account[];
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, habits, transactions, accounts, calendarItems } = deps;

  const reverseTransactionApproval = async (
    id: string,
    prior: { category: string; accountId?: string; relatedHabitIds?: string[] },
    firedHabitIds: string[],
  ) => {
    if (!householdId) return;

    const existingTx = transactions.find(t => t.id === id);
    if (!existingTx) {
      toast.error('Transaction not found');
      return;
    }

    // SETTLED-BILL GUARD (TODO.md 2H(a)): this undo knows nothing about bills.
    // Reversing a row that settled one would send the transaction back to
    // `pending_review` and credit the balance back while leaving the bill marked
    // paid and its paid-instance doc orphaned — a silent money/calendar
    // divergence. See utils/settledBillGuard.ts; the same refusal guards every
    // other mutation that could break the pair (delete/merge/split/edit).
    const settledBill = findSettledBill(existingTx, calendarItems);
    if (settledBill) {
      toast.error(settledBillRefusal('undo', settledBill.title));
      return;
    }

    const batch = writeBatch(db);

    // 1. Reverse the balance the approve applied: reverse the CURRENT verified
    // impact off the account it landed on; the pending target's impact is 0, so
    // nothing is re-applied. Bank-sync rows never delta a balance (guarded).
    const currentTarget = resolveTargetAccount(existingTx.accountId, accounts);
    const reverseDelta = shouldSkipBankSyncDelta(existingTx, currentTarget?.id, currentTarget?.id)
      ? 0
      : -effectiveAccountImpact(existingTx, currentTarget);
    if (currentTarget) {
      const rounded = roundMoney(reverseDelta);
      if (rounded !== 0) {
        batch.update(doc(db, `households/${householdId}/accounts`, currentTarget.id), {
          balance: increment(rounded),
          lastUpdated: serverTimestamp(),
        });
      }
    }

    // Restore the transaction to its pre-approve state and clear the fired
    // ledger so the row can be re-approved cleanly.
    batch.update(doc(db, `households/${householdId}/transactions`, id), {
      status: 'pending_review',
      category: prior.category,
      relatedHabitIds: prior.relatedHabitIds ?? [],
      firedHabitIds: deleteField(),
      ...(prior.accountId ? { accountId: prior.accountId } : { accountId: deleteField() }),
    });

    // 2. Reverse each fired habit from the SUBMISSION the fire wrote.
    //
    // The forward fire back-dates to the transaction's date, so a plain
    // `processToggleHabit(habit, 'down')` — which keys on TODAY — would strip the
    // wrong day's completion and refund at the wrong multiplier. The submission
    // doc records the date it credited and the points it actually credited, so
    // reversing from it is exact by construction: a completion that landed in
    // between and shifted that day's streak can't make the refund disagree with
    // the charge (which recomputing the historical multiplier would).
    const today = getLocalDateString();
    const weekStart = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const pointsDelta = { daily: 0, weekly: 0, total: 0 };

    for (const habitId of firedHabitIds) {
      const habit = habits.find(h => h.id === habitId);
      if (!habit) continue;

      // The fire's own record. Read by source transaction so an undo can never
      // consume a hand-entered submission on the same date.
      let fired: (HabitSubmission & { id: string })[] = [];
      try {
        const snap = await getDocs(query(
          collection(db, `households/${householdId}/habits/${habitId}/submissions`),
          where('sourceTransactionId', '==', id),
        ));
        fired = snap.docs.map(d => ({ ...(d.data() as HabitSubmission), id: d.id }));
      } catch (error) {
        console.warn('[reverseTransactionApproval] Submission read failed:', error);
      }

      if (fired.length === 0) {
        // No submission to reverse. Either the fire predates this change (a
        // legacy same-day toggle-path fire) or the read failed — fall back to the
        // old same-day decrement, which is correct for exactly those rows.
        const result = processToggleHabit(habit, 'down');
        if (result) {
          batch.update(doc(db, `households/${householdId}/habits`, habitId), habitDeltaUpdate(habit, result));
          pointsDelta.daily += result.pointsChange;
          pointsDelta.weekly += result.pointsChange;
          pointsDelta.total += result.pointsChange;
        }
        continue;
      }

      const reversedDates = new Set(fired.map(s => s.date));
      const unitsReversed = fired.reduce((sum, s) => sum + (s.count ?? 0), 0);
      const creditedPoints = fired.reduce((sum, s) => sum + (s.pointsEarned ?? 0), 0);

      // Only units belonging to the habit's CURRENT period came out of the live
      // counter; a past-period fire never touched it, so it must not be
      // decremented now (that would corrupt a later period's count).
      const liveUnitsReversed = fired
        .filter(s => habitPeriodStart(habit.period, s.date) === habitPeriodStart(habit.period, today))
        .reduce((sum, s) => sum + (s.count ?? 0), 0);

      // A date leaves completedDates only if this transaction's submissions were
      // the last units on it. Any other submission on that date — or a manual
      // toggle that put the date there — keeps it completed.
      const remainingByDate = new Map<string, number>();
      try {
        // Scoped to the dates being reversed rather than reading the whole
        // subcollection: a habit logged daily for a year holds 365+ docs and all
        // but one would be discarded here. A transaction fire writes exactly one
        // submission per habit, so this is a 1-value `in` in practice; the guard
        // is for Firestore's 30-value ceiling, above which the full scan is the
        // only correct read.
        const dates = [...reversedDates];
        const submissionsRef = collection(db, `households/${householdId}/habits/${habitId}/submissions`);
        const allSnap = await getDocs(
          dates.length <= 30 ? query(submissionsRef, where('date', 'in', dates)) : submissionsRef,
        );
        for (const d of allSnap.docs) {
          const s = d.data() as HabitSubmission;
          if (!reversedDates.has(s.date) || fired.some(f => f.id === d.id)) continue;
          remainingByDate.set(s.date, (remainingByDate.get(s.date) ?? 0) + (s.count ?? 0));
        }
      } catch (error) {
        // Read failed: keep the dates completed rather than risk deleting a day
        // that other submissions still justify. Under-reversing is recoverable;
        // wrongly erasing completion history is not (2026-07-15 incident).
        console.warn('[reverseTransactionApproval] Submission scan failed:', error);
        for (const date of reversedDates) remainingByDate.set(date, 1);
      }
      const datesToClear = [...reversedDates].filter(d => (remainingByDate.get(d) ?? 0) === 0);
      const nextCompletedDates = habit.completedDates.filter(d => !datesToClear.includes(d));

      batch.update(doc(db, `households/${householdId}/habits`, habitId), {
        ...(liveUnitsReversed > 0 ? { count: increment(-liveUnitsReversed) } : {}),
        totalCount: increment(-Math.min(unitsReversed, habit.totalCount)),
        ...(datesToClear.length > 0 ? { completedDates: arrayRemove(...datesToClear) } : {}),
        streakDays: streakForHabit({
          period: habit.period,
          completedDates: nextCompletedDates,
          frozenDates: habit.frozenDates,
          pausedUntil: habit.pausedUntil,
        }),
        lastUpdated: serverTimestamp(),
      });

      // Delete the fire's records so a re-approve writes fresh ones rather than
      // double-counting against stale history.
      for (const s of fired) {
        batch.delete(doc(db, `households/${householdId}/habits/${habitId}/submissions`, s.id));
      }

      // Bucket-gate the refund by the date each submission credited, mirroring
      // the forward fire — reversing a Monday fire must not drain today's daily.
      pointsDelta.total -= creditedPoints;
      for (const s of fired) {
        if (s.date === today) pointsDelta.daily -= s.pointsEarned ?? 0;
        if (s.date >= weekStart && s.date <= today) pointsDelta.weekly -= s.pointsEarned ?? 0;
      }
    }

    const householdUpdates: Record<string, unknown> = {};
    if (pointsDelta.daily !== 0) householdUpdates['points.daily'] = increment(pointsDelta.daily);
    if (pointsDelta.weekly !== 0) householdUpdates['points.weekly'] = increment(pointsDelta.weekly);
    if (pointsDelta.total !== 0) householdUpdates['points.total'] = increment(pointsDelta.total);
    if (Object.keys(householdUpdates).length > 0) {
      batch.update(doc(db, `households/${householdId}`), householdUpdates);
    }

    await batch.commit();
  };

  return { reverseTransactionApproval };
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
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, transactions, householdSettings, accounts, calendarItems } = deps;

  const updateTransaction = async (id: string, updates: Partial<Transaction>, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // SETTLED-BILL GUARD (see utils/settledBillGuard.ts): re-pricing, re-tagging
      // or un-verifying a row that settled a bill would move the balance while the
      // calendar doc keeps the amount/paid state it was settled at. Only the fields
      // the pair actually depends on are refused — a notes/merchant/date edit can't
      // diverge the two documents and stays allowed.
      if (touchesSettledBillFields(updates, transaction)) {
        const settledBill = findSettledBill(transaction, calendarItems);
        if (settledBill) {
          toast.error(settledBillRefusal('edit', settledBill.title));
          return;
        }
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

      // BANK-SYNC EXCEPTION (PER-TARGET, not per-row): a bank-email-sync row's
      // account balance came authoritatively from the bank email's ENDING
      // BALANCE (which already reflects the transaction) — it was never
      // accumulated from this row, so a delta destined for that
      // AUTHORITATIVE account must be skipped. But re-tagging the row to a
      // DIFFERENT (manual) account moves its impact onto that account like an
      // ordinary transaction — skipping the apply there too would silently
      // drop the money everywhere (the original bug). `bankSyncHomeAccountId`
      // resolves which account is currently authoritative for this row (the
      // persisted `bankSyncAccountId`, or — on a row never yet edited/re-tagged
      // — the OLD account itself, which is also what gets stamped onto the
      // doc below the first time). See isBankSyncTransaction /
      // shouldSkipBankSyncDelta.
      const isBankSync = isBankSyncTransaction(transaction);
      const bankSyncHomeId = isBankSync ? (transaction.bankSyncAccountId ?? oldTarget?.id) : undefined;
      const reverseDelta = shouldSkipBankSyncDelta(transaction, oldTarget?.id, oldTarget?.id)
        ? 0
        : -effectiveAccountImpact(transaction, oldTarget);
      const applyDelta = shouldSkipBankSyncDelta(transaction, newTarget?.id, oldTarget?.id)
        ? 0
        : effectiveAccountImpact(
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
        // Clearing notes: omitting the field leaves the old value in Firestore,
        // so a caller explicitly emptying previously-set notes must remove them
        // with deleteField() (same rule as `store` above).
        if ('notes' in updates && !updates.notes && transaction.notes) {
          sanitizedUpdates.notes = deleteField();
        }
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
        // Backfill-on-write: stamp the bank-sync row's authoritative account
        // the FIRST time it's ever edited client-side, so a later re-tag away
        // and back can still tell which account is exempt from delta
        // bookkeeping. Never overwrites an already-stamped value.
        ...(isBankSync && !transaction.bankSyncAccountId && bankSyncHomeId ? { bankSyncAccountId: bankSyncHomeId } : {}),
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
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, transactions, accounts, user, calendarItems } = deps;

  const deleteTransaction = async (id: string, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // SETTLED-BILL AUTO-UNDO (see utils/settledBillGuard.ts): deleting a row
      // that paid a bill reverses the balance, so leaving the calendar doc
      // marked paid would orphan it — that occurrence never returns to unpaid
      // bills and Safe-to-Spend overstates cash by its amount forever. The other
      // four guarded mutations still refuse; DELETE instead un-settles the bill
      // in the SAME batch (its callers warn about that before confirming),
      // inverting exactly what `payCalendarItem` wrote. See the batch below.
      const settledBill = findSettledBill(transaction, calendarItems);

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
        //
        // BANK-SYNC EXCEPTION (PER-TARGET, not per-row): a bank-email-sync row
        // (source 'bank-sync' / bankRef) is verified, but the account balance
        // was set authoritatively from the bank email's ENDING BALANCE — which
        // already reflects this transaction — not accumulated from the row.
        // Deleting the row must NOT credit the money back ON ITS
        // AUTHORITATIVE ACCOUNT: the bank's stated balance there is still
        // correct. BUT if the row was since re-tagged to a different (manual)
        // account, that account's balance WAS accumulated from this row (see
        // makeUpdateTransaction) and deleting must reverse it normally, or
        // that account is permanently overstated forever.
        // `bankSyncAccountId` (stamped on first edit — see makeUpdateTransaction
        // / makeUpdateTransactionCategory) tracks which account is currently
        // authoritative; falling back to the CURRENT tag for a never-edited
        // row preserves the original always-skip behavior.
        // KNOWN MIGRATION GAP: a row re-tagged BEFORE the stamp existed has no
        // bankSyncAccountId, so the fallback resolves its home to the manual
        // account it now sits on and the reversal is (wrongly) skipped. Those
        // rows' balance data was already compromised by the pre-fix code (the
        // old re-tag never debited the destination), so there is no correct
        // reversal to compute — accept the skip rather than guess.
        const target = resolveTargetAccount(transaction.accountId, accounts);
        const balanceDelta = shouldSkipBankSyncDelta(transaction, target?.id, target?.id)
          ? 0
          : -effectiveAccountImpact(transaction, target);
        if (balanceDelta !== 0 && target) {
          deleteBatch.update(doc(db, `households/${householdId}/accounts`, target.id), {
            balance: increment(roundMoney(balanceDelta)),
            lastUpdated: serverTimestamp(),
          });
        }

        // UN-SETTLE the bill this row paid, inverting `payCalendarItem`'s two
        // shapes. A recurring occurrence was paid by CREATING a paid-instance
        // doc (`parentRecurringId` set, `isRecurring: false`) whose only job is
        // to suppress that occurrence in `expandCalendarItems` — deleting it
        // restores the occurrence as unpaid. A one-off bill's own pre-existing
        // doc was updated in place, so clear `isPaid` and keep the doc. Its
        // `amount` deliberately stays at the paid figure: the budgeted amount
        // that write overwrote is not recoverable, and what actually cleared is
        // the better estimate for the re-opened bill.
        if (settledBill) {
          const billRef = doc(db, `households/${householdId}/calendarItems`, settledBill.id);
          if (settledBill.parentRecurringId && !settledBill.isRecurring) {
            deleteBatch.delete(billRef);
          } else {
            deleteBatch.update(billRef, { isPaid: false });
          }
        }

        if (withTrashMirror) {
          // Mirror the full row (minus the synthetic id) so Recently Deleted can
          // restore it verbatim; restore re-applies the balance impact reversed
          // above (see trashMutations.restoreTrashedItem). `paidCalendarItemId`
          // is dropped when we un-settled: the doc it named is now unpaid (or
          // gone), so a restore must not resurrect a link claiming otherwise.
          deleteBatch.set(doc(db, `households/${householdId}/trash`, trashDocId('transaction', id)), {
            domain: 'transaction',
            originalId: id,
            data: sanitizeFirestoreData(
              transactionTrashData(settledBill ? { ...transaction, paidCalendarItemId: undefined } : transaction)
            ),
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

      if (!opts?.silent) {
        toast.success(settledBill ? 'Transaction deleted — bill marked unpaid' : 'Transaction deleted');
      }
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
  user: { uid: string } | null;
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, transactions, accounts, user, calendarItems } = deps;

  /**
   * Resolves TRUE when the dupe was actually merged away, FALSE when the merge
   * was refused without writing anything (no household, or the settled-bill
   * guard). Callers advance their review UI only on `true` — returning void
   * made a refusal look identical to a success and the drawer moved on as
   * though a row had been merged. Errors still THROW (unchanged).
   */
  const mergeTransactions = async (keeperId: string, dupeId: string, learnAlias?: MergeLearnAlias): Promise<boolean> => {
    if (!householdId) return false;

    try {
      const keeperTx = transactions.find(tx => tx.id === keeperId);
      const dupeTx = transactions.find(tx => tx.id === dupeId);
      if (!keeperTx || !dupeTx) {
        // Throw (not return) so callers' catch blocks run and the review UI
        // doesn't advance as if the merge succeeded. The outer catch shows
        // the failure toast and re-throws.
        throw new Error('Transaction not found');
      }

      // SETTLED-BILL GUARD (see utils/settledBillGuard.ts): the DUPE is deleted by
      // this merge, so a dupe that settled a bill would orphan the paid calendar
      // doc exactly as deleteTransaction would. The keeper survives untouched by
      // any money field (`buildMergeUpdates` only unions identity/metadata), so it
      // needs no guard. Toast + return rather than throw so the caller's own
      // generic "failed to merge" toast doesn't bury the actual reason.
      const dupeSettledBill = findSettledBill(dupeTx, calendarItems);
      if (dupeSettledBill) {
        toast.error(settledBillRefusal('merge away', dupeSettledBill.title));
        return false;
      }

      const updates = buildMergeUpdates(keeperTx, dupeTx);

      // The dupe is DELETED here, so it gets the same trash mirror
      // `deleteTransaction` writes (F-XCUT-03) — a merge is the one delete in
      // this app the user is invited to perform on a hunch, so it is the last
      // one that should be unrecoverable. Same graceful degradation too: if the
      // `trash` write is permission-denied (rules not deployed), the merge is
      // retried WITHOUT the mirror rather than failing.
      const buildBatch = (withTrashMirror: boolean) => {
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
        // (Bank-sync exception, same PER-TARGET rule as deleteTransaction: skip
        // only on the dupe's currently-authoritative account — see
        // shouldSkipBankSyncDelta / bankSyncAccountId.)
        const dupeTarget = resolveTargetAccount(dupeTx.accountId, accounts);
        const dupeBalanceDelta = shouldSkipBankSyncDelta(dupeTx, dupeTarget?.id, dupeTarget?.id)
          ? 0
          : -effectiveAccountImpact(dupeTx, dupeTarget);
        if (dupeBalanceDelta !== 0 && dupeTarget) {
          mergeBatch.update(doc(db, `households/${householdId}/accounts`, dupeTarget.id), {
            balance: increment(roundMoney(dupeBalanceDelta)),
            lastUpdated: serverTimestamp(),
          });
        }

        // Learn the bank's descriptor onto the bill IN THIS BATCH. A separate
        // write could half-fail and leave the pair merged with nothing learned,
        // so next month's sync would import the same duplicate all over again
        // with no trace of why. Guarded on non-empty strings so a caller that
        // couldn't resolve either half writes nothing rather than an empty alias.
        // The caller MUST have resolved `calendarItemId` against the live
        // calendar (see `aliasTargetForSettledRow`): an update() on a missing
        // doc rejects this whole batch, keeper patch and dupe delete included.
        if (learnAlias?.calendarItemId && learnAlias.descriptor.trim()) {
          mergeBatch.update(doc(db, `households/${householdId}/calendarItems`, learnAlias.calendarItemId), {
            bankDescriptorAliases: arrayUnion(learnAlias.descriptor.trim()),
          });
        }

        if (withTrashMirror) {
          // Identical shape to deleteTransaction's mirror so Recently Deleted
          // lists and restores a merged-away row exactly like a deleted one
          // (restore re-applies the balance impact reversed above).
          mergeBatch.set(doc(db, `households/${householdId}/trash`, trashDocId('transaction', dupeId)), {
            domain: 'transaction',
            originalId: dupeId,
            data: sanitizeFirestoreData(transactionTrashData(dupeTx)),
            deletedAt: serverTimestamp(),
            deletedBy: user?.uid ?? null,
          });
        }

        mergeBatch.delete(doc(db, `households/${householdId}/transactions`, dupeId));
        return mergeBatch;
      };

      try {
        await buildBatch(true).commit();
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== 'permission-denied') throw error;
        await buildBatch(false).commit();
      }

      track('duplicate_merged', { source: dupeTx.source });
      toast.success('Transactions merged');
      return true;
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

  /**
   * `dismissDuplicateOf` is the id of the SETTLED-BILL counterpart being
   * dismissed, and is passed ONLY by that arm. The ordinary duplicate banner
   * passes nothing and writes nothing beyond the flag clear: writing the
   * dismissal unconditionally meant "Keep both" on the ordinary banner silently
   * suppressed a settled-bill question the user was never asked, forever, and
   * nothing ever cleared it.
   */
  const keepBothTransactions = async (txnId: string, dismissDuplicateOf?: string) => {
    if (!householdId) return;

    try {
      // Clearing the stored flag settles the `possibleDuplicateOf` banner. The
      // settled-bill arm is computed at render and has no stored flag to clear,
      // so it persists the counterpart it was asked about instead — scoped, so
      // a later pairing against a different bill payment still gets asked.
      await updateDoc(doc(db, `households/${householdId}/transactions`, txnId), {
        possibleDuplicateOf: deleteField(),
        ...(dismissDuplicateOf ? { duplicateDismissedFor: dismissDuplicateOf } : {}),
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
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, user, transactions, householdSettings, accounts, calendarItems } = deps;

  const splitTransaction = async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    if (!householdId || !user) return;

    try {
      const batch = writeBatch(db);
      const originalTx = transactions.find(t => t.id === originalTransactionId);

      if (!originalTx) {
        throw new Error('Original transaction not found');
      }

      // SETTLED-BILL GUARD (see utils/settledBillGuard.ts): step 1 below DELETES
      // the original, so splitting a row that settled a bill orphans the paid
      // calendar doc exactly as deleting it would.
      const settledBill = findSettledBill(originalTx, calendarItems);
      if (settledBill) {
        toast.error(settledBillRefusal('split', settledBill.title));
        return;
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
