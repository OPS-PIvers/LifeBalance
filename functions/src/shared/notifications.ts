import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { formatInTimeZone } from "date-fns-tz";
import { defineString } from "firebase-functions/params";

export interface NotificationPreferences {
  habitReminders: {
    enabled: boolean;
    time: string;
  };
  actionQueueReminders: {
    enabled: boolean;
    time: string;
  };
  budgetAlerts: {
    enabled: boolean;
    threshold?: number;
  };
  streakWarnings: {
    enabled: boolean;
    time: string;
  };
  billReminders: {
    enabled: boolean;
    daysBeforeDue: number;
    time: string;
    // F-NOTIF-05: yyyy-MM-dd local date set by the "Snooze 1 day" push action.
    // Reminders are suppressed while localToday <= snoozedUntil.
    snoozedUntil?: string;
  };
  // Plan 02 (weekly recap engine): per-member opt-out for the weekly recap
  // push notification. Absent/undefined is treated as enabled (fail-open,
  // matching the other notification preference blocks' spirit) — only an
  // explicit `enabled: false` suppresses the push.
  weeklyRecap?: {
    enabled: boolean;
  };
  // F-MONEY-06 (monthly money recap): per-member opt-out for the monthly money
  // recap push. Absent/undefined is treated as enabled (fail-open) — only an
  // explicit `enabled: false` suppresses the push.
  monthlyMoneyRecap?: {
    enabled: boolean;
  };
  timezone?: string;
}

export interface HouseholdMember {
  uid: string;
  displayName: string;
  email?: string;
  fcmTokens?: string[];
  notificationPreferences?: NotificationPreferences;
  // Plan 06 (notification fan-out cost): denormalized "could this member ever
  // receive a push" flag, maintained by the pref/token writers so the four
  // hourly scheduled jobs can query via a collection-group index instead of
  // scanning every household/member. See computeAnyNotificationsEnabled below.
  anyNotificationsEnabled?: boolean;
}

/**
 * Plan 06 (notification fan-out cost) — pure helper computing the denormalized
 * `anyNotificationsEnabled` flag maintained on each HouseholdMember doc.
 *
 * True iff the member has at least one FCM token AND at least one notification
 * category that could fire is enabled:
 *   - habitReminders / actionQueueReminders / streakWarnings / billReminders:
 *     counted enabled only when `.enabled === true`.
 *   - weeklyRecap: this pref is fail-open (absent/undefined defaults to ON;
 *     only an explicit `enabled: false` opts out — see NotificationPreferences
 *     above). For THIS flag's purpose ("could any push ever be sent to this
 *     member") we treat weeklyRecap as enabled unless explicitly disabled,
 *     matching that fail-open spirit. Note the weekly recap job additionally
 *     gates on premium status server-side — that's a separate check the recap
 *     job still performs; this flag only answers "is a push category live".
 *
 * Kept in perfect parity with the client copy in utils/notificationFlags.ts —
 * mirror any change there.
 */
export function computeAnyNotificationsEnabled(
  prefs: NotificationPreferences | undefined,
  fcmTokens: string[] | undefined
): boolean {
  if (!fcmTokens || fcmTokens.length === 0) return false;
  // No prefs object at all (legacy/new member): weeklyRecap's fail-open
  // default still applies, so a member with tokens remains reachable.
  if (!prefs) return true;

  const weeklyRecapEnabled = prefs.weeklyRecap?.enabled !== false;

  return (
    prefs.habitReminders?.enabled === true ||
    prefs.actionQueueReminders?.enabled === true ||
    prefs.streakWarnings?.enabled === true ||
    prefs.billReminders?.enabled === true ||
    weeklyRecapEnabled
  );
}

/**
 * F-NOTIF-02 (in-app notification inbox) — when provided, `sendNotificationToUser`
 * also writes a durable log entry to `households/{householdId}/notificationLog/{id}`
 * so the recipient can revisit the notification later even if the push was missed,
 * swiped away, or the device was offline. This is a flat household-level
 * subcollection (not nested under the member doc) so it works with the existing
 * generic member-write Firestore rule without a rules change; each entry carries
 * `recipientUid` and the client filters/queries by it. See CLAUDE.md / the PR
 * description for the composite-index follow-up this implies at scale.
 */
export interface NotificationLogContext {
  householdId: string;
  recipientUid: string;
  /** Coarse category so the inbox UI can group/icon entries. */
  type:
    | "habit_reminder"
    | "action_queue_reminder"
    | "streak_warning"
    | "bill_reminder"
    | "budget_alert"
    | "weekly_recap"
    | "monthly_money_recap";
}

