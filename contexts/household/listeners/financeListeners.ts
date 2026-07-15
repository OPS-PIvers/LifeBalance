import {
  collection,
  query,
  onSnapshot,
  orderBy,
  limit,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  accountConverter,
  budgetBucketConverter,
  bucketPeriodSnapshotConverter,
  calendarItemConverter,
  transactionConverter,
  savingsGoalConverter,
  netWorthSnapshotConverter,
} from '@/utils/firestoreConverters';
import { Account, BudgetBucket, BucketPeriodSnapshot, CalendarItem, Transaction, SavingsGoal, NetWorthSnapshot } from '@/types/schema';
import { BUCKET_HISTORY_LIMIT, NET_WORTH_HISTORY_LIMIT } from '@/utils/listenerWindows';
import { mapTransactionDoc } from '@/contexts/household/selectors';
import toast from 'react-hot-toast';

/**
 * Attaches the accounts, buckets, bucket-history, and calendar-items listeners
 * (verbatim move from FirebaseHouseholdContext's main listener effect).
 *
 * NOT included here — the TRANSACTIONS listener lives in its own effect (see
 * `attachTransactionsListener` below) so its live window can track
 * `currentPeriodId` without re-subscribing every other finance listener; and
 * PAY PERIODS have no dedicated Firestore collection of their own — period
 * tracking is a field (`lastPaycheckDate`) on the household doc, synced by
 * `attachCoreListeners`.
 */
export function attachFinanceListeners({
  db,
  householdId,
  setAccounts,
  setBuckets,
  setBucketHistoryWindow,
  setHasMoreBucketHistory,
  bucketHistoryLoadedAllRef,
  setCalendarItems,
  setSavingsGoals,
  setNetWorthHistory,
}: {
  db: Firestore;
  householdId: string;
  setAccounts: (accounts: Account[]) => void;
  setBuckets: (buckets: BudgetBucket[]) => void;
  setBucketHistoryWindow: (history: BucketPeriodSnapshot[]) => void;
  setHasMoreBucketHistory: (hasMore: boolean) => void;
  bucketHistoryLoadedAllRef: { current: boolean };
  setCalendarItems: (items: CalendarItem[]) => void;
  setSavingsGoals: (goals: SavingsGoal[]) => void;
  setNetWorthHistory: (history: NetWorthSnapshot[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // Accounts listener
  const accountsQuery = query(collection(db, `households/${householdId}/accounts`).withConverter(accountConverter));
  unsubscribers.push(
    onSnapshot(accountsQuery, (snapshot) => {
      setAccounts(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[accounts] listener failed:', error);
      toast.error('Lost connection to your accounts. Safe-to-Spend may be out of date.');
    })
  );

  // Buckets listener
  const bucketsQuery = query(collection(db, `households/${householdId}/buckets`).withConverter(budgetBucketConverter));
  unsubscribers.push(
    onSnapshot(bucketsQuery, (snapshot) => {
      setBuckets(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[buckets] listener failed:', error);
      toast.error('Lost connection to your budget. Safe-to-Spend may be out of date.');
    })
  );

  // Bucket History listener — live window of the most recent N periods.
  // Older snapshots are fetched on demand via loadAllBucketHistory().
  const historyQuery = query(
    collection(db, `households/${householdId}/bucketHistory`).withConverter(bucketPeriodSnapshotConverter),
    orderBy('periodStartDate', 'desc'),
    limit(BUCKET_HISTORY_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(historyQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data());
      setBucketHistoryWindow(data);
      // A full page means there are (probably) older periods to load. Don't
      // flip this back on once the caller has already loaded everything.
      if (!bucketHistoryLoadedAllRef.current) {
        setHasMoreBucketHistory(snapshot.size >= BUCKET_HISTORY_LIMIT);
      }
    }, (error) => {
      console.error('Error listening to bucketHistory:', error);
    })
  );

  // (Transactions are handled by their own effect below so the window can
  // track the current pay period without re-subscribing every other listener.)

  // Calendar listener
  const calQuery = query(collection(db, `households/${householdId}/calendarItems`).withConverter(calendarItemConverter));
  unsubscribers.push(
    onSnapshot(calQuery, (snapshot) => {
      setCalendarItems(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      // Calendar items feed Safe-to-Spend; a silent failure would leave that
      // metric stale. Surface it like the accounts/buckets listeners do.
      console.error('[calendarItems] listener failed:', error);
      toast.error('Failed to sync calendar items. Some figures may be out of date.');
    })
  );

  // Savings goals listener (Plan 24). Unbounded — a household holds at most a
  // handful of goals (few tens at most), so a live `limit()` window isn't
  // warranted the way it is for transactions/bucketHistory (see plans/040's
  // listener-bounding rationale, which targets HIGH-cardinality collections).
  const savingsGoalsQuery = query(collection(db, `households/${householdId}/savingsGoals`).withConverter(savingsGoalConverter));
  unsubscribers.push(
    onSnapshot(savingsGoalsQuery, (snapshot) => {
      setSavingsGoals(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[savingsGoals] listener failed:', error);
    })
  );

  // Net worth history listener (F-MONEY-09) — bounded live window of the most
  // recent N daily snapshots, newest first (mirrors the RECAPS_LIMIT pattern).
  // Snapshots are written server-side by the daily `snapshotnetworth`
  // scheduled function; the client never writes to this collection.
  const netWorthQuery = query(
    collection(db, `households/${householdId}/netWorthSnapshots`).withConverter(netWorthSnapshotConverter),
    orderBy('date', 'desc'),
    limit(NET_WORTH_HISTORY_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(netWorthQuery, (snapshot) => {
      setNetWorthHistory(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[netWorthSnapshots] listener failed:', error);
    })
  );

  return unsubscribers;
}

/**
 * Attaches the windowed transactions listener (verbatim move from
 * FirebaseHouseholdContext's dedicated transactions effect). Kept as its own
 * function — not folded into `attachFinanceListeners` — because it is called
 * from a SEPARATE `useEffect` keyed on `[householdId, loadedHouseholdId,
 * currentPeriodId]` so the live window can track the current pay period
 * without re-subscribing the rest of the finance listeners.
 */
export function attachTransactionsListener({
  db,
  householdId,
  windowStart,
  setRecentTransactions,
}: {
  db: Firestore;
  householdId: string;
  windowStart: string | null;
  setRecentTransactions: (transactions: Transaction[]) => void;
}): Unsubscribe {
  const txCollection = collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter);
  const txQuery = windowStart
    ? query(txCollection, where('date', '>=', windowStart), orderBy('date', 'desc'))
    : query(txCollection);

  return onSnapshot(txQuery, (snapshot) => {
    setRecentTransactions(snapshot.docs.map(mapTransactionDoc));
  }, (error) => {
    console.error('Error listening to transactions:', error);
  });
}
