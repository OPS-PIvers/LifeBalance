import {
  collection,
  query,
  onSnapshot,
  doc,
  orderBy,
  limit,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  householdApiKeyConverter,
  insightConverter,
  weeklyRecapConverter,
  monthlyMoneyRecapConverter,
  activityLogConverter,
  notificationLogConverter,
} from '@/utils/firestoreConverters';
import { Household, FreezeBank, Insight, HouseholdApiKey, WeeklyRecap, MonthlyMoneyRecap, ActivityLogEntry, NotificationLogEntry } from '@/types/schema';
import { migrateFreezeBankToEnhanced, needsFreezeBankMigration } from '@/utils/migrations/freezeBankMigration';
import { getLocalDateString } from '@/utils/dateHelpers';
import { RECAPS_LIMIT, MONEY_RECAPS_LIMIT, INSIGHTS_LIMIT, ACTIVITY_LOG_LIMIT, NOTIFICATION_LOG_FETCH_LIMIT } from '@/utils/listenerWindows';
import { format } from 'date-fns';

/**
 * Attaches the core household listeners that are cleanly separable from the
 * members/pending-items logic (verbatim move from FirebaseHouseholdContext's
 * main listener effect): the household doc (settings + freezeBank, with
 * migration), weekly recaps, API keys, and the insights window.
 *
 * NOT included here (left in the main effect — see
 * advisor-plans/08-context-decomposition.md step 4): the MEMBERS listener
 * (entangled with the current-user-doc-recovery migration, keyed off
 * `userRef`/`memberRecoveryAttemptedForHousehold`) and the PENDING ITEMS
 * listener (entangled with the voice-command drain loop, which reads
 * `bucketsRef`/`householdSettingsRef` and calls shopping/todo/transaction
 * mutations). Both have cross-family dependencies that would not be a
 * verbatim, dependency-array-preserving move.
 */
