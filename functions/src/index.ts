import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { formatInTimeZone } from "date-fns-tz";
import { formatCurrency } from "./utils/formatCurrency";
import {
  isTimeToSend,
  sendNotificationToUser,
  loadNotifiableMembersByHousehold,
  type HouseholdMember,
} from "./shared/notifications";
import { findBillsDueOnDate, type BillCalendarItem } from "./shared/bills";
import { shouldSendTodoReminder, buildTodoReminderBody } from "./shared/todoReminders";
import { writeProactiveInsight, type ProactiveCapHouseholdDoc } from "./insights/writeProactiveInsight";
import {
  computeHabitsPending,
  computeStreaksAtRisk,
  computeTodosToday,
  buildDigestMessage,
  type DigestHabit,
  type DigestTodo,
} from "./shared/digest";
import {
  buildActionsDataField,
  buildHabitLogActionsDataField,
  isBillReminderSnoozed,
} from "./shared/notificationActions";
import {
  buildHabitReminderMessage,
  isRemindableHabit,
  isReminderDue,
  localClock,
  normalizeHabitReminder,
} from "./shared/habitReminders";
import { PLAID_SECRETS } from "./plaid/client";
import { revokeAllPlaidItems } from "./plaid/revoke";

// Re-export for consumers that imported this from index.ts before the
// extraction to shared/notifications.ts.
export { isTimeToSend } from "./shared/notifications";

// Re-export the bill-recurrence helpers moved to shared/bills.ts, so existing
// importers (and index.test.ts) that referenced them from index.ts keep working.
export { findBillsDueOnDate, type BillCalendarItem } from "./shared/bills";

admin.initializeApp();

// Export Quick Add HTTP functions for iOS Shortcuts
export { quickAddHabit, quickAddExpense, quickAddShoppingItem, quickAddNaturalLanguage, quickAddBillPay, quickAddTodo, getTodos, bankEmailSync } from "./quickAdd";

// Export the Gemini API proxy (holds the GEMINI_API_KEY secret server-side).
export { geminiproxy } from "./geminiProxy";

// Recipe-page fetcher for URL recipe import (Plan 19). No secrets — plain
// server-side fetch with SSRF guards, so exporting it cannot break CI deploys.
export { fetchrecipepage } from "./fetchRecipePage";

// Stripe billing functions (Plan 050a) live in ./stripe and are fully implemented
// and unit-tested, but are intentionally NOT exported here yet. Exporting a function
// deploys it, and deploying these binds the STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
// secrets — which a non-interactive `firebase deploy` (our CI) REQUIRES to already
// exist in Secret Manager, failing the whole deploy otherwise. Creating those secrets
// is a human step. ACTIVATION: set the secrets (docs/STRIPE_SETUP_RUNBOOK.md §1.3),
// then wire them in here and redeploy:
//   export { createcheckoutsession } from "./stripe/checkout";
//   export { stripewebhook } from "./stripe/webhook";

// API-key reveal functions (Plan: iOS-Shortcut key copy) live in ./apiKeys and
// are fully implemented and unit-tested, but are intentionally NOT exported here
// yet — same reason as Stripe. Exporting binds the APIKEY_ENC_KEY secret, which
// a non-interactive `firebase deploy` (our CI) REQUIRES to already exist in
// Secret Manager, failing the whole deploy otherwise. ACTIVATION is a human step
// (docs/APIKEY_REVEAL_RUNBOOK.md): set the secret, then wire them in here, set
// VITE_APIKEY_REVEAL_ENABLED=true in the deploy workflow, and redeploy:
//   export { attachapikeyencryption, revealapikey } from "./apiKeys/reveal";

// Plaid bank-link functions (./plaid). ACTIVATED: the PLAID_CLIENT_ID /
// PLAID_SECRET / PLAID_ENV secrets are now set in Secret Manager (sandbox), so
// these secret-bound functions can deploy. The "Connect a bank" UI + the daily
// sync still only do anything once the `plaidEnabled` flag is flipped ON in the
// Developer Console (docs/PLAID_SETUP_RUNBOOK.md).
export { plaidcreatelinktoken } from "./plaid/links";
export { plaidexchangepublictoken } from "./plaid/exchange";
export { plaidsynctransactions } from "./plaid/sync";
export { plaiddisconnectbank } from "./plaid/disconnect";

// Weekly recap engine (Plan 02).
export { sendweeklyrecap } from "./recap";

