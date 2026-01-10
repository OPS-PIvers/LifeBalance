import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

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
        if (!resp.success) {
          tokensToRemove.push(fcmTokens[idx]);
        }
      });
      logger.info("Tokens to remove:", tokensToRemove);
    }
  } catch (error) {
    logger.error("Error sending notification:", error);
  }
}

/**
 * Helper function to check if current time matches scheduled time
 */
function isTimeToSend(
  scheduledTime: string,
  timezone: string = "UTC"
): boolean {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();

  const [schedHour, schedMinute] = scheduledTime.split(":").map(Number);

  // Simple check - in production, you'd want to handle timezones properly
  return currentHour === schedHour && currentMinute === schedMinute;
}

/**
 * Scheduled function: Runs every hour to check for habit reminders
 */
export const sendhabitreminders = onSchedule("every 1 hours", async () => {
  logger.info("Checking for habit reminders to send");

  const householdsSnapshot = await db.collection("households").get();

  for (const householdDoc of householdsSnapshot.docs) {
    const household = householdDoc.data();
    const members: HouseholdMember[] = household.members || [];

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
      const household = householdDoc.data();
      const members: HouseholdMember[] = household.members || [];

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
    const household = householdDoc.data();
    const members: HouseholdMember[] = household.members || [];

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
export const sendbillreminders = onSchedule("every 1 hours", async () => {
  logger.info("Checking for bill reminders to send");

  const householdsSnapshot = await db.collection("households").get();

  for (const householdDoc of householdsSnapshot.docs) {
    const household = householdDoc.data();
    const members: HouseholdMember[] = household.members || [];

    for (const member of members) {
      const prefs = member.notificationPreferences;
      if (!prefs?.billReminders?.enabled) continue;
      if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

      if (isTimeToSend(prefs.billReminders.time, prefs.timezone)) {
        // Get calendar items (bills)
        const calendarSnapshot = await householdDoc.ref
          .collection("calendar")
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
});

/**
 * Firestore trigger: Monitor safe-to-spend and send budget alerts
 */
export const sendbudgetalerts = onDocumentUpdated(
  "households/{householdId}",
  async (event) => {
    const newData = event.data?.after.data();
    if (!newData) return;

    const members: HouseholdMember[] = newData.members || [];

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
