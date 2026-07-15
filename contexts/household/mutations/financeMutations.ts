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
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  type Firestore,
  type WriteBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { format, subDays, parseISO } from 'date-fns';
import {
  Account,
  BudgetBucket,
  BucketPeriodSnapshot,
  Transaction,
} from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { getTransactionsForBucket, type BucketSpent } from '@/utils/bucketSpentCalculator';
import { roundMoney } from '@/utils/money';
import { TRANSACTION_PAGE_SIZE } from '@/utils/listenerWindows';
import { transactionConverter, bucketPeriodSnapshotConverter } from '@/utils/firestoreConverters';
import { mergeById, mapTransactionDoc } from '@/contexts/household/selectors';

// Pure-ish factories for the ACCOUNT, BUCKET, PAY-PERIOD, and CALENDAR
// mutation families, plus the transaction/bucket-history "load older"
// pagination helpers — moved verbatim out of FirebaseHouseholdContext. See
// advisor-plans/08-context-decomposition.md step 5. The TRANSACTION CRUD
// family (addTransaction, updateTransactionCategory, updateTransaction,
// deleteTransaction, mergeTransactions/keepBothTransactions,
// splitTransaction) lives in the sibling transactionMutations.ts.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * addAccount / updateAccountBalance / setAccountGoal / setAccountCardLast4 /
 * deleteAccount / updateAccountOrder / reorderAccounts — original closures
 * captured only `householdId` (addAccount also captured `user`).
 */
export function makeAccountMutations(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
}) {
  const { db, householdId, user } = deps;

  const addAccount = async (account: Account) => {
    if (!householdId || !user) return;
    await addDoc(collection(db, `households/${householdId}/accounts`), {
      ...account,
      createdBy: user.uid,
      lastUpdated: serverTimestamp(),
    });
    toast.success('Account added');
  };

  const updateAccountBalance = async (id: string, newBalance: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      balance: newBalance,
      lastUpdated: serverTimestamp(),
    });
    toast.success('Account updated');
  };

  const setAccountGoal = async (id: string, goal: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      monthlyGoal: goal,
    });
    toast.success('Goal set');
  };

  const setAccountCardLast4 = async (id: string, cardLast4: string) => {
    if (!householdId) return;
    // Defensive guard (the UI validates too): a non-empty but sub-4-digit value
    // would store something that can never match an incoming card, so reject it.
    const rawDigits = cardLast4.replace(/\D/g, '');
    if (rawDigits && rawDigits.length < 4) {
      toast.error('Card digits must be the last 4 numbers');
      return;
    }
    // Keep only digits and cap at the last 4 so "...8899" / "8899" both store as
    // "8899". An empty result clears the field (untags the card).
    const digits = rawDigits.slice(-4);
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      cardLast4: digits ? digits : deleteField(),
    });
    toast.success(digits ? 'Card digits saved' : 'Card digits cleared');
  };

  const deleteAccount = async (id: string) => {
    if (!householdId) return;
    // Genuine hard-delete is only safe for an account that has never been
    // referenced by a transaction — otherwise the transaction's `accountId`
    // becomes a dangling reference that resolveTargetAccount() silently
    // resolves to the checking account, losing which card a historical
    // purchase was really on. When history exists, steer to Archive instead
    // (archiveAccount below), which keeps the account doc around so
    // transactions keep resolving to it correctly.
    const referencingQuery = query(
      collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter),
      where('accountId', '==', id),
      limit(1)
    );
    const referencingSnap = await getDocs(referencingQuery);
    if (!referencingSnap.empty) {
      toast.error('This account has transaction history — archive it instead of deleting');
      return;
    }
    await deleteDoc(doc(db, `households/${householdId}/accounts`, id));
    toast.success('Account deleted');
  };

  const archiveAccount = async (id: string) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      archived: true,
    });
    toast.success('Account archived');
  };

  const unarchiveAccount = async (id: string) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      archived: deleteField(),
    });
    toast.success('Account unarchived');
  };

  const updateAccountOrder = async (accountId: string, newOrder: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, accountId), {
      order: newOrder,
    });
  };

  const reorderAccounts = async (orderedIds: string[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      orderedIds.forEach((id, index) => {
        const accountRef = doc(db, `households/${householdId}/accounts`, id);
        batch.update(accountRef, { order: index });
      });
      await batch.commit();
    } catch (error) {
      console.error('[reorderAccounts] Failed:', error);
      toast.error('Failed to reorder accounts');
      throw error;
    }
  };

  return {
    addAccount, updateAccountBalance, setAccountGoal, setAccountCardLast4,
    deleteAccount, archiveAccount, unarchiveAccount, updateAccountOrder, reorderAccounts,
  };
}