// Monthly money recap engine (F-MONEY-06). Uses the shared GEMINI_API_KEY
// secret (already required by geminiproxy/sendweeklyrecap), so exporting it
// adds no new secret dependency for CI deploys.
export { sendmonthlymoneyrecap } from "./moneyRecap";

// AI Daily Briefing engine (F-DASH-02). Uses the shared GEMINI_API_KEY secret
// (already required by geminiproxy/sendweeklyrecap/sendmonthlymoneyrecap), so
// exporting it adds no new secret dependency for CI deploys.
export { senddailybriefing } from "./dailyBriefing";

// Daily net worth snapshot (F-MONEY-09). No secrets — safe to export/deploy.
export { snapshotnetworth } from "./netWorth";

// Managed kid-profile creation (Plan 080 / Plan 051): authoritatively enforces the
// per-plan maxKidProfiles cap server-side. No secrets — safe to export/deploy.
export { createkidprofile } from "./kid/createKidProfile";

// Household calendar ICS feed (Plan 22): token callable + public read-only
// HTTP feed. No secrets — safe to export/deploy unconditionally.
export { generatecalendarfeedtoken, calendarfeed } from "./calendarFeed";

// Unified trash purge (F-XCUT-03): daily scheduled job that permanently removes
// soft-deleted records older than the 30-day retention window. No secrets, and
// fails-soft if the collection-group index isn't present yet — safe to export.
export { purgetrash } from "./purgeTrash";

const db = admin.firestore();

/**
 * Scheduled function: Runs every hour to send the household-wide daily habit
 * nudge (the single `habitReminders.time` toggle in Notification settings).
 *
 * F-HABITS-03 made this CONTENT-AWARE: it now counts what the member actually
 * has left today and stays silent when the answer is zero, instead of pushing
 * the same "keep those streaks alive" line at someone who finished everything.
 * Habits carrying their OWN per-habit reminder are excluded from the count —
 * `sendperhabitreminders` below owns those, and double-nudging the same habit
 * from two jobs is exactly what a per-habit schedule is meant to replace.
 */
export const sendhabitreminders = onSchedule("every 1 hours", async () => {
  logger.info("Checking for habit reminders to send");

  const groups = await loadNotifiableMembersByHousehold(db);
  logger.info(`Found ${groups.length} household(s) with notification-eligible members`);

  for (const group of groups) {
    logger.info(`Household ${group.householdId}: ${group.memberDocs.length} member(s)`);

    // One habits read per household, shared by every member below and paid for
    // only once a member actually reaches the send window.
    let habitDocsPromise: Promise<admin.firestore.QueryDocumentSnapshot[]> | undefined;
    const getHabitDocs = () => {
      habitDocsPromise ??= group.householdRef
        .collection("habits")
        .get()
        .then((snap) => snap.docs);
      return habitDocsPromise;
    };

    for (const memberDoc of group.memberDocs) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;

      if (prefs?.digestMode?.enabled) {
        logger.info(`Member ${member.uid}: digest mode active, skipping per-type habit reminder`);
        continue;
      }

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
        const today = formatInTimeZone(new Date(), prefs.timezone || "UTC", "yyyy-MM-dd");
        const ownReminders = prefs.perHabitReminders ?? {};
        const pending = (await getHabitDocs()).filter((doc) => {
          // A habit the member scheduled for themselves is handled by
          // sendperhabitreminders — even when its own minute hasn't arrived yet,
          // since being reminded twice is worse than being reminded once late.
          if (normalizeHabitReminder(ownReminders[doc.id])?.enabled) return false;
          return isRemindableHabit(doc.data(), today, member.uid);
        });

        if (pending.length === 0) {
          logger.info(`Member ${member.uid}: nothing left to log today, skipping nudge`);
          continue;
        }

        logger.info(`Member ${member.uid}: sending habit reminder now (${pending.length} pending)`);
        await sendNotificationToUser(
          member.fcmTokens,
          "Time for your daily habit check-in!",
          `${pending.length} habit${pending.length > 1 ? "s" : ""} still to log — let's keep those streaks alive.`,
          {
            type: "habit_reminder",
            url: "/habits",
          },
          memberDoc.ref,
          { householdId: group.householdId, recipientUid: member.uid, type: "habit_reminder" }
        );
      } else {
        logger.info(`Member ${member.uid}: not time to send yet (current check didn't match scheduled time)`);
      }
    }
  }
});

