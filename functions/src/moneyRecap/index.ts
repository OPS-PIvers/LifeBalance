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
import { priorMonthId, subtractOneMonth, monthBounds } from "../shared/monthId";
import {
  assembleMonthlyMoneyRecap,
  type RecapBucketSnapshot,
  type RecapTransaction,
} from "./dataAssembly";
import { buildTemplateNarrative, generateNarrative } from "./narrative";
import { MonthlyMoneyRecap } from "./types";

/** The Gemini API key, shared with the geminiproxy function's secret binding. */
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/** Local wall-clock hour the recap is generated/delivered at (member's tz). */
const SEND_TIME = "09:00";

/** Loosely-typed view of the household doc fields this module reads/writes. */
interface MoneyRecapHouseholdDoc {
  subscription?: {
    status?: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  };
  /** Calendar month (e.g. "2026-06") the money recap was last generated for —
   *  the household-level generation dedupe. */
  lastMoneyRecapMonth?: string;
}

/** Loosely-typed member doc view with the per-member push dedupe marker. */
interface MoneyRecapMemberDoc extends HouseholdMember {
  /** Calendar month (e.g. "2026-06") this member was last sent a money recap
   *  push for — the per-member delivery dedupe. */
  lastMoneyRecapSentMonth?: string;
}

/** Reads `app_config/global`'s `billingEnabled` flag directly (default false). */
async function readBillingEnabled(db: admin.firestore.Firestore): Promise<boolean> {
  try {
    const snap = await db.doc("app_config/global").get();
    return snap.exists ? snap.data()?.billingEnabled === true : false;
  } catch (error) {
    logger.error("sendmonthlymoneyrecap: failed to read app_config/global, defaulting billingEnabled=false", error);
    return false;
  }
}

function isPremiumHousehold(household: MoneyRecapHouseholdDoc, billingEnabled: boolean): boolean {
  if (!billingEnabled) return true;
  const status = household.subscription?.status;
  return status === "active" || status === "trialing" || status === "past_due";
}

/**
 * Monthly money recap engine (F-MONEY-06) — the Weekly Recap's money sibling.
 * Runs hourly so each household's members (potentially across timezones) each
 * get evaluated close to their own local 1st-of-month 09:00, and:
 *  - Generates (at most once per calendar month, per household) a
 *    `MonthlyMoneyRecap` doc at `households/{id}/moneyRecaps/{month}` covering
 *    the month that just completed, with a best-effort Gemini narrative for
 *    premium households (template fallback) and always a template narrative for
 *    free households (no push).
 *  - Sends a push to each premium member once THAT member's own local 1st
 *    09:00 arrives, independently deduped per member.
 */
export const sendmonthlymoneyrecap = onSchedule(
  { schedule: "every 1 hours", secrets: [geminiApiKey], timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore();
    logger.info("sendmonthlymoneyrecap: checking households for monthly money recap generation/delivery");

    const billingEnabled = await readBillingEnabled(db);

    // Only households with at least one notification-eligible member are
    // considered (same tradeoff as the weekly recap engine — see recap/index.ts).
    const groups = await loadNotifiableMembersByHousehold(db);
    logger.info(`sendmonthlymoneyrecap: found ${groups.length} household(s) with notification-eligible members`);

    for (const group of groups) {
      try {
        await processHousehold(db, group, billingEnabled);
      } catch (error) {
        logger.error(`sendmonthlymoneyrecap: failed processing household ${group.householdId}`, error);
      }
    }
  }
);