/**
 * addBucket / updateBucket / deleteBucket / updateBucketLimit —
 * original closures captured only `householdId` (addBucket also captured
 * `user`).
 */
export function makeBucketCrudMutations(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
}) {
  const { db, householdId, user } = deps;

  const addBucket = async (bucket: BudgetBucket) => {
    if (!householdId || !user) return;
    // Exclude 'id' field - it's not stored in Firestore (document ID is separate)
    const { id: _id, spent: _spent, ...bucketWithoutId } = bucket;
    const sanitizedBucket = sanitizeFirestoreData(bucketWithoutId);
    await addDoc(collection(db, `households/${householdId}/buckets`), {
      ...sanitizedBucket,
      createdBy: user.uid,
    });
    toast.success('Bucket added');
  };

  const updateBucket = async (bucket: BudgetBucket) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/buckets`, bucket.id), {
      name: bucket.name,
      limit: bucket.limit,
      color: bucket.color,
      isVariable: bucket.isVariable,
      isCore: bucket.isCore,
      // DO NOT update spent - it's calculated in real-time
    });
    toast.success('Bucket updated');
  };

  const deleteBucket = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/buckets`, id));
    toast.success('Bucket deleted');
  };

  const updateBucketLimit = async (id: string, newLimit: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/buckets`, id), {
      limit: newLimit,
    });
    toast.success('Limit updated');
  };

  // Pay-period ceremony "set your budgets" save: updates several bucket
  // limits in ONE writeBatch so a partial write can never apply only some of
  // the user's chosen plan. Invalid entries (negative / non-finite) are
  // dropped rather than corrupting a limit.
  const setBucketLimits = async (updates: { id: string; limit: number }[]) => {
    if (!householdId) return;
    const valid = updates.filter(u => Number.isFinite(u.limit) && u.limit >= 0);
    if (valid.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const u of valid) {
        batch.update(doc(db, `households/${householdId}/buckets`, u.id), {
          limit: roundMoney(u.limit),
        });
      }
      await batch.commit();
      toast.success('Bucket budgets set');
    } catch (error) {
      console.error('[setBucketLimits] Failed:', error);
      toast.error('Failed to update bucket budgets. Please try again.');
      throw error;
    }
  };

  // Pay-period ceremony save (bucket budgets + account balance true-ups):
  // ALL writes go in ONE writeBatch so the user's period plan can never
  // half-apply. Bucket rules match setBucketLimits (negative / non-finite
  // limits are dropped); balances may legitimately be negative (overdrawn
  // checking) so only non-finite balances are dropped. Balance writes stamp
  // lastUpdated: serverTimestamp() exactly like updateAccountBalance.
  const saveCeremonyChanges = async (updates: {
    bucketLimits: { id: string; limit: number }[];
    accountBalances: { id: string; balance: number }[];
  }) => {
    if (!householdId) return;
    const validLimits = updates.bucketLimits.filter(u => Number.isFinite(u.limit) && u.limit >= 0);
    const validBalances = updates.accountBalances.filter(u => Number.isFinite(u.balance));
    if (validLimits.length === 0 && validBalances.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const u of validLimits) {
        batch.update(doc(db, `households/${householdId}/buckets`, u.id), {
          limit: roundMoney(u.limit),
        });
      }
      for (const u of validBalances) {
        batch.update(doc(db, `households/${householdId}/accounts`, u.id), {
          balance: roundMoney(u.balance),
          lastUpdated: serverTimestamp(),
        });
      }
      await batch.commit();
      toast.success('Changes saved');
    } catch (error) {
      console.error('[saveCeremonyChanges] Failed:', error);
      toast.error('Failed to save changes. Please try again.');
      throw error;
    }
  };

  return { addBucket, updateBucket, deleteBucket, updateBucketLimit, setBucketLimits, saveCeremonyChanges };
}

/**
 * reallocateBucket — original closure captured `householdId`, `buckets`.
 */
export function makeReallocateBucket(deps: {
  db: Firestore;
  householdId: string | null;
  buckets: BudgetBucket[];
}) {
  const { db, householdId, buckets } = deps;

  const reallocateBucket = async (sourceId: string, targetId: string, amount: number) => {
    if (!householdId) return;

    const sourceBucket = buckets.find(b => b.id === sourceId);
    const targetBucket = buckets.find(b => b.id === targetId);

    if (!sourceBucket || !targetBucket) return;

    // Round to whole cents up front so sub-cent input or float drift can't write
    // fractional cents into a bucket limit via increment() below.
    const roundedAmount = roundMoney(amount);

    // Validate input before writing — otherwise a bad amount flows straight into
    // the increments below: source===target collapses to a single same-doc update
    // that fabricates funds, a non-positive/non-finite amount reverses or no-ops
    // the transfer, and an amount above the source's limit drives that limit
    // negative. The caller is fire-and-forget, so surface the problem with a toast
    // and bail rather than throw.
    if (sourceId === targetId) {
      toast.error('Pick two different buckets to move funds between.');
      return;
    }
    if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
      toast.error('Enter an amount greater than zero to reallocate.');
      return;
    }
    // Compare in integer cents so float drift can't reject an exact full move.
    if (Math.round(roundedAmount * 100) > Math.round(sourceBucket.limit * 100)) {
      toast.error(`${sourceBucket.name} doesn't have that much to reallocate.`);
      return;
    }

    // Commit both limit changes in a single batch so a partial write can never
    // leave the source debited without crediting the target. Use increment()
    // (server-side field value) rather than absolute values from local state so
    // concurrent edits to either bucket's limit are not clobbered.
    const batch = writeBatch(db);
    batch.update(doc(db, `households/${householdId}/buckets`, sourceId), {
      limit: increment(-roundedAmount),
    });
    batch.update(doc(db, `households/${householdId}/buckets`, targetId), {
      limit: increment(roundedAmount),
    });
    await batch.commit();

    toast.success('Funds reallocated');
  };

  return { reallocateBucket };
}