/**
 * F-HABITS-03: Scheduled function running every 15 minutes to deliver PER-HABIT
 * timed reminders — the `notificationPreferences.perHabitReminders[habitId]`
 * `{enabled, time, days}` schedules written by the habit form.
 *
 * Shape mirrors `sendtodoreminders`: an arbitrary member-local HH:MM matched
 * inside a 15-minute cadence, a generous late-catch-up window, and a claim
 * written BEFORE the send so an overlapping invocation can't double-push. The
 * claim lives in a server-owned `habitReminderSentDates` map (habit id → local
 * yyyy-MM-dd) on the member doc rather than on the shared habit document, for
 * the same reason the schedules themselves do — see the `perHabitReminders`
 * comment in types/schema.ts.
 *
 * Like `sendtodoreminders`, it deliberately IGNORES `digestMode`: a reminder
 * aimed at one habit at one minute is an alarm, not a briefing. Every habit due
 * in the same window is coalesced into ONE push so a member with a 07:00
 * morning routine gets a single notification, not five.
 */
export const sendperhabitreminders = onSchedule("every 15 minutes", async () => {
  logger.info("Checking for per-habit reminders to send");

  const groups = await loadNotifiableMembersByHousehold(db);
  const nowMs = Date.now();

  for (const group of groups) {
    // Resolve who is due BEFORE reading any habit, so the overwhelming majority
    // of 15-minute runs (nobody due) cost zero extra reads per household.
    const candidates = group.memberDocs.flatMap((memberDoc) => {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;
      if (!member.fcmTokens || member.fcmTokens.length === 0) return [];

      const stored = prefs?.perHabitReminders;
      if (!stored) return [];

      const clock = localClock(nowMs, prefs?.timezone || "UTC");
      const dueHabitIds = Object.entries(stored).flatMap(([habitId, raw]) => {
        const config = normalizeHabitReminder(raw);
        return config && isReminderDue(config, clock) ? [habitId] : [];
      });

      // Carry the tokens explicitly: the guard above narrows them here, but that
      // narrowing can't survive being stashed on `member`, and re-defaulting at
      // the send site would read as though they might be missing.
      return dueHabitIds.length > 0
        ? [{ member, fcmTokens: member.fcmTokens, ref: memberDoc.ref, clock, dueHabitIds }]
        : [];
    });

    if (candidates.length === 0) continue;

    const habitsSnapshot = await group.householdRef.collection("habits").get();
    const habitsById = new Map(habitsSnapshot.docs.map((doc) => [doc.id, doc.data()]));

    for (const { member, fcmTokens, ref, clock, dueHabitIds } of candidates) {
      // Drop reminders whose habit is gone, archived, paused, already done for
      // its period, or personal to someone else.
      const remindable = dueHabitIds.flatMap((habitId) => {
        const habit = habitsById.get(habitId);
        if (!habit || !isRemindableHabit(habit, clock.date, member.uid)) return [];
        const title = typeof habit.title === "string" ? habit.title : "";
        return [{ habitId, title }];
      });
      if (remindable.length === 0) continue;

      // Claim BEFORE sending, in a transaction that re-reads the member doc, so
      // a slow run still going when the next 15-minute trigger fires can't
      // double-push: only one claimant flips a habit's stamp to today's local
      // date. A send failure after the claim drops one reminder, which is the
      // safer failure mode. The same pass prunes stamps for habits that no
      // longer exist, so the map can't grow without bound.
      const claimed = await db.runTransaction(async (tx) => {
        const liveSnap = await tx.get(ref);
        if (!liveSnap.exists) return [];
        const live = liveSnap.data() ?? {};
        const sentDates = (live.habitReminderSentDates ?? {}) as Record<string, unknown>;

        const toSend = remindable.filter(({ habitId }) => sentDates[habitId] !== clock.date);
        if (toSend.length === 0) return [];

        const next: Record<string, string> = {};
        for (const [habitId, sentOn] of Object.entries(sentDates)) {
          if (typeof sentOn === "string" && habitsById.has(habitId)) next[habitId] = sentOn;
        }
        for (const { habitId } of toSend) next[habitId] = clock.date;

        // Whole-map write is safe here (unlike completedDates): this field is
        // server-owned, no client ever touches it, and the transaction just
        // re-read it.
        tx.update(ref, { habitReminderSentDates: next });
        return toSend;
      });
      if (claimed.length === 0) continue;

      const message = buildHabitReminderMessage(claimed.map((entry) => entry.title));
      if (!message) continue;

      // The habits page filters to exactly what this push is about. A push
      // naming ONE habit can also carry a "Log it" action button, since the
      // `nhabit` target is unambiguous; a coalesced push has no single target,
      // so it deep-links only. (iOS renders no action buttons either way — see
      // buildHabitLogActionsDataField.)
      const single = claimed.length === 1 ? claimed[0] : undefined;
      const dueParam = claimed.map((entry) => encodeURIComponent(entry.habitId)).join(",");

      logger.info(
        `Household ${group.householdId}: sending per-habit reminder for ${claimed.length} habit(s) to ${member.uid}`
      );
      await sendNotificationToUser(
        fcmTokens,
        message.title,
        message.body,
        {
          type: "habit_reminder",
          url: single
            ? `/habits?due=${dueParam}&nhabit=${encodeURIComponent(single.habitId)}`
            : `/habits?due=${dueParam}`,
          ...(single ? { actions: buildHabitLogActionsDataField() } : {}),
        },
        ref,
        { householdId: group.householdId, recipientUid: member.uid, type: "habit_reminder" }
      );
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

    const groups = await loadNotifiableMembersByHousehold(db);
    logger.info(`Found ${groups.length} household(s) with notification-eligible members`);

    for (const group of groups) {
      logger.info(`Household ${group.householdId}: ${group.memberDocs.length} member(s)`);

      for (const memberDoc of group.memberDocs) {
        const member = memberDoc.data() as HouseholdMember;
        const prefs = member.notificationPreferences;

        if (prefs?.digestMode?.enabled) {
          logger.info(`Member ${member.uid}: digest mode active, skipping per-type action queue reminder`);
          continue;
        }

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
          const todosSnapshot = await group.householdRef
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
          // Held-for-review captures (captureReview) must not trigger a
          // reminder until approved — they haven't landed on the real to-do
          // list yet. See types/schema.ts's `ToDo.needsReview`.
          //
          // "Saved for later" parked to-dos are excluded for a sharper reason:
          // their `completeByDate` is an INERT PLACEHOLDER stamped with the day
          // they were parked, so it MATCHES `todayString` on that very day.
          // Without this guard, parking a thought in the morning would push the
          // user a reminder about it the next morning it lines up — a task they
          // deliberately did not commit to. See `ToDo.savedForLater`.
          const todayTodos = todosSnapshot.docs.filter(
            (doc) =>
              doc.data().completeByDate === todayString &&
              doc.data().needsReview !== true &&
              doc.data().savedForLater !== true
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
              memberDoc.ref,
              { householdId: group.householdId, recipientUid: member.uid, type: "action_queue_reminder" }
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
 * F-TODO-14: Scheduled function running every 15 minutes to deliver per-task
 * timed reminders (dueTime − reminderMinutesBefore, in the assignee's
 * timezone). Unlike the four hourly summary jobs this deliberately IGNORES
 * digestMode — a time-specific reminder is an alarm, not a briefing — and the
 * todoReminders pref is fail-open (absent = enabled), matching weeklyRecap.
 * Exactly-once delivery is enforced by stamping `reminderSentAt` on the todo;
 * client edits to the date/time/offset re-arm it by writing null.
 */
export const sendtodoreminders = onSchedule("every 15 minutes", async () => {
  logger.info("Checking for timed to-do reminders to send");

  const groups = await loadNotifiableMembersByHousehold(db);
  const nowMs = Date.now();

  // Gate on member eligibility BEFORE querying todos so households with no
  // reachable assignee cost zero extra reads on this 96×/day schedule.
  const eligibleGroups = groups.flatMap((group) => {
    const eligibleMembers = new Map<string, { member: HouseholdMember; ref: admin.firestore.DocumentReference }>();
    for (const memberDoc of group.memberDocs) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;
      if (prefs?.todoReminders?.enabled === false) continue;
      if (!member.fcmTokens || member.fcmTokens.length === 0) continue;
      eligibleMembers.set(member.uid, { member, ref: memberDoc.ref });
    }
    return eligibleMembers.size > 0 ? [{ group, eligibleMembers }] : [];
  });

  // Candidate todos: active with a reminder configured. Date/time filtering
  // happens in memory (per-assignee timezone math can't be expressed in the
  // query). Composite index: todos(isCompleted ASC, reminderMinutesBefore ASC).
  // Reads fan out in parallel across households; the stamp+send pass below
  // stays sequential so `reminderSentAt` can never race into a double-send.
  const todoSnapshots = await Promise.all(
    eligibleGroups.map(({ group }) =>
      group.householdRef
        .collection("todos")
        .where("isCompleted", "==", false)
        .where("reminderMinutesBefore", ">=", 0)
        .get()
    )
  );

  for (let i = 0; i < eligibleGroups.length; i++) {
    const entry = eligibleGroups[i];
    const todosSnapshot = todoSnapshots[i];
    if (!entry || !todosSnapshot) continue; // same-length arrays; guard for noUncheckedIndexedAccess
    const { group, eligibleMembers } = entry;

    for (const todoDoc of todosSnapshot.docs) {
      const todo = todoDoc.data();
      const assignee = typeof todo.assignedTo === "string" ? eligibleMembers.get(todo.assignedTo) : undefined;
      if (!assignee) continue;

      const timezone = assignee.member.notificationPreferences?.timezone || "UTC";
      if (!shouldSendTodoReminder(todo, nowMs, timezone)) continue;

      // Claim BEFORE sending, via a transaction, so neither a crash between
      // send and stamp NOR an overlapping invocation (a slow run still going
      // when the next 15-minute trigger fires) can double-send: the
      // transaction re-reads the live doc and only one claimant can flip
      // reminderSentAt from null. A send failure after the claim just drops
      // one reminder, which is the safer failure mode.
      const claimResult = await db.runTransaction(async (tx) => {
        const liveSnap = await tx.get(todoDoc.ref);
        const live = liveSnap.data();
        if (!liveSnap.exists || live === undefined || live.reminderSentAt != null || live.isCompleted === true) {
          return null;
        }
        // Re-validate on the LIVE doc — a concurrent edit may have moved
        // dueTime/reminderMinutesBefore and re-armed the todo, in which case
        // the stale snapshot's window must not claim (and later notify with)
        // the old time.
        if (!shouldSendTodoReminder(live, nowMs, timezone)) {
          return null;
        }
        tx.update(todoDoc.ref, { reminderSentAt: new Date(nowMs).toISOString() });
        return live;
      });
      if (!claimResult) continue;

      logger.info(`Household ${group.householdId}: sending todo reminder for ${todoDoc.id} to ${assignee.member.uid}`);
      await sendNotificationToUser(
        assignee.member.fcmTokens ?? [],
        "To-Do Reminder",
        buildTodoReminderBody(claimResult, timezone, nowMs),
        {
          type: "todo_reminder",
          url: "/lists",
        },
        assignee.ref,
        { householdId: group.householdId, recipientUid: assignee.member.uid, type: "todo_reminder" }
      );
    }
  }
});

/**
 * Scheduled function: Runs every hour to check for streak warnings
 */
export const sendstreakwarnings = onSchedule("every 1 hours", async () => {
  logger.info("Checking for streak warnings to send");

  const groups = await loadNotifiableMembersByHousehold(db);
  logger.info(`Found ${groups.length} household(s) with notification-eligible members`);

  for (const group of groups) {
    logger.info(`Household ${group.householdId}: ${group.memberDocs.length} member(s)`);

    for (const memberDoc of group.memberDocs) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;

      if (prefs?.digestMode?.enabled) {
        logger.info(`Member ${member.uid}: digest mode active, skipping per-type streak warning`);
        continue;
      }

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
        const habitsSnapshot = await group.householdRef
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
            "Don't break your streak!",
            `You have ${habitsAtRisk.length} habit${
              habitsAtRisk.length > 1 ? "s" : ""
            } with active streaks that need attention today.`,
            {
              type: "streak_warning",
              url: "/habits",
            },
            memberDoc.ref,
            { householdId: group.householdId, recipientUid: member.uid, type: "streak_warning" }
          );

          // Proactive insight (plan 02 part C): "streak rescue". Piggybacks on
          // this same job — no new cron. For any habit with a long (>=7 day)
          // streak at risk, surface a suggestion in the Insight feed (the same
          // `households/{id}/insights` collection the manual "refresh insight"
          // button writes to, so the existing dashboard UI renders it for
          // free). Subject to the shared 2/week/household proactive-insight cap.
          const longStreakAtRisk = habitsAtRisk.find(
            (doc) => (doc.data().streakDays ?? 0) >= 7
          );
          if (longStreakAtRisk) {
            // Fully best-effort: any failure here must never block the streak
            // warning above or the remaining members/households. The
            // deterministic doc id also makes the write idempotent across the
            // member loop (each member finds the same at-risk habit) and
            // across hourly re-runs on the same local day, so one rescue never
            // burns more than one slot of the weekly cap.
            try {
              const habit = longStreakAtRisk.data();
              const streakDays = habit.streakDays ?? 0;

              // The cap state must come from a successful read — defaulting to
              // an empty doc would treat the count as 0 and clobber the real
              // cap state with a reset patch.
              const data = await group.getHouseholdData();
              if (!data) {
                logger.warn(
                  `sendstreakwarnings: household ${group.householdId} doc missing/empty, skipping proactive insight`
                );
              } else {
                const household = data as ProactiveCapHouseholdDoc;
                const freezeBank = data.freezeBank;
                const tokens = freezeBank?.tokens ?? freezeBank?.current;
                const hasFreezeToken = typeof tokens === "number" && tokens > 0;

                // Plan 25: freezes are auto-applied — the copy reassures rather
                // than instructing a manual patch.
                const suggestion = hasFreezeToken
                  ? " If you can't get to it today, a freeze will protect it automatically."
                  : "";
                const insightText = `"${habit.title ?? "A habit"}" has a ${streakDays}-day streak that's about to break today.${suggestion}`;

                await writeProactiveInsight(
                  db,
                  group.householdId,
                  household,
                  {
                    text: insightText,
                    generatedAt: new Date().toISOString(),
                    type: "habits",
                  },
                  new Date(),
                  prefs.timezone || "UTC",
                  `streak_rescue_${longStreakAtRisk.id}_${today}`
                );
              }
            } catch (error) {
              logger.warn(
                `sendstreakwarnings: proactive insight failed for household ${group.householdId}, continuing`,
                error
              );
            }
          }
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

    const groups = await loadNotifiableMembersByHousehold(db);
    logger.info(`Found ${groups.length} household(s) with notification-eligible members`);

    for (const group of groups) {
      logger.info(`Household ${group.householdId}: ${group.memberDocs.length} member(s)`);

      // Currency for user-facing money strings is sourced from the household doc
      // (the top-level `currency` field added by the client). Falls back to USD.
      // Loaded lazily and only once per household, on first member that
      // actually needs a bill reminder sent.
      let currency: string | undefined;

      for (const memberDoc of group.memberDocs) {
        const member = memberDoc.data() as HouseholdMember;
        const prefs = member.notificationPreferences;

        if (prefs?.digestMode?.enabled) {
          logger.info(`Member ${member.uid}: digest mode active, skipping per-type bill reminder`);
          continue;
        }

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
          if (currency === undefined) {
            const householdData = await group.getHouseholdData();
            currency = householdData?.currency || "USD";
          }

          // Get calendar items (bills). Deliberately NOT filtered on isPaid:
          // paid instance docs (isPaid: true, parentRecurringId set) are needed
          // by findBillsDueOnDate to suppress already-paid occurrences of
          // recurring templates.
          const calendarSnapshot = await group.householdRef
            .collection("calendarItems")
            .where("type", "==", "expense")
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

          // F-NOTIF-05: honor a "Snooze 1 day" push action. The client wrote
          // billReminders.snoozedUntil (yyyy-MM-dd local); suppress the reminder
          // while today is on or before that date.
          if (isBillReminderSnoozed(prefs.billReminders.snoozedUntil, localToday)) {
            logger.info(`Member ${member.uid}: bill reminders snoozed until ${prefs.billReminders.snoozedUntil}, skipping`);
            continue;
          }

          const [ly, lm, ld] = localToday.split("-").map(Number);
          const targetDateObj = new Date(
            Date.UTC(ly ?? 2000, (lm ?? 1) - 1, (ld ?? 1) + daysAhead)
          );
          const targetDateStr = formatInTimeZone(
            targetDateObj,
            "UTC",
            "yyyy-MM-dd"
          );

          // Recurring templates keep their original anchor `date` forever, so
          // a raw string comparison would only ever match the first occurrence.
          // Expand recurrence to the target date instead.
          const calendarItems: BillCalendarItem[] = calendarSnapshot.docs.map(
            (doc) => ({
              ...(doc.data() as Omit<BillCalendarItem, "id">),
              id: doc.id,
            })
          );
          const upcomingBills = findBillsDueOnDate(calendarItems, targetDateStr);

          if (upcomingBills.length > 0) {
            const totalAmount = upcomingBills.reduce(
              (sum, bill) => sum + (bill.amount || 0),
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
                // F-NOTIF-05: inline action buttons ("Pay bill"/"Snooze 1 day").
                // JSON string (FCM data values must be strings); the SW renders
                // them and deep-links back with ?nact=<action>. Undefined key is
                // dropped by the spread so non-action types are unaffected.
                ...(buildActionsDataField("bill_reminder")
                  ? { actions: buildActionsDataField("bill_reminder") as string }
                  : {}),
              },
              memberDoc.ref,
              { householdId: group.householdId, recipientUid: member.uid, type: "bill_reminder" }
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
 * Scheduled function (F-NOTIF-03): runs every hour to send the consolidated
 * digest push to members with `digestMode.enabled`. The four per-type hourly
 * jobs above skip their own send for such a member (see the `digestMode?.enabled`
 * early-continue in each), so this is the only push they receive.
 *
 * The digest only reports on categories the member has individually enabled
 * (habitReminders/actionQueueReminders/streakWarnings/billReminders) — turning
 * on digest mode changes *delivery* (one push instead of several) without
 * silently opting a member into categories they never turned on.
 *
 * Habit/todo/calendar collections are fetched once per household (not once per
 * digest-eligible member) since the underlying docs are shared; only the
 * per-member "today" (member's own timezone) and per-member filtering
 * (todos' assignedTo, which sub-preferences are enabled) vary per member.
 */
export const senddigest = onSchedule("every 1 hours", async () => {
  logger.info("Checking for digest pushes to send");

  const groups = await loadNotifiableMembersByHousehold(db);
  logger.info(`Found ${groups.length} household(s) with notification-eligible members`);

  for (const group of groups) {
    const digestMembers = group.memberDocs.filter((memberDoc) => {
      const member = memberDoc.data() as HouseholdMember;
      return member.notificationPreferences?.digestMode?.enabled === true;
    });

    if (digestMembers.length === 0) continue;

    logger.info(`Household ${group.householdId}: ${digestMembers.length} digest-mode member(s)`);

    // Lazily loaded, once per household, and reused across every digest
    // member in it.
    let habitsPromise: Promise<DigestHabit[]> | undefined;
    let todosPromise: Promise<DigestTodo[]> | undefined;
    let calendarItemsPromise: Promise<BillCalendarItem[]> | undefined;
    let currencyPromise: Promise<string> | undefined;

    const getHabits = () => {
      habitsPromise ??= group.householdRef
        .collection("habits")
        .get()
        .then((snap) => snap.docs.map((d) => d.data() as DigestHabit));
      return habitsPromise;
    };
    const getTodos = () => {
      todosPromise ??= group.householdRef
        .collection("todos")
        .where("isCompleted", "==", false)
        .get()
        .then((snap) => snap.docs.map((d) => d.data() as DigestTodo));
      return todosPromise;
    };
    const getCalendarItems = () => {
      calendarItemsPromise ??= group.householdRef
        .collection("calendarItems")
        .where("type", "==", "expense")
        .get()
        .then((snap) =>
          snap.docs.map((d) => ({
            ...(d.data() as Omit<BillCalendarItem, "id">),
            id: d.id,
          }))
        );
      return calendarItemsPromise;
    };
    const getCurrency = () => {
      currencyPromise ??= group.getHouseholdData().then((data) => data?.currency || "USD");
      return currencyPromise;
    };

    for (const memberDoc of digestMembers) {
      const member = memberDoc.data() as HouseholdMember;
      const prefs = member.notificationPreferences;
      const digestPrefs = prefs?.digestMode;

      if (!digestPrefs || !member.fcmTokens || member.fcmTokens.length === 0) {
        logger.info(`Member ${member.uid}: no FCM tokens found, skipping digest`);
        continue;
      }

      if (!isTimeToSend(digestPrefs.time, prefs?.timezone)) {
        logger.info(`Member ${member.uid}: not time to send digest yet`);
        continue;
      }

      const today = formatInTimeZone(new Date(), prefs?.timezone || "UTC", "yyyy-MM-dd");

      const enabled = {
        habits: prefs?.habitReminders?.enabled === true,
        todos: prefs?.actionQueueReminders?.enabled === true,
        streaks: prefs?.streakWarnings?.enabled === true,
        bills: prefs?.billReminders?.enabled === true,
      };

      const habits = enabled.habits || enabled.streaks ? await getHabits() : [];
      const todos = enabled.todos ? await getTodos() : [];

      let billsDueCount = 0;
      let billsDueTotalFormatted = "$0.00";
      if (enabled.bills && prefs?.billReminders) {
        const daysAhead = prefs.billReminders.daysBeforeDue;
        const [ly, lm, ld] = today.split("-").map(Number);
        const targetDateObj = new Date(
          Date.UTC(ly ?? 2000, (lm ?? 1) - 1, (ld ?? 1) + daysAhead)
        );
        const targetDateStr = formatInTimeZone(targetDateObj, "UTC", "yyyy-MM-dd");

        const calendarItems = await getCalendarItems();
        const upcomingBills = findBillsDueOnDate(calendarItems, targetDateStr);
        billsDueCount = upcomingBills.length;
        if (billsDueCount > 0) {
          const totalAmount = upcomingBills.reduce((sum, bill) => sum + (bill.amount || 0), 0);
          const currency = await getCurrency();
          billsDueTotalFormatted = formatCurrency(totalAmount, { currency });
        }
      }

      const counts = {
        habitsPending: enabled.habits ? computeHabitsPending(habits, today) : 0,
        todosToday: enabled.todos ? computeTodosToday(todos, member.uid, today) : 0,
        streaksAtRisk: enabled.streaks ? computeStreaksAtRisk(habits, today) : 0,
        billsDueCount,
        billsDueTotalFormatted,
      };

      const message = buildDigestMessage(counts, enabled);
      if (!message) {
        logger.info(`Member ${member.uid}: nothing to report, skipping digest`);
        continue;
      }

      logger.info(`Member ${member.uid}: sending digest — ${message.body}`);
      await sendNotificationToUser(
        member.fcmTokens,
        message.title,
        message.body,
        {
          type: "digest",
          url: "/",
        },
        memberDoc.ref
      );
    }
  }
});

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

    // Fetch members, accounts, and the household doc in parallel — none of
    // these reads depends on another's result, so there's no reason to pay
    // for three sequential round trips on every single account write.
    const [membersSnapshot, accountsSnapshot, householdSnap] = await Promise.all([
      householdRef.collection("members").get(),
      // Recompute total checking balance across all accounts in the
      // subcollection so the alert threshold reflects the real current state.
      householdRef.collection("accounts").get(),
      // Currency for the alert string is sourced from the household doc (the
      // top-level `currency` field added by the client). Falls back to USD.
      householdRef.get(),
    ]);

    const checkingBalance = accountsSnapshot.docs
      .map((accDoc) => accDoc.data())
      .filter((acc) => acc.type === "checking")
      .reduce(
        (sum, acc) => sum + (typeof acc.balance === "number" ? acc.balance : 0),
        0
      );

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
          "Low Balance Alert!",
          `Your safe-to-spend is down to ${formatCurrency(checkingBalance, {
            currency,
          })}. Time to watch your spending.`,
          {
            type: "budget_alert",
            url: "/budget",
          },
          memberDoc.ref,
          { householdId, recipientUid: member.uid, type: "budget_alert" }
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
      "Test Notification",
      "Great! Your device is set up to receive notifications.",
      {
        type: "test_notification",
        url: "/settings",
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
 * Only a household admin may invoke this. Revokes any linked bank connections
 * at Plaid, then recursively deletes the household document and every
 * subcollection (members, habits, transactions, etc.), then removes any invite
 * codes that point at the household. Uses a longer timeout because large
 * households can have many subcollection documents to delete.
 */
export const deletehousehold = onCall(
  {
    cors: true,
    timeoutSeconds: 300,
    // Needed only when the household has linked banks — revokeAllPlaidItems
    // returns early without constructing a client when `plaidItems` is empty.
    secrets: PLAID_SECRETS,
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

    // Revoke bank connections BEFORE the recursive delete. The plaidItems docs
    // hold the only access tokens that can invalidate an Item at Plaid, and
    // recursiveDelete would destroy them — leaving the bank connection live at
    // Plaid with nothing left that could ever revoke it.
    //
    // Best-effort: a Plaid outage must never block a deletion request. If this
    // throws we log loudly (an orphaned Item needs manual cleanup in the Plaid
    // dashboard) and still delete the household — a user asking to be deleted
    // gets deleted.
    try {
      const revoked = await revokeAllPlaidItems(householdId);
      if (revoked > 0) {
        logger.info("Revoked Plaid connections before household delete", {
          householdId,
          revoked,
        });
      }
    } catch (err) {
      logger.error(
        `Failed to revoke Plaid connections for household ${householdId} — ` +
          "continuing with delete; the Plaid Item(s) may need manual removal.",
        err
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