export function attachCoreListeners({
  db,
  householdId,
  setHouseholdSettings,
  setLoadedHouseholdId,
  setFreezeBank,
  setRecaps,
  setMoneyRecaps,
  setActivityLog,
  setApiKeys,
  setInsightsWindow,
  setHasMoreInsights,
  setInsight,
  insightsLoadedAllRef,
  setNotificationLogRaw,
}: {
  db: Firestore;
  householdId: string;
  setHouseholdSettings: (settings: Household | null) => void;
  setLoadedHouseholdId: (id: string) => void;
  setFreezeBank: (freezeBank: FreezeBank | null) => void;
  setRecaps: (recaps: WeeklyRecap[]) => void;
  setMoneyRecaps: (moneyRecaps: MonthlyMoneyRecap[]) => void;
  setActivityLog: (entries: ActivityLogEntry[]) => void;
  setApiKeys: (apiKeys: HouseholdApiKey[]) => void;
  setInsightsWindow: (insights: Insight[]) => void;
  setHasMoreInsights: (hasMore: boolean) => void;
  setInsight: (text: string) => void;
  insightsLoadedAllRef: { current: boolean };
  /** F-NOTIF-02 — receives the raw, unfiltered household-wide fetch window;
   *  the provider filters to the current member's own entries (see the
   *  flat-subcollection note on `NotificationLogEntry`). */
  setNotificationLogRaw: (entries: NotificationLogEntry[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // Household settings listener (for pay period tracking and freeze bank).
  // The snapshot callback is async (it awaits a migration write below), so a
  // teardown mid-await (household switch, sign-out, unmount) must not let the
  // resumed callback call setters that now belong to a stale household/provider.
  let cancelled = false;
  const householdDocRef = doc(db, `households/${householdId}`);
  const householdDocUnsubscribe = onSnapshot(householdDocRef, async (snapshot) => {
      const data = snapshot.data() as Household | undefined;
      // Include the document ID in householdSettings
      setHouseholdSettings(data ? { ...data, id: snapshot.id } : null);
      // Core data has arrived — mark this household as loaded.
      setLoadedHouseholdId(householdId);

      // Extract and set freezeBank
      if (data?.freezeBank) {
        // Check if migration is needed
        if (needsFreezeBankMigration(data.freezeBank)) {
          try {
            // Cast to unknown first to satisfy linter, then to legacy format expected by migration
            await migrateFreezeBankToEnhanced(
              householdId,
              data.freezeBank as unknown as { current: number; accrued: number; lastMonth: string }
            );
            // Migration will trigger a new snapshot with updated data
          } catch (error) {
            if (cancelled) return;
            console.error('[FreezeBank] Migration failed:', error);
            // Fall back to a default freeze bank
            setFreezeBank({
              tokens: 2,
              maxTokens: 3,
              lastRolloverDate: getLocalDateString(),
              lastRolloverMonth: format(new Date(), 'yyyy-MM'),
              history: []
            });
          }
        } else {
          setFreezeBank(data.freezeBank as FreezeBank);
        }
      }
    }, (error) => {
      // Without this, a permission/network error would leave isLoading stuck
      // true forever (permanent skeleton). Clear the loading state so the UI
      // can recover and surface whatever data is available.
      console.error('[Household] Failed to listen to household document:', error);
      setLoadedHouseholdId(householdId);
    });
  unsubscribers.push(() => {
    cancelled = true;
    householdDocUnsubscribe();
  });

  // Weekly recaps listener (Plan 02) — bounded live window of the most recent
  // few weeks. Docs are keyed by ISO week ('2026-Www'), which sorts
  // chronologically as a string, so orderBy desc yields newest-first.
  const recapsQuery = query(
    collection(db, `households/${householdId}/recaps`).withConverter(weeklyRecapConverter),
    orderBy('isoWeek', 'desc'),
    limit(RECAPS_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(recapsQuery, (snapshot) => {
      setRecaps(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('Error listening to recaps:', error);
    })
  );

  // Monthly money recaps listener (F-MONEY-06) — bounded live window of the
  // most recent few months. Docs are keyed by calendar month ('2026-06'),
  // which sorts chronologically as a string, so orderBy desc yields newest-first.
  const moneyRecapsQuery = query(
    collection(db, `households/${householdId}/moneyRecaps`).withConverter(monthlyMoneyRecapConverter),
    orderBy('month', 'desc'),
    limit(MONEY_RECAPS_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(moneyRecapsQuery, (snapshot) => {
      setMoneyRecaps(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('Error listening to money recaps:', error);
    })
  );

  // Activity log listener (F-XCUT-01) — bounded live window of the most recent
  // N entries, newest first. Read visibility is gated to admins in the UI; a
  // non-admin household may hit a permission error once rules are tightened
  // (see the PR's "concerns"), which is swallowed so the feed degrades to empty.
  const activityLogQuery = query(
    collection(db, `households/${householdId}/activityLog`).withConverter(activityLogConverter),
    orderBy('timestamp', 'desc'),
    limit(ACTIVITY_LOG_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(activityLogQuery, (snapshot) => {
      setActivityLog(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.error('Error listening to activity log:', error);
      }
    })
  );

  // API Keys listener (for iOS Shortcuts)
  const apiKeysQuery = query(collection(db, `households/${householdId}/apiKeys`).withConverter(householdApiKeyConverter));
  unsubscribers.push(
    onSnapshot(apiKeysQuery, (snapshot) => {
      setApiKeys(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      // Silently ignore permission errors for non-admin users
      if (error.code !== 'permission-denied') {
        console.error('Error fetching API keys:', error);
      }
    })
  );

  // Insights listener — live window of the most recent N insights.
  // The full archive is fetched on demand via loadAllInsights().
  // Index (generatedAt DESC) is declared in firestore.indexes.json.
  const insightsQuery = query(
    collection(db, `households/${householdId}/insights`).withConverter(insightConverter),
    orderBy('generatedAt', 'desc'),
    limit(INSIGHTS_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(
      insightsQuery,
      (snapshot) => {
        const data = snapshot.docs.map(doc => doc.data());
        setInsightsWindow(data);
        if (!insightsLoadedAllRef.current) {
          setHasMoreInsights(snapshot.size >= INSIGHTS_LIMIT);
        }
        if (data.length > 0) {
          setInsight(data[0]!.text); // length > 0 checked above
        }
      },
      (error) => {
        console.error('Error listening to insights collection:', error);
        // Don't show error toast to user as this is non-critical data
      }
    )
  );

  // Notification inbox listener (F-NOTIF-02) — bounded, newest-first window
  // across the whole household (no `recipientUid` equality filter, see the
  // NOTIFICATION_LOG_FETCH_LIMIT doc comment); the provider filters this raw
  // window down to the current member's own entries.
  const notificationLogQuery = query(
    collection(db, `households/${householdId}/notificationLog`).withConverter(notificationLogConverter),
    orderBy('createdAt', 'desc'),
    limit(NOTIFICATION_LOG_FETCH_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(notificationLogQuery, (snapshot) => {
      setNotificationLogRaw(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      // Non-critical: the inbox degrades to empty rather than blocking the app.
      console.error('Error listening to notification log:', error);
    })
  );

  return unsubscribers;
}