/**
 * resetBucketsForNewPeriod — original closure captured `householdId`,
 * `currentPeriodId`, `buckets`, `bucketSpentMap`, `transactions` (NOT `user`).
 */
export function makeResetBucketsForNewPeriod(deps: {
  db: Firestore;
  householdId: string | null;
  currentPeriodId: string;
  buckets: BudgetBucket[];
  bucketSpentMap: Map<string, BucketSpent>;
  transactions: Transaction[];
}) {
  const { db, householdId, currentPeriodId, buckets, bucketSpentMap, transactions } = deps;

  // When `externalBatch` is provided the writes are STAGED into it and the
  // caller owns the commit (and any success toast) — used by payCalendarItem's
  // income path so the period roll and the paycheck credit commit atomically.
  const resetBucketsForNewPeriod = async (newPeriodId: string, externalBatch?: WriteBatch) => {
    if (!householdId || !currentPeriodId) return;

    try {
      const batch = externalBatch ?? writeBatch(db);

      // Create snapshots for all buckets from the old period
      for (const bucket of buckets) {
        const spent = bucketSpentMap.get(bucket.id) || { verified: 0, pending: 0 };
        const bucketTransactions = getTransactionsForBucket(bucket.name, transactions, currentPeriodId);

        const periodStart = currentPeriodId;
        const periodEnd = format(subDays(parseISO(newPeriodId), 1), 'yyyy-MM-dd');

        // Create snapshot in bucketHistory subcollection
        const snapshotRef = doc(collection(db, `households/${householdId}/bucketHistory`));
        batch.set(snapshotRef, {
          bucketId: bucket.id,
          bucketName: bucket.name,
          periodId: currentPeriodId,
          periodStartDate: periodStart,
          periodEndDate: periodEnd,
          limit: bucket.limit,
          totalSpent: spent.verified,
          totalPending: spent.pending,
          transactionCount: bucketTransactions.length,
          createdAt: new Date().toISOString(),
        });

        // Update bucket's current period
        const bucketRef = doc(db, `households/${householdId}/buckets`, bucket.id);
        batch.update(bucketRef, {
          currentPeriodId: newPeriodId,
          lastResetDate: periodStart,
        });
      }

      // Advance the household's last paycheck date IN THE SAME BATCH as the
      // bucket resets, so periods can never desync (either everything commits
      // or nothing does).
      const householdRef = doc(db, `households/${householdId}`);
      batch.update(householdRef, {
        lastPaycheckDate: newPeriodId,
      });

      // Staged mode: the caller commits (atomically with its own writes).
      if (externalBatch) return;

      // Commit all changes atomically
      await batch.commit();
      toast.success('Buckets reset for new pay period');
    } catch (error) {
      console.error('[resetBucketsForNewPeriod] Failed:', error);
      toast.error('Failed to reset period. Please try again.');
      throw error; // Re-throw so handlePaycheckApproval can catch it
    }
  };

  return { resetBucketsForNewPeriod };
}

