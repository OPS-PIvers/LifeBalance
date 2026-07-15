import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { formatInTimeZone } from "date-fns-tz";
import {
  isTimeToSend,
  sendNotificationToUser,
  loadNotifiableMembersByHousehold,
  type HouseholdMember,
  type NotifiableHouseholdGroup,
} from "../shared/notifications";
import { type BillCalendarItem } from "../shared/bills";
import {
  assembleDailyBriefing,
  type BriefingHabit,
  type BriefingTransaction,
  type DailyBriefingSummary,
} from "./dataAssembly";
import { buildTemplateNarrative, generateBriefingText } from "./narrative";

/** The Gemini API key, shared with the geminiproxy function's secret binding. */
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/** Loosely-typed view of the household doc fields this module reads. */
interface BriefingHouseholdDoc {
  subscription?: {
    status?: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  };
}

/** Member doc view with the per-member push dedupe marker. */
interface BriefingMemberDoc extends HouseholdMember {
  /** yyyy-MM-dd (member-local) this member was last sent a daily briefing for. */
  lastDailyBriefingSentDate?: string;
}

/** Reads `app_config/global`'s `billingEnabled` flag directly (default false). */
async function readBillingEnabled(
  db: admin.firestore.Firestore
): Promise<boolean> {
  try {
    const snap = await db.doc("app_config/global").get();
    return snap.exists ? snap.data()?.billingEnabled === true : false;
  } catch (error) {
    logger.error(
      "senddailybriefing: failed to read app_config/global billingEnabled, defaulting false",
      error
    );
    return false;
  }
}

/**
 * Reads `app_config/global`'s `aiEnabled` kill-switch (fail-OPEN: default true
 * on a missing doc/field/error), matching the client's `getAiEnabled()`.
 */
async function readAiEnabled(db: admin.firestore.Firestore): Promise<boolean> {
  try {
    const snap = await db.doc("app_config/global").get();
    if (!snap.exists) return true;
    return snap.data()?.aiEnabled !== false;
  } catch (error) {
    logger.error(
      "senddailybriefing: failed to read app_config/global aiEnabled, defaulting true",
      error
    );
    return true;
  }
}

function isPremiumHousehold(
  household: BriefingHouseholdDoc,
  billingEnabled: boolean
): boolean {
  if (!billingEnabled) return true;
  const status = household.subscription?.status;
  return status === "active" || status === "trialing" || status === "past_due";
}

/**
 * AI Daily Briefing engine (F-DASH-02). Runs hourly so each member (potentially
 * across timezones) is evaluated near their own local briefing time. For each
 * member who has opted IN (`dailyBriefing.enabled === true`, default OFF) and
 * whose local clock currently matches their configured time, assembles the same
 * inputs the dashboard action queue computes (bills due today, pending-review
 * count, today's habit completion, streaks at risk), turns them into a one/two
 * sentence summary — AI-written for premium households when the `aiEnabled`
 * kill-switch is on, deterministic template otherwise — and sends a single push
 * deep-linked into `/`.
 *
 * Deduped per member per member-local day, and skipped entirely on an all-clear
 * day (`summary.hasContent === false`) so a "nothing to do" ping never fires.
 */
export const senddailybriefing = onSchedule(
  { schedule: "every 1 hours", secrets: [geminiApiKey], timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore();
    logger.info("senddailybriefing: checking households for daily briefing delivery");

    const [billingEnabled, aiEnabled] = await Promise.all([
      readBillingEnabled(db),
      readAiEnabled(db),
    ]);

    const groups = await loadNotifiableMembersByHousehold(db);
    logger.info(
      `senddailybriefing: found ${groups.length} household(s) with notification-eligible members`
    );

    await Promise.allSettled(
      groups.map(async (group) => {
        try {
          await processHousehold(group, billingEnabled, aiEnabled);
        } catch (error) {
          logger.error(
            `senddailybriefing: failed processing household ${group.householdId}`,
            error
          );
        }
      })
    );
  }
);