/**
 * Helper function to send a notification to a user.
 * @param memberRef - Optional Firestore document reference for the member. When
 *   provided, any permanently-invalid FCM tokens detected in the multicast response
 *   are removed from the member's `fcmTokens` array via arrayRemove so they are
 *   not retried on future sends.
 * @param logContext - Optional (F-NOTIF-02). When provided, also persists a
 *   notification-log entry for the in-app inbox. Omitted for ad-hoc/test sends
 *   (e.g. `sendtestnotification`) that shouldn't clutter the inbox.
 */
export async function sendNotificationToUser(
  fcmTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  memberRef?: admin.firestore.DocumentReference,
  logContext?: NotificationLogContext
): Promise<void> {
  if (!fcmTokens || fcmTokens.length === 0) {
    logger.info("No FCM tokens available for user");
    return;
  }

  if (logContext) {
    try {
      await admin
        .firestore()
        .collection(`households/${logContext.householdId}/notificationLog`)
        .add({
          type: logContext.type,
          recipientUid: logContext.recipientUid,
          title,
          body,
          data: data || {},
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          readBy: [],
        });
    } catch (logError) {
      // A logging failure must never block push delivery.
      logger.error("Failed to write notification log entry:", logError);
    }
  }

  const message = {
    notification: {
      title,
      body,
    },
    data: data || {},
    tokens: fcmTokens,
  };

  try {
    // Resolved lazily (NOT at module load): this module is imported at the top
    // of index.ts, before admin.initializeApp() runs, so a module-level
    // admin.messaging() would throw "default app does not exist" on deploy.
    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info(
      `Successfully sent notification: ${response.successCount} succeeded, ${response.failureCount} failed`
    );

    // Remove permanently-invalid tokens from Firestore so they are not retried.
    if (response.failureCount > 0) {
      const tokensToRemove: string[] = [];
      const permanentErrorCodes = [
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token",
        "messaging/mismatched-credential"
      ];

      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code && permanentErrorCodes.includes(resp.error.code)) {
          const token = fcmTokens[idx];
          if (token !== undefined) {
            tokensToRemove.push(token);
          }
        }
      });

      if (tokensToRemove.length > 0) {
        logger.info("Removing stale FCM tokens:", tokensToRemove);
        if (memberRef) {
          try {
            // FieldValue.arrayRemove mutates server-side — the resulting array
            // is never observable to us here. Compute it ourselves from the
            // in-scope pre-prune `fcmTokens` array so we know whether the
            // member is left with zero tokens.
            const remainingTokens = fcmTokens.filter(
              (t) => !tokensToRemove.includes(t)
            );

            const update: Record<string, unknown> = {
              fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensToRemove),
            };

            // Only flip the flag OFF when pruning empties the token array.
            // When tokens remain, leave `anyNotificationsEnabled` untouched:
            // we don't have this member's notificationPreferences in scope
            // here (deliberately not adding a Firestore read just to recompute
            // a flag the pref writers already maintain), so we can only ever
            // safely narrow the flag to false, never widen it to true.
            // Getting this wrong (leaving `true` on empty tokens) would mean
            // a pruned member with no working tokens keeps matching the
            // collection-group query in every future scheduled run forever.
            if (remainingTokens.length === 0) {
              update.anyNotificationsEnabled = false;
            }

            await memberRef.update(update);
          } catch (cleanupError) {
            // A cleanup failure must never break notification delivery.
            logger.error("Failed to remove stale FCM tokens:", cleanupError);
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error sending notification:", error);
  }
}

/**
 * Helper function to check if current time matches scheduled time
 * This function now correctly handles timezones and relaxed matching for hourly crons
 */
export function isTimeToSend(
  scheduledTime: string,
  timezone: string = "UTC"
): boolean {
  // Validate scheduledTime format (HH:MM)
  if (!/^\d{1,2}:\d{2}$/.test(scheduledTime)) {
    logger.warn(`Invalid scheduled time format: ${scheduledTime}`);
    return false;
  }

  const now = new Date();

  let currentHour: number;
  try {
    // formatInTimeZone throws if timezone is invalid
    const hourStr = formatInTimeZone(now, timezone, "H");
    currentHour = parseInt(hourStr, 10);
  } catch (_e) {
    logger.warn(`Invalid timezone '${timezone}', falling back to UTC`);
    const hourStr = formatInTimeZone(now, "UTC", "H");
    currentHour = parseInt(hourStr, 10);
  }

  const [schedHour] = scheduledTime.split(":").map(Number);

  return currentHour === schedHour;
}