/**
 * initializeFirstPeriod — original closure captured `householdId`, `user`,
 * `buckets`.
 */
export function makeInitializeFirstPeriod(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  buckets: BudgetBucket[];
}) {
  const { db, householdId, user, buckets } = deps;

  // `externalBatch` stages the writes for the caller to commit — see
  // resetBucketsForNewPeriod.
  const initializeFirstPeriod = async (paycheckDate: string, externalBatch?: WriteBatch) => {
    if (!householdId || !user) return;

    try {
      const batch = externalBatch ?? writeBatch(db);

      // Set household's first paycheck
      const householdRef = doc(db, `households/${householdId}`);
      batch.update(householdRef, {
        lastPaycheckDate: paycheckDate,
      });

      // Initialize all buckets with this period ID
      for (const bucket of buckets) {
        const bucketRef = doc(db, `households/${householdId}/buckets`, bucket.id);
        batch.update(bucketRef, {
          currentPeriodId: paycheckDate,
          lastResetDate: paycheckDate,
        });
      }

      // Staged mode: the caller commits (atomically with its own writes).
      if (externalBatch) return;

      await batch.commit();
      toast.success('Pay period tracking initialized!');
    } catch (error) {
      console.error('[initializeFirstPeriod] Failed:', error);
      toast.error('Failed to initialize period tracking');
      throw error; // Re-throw so handlePaycheckApproval can catch it
    }
  };

  return { initializeFirstPeriod };
}

/**
 * handlePaycheckApproval — original closure captured `householdId`, `user`,
 * `currentPeriodId`, `initializeFirstPeriod`, `resetBucketsForNewPeriod` (the
 * latter two as the OTHER `useCallback`-wrapped functions, not raw state).
 */
export function makeHandlePaycheckApproval(deps: {
  householdId: string | null;
  user: { uid: string } | null;
  currentPeriodId: string;
  initializeFirstPeriod: (paycheckDate: string, externalBatch?: WriteBatch) => Promise<void>;
  resetBucketsForNewPeriod: (newPeriodId: string, externalBatch?: WriteBatch) => Promise<void>;
}) {
  const { householdId, user, currentPeriodId, initializeFirstPeriod, resetBucketsForNewPeriod } = deps;

  // `externalBatch` stages the period-tracking writes into the caller's batch
  // instead of committing them here, so payCalendarItem's income path can
  // commit the period roll AND the paycheck credit atomically (a partial
  // commit could otherwise advance the pay period without crediting income).
  const handlePaycheckApproval = async (paycheckDate: string, externalBatch?: WriteBatch) => {
    if (!householdId || !user) return;

    try {
      if (!currentPeriodId) {
        // First paycheck ever - initialize period tracking
        await initializeFirstPeriod(paycheckDate, externalBatch);
        return;
      }

      // A paycheck dated ON/BEFORE the current period start (e.g. an older
      // overdue income item approved from the Action Queue AFTER a newer one)
      // must NOT roll the period: resetBucketsForNewPeriod would rewind
      // lastPaycheckDate and snapshot a period whose end precedes its start,
      // orphaning every current-period transaction. Record the income (done by
      // payCalendarItem) without touching period tracking. yyyy-MM-dd strings
      // compare lexicographically, so a plain string compare is date-correct.
      if (paycheckDate <= currentPeriodId) return;

      // Reset buckets for the period that just ended. This also advances the
      // household's lastPaycheckDate within the same atomic batch, so the bucket
      // resets and the period pointer can never desync from a partial write.
      await resetBucketsForNewPeriod(paycheckDate, externalBatch);
    } catch (error) {
      console.error('[handlePaycheckApproval] Failed:', error);
      toast.error('Failed to process paycheck approval. Please try again.');
      throw error;
    }
  };

  return { handlePaycheckApproval };
}


/**
 * loadOlderTransactions / loadAllTransactions — the transactions
 * "load older" pagination helpers. Original closures captured only
 * `householdId` plus the hook-stable cursor/window refs and setState setters
 * (mirrors makeLoadOlderCompletedTodos in todoMutations.ts).
 */