async function processHousehold(
  group: NotifiableHouseholdGroup,
  billingEnabled: boolean,
  aiEnabled: boolean
): Promise<void> {
  const now = new Date();

  // Which members are due a briefing right now (opted in + correct local time +
  // has tokens + not already sent today)? Resolve this before any subcollection
  // reads so households with nobody due cost nothing extra.
  const dueMembers: {
    memberDoc: admin.firestore.QueryDocumentSnapshot;
    member: BriefingMemberDoc;
    today: string;
  }[] = [];

  for (const memberDoc of group.memberDocs) {
    const member = memberDoc.data() as BriefingMemberDoc;
    const prefs = member.notificationPreferences;
    // Default OFF — only an explicit enabled:true opts in.
    if (prefs?.dailyBriefing?.enabled !== true) continue;
    if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

    const tz = prefs.timezone || "UTC";
    const time = prefs.dailyBriefing.time || "08:00";
    if (!isTimeToSend(time, tz)) continue;

    const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
    if (member.lastDailyBriefingSentDate === today) continue;

    dueMembers.push({ memberDoc, member, today });
  }

  if (dueMembers.length === 0) return;

  // Load the household's briefing inputs once, shared across all due members.
  const [household, calendarItems, transactions, habits] = await Promise.all([
    group.getHouseholdData().then((d) => (d ?? {}) as BriefingHouseholdDoc),
    loadCalendarItems(group.householdRef),
    loadTransactions(group.householdRef),
    loadHabits(group.householdRef),
  ]);

  const useAi = aiEnabled && isPremiumHousehold(household, billingEnabled);

  // Memoize the narrative per local day: members sharing a timezone share the
  // same summary, so this bounds AI to at most one call per distinct local day
  // per household per run.
  const narrativeByDay = new Map<string, Promise<string>>();

  for (const { memberDoc, member, today } of dueMembers) {
    const summary = assembleDailyBriefing({
      calendarItems,
      transactions,
      habits,
      today,
    });

    // All-clear day: skip the push AND do not mark it sent. The send-time gate
    // (isTimeToSend matches only the configured hour) already bounds re-fires to
    // that one hour's runs, and leaving the dedupe marker unset means a member
    // who is all-clear at their briefing hour simply gets no ping that day.
    if (!summary.hasContent) {
      logger.info(
        `senddailybriefing: household ${group.householdId} member ${member.uid} all-clear, skipping`
      );
      continue;
    }

    let narrativePromise = narrativeByDay.get(today);
    if (!narrativePromise) {
      narrativePromise = resolveNarrative(summary, useAi);
      narrativeByDay.set(today, narrativePromise);
    }
    const narrative = await narrativePromise;

    await sendNotificationToUser(
      member.fcmTokens ?? [],
      "Your daily briefing",
      narrative,
      { type: "daily_briefing", url: "/" },
      memberDoc.ref
    );

    await memberDoc.ref.update({ lastDailyBriefingSentDate: today });
  }
}

async function resolveNarrative(
  summary: DailyBriefingSummary,
  useAi: boolean
): Promise<string> {
  if (!useAi) return buildTemplateNarrative(summary);
  const result = await generateBriefingText(summary, geminiApiKey.value());
  return result.text;
}

async function loadCalendarItems(
  householdRef: admin.firestore.DocumentReference
): Promise<BillCalendarItem[]> {
  const snap = await householdRef.collection("calendarItems").get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      date: data.date,
      isRecurring: data.isRecurring,
      frequency: data.frequency,
      isPaid: data.isPaid,
      isDeleted: data.isDeleted,
      parentRecurringId: data.parentRecurringId,
      amount: data.amount,
    };
  });
}

async function loadTransactions(
  householdRef: admin.firestore.DocumentReference
): Promise<BriefingTransaction[]> {
  // Only pending-review transactions matter for the briefing count.
  const snap = await householdRef
    .collection("transactions")
    .where("status", "==", "pending_review")
    .get();
  return snap.docs.map((d) => ({ status: d.data().status }));
}

async function loadHabits(
  householdRef: admin.firestore.DocumentReference
): Promise<BriefingHabit[]> {
  const snap = await householdRef
    .collection("habits")
    .where("period", "==", "daily")
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      period: data.period,
      streakDays: data.streakDays,
      completedDates: data.completedDates,
    };
  });
}