async function processHousehold(
  db: admin.firestore.Firestore,
  group: NotifiableHouseholdGroup,
  billingEnabled: boolean
): Promise<void> {
  const householdId = group.householdId;
  const household = ((await group.getHouseholdData()) ?? {}) as MoneyRecapHouseholdDoc;
  const memberDocs = group.memberDocs;

  // Does ANY member's local clock currently read the 1st of the month at 09:00?
  // That member's timezone defines which month we generate the recap for.
  const now = new Date();
  let triggeringTimezone: string | undefined;
  for (const memberDoc of memberDocs) {
    const member = memberDoc.data() as MoneyRecapMemberDoc;
    const tz = member.notificationPreferences?.timezone || "UTC";
    const isFirstOfMonth = formatInTimeZone(now, tz, "d") === "1";
    if (isFirstOfMonth && isTimeToSend(SEND_TIME, tz)) {
      triggeringTimezone = tz;
      break;
    }
  }

  if (!triggeringTimezone) {
    return;
  }

  const month = priorMonthId(now, triggeringTimezone);
  const premium = isPremiumHousehold(household, billingEnabled);

  // ---- Household-level generation dedupe -------------------------------
  if (household.lastMoneyRecapMonth !== month) {
    await generateRecap(db, householdId, month, geminiApiKey.value(), premium);
  } else {
    logger.info(`sendmonthlymoneyrecap: household ${householdId} already has a recap for ${month}, skipping generation`);
  }

  // ---- Per-member push delivery dedupe ---------------------------------
  if (!premium) {
    return;
  }

  for (const memberDoc of memberDocs) {
    const member = memberDoc.data() as MoneyRecapMemberDoc;
    const tz = member.notificationPreferences?.timezone || "UTC";
    const isFirstOfMonth = formatInTimeZone(now, tz, "d") === "1";
    const memberMonth = priorMonthId(now, tz);

    if (!isFirstOfMonth || !isTimeToSend(SEND_TIME, tz)) continue;
    if (member.lastMoneyRecapSentMonth === memberMonth) continue;
    if (member.notificationPreferences?.monthlyMoneyRecap?.enabled === false) continue;
    if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

    await sendNotificationToUser(
      member.fcmTokens,
      "Your monthly money recap is ready",
      "See how your budget, spending, and income closed out last month.",
      { type: "monthly_money_recap", url: `/?moneyrecap=${memberMonth}` },
      memberDoc.ref
    );

    await memberDoc.ref.update({ lastMoneyRecapSentMonth: memberMonth });
  }
}

async function generateRecap(
  db: admin.firestore.Firestore,
  householdId: string,
  month: string,
  apiKey: string,
  premium: boolean
): Promise<void> {
  const now = new Date();

  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const priorMonth = subtractOneMonth(month);
  const { start: priorMonthStart, end: priorMonthEnd } = monthBounds(priorMonth);

  const [transactionsSnap, bucketHistorySnap] = await Promise.all([
    db
      .collection(`households/${householdId}/transactions`)
      .where("date", ">=", priorMonthStart)
      .where("date", "<=", monthEnd)
      .get(),
    // Snapshots whose period closed during the recap month.
    db
      .collection(`households/${householdId}/bucketHistory`)
      .where("periodEndDate", ">=", monthStart)
      .where("periodEndDate", "<=", monthEnd)
      .get(),
  ]);

  const transactions: RecapTransaction[] = transactionsSnap.docs.map((d) => {
    const data = d.data();
    return {
      amount: data.amount,
      merchant: data.merchant ?? "",
      category: data.category,
      date: data.date,
      status: data.status,
    };
  });

  const bucketSnapshots: RecapBucketSnapshot[] = bucketHistorySnap.docs.map((d) => {
    const data = d.data();
    return {
      bucketId: data.bucketId,
      bucketName: data.bucketName,
      limit: data.limit ?? 0,
      totalSpent: data.totalSpent ?? 0,
      periodEndDate: data.periodEndDate,
    };
  });

  const assembled = assembleMonthlyMoneyRecap({
    transactions,
    bucketSnapshots,
    month,
    monthStart,
    monthEnd,
    priorMonthStart,
    priorMonthEnd,
    // Net Worth History snapshots are not yet populated; F-MONEY-07 family.
    netWorthDelta: null,
  });

  const narrativeInput = { month, ...assembled };
  let narrative: string;
  let narrativeSource: "ai" | "template";
  if (premium) {
    const result = await generateNarrative(narrativeInput, apiKey);
    narrative = result.text;
    narrativeSource = result.source;
  } else {
    narrative = buildTemplateNarrative(narrativeInput);
    narrativeSource = "template";
  }

  const recap: MonthlyMoneyRecap = {
    month,
    generatedAt: now.toISOString(),
    ...assembled,
    narrative,
    narrativeSource,
    premium,
  };

  const batch = db.batch();
  const recapRef = db.doc(`households/${householdId}/moneyRecaps/${month}`);
  batch.set(recapRef, recap);
  batch.update(db.doc(`households/${householdId}`), { lastMoneyRecapMonth: month });
  await batch.commit();

  logger.info(`sendmonthlymoneyrecap: generated recap ${month} for household ${householdId} (premium=${premium}, narrativeSource=${narrativeSource})`);
}