export function makeTransactionLoaders(deps: {
  db: Firestore;
  householdId: string | null;
  txWindowStartRef: { current: string | null };
  txOlderCursorRef: { current: QueryDocumentSnapshot<DocumentData> | null };
  recentTransactionsRef: { current: Transaction[] };
  setIsLoadingOlderTransactions: (v: boolean) => void;
  setOlderTransactions: (value: Transaction[] | ((prev: Transaction[]) => Transaction[])) => void;
  setHasMoreTransactions: (v: boolean) => void;
}) {
  const {
    db, householdId,
    txWindowStartRef, txOlderCursorRef, recentTransactionsRef,
    setIsLoadingOlderTransactions, setOlderTransactions, setHasMoreTransactions,
  } = deps;

  const loadOlderTransactions = async () => {
    const windowStart = txWindowStartRef.current;
    if (!householdId || windowStart === null) return;
    setIsLoadingOlderTransactions(true);
    try {
      const txCollection = collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter);
      const cursor = txOlderCursorRef.current;
      const olderQuery = cursor
        ? query(txCollection, where('date', '<', windowStart), orderBy('date', 'desc'), startAfter(cursor), limit(TRANSACTION_PAGE_SIZE))
        : query(txCollection, where('date', '<', windowStart), orderBy('date', 'desc'), limit(TRANSACTION_PAGE_SIZE));
      const snap = await getDocs(olderQuery);
      if (snap.docs.length > 0) {
        txOlderCursorRef.current = snap.docs[snap.docs.length - 1] ?? null;
        const page = snap.docs.map(mapTransactionDoc);
        setOlderTransactions(prev => mergeById(prev, page));
      }
      setHasMoreTransactions(snap.docs.length === TRANSACTION_PAGE_SIZE);
    } catch (error) {
      console.error('[loadOlderTransactions] Failed:', error);
      toast.error('Failed to load older transactions');
    } finally {
      setIsLoadingOlderTransactions(false);
    }
  };

  const loadAllTransactions = async (): Promise<Transaction[]> => {
    const windowStart = txWindowStartRef.current;
    // No window (period tracking off) → everything is already loaded.
    if (!householdId || windowStart === null) return recentTransactionsRef.current;
    setIsLoadingOlderTransactions(true);
    try {
      const txCollection = collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter);
      const snap = await getDocs(query(txCollection, where('date', '<', windowStart), orderBy('date', 'desc')));
      const older = snap.docs.map(mapTransactionDoc);
      txOlderCursorRef.current = snap.docs.length ? snap.docs[snap.docs.length - 1] ?? null : null;
      setOlderTransactions(older);
      setHasMoreTransactions(false);
      return mergeById(recentTransactionsRef.current, older);
    } catch (error) {
      console.error('[loadAllTransactions] Failed:', error);
      toast.error('Failed to load full transaction history');
      return recentTransactionsRef.current;
    } finally {
      setIsLoadingOlderTransactions(false);
    }
  };

  return { loadOlderTransactions, loadAllTransactions };
}

/**
 * loadAllBucketHistory — original closure captured `householdId` plus the
 * hook-stable `bucketHistoryLoadedAllRef` and setState setters.
 */
export function makeLoadAllBucketHistory(deps: {
  db: Firestore;
  householdId: string | null;
  bucketHistoryLoadedAllRef: { current: boolean };
  setIsLoadingOlderBucketHistory: (v: boolean) => void;
  setBucketHistoryOlder: (history: BucketPeriodSnapshot[]) => void;
  setHasMoreBucketHistory: (v: boolean) => void;
}) {
  const {
    db, householdId, bucketHistoryLoadedAllRef,
    setIsLoadingOlderBucketHistory, setBucketHistoryOlder, setHasMoreBucketHistory,
  } = deps;

  const loadAllBucketHistory = async () => {
    if (!householdId) return;
    setIsLoadingOlderBucketHistory(true);
    try {
      const snap = await getDocs(query(
        collection(db, `households/${householdId}/bucketHistory`).withConverter(bucketPeriodSnapshotConverter),
        orderBy('periodStartDate', 'desc')
      ));
      bucketHistoryLoadedAllRef.current = true;
      setBucketHistoryOlder(snap.docs.map(doc => doc.data()));
      setHasMoreBucketHistory(false);
    } catch (error) {
      console.error('[loadAllBucketHistory] Failed:', error);
      toast.error('Failed to load full budget history');
    } finally {
      setIsLoadingOlderBucketHistory(false);
    }
  };

  return { loadAllBucketHistory };
}