/**
 * Plan 06 PR-2 escape hatch: when set to the literal string "true", the
 * scheduled notification jobs fall back to the pre-PR-2 full
 * `db.collection("households").get()` scan instead of the flagged
 * collection-group query. Defaulted to "" (falsy) so CI's non-interactive
 * `firebase deploy` never prompts/fails on an unset param — the same trap
 * documented on `ADMIN_UID` in index.ts. An operator flips it via the
 * functions env only if a bad backfill is suspected.
 */
const notificationsFullScanParam = defineString("NOTIFICATIONS_FULL_SCAN", {
  default: "",
});

/** One household's worth of pre-loaded, notification-eligible members. */
export interface NotifiableHouseholdGroup {
  householdId: string;
  householdRef: admin.firestore.DocumentReference;
  /** Lazily fetched — most jobs need at most currency/freezeBank/etc., not the
   *  full document, and some (habit/action-queue reminders) don't need it at
   *  all. Call this only when the job actually needs household-level data. */
  getHouseholdData: () => Promise<admin.firestore.DocumentData | undefined>;
  memberDocs: admin.firestore.QueryDocumentSnapshot[];
}

/**
 * Plan 06 PR-2 — shared loader used by all five scheduled notification jobs
 * (sendhabitreminders, sendactionqueuereminders, sendstreakwarnings,
 * sendbillreminders, sendweeklyrecap) so the collection-group switch and its
 * fallback live in exactly one place.
 *
 * Normal path: a single `collectionGroup("members").where("anyNotificationsEnabled", "==", true)`
 * query replaces the full `households` collection scan + per-household
 * `members` subcollection reads. Member docs are grouped by their parent
 * household (`doc.ref.parent.parent`) so a household reached via two flagged
 * members is still processed exactly once.
 *
 * Fallback path (`NOTIFICATIONS_FULL_SCAN` param === "true", or the optional
 * `forceFullScan` override used by tests): reproduces the original
 * `households.get()` -> per-household `members.get()` shape, with NO
 * `anyNotificationsEnabled` filtering, so a bad backfill degrades to the
 * previous (correct, just expensive) behavior rather than silently dropping
 * members.
 */
export async function loadNotifiableMembersByHousehold(
  db: admin.firestore.Firestore,
  forceFullScan?: boolean
): Promise<NotifiableHouseholdGroup[]> {
  const fullScan = forceFullScan ?? notificationsFullScanParam.value() === "true";

  if (fullScan) {
    logger.info("loadNotifiableMembersByHousehold: FALLBACK_FULL_SCAN active, scanning all households");
    const householdsSnapshot = await db.collection("households").get();
    const groups: NotifiableHouseholdGroup[] = [];
    for (const householdDoc of householdsSnapshot.docs) {
      const membersSnapshot = await householdDoc.ref.collection("members").get();
      groups.push({
        householdId: householdDoc.id,
        householdRef: householdDoc.ref,
        getHouseholdData: async () => householdDoc.data(),
        memberDocs: membersSnapshot.docs,
      });
    }
    return groups;
  }

  const membersSnapshot = await db
    .collectionGroup("members")
    .where("anyNotificationsEnabled", "==", true)
    .get();

  const byHousehold = new Map<string, NotifiableHouseholdGroup>();
  for (const memberDoc of membersSnapshot.docs) {
    const householdRef = memberDoc.ref.parent.parent;
    if (!householdRef) {
      // A `members` doc with no parent household should be impossible under
      // the app's data model, but guard defensively rather than throw.
      logger.warn(
        `loadNotifiableMembersByHousehold: member doc ${memberDoc.ref.path} has no parent household, skipping`
      );
      continue;
    }

    let group = byHousehold.get(householdRef.id);
    if (!group) {
      // Memoize the household read: jobs may call getHouseholdData once per
      // member of the group, and it should cost one Firestore read total.
      let householdDataPromise: Promise<admin.firestore.DocumentData | undefined> | undefined;
      group = {
        householdId: householdRef.id,
        householdRef,
        getHouseholdData: () => {
          householdDataPromise ??= householdRef.get().then((snap) => snap.data());
          return householdDataPromise;
        },
        memberDocs: [],
      };
      byHousehold.set(householdRef.id, group);
    }
    group.memberDocs.push(memberDoc);
  }

  logger.info(
    `loadNotifiableMembersByHousehold: ${membersSnapshot.docs.length} flagged member(s) across ${byHousehold.size} household(s)`
  );

  return Array.from(byHousehold.values());
}
