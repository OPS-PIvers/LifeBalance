import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { formatInTimeZone } from "date-fns-tz";
import { formatCurrency } from "./utils/formatCurrency";

admin.initializeApp();

// Export Quick Add HTTP functions for iOS Shortcuts
export { quickAddHabit, quickAddExpense, quickAddReceipt, quickAddShoppingItem, quickAddNaturalLanguage } from "./quickAdd";

// Export the Gemini API proxy (holds the GEMINI_API_KEY secret server-side).
export { geminiproxy } from "./geminiProxy";

// Stripe billing functions (Plan 050a) live in ./stripe and are fully implemented
// and unit-tested, but are intentionally NOT exported here yet. Exporting a function
// deploys it, and deploying these binds the STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
// secrets — which a non-interactive `firebase deploy` (our CI) REQUIRES to already
// exist in Secret Manager, failing the whole deploy otherwise. Creating those secrets
// is a human step. ACTIVATION: set the secrets (docs/STRIPE_SETUP_RUNBOOK.md §1.3),
// then wire them in here and redeploy:
//   export { createcheckoutsession } from "./stripe/checkout";
//   export { stripewebhook } from "./stripe/webhook";

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
 * Helper function to send a notification to a user.
 * @param memberRef - Optional Firestore document reference for the member. When
 *   provided, any permanently-invalid FCM tokens detected in the multicast response
 *   are removed from the member's `fcmTokens` array via arrayRemove so they are
 *   not retried on future sends.
 */
