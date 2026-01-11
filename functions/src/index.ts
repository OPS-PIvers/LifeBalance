import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { toZonedTime } from "date-fns-tz";

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

interface NotificationPreferences {
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
  timezone?: string;
}

interface HouseholdMember {
  uid: string;
  displayName: string;
  email?: string;
  fcmTokens?: string[];
  notificationPreferences?: NotificationPreferences;
}

/**
 * Helper function to send a notification to a user
 */
async function sendNotificationToUser(
  fcmTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
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
    const response = await messaging.sendEachForMulticast(message);
    logger.info(
      `Successfully sent notification: ${response.successCount} succeeded, ${response.failureCount} failed`
    );

    // Remove invalid tokens
    if (response.failureCount > 0) {
      const tokensToRemove: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code === "messaging/registration-token-not-registered") {
          tokensToRemove.push(fcmTokens[idx]);
        }
      });

      if (tokensToRemove.length > 0) {
        logger.info("Tokens to remove:", tokensToRemove);
        // Note: In a real app, you would want to remove these from Firestore here
        // But we need the userId/householdId context to do that efficiently
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
  // Get current time in UTC
  const nowUtc = new Date();

  // Convert to user's timezone
  let userTime;
  try {
    userTime = toZonedTime(nowUtc, timezone);
  } catch (e) {
    logger.warn(`Invalid timezone '${timezone}', falling back to UTC`);
    userTime = toZonedTime(nowUtc, "UTC");
  }

  const currentHour = userTime.getHours();
  // We don't check minutes strictly because the cron runs once an hour.
  // We check if the current hour matches the scheduled hour.

  const [schedHour] = scheduledTime.split(":").map(Number);

  return currentHour === schedHour;
}

/**
 * Scheduled function: Runs every hour to check for habit reminders
 */
export const sendhabitreminders = onSchedule("every 1 hours", async () => {
  logger.info("Checking for habit reminders to send");

  const householdsSnapshot = await db.collection("households").get();

  for (const householdDoc of householdsSnapshot.docs) {
    // Fetch members from subcollection
    const membersSnapshot = await householdDoc.ref.collection("members").get();
    const members = membersSnapshot.docs.map(
      (doc) => doc.data() as HouseholdMember
    );

    for (const member of members) {
      const prefs = member.notificationPreferences;
      if (!prefs?.habitReminders?.enabled) continue;
      if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

      // Check if it's time to send
      if (isTimeToSend(prefs.habitReminders.time, prefs.timezone)) {
        await sendNotificationToUser(
          member.fcmTokens,
          "Time for your daily habit check-in! 🎯",
          "Let's keep those streaks alive and hit your goals today.",
          {
            type: "habit_reminder",
            url: "/habits",
          }
        );
      }
    }
  }
});

/**
 * Scheduled function: Runs every hour to check for action queue reminders
 */
export const sendactionqueuereminders = onSchedule(
  "every 1 hours",
  async () => {
    logger.info("Checking for action queue reminders to send");

    const householdsSnapshot = await db.collection("households").get();

    for (const householdDoc of householdsSnapshot.docs) {
      // Fetch members from subcollection
      const membersSnapshot = await householdDoc.ref.collection("members").get();
      const members = membersSnapshot.docs.map(
        (doc) => doc.data() as HouseholdMember
      );

      for (const member of members) {
        const prefs = member.notificationPreferences;
        if (!prefs?.actionQueueReminders?.enabled) continue;
        if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

        if (isTimeToSend(prefs.actionQueueReminders.time, prefs.timezone)) {
          // Get today's todos for this household
          const todosSnapshot = await householdDoc.ref
            .collection("todos")
            .where("assignedTo", "==", member.uid)
            .where("isCompleted", "==", false)
            .get();

          const todayString = new Date().toISOString().split("T")[0];
          const todayTodos = todosSnapshot.docs.filter(
            (doc) => doc.data().completeByDate === todayString
          );

          if (todayTodos.length > 0) {
            await sendNotificationToUser(
              member.fcmTokens,
              `Good morning! You have ${todayTodos.length} task${
                todayTodos.length > 1 ? "s" : ""
              } today`,
              `Let's tackle your action queue and make today productive!`,
              {
                type: "action_queue_reminder",
                url: "/dashboard",
              }
            );
          }
        }
      }
    }
  }
);

/**
 * Scheduled function: Runs every hour to check for streak warnings
 */
export const sendstreakwarnings = onSchedule("every 1 hours", async () => {
  logger.info("Checking for streak warnings to send");

  const householdsSnapshot = await db.collection("households").get();

  for (const householdDoc of householdsSnapshot.docs) {
    // Fetch members from subcollection
    const membersSnapshot = await householdDoc.ref.collection("members").get();
    const members = membersSnapshot.docs.map(
      (doc) => doc.data() as HouseholdMember
    );

    for (const member of members) {
      const prefs = member.notificationPreferences;
      if (!prefs?.streakWarnings?.enabled) continue;
      if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

      if (isTimeToSend(prefs.streakWarnings.time, prefs.timezone)) {
        // Get habits subcollection
        const habitsSnapshot = await householdDoc.ref
          .collection("habits")
          .where("period", "==", "daily")
          .get();

        const today = new Date().toISOString().split("T")[0];
        const habitsAtRisk = habitsSnapshot.docs.filter((doc) => {
          const habit = doc.data();
          return (
            habit.streakDays >= 3 &&
            !habit.completedDates?.includes(today)
          );
        });

        if (habitsAtRisk.length > 0) {
          await sendNotificationToUser(
            member.fcmTokens,
            "Don't break your streak! 🔥",
            `You have ${habitsAtRisk.length} habit${
              habitsAtRisk.length > 1 ? "s" : ""
            } with active streaks that need attention today.`,
            {
              type: "streak_warning",
              url: "/habits",
            }
          );
        }
      }
    }
  }
});

