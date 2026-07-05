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
            await memberRef.update({
              fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensToRemove),
            });
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