async function sendNotificationToUser(
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
    const response = await messaging.sendEachForMulticast(message);
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

/**
 * Scheduled function: Runs every hour to check for habit reminders
 */
export const sendhabitreminders = onSchedule("every 1 hours", async () => {
  logger.info("Checking for habit reminders to send");

  const householdsSnapshot = await db.collection("households").get();
  logger.info(`Found ${householdsSnapshot.docs.length} household(s)`);

  for (const householdDoc of householdsSnapshot.docs) {
    // Fetch members from subcollection
    const membersSnapshot = await householdDoc.ref.collection("members").get();
    logger.info(`Household ${householdDoc.id}: ${membersSnapshot.docs.length} member(s)`);

    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;

      if (!prefs?.habitReminders?.enabled) {
        logger.info(`Member ${member.uid}: habit reminders not enabled`);
        continue;
      }

      if (!member.fcmTokens || member.fcmTokens.length === 0) {
        logger.info(`Member ${member.uid}: no FCM tokens found`);
        continue;
      }

      logger.info(`Member ${member.uid}: has ${member.fcmTokens.length} token(s), scheduled time: ${prefs.habitReminders.time}, timezone: ${prefs.timezone}`);

      // Check if it's time to send
      if (isTimeToSend(prefs.habitReminders.time, prefs.timezone)) {
        logger.info(`Member ${member.uid}: sending habit reminder now`);
        await sendNotificationToUser(
          member.fcmTokens,
          "Time for your daily habit check-in! 🎯",
          "Let's keep those streaks alive and hit your goals today.",
          {
            type: "habit_reminder",
            url: "/habits",
          },
          memberDoc.ref
        );
      } else {
        logger.info(`Member ${member.uid}: not time to send yet (current check didn't match scheduled time)`);
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
    logger.info(`Found ${householdsSnapshot.docs.length} household(s)`);

    for (const householdDoc of householdsSnapshot.docs) {
      // Fetch members from subcollection
      const membersSnapshot = await householdDoc.ref.collection("members").get();
      logger.info(`Household ${householdDoc.id}: ${membersSnapshot.docs.length} member(s)`);

      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data() as HouseholdMember;
        const prefs = member.notificationPreferences;

        if (!prefs?.actionQueueReminders?.enabled) {
          logger.info(`Member ${member.uid}: action queue reminders not enabled`);
          continue;
        }

        if (!member.fcmTokens || member.fcmTokens.length === 0) {
          logger.info(`Member ${member.uid}: no FCM tokens found`);
          continue;
        }

        logger.info(`Member ${member.uid}: has ${member.fcmTokens.length} token(s), scheduled time: ${prefs.actionQueueReminders.time}, timezone: ${prefs.timezone}`);

        if (isTimeToSend(prefs.actionQueueReminders.time, prefs.timezone)) {
          // Get today's todos for this household
          const todosSnapshot = await householdDoc.ref
            .collection("todos")
            .where("assignedTo", "==", member.uid)
            .where("isCompleted", "==", false)
            .get();

          // Compute "today" in the member's local timezone so the comparison
          // against locally-stored completeByDate strings is correct.
          // Using new Date().toISOString().split("T")[0] would return the UTC
          // date, which is wrong for non-UTC users (e.g., wrong day in evenings
          // for US timezones). formatInTimeZone matches the pattern used by
          // isTimeToSend above.
          const todayString = formatInTimeZone(
            new Date(),
            prefs.timezone || "UTC",
            "yyyy-MM-dd"
          );
          const todayTodos = todosSnapshot.docs.filter(
            (doc) => doc.data().completeByDate === todayString
          );

          if (todayTodos.length > 0) {
            logger.info(`Member ${member.uid}: sending action queue reminder (${todayTodos.length} todos)`);
            await sendNotificationToUser(
              member.fcmTokens,
              `Good morning! You have ${todayTodos.length} task${
                todayTodos.length > 1 ? "s" : ""
              } today`,
              `Let's tackle your action queue and make today productive!`,
              {
                type: "action_queue_reminder",
                url: "/dashboard",
              },
              memberDoc.ref
            );
          } else {
            logger.info(`Member ${member.uid}: no todos for today, skipping notification`);
          }
        } else {
          logger.info(`Member ${member.uid}: not time to send yet`);
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
  logger.info(`Found ${householdsSnapshot.docs.length} household(s)`);

  for (const householdDoc of householdsSnapshot.docs) {
    // Fetch members from subcollection
    const membersSnapshot = await householdDoc.ref.collection("members").get();
    logger.info(`Household ${householdDoc.id}: ${membersSnapshot.docs.length} member(s)`);

    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;

      if (!prefs?.streakWarnings?.enabled) {
        logger.info(`Member ${member.uid}: streak warnings not enabled`);
        continue;
      }

      if (!member.fcmTokens || member.fcmTokens.length === 0) {
        logger.info(`Member ${member.uid}: no FCM tokens found`);
        continue;
      }

      logger.info(`Member ${member.uid}: has ${member.fcmTokens.length} token(s), scheduled time: ${prefs.streakWarnings.time}, timezone: ${prefs.timezone}`);

      if (isTimeToSend(prefs.streakWarnings.time, prefs.timezone)) {
        // Get habits subcollection
        const habitsSnapshot = await householdDoc.ref
          .collection("habits")
          .where("period", "==", "daily")
          .get();

        // Compute "today" in the member's local timezone so the check
        // against locally-stored completedDates strings is correct.
        // new Date().toISOString().split("T")[0] returns the UTC date,
        // which is wrong for non-UTC users (e.g., a US user at 9pm would
        // see the next day's date). formatInTimeZone matches isTimeToSend.
        const today = formatInTimeZone(
          new Date(),
          prefs.timezone || "UTC",
          "yyyy-MM-dd"
        );
        const habitsAtRisk = habitsSnapshot.docs.filter((doc) => {
          const habit = doc.data();
          return (
            habit.streakDays >= 3 &&
            !habit.completedDates?.includes(today)
          );
        });

        if (habitsAtRisk.length > 0) {
          logger.info(`Member ${member.uid}: sending streak warning (${habitsAtRisk.length} habits at risk)`);
          await sendNotificationToUser(
            member.fcmTokens,
            "Don't break your streak! 🔥",
            `You have ${habitsAtRisk.length} habit${
              habitsAtRisk.length > 1 ? "s" : ""
            } with active streaks that need attention today.`,
            {
              type: "streak_warning",
              url: "/habits",
            },
            memberDoc.ref
          );
        } else {
          logger.info(`Member ${member.uid}: no habits at risk, skipping notification`);
        }
      } else {
        logger.info(`Member ${member.uid}: not time to send yet`);
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
    logger.info(`Found ${householdsSnapshot.docs.length} household(s)`);

    for (const householdDoc of householdsSnapshot.docs) {
      // Fetch members from subcollection
      const membersSnapshot = await householdDoc.ref.collection("members").get();
      logger.info(`Household ${householdDoc.id}: ${membersSnapshot.docs.length} member(s)`);

      // Currency for user-facing money strings is sourced from the household doc
      // (the top-level `currency` field added by the client). Falls back to USD.
      const currency = householdDoc.data()?.currency || "USD";

      for (const memberDoc of membersSnapshot.docs) {
        const member = memberDoc.data() as HouseholdMember;
        const prefs = member.notificationPreferences;

        if (!prefs?.billReminders?.enabled) {
          logger.info(`Member ${member.uid}: bill reminders not enabled`);
          continue;
        }

        if (!member.fcmTokens || member.fcmTokens.length === 0) {
          logger.info(`Member ${member.uid}: no FCM tokens found`);
          continue;
        }

        logger.info(`Member ${member.uid}: has ${member.fcmTokens.length} token(s), scheduled time: ${prefs.billReminders.time}, timezone: ${prefs.timezone}`);

        if (isTimeToSend(prefs.billReminders.time, prefs.timezone)) {
          // Get calendar items (bills)
          const calendarSnapshot = await householdDoc.ref
            .collection("calendarItems")
            .where("type", "==", "expense")
            .where("isPaid", "==", false)
            .get();

          const daysAhead = prefs.billReminders.daysBeforeDue;
          // Compute the target date in the member's local timezone so the
          // comparison against locally-stored bill date strings is correct.
          // toISOString().split("T")[0] returns the UTC date, which is wrong
          // for non-UTC users. We advance by daysAhead whole days relative to
          // the member's local "today" using a UTC offset-free Date arithmetic
          // on a date string derived via formatInTimeZone.
          const localToday = formatInTimeZone(
            new Date(),
            prefs.timezone || "UTC",
            "yyyy-MM-dd"
          );
          const [ly, lm, ld] = localToday.split("-").map(Number);
          const targetDateObj = new Date(
            Date.UTC(ly ?? 2000, (lm ?? 1) - 1, (ld ?? 1) + daysAhead)
          );
          const targetDateStr = formatInTimeZone(
            targetDateObj,
            "UTC",
            "yyyy-MM-dd"
          );

          const upcomingBills = calendarSnapshot.docs.filter(
            (doc) => doc.data().date === targetDateStr
          );

          if (upcomingBills.length > 0) {
            const totalAmount = upcomingBills.reduce(
              (sum, doc) => sum + (doc.data().amount || 0),
              0
            );

            logger.info(`Member ${member.uid}: sending bill reminder (${upcomingBills.length} bills, $${totalAmount.toFixed(2)})`);
            await sendNotificationToUser(
              member.fcmTokens,
              `Bills due in ${daysAhead} day${daysAhead > 1 ? "s" : ""}`,
              `${upcomingBills.length} bill${
                upcomingBills.length > 1 ? "s" : ""
              } totaling ${formatCurrency(totalAmount, { currency })} coming up`,
              {
                type: "bill_reminder",
                url: "/budget",
              },
              memberDoc.ref
            );
          } else {
            logger.info(`Member ${member.uid}: no upcoming bills, skipping notification`);
          }
        } else {
          logger.info(`Member ${member.uid}: not time to send yet`);
        }
      }
    }
  }
);

/**
 * Firestore trigger: Monitor account balance changes and send budget alerts.
 * Fires on every write to the accounts subcollection (create/update/delete),
 * which is where balances actually live — not on the household document.
 * This avoids the previous behaviour of re-running on every household write
 * (e.g., every points increment) which caused spurious $0.00 alerts.
 */
export const sendbudgetalerts = onDocumentWritten(
  "households/{householdId}/accounts/{accountId}",
  async (event) => {
    // Fires on any account create/update/delete. We always recompute the total
    // checking balance from the accounts subcollection below, so deletions (which
    // lower the balance and could cross the alert threshold) are handled correctly
    // — no early return is needed.
    const householdId = event.params.householdId;
    const householdRef = db.collection("households").doc(householdId);

    // Fetch members from subcollection
    const membersSnapshot = await householdRef.collection("members").get();

    // Recompute total checking balance across all accounts in the subcollection
    // so the alert threshold reflects the real current state.
    const accountsSnapshot = await householdRef.collection("accounts").get();
    const checkingBalance = accountsSnapshot.docs
      .map((accDoc) => accDoc.data())
      .filter((acc) => acc.type === "checking")
      .reduce(
        (sum, acc) => sum + (typeof acc.balance === "number" ? acc.balance : 0),
        0
      );

    // Currency for the alert string is sourced from the household doc (the
    // top-level `currency` field added by the client). Falls back to USD.
    const householdSnap = await householdRef.get();
    const currency = householdSnap.data()?.currency || "USD";

    for (const memberDoc of membersSnapshot.docs) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;
      if (!prefs?.budgetAlerts?.enabled) continue;
      if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

      const threshold = prefs.budgetAlerts.threshold || 100;

      if (checkingBalance < threshold) {
        await sendNotificationToUser(
          member.fcmTokens,
          "Low Balance Alert! 💰",
          `Your safe-to-spend is down to ${formatCurrency(checkingBalance, {
            currency,
          })}. Time to watch your spending.`,
          {
            type: "budget_alert",
            url: "/budget",
          },
          memberDoc.ref
        );
      }
    }
  }
);

/**
 * Callable function: Send a test notification to the calling user
 * This allows users to verify that their device is correctly configured
 */
export const sendtestnotification = onCall(
  {
    cors: true,
  },
  async (request) => {
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

    // No self-access guard is needed here: userId is request.auth.uid, so this
    // callable only ever reads and notifies the caller's OWN member document
    // (households/{householdId}/members/{userId}). The previous
    // `userId !== request.auth.uid` check was dead code (always false) and has
    // been removed.

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
      },
      memberRef
    );

    return { success: true, message: "Test notification sent" };
  } catch (error) {
    logger.error("Error sending test notification:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to send test notification");
  }
});

/**
 * Callable function: Permanently delete a household and all of its data.
 *
 * Only a household admin may invoke this. Recursively deletes the household
 * document and every subcollection (members, habits, transactions, etc.), then
 * removes any invite codes that point at the household. Uses a longer timeout
 * because large households can have many subcollection documents to delete.
 */
export const deletehousehold = onCall(
  {
    cors: true,
    timeoutSeconds: 300,
  },
  async (request) => {
    // Ensure the user is authenticated
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const householdId = request.data?.householdId;

    if (!householdId || typeof householdId !== "string") {
      throw new HttpsError(
        "invalid-argument",
        "The function must be called with a householdId."
      );
    }

    // Verify the caller is an admin of THIS household.
    const memberRef = db.doc(
      `households/${householdId}/members/${request.auth.uid}`
    );
    const memberDoc = await memberRef.get();

    if (!memberDoc.exists || memberDoc.data()?.role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Only a household admin can delete the household."
      );
    }

    // Recursively delete the household document and all of its subcollections.
    await db.recursiveDelete(db.doc(`households/${householdId}`));

    // Remove any invite codes that pointed at the deleted household.
    const inviteSnap = await db
      .collection("inviteCodes")
      .where("householdId", "==", householdId)
      .get();
    await Promise.all(inviteSnap.docs.map((d) => d.ref.delete()));

    logger.info("Household deleted", {
      householdId,
      deletedBy: request.auth.uid,
    });

    return { success: true };
  }
);