/**
 * Scheduled function: Runs every hour to check for bill reminders
 */
export const sendbillreminders = onSchedule(
  {schedule: "every 1 hours"},
  async () => {
    logger.info("Checking for bill reminders to send");

    const householdsSnapshot = await db.collection("households").get();

    for (const householdDoc of householdsSnapshot.docs) {
      // Fetch members from subcollection
      const membersSnapshot = await householdDoc.ref.collection("members").get();
      const members = membersSnapshot.docs.map(
        (doc) => doc.data() as HouseholdMember
      );

      for (const member of members) {
        const prefs = member.notificationPreferences;
        if (!prefs?.billReminders?.enabled) continue;
        if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

        if (isTimeToSend(prefs.billReminders.time, prefs.timezone)) {
          // Get calendar items (bills)
          const calendarSnapshot = await householdDoc.ref
            .collection("calendarItems")
            .where("type", "==", "expense")
            .where("isPaid", "==", false)
            .get();

          const daysAhead = prefs.billReminders.daysBeforeDue;
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + daysAhead);
          const targetDateStr = targetDate.toISOString().split("T")[0];

          const upcomingBills = calendarSnapshot.docs.filter(
            (doc) => doc.data().date === targetDateStr
          );

          if (upcomingBills.length > 0) {
            const totalAmount = upcomingBills.reduce(
              (sum, doc) => sum + (doc.data().amount || 0),
              0
            );

            await sendNotificationToUser(
              member.fcmTokens,
              `Bills due in ${daysAhead} day${daysAhead > 1 ? "s" : ""}`,
              `${upcomingBills.length} bill${
                upcomingBills.length > 1 ? "s" : ""
              } totaling $${totalAmount.toFixed(2)} coming up`,
              {
                type: "bill_reminder",
                url: "/budget",
              }
            );
          }
        }
      }
    }
  }
);

/**
 * Firestore trigger: Monitor safe-to-spend and send budget alerts
 */
export const sendbudgetalerts = onDocumentUpdated(
  "households/{householdId}",
  async (event) => {
    const newData = event.data?.after.data();
    if (!newData) return;

    const householdId = event.params.householdId;
    const householdRef = db.collection("households").doc(householdId);

    // Fetch members from subcollection
    const membersSnapshot = await householdRef.collection("members").get();
    const members = membersSnapshot.docs.map(
      (doc) => doc.data() as HouseholdMember
    );

    // Calculate safe-to-spend (simplified)
    const accounts = newData.accounts || [];
    const checkingBalance = accounts
      .filter((acc: any) => acc.type === "checking")
      .reduce((sum: number, acc: any) => sum + acc.balance, 0);

    for (const member of members) {
      const prefs = member.notificationPreferences;
      if (!prefs?.budgetAlerts?.enabled) continue;
      if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

      const threshold = prefs.budgetAlerts.threshold || 100;

      if (checkingBalance < threshold) {
        await sendNotificationToUser(
          member.fcmTokens,
          "Low Balance Alert! 💰",
          `Your safe-to-spend is down to $${checkingBalance.toFixed(
            2
          )}. Time to watch your spending.`,
          {
            type: "budget_alert",
            url: "/budget",
          }
        );
      }
    }
  }
);

/**
 * Callable function: Send a test notification to the calling user
 * This allows users to verify that their device is correctly configured
 */
export const sendtestnotification = onCall(async (request) => {
  // Ensure the user is authenticated
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  const userId = request.auth.uid;
  // We need to find the householdId to look up the user's tokens.
  // Since we don't have it in the request (unless passed), we can search households.
  // A better way is to pass householdId in the data.
  const householdId = request.data.householdId;

  if (!householdId) {
    throw new HttpsError(
      "invalid-argument",
      "The function must be called with a householdId."
    );
  }

  try {
    const memberRef = db.doc(`households/${householdId}/members/${userId}`);
    const memberDoc = await memberRef.get();

    if (!memberDoc.exists) {
      throw new HttpsError("not-found", "Member profile not found.");
    }

    const memberData = memberDoc.data() as HouseholdMember;
    const tokens = memberData.fcmTokens;

    if (!tokens || tokens.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No notification tokens found for this user."
      );
    }

    await sendNotificationToUser(
      tokens,
      "Test Notification 🔔",
      "Great! Your device is set up to receive notifications.",
      {
        type: "test_notification",
        url: "/settings"
      }
    );

    return { success: true, message: "Test notification sent" };
  } catch (error) {
    logger.error("Error sending test notification:", error);
    throw new HttpsError("internal", "Failed to send test notification");
  }
});
