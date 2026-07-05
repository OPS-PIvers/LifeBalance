import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { formatInTimeZone } from "date-fns-tz";

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
  };
  // Plan 02 (weekly recap engine): per-member opt-out for the weekly recap
  // push notification. Absent/undefined is treated as enabled (fail-open,
  // matching the other notification preference blocks' spirit) — only an
  // explicit `enabled: false` suppresses the push.
  weeklyRecap?: {
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
  if (!prefs) return false;

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
 * Helper function to send a notification to a user.
 * @param memberRef - Optional Firestore document reference for the member. When
 *   provided, any permanently-invalid FCM tokens detected in the multicast response
 *   are removed from the member's `fcmTokens` array via arrayRemove so they are
 *   not retried on future sends.
 */
export async function sendNotificationToUser(
  fcmTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  memberRef?: admin.firestore.DocumentReference
): Promise<void> {
  if (!fcmTokens || fcmTokens.length === 0) {
    logger.info("No FCM tokens available for user");
    return;
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
