import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { formatInTimeZone } from "date-fns-tz";
import { isTimeToSend, sendNotificationToUser, loadNotifiableMembersByHousehold, type HouseholdMember, type NotifiableHouseholdGroup } from "../shared/notifications";
import { isoWeekIdForDate } from "../shared/isoWeek";
import { assembleWeeklyRecap, type RecapCalendarItem, type RecapHabit, type RecapMember, type RecapTransaction } from "./dataAssembly";
import { buildTemplateNarrative, generateNarrative, resolveCeremonyTone, type CeremonyTone } from "./narrative";
import { buildRecapHeadline } from "./headline";
import { WeeklyRecap } from "./types";

/** The Gemini API key, shared with the geminiproxy function's secret binding. */
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/**
 * 🛡️ WHEN THE RECAP FIRES — Monday morning, member-local (per-member points,
 * stage 5). It used to be Sunday 17:00, i.e. with seven hours of the week still
 * unplayed; the ceremony crowns a winner, so the week has to be CLOSED first.
 *
 * The consequence every "which week?" computation in this file now has to
 * respect: the recap describes the week that ENDED YESTERDAY, not the week the
 * generating instant falls in. `closedWeekFor` is the single place that
 * conversion happens — do not reach for `isoWeekId(now, tz)` here again, which
 * would label the recap with the brand-new week and make the household-level
 * `lastRecapWeek` dedupe guard the wrong week too.
 */
const RECAP_WEEKDAY = "Monday";
const RECAP_HOUR = "07:00";

/**
 * Loosely-typed view of the household doc fields this module reads/writes.
 * functions/ keeps its own local type views of Firestore docs rather than
 * importing the client's `types/schema.ts` (separate pnpm package).
 */
interface RecapHouseholdDoc {
  currency?: string;
  subscription?: {
    status?: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  };
  /** ISO week (e.g. "2026-W27") the recap was last generated for — the
   *  household-level generation dedupe. */
  lastRecapWeek?: string;
  /** Admin setting (stage 6) selecting how the ceremony frames the week. */
  ceremonyTone?: CeremonyTone;
}

/** The closed week a Monday-morning run describes, in one member's timezone. */
interface ClosedWeek {
  /** ISO week id of the week that just ended (also the recap doc id). */
  isoWeek: string;
  /** yyyy-MM-dd — the Monday that opened the closed week. */
  weekStart: string;
  /** yyyy-MM-dd — the Sunday that closed it (yesterday, member-local). */
  weekEnd: string;
}

/**
 * The week that just closed, evaluated in `timezone`: the 7 local days ending
 * on YESTERDAY (the Sunday), named after that Sunday's own ISO week.
 */
function closedWeekFor(now: Date, timezone: string): ClosedWeek {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const weekEnd = shiftDate(today, -1);
  return { isoWeek: isoWeekIdForDate(weekEnd), weekStart: shiftDate(weekEnd, -6), weekEnd };
}

/** Is it the recap's generation moment (Monday morning) in this timezone? */
function isRecapMoment(now: Date, timezone: string): boolean {
  return formatInTimeZone(now, timezone, "EEEE") === RECAP_WEEKDAY && isTimeToSend(RECAP_HOUR, timezone);
}

/** Loosely-typed member doc view, extending the shared HouseholdMember with the
 *  per-member push dedupe marker. */
interface RecapMemberDoc extends HouseholdMember {
  /** ISO week (e.g. "2026-W27") this member was last sent a recap push for —
   *  the per-member delivery dedupe (independent of household generation). */
  lastRecapSentWeek?: string;
  /** A login-less managed kid profile (`HouseholdMember.isManaged`). */
  isManaged?: boolean;
  // NOTE: `points` is deliberately absent. A Monday-morning run reads it AFTER
  // the client's weekly rollover, so it describes the new week, not the one
  // being recapped — every per-member figure is derived instead (memberFacts.ts).
}

/** Adds/subtracts whole days from a yyyy-MM-dd local date string. */
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Reads `app_config/global`'s `billingEnabled` flag directly (default false). */
async function readBillingEnabled(db: admin.firestore.Firestore): Promise<boolean> {
  try {
    const snap = await db.doc("app_config/global").get();
    return snap.exists ? snap.data()?.billingEnabled === true : false;
  } catch (error) {
    logger.error("sendweeklyrecap: failed to read app_config/global, defaulting billingEnabled=false", error);
    return false;
  }
}

function isPremiumHousehold(household: RecapHouseholdDoc, billingEnabled: boolean): boolean {
  if (!billingEnabled) return true;
  const status = household.subscription?.status;
  return status === "active" || status === "trialing" || status === "past_due";
}

/**
 * Weekly recap engine (Plan 02, ceremony stage 5). Runs hourly (so each
 * household's members, potentially spread across timezones, each get evaluated
 * close to their own local MONDAY 07:00 — the week must be closed before the
 * ceremony crowns anyone) and:
 *  - Generates (at most once per ISO week, per household) a `WeeklyRecap` doc
 *    at `households/{id}/recaps/{isoWeek}` from purely computed numbers, with
 *    a best-effort Gemini narrative for premium households (falling back to a
 *    deterministic template on any AI failure) and always a template
 *    narrative for free households (no push).
 *  - Sends a push notification to each premium member individually once THAT
 *    member's own local Monday 07:00 arrives, independently deduped per
 *    member so members in later timezones still get their push even after
 *    the household-level recap doc was already generated by an earlier
 *    member's trigger.
 */
export const sendweeklyrecap = onSchedule(
  { schedule: "every 1 hours", secrets: [geminiApiKey], timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore();
    logger.info("sendweeklyrecap: checking households for weekly recap generation/delivery");

    const billingEnabled = await readBillingEnabled(db);

    // Plan 06 PR-2: only households with at least one notification-eligible
    // member are considered. NOTE (documented tradeoff): a household whose
    // members ALL have notifications off (anyNotificationsEnabled: false for
    // everyone) will no longer have a recap doc GENERATED at all, since
    // generation now piggybacks on this same flagged member list rather than
    // a full household scan. This is acceptable because the recap card is
    // only ever surfaced to a member who opens the app — and a member with
    // every notification category off is, by definition, not one who has
    // weeklyRecap push enabled either (weeklyRecap defaults to enabled, so
    // anyNotificationsEnabled is false for a member only when they've
    // explicitly turned it off along with everything else).
    const groups = await loadNotifiableMembersByHousehold(db);
    logger.info(`sendweeklyrecap: found ${groups.length} household(s) with notification-eligible members`);

    for (const group of groups) {
      try {
        await processHousehold(db, group, billingEnabled);
      } catch (error) {
        // One household's failure must never throw out of the whole run.
        logger.error(`sendweeklyrecap: failed processing household ${group.householdId}`, error);
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
  const household = ((await group.getHouseholdData()) ?? {}) as RecapHouseholdDoc;

  const memberDocs = group.memberDocs;

  // Does ANY member's local clock currently read Monday 07:00? That member's
  // timezone also defines which closed week we generate the recap for.
  const now = new Date();
  let triggeringTimezone: string | undefined;
  for (const memberDoc of memberDocs) {
    const member = memberDoc.data() as RecapMemberDoc;
    const tz = member.notificationPreferences?.timezone || "UTC";
    if (isRecapMoment(now, tz)) {
      triggeringTimezone = tz;
      break;
    }
  }

  if (!triggeringTimezone) {
    return;
  }

  const week = closedWeekFor(now, triggeringTimezone);
  const isoWeek = week.isoWeek;
  const premium = isPremiumHousehold(household, billingEnabled);

  // ---- Household-level generation dedupe -------------------------------
  if (household.lastRecapWeek !== isoWeek) {
    await generateRecap(db, householdId, week, premium, resolveCeremonyTone(household.ceremonyTone));
  } else {
    logger.info(`sendweeklyrecap: household ${householdId} already has a recap for ${isoWeek}, skipping generation`);
  }

  // ---- Per-member push delivery dedupe ---------------------------------
  if (!premium) {
    // Free households get the recap card (already written above) but no push.
    return;
  }

  // F-NOTIF-09: the push body includes a real headline stat pulled from the
  // just-(or previously-)generated recap doc rather than a static message.
  // Cache the headline per isoWeek since most runs only ever touch one week
  // across all members (per-member timezones only diverge across the ISO
  // week boundary in rare edge cases).
  const headlineByWeek = new Map<string, string>();
  const getHeadline = async (week: string): Promise<string> => {
    const cached = headlineByWeek.get(week);
    if (cached) return cached;
    const headline = await computeRecapHeadline(db, householdId, week, household.currency);
    headlineByWeek.set(week, headline);
    return headline;
  };

  for (const memberDoc of memberDocs) {
    const member = memberDoc.data() as RecapMemberDoc;
    const tz = member.notificationPreferences?.timezone || "UTC";

    if (!isRecapMoment(now, tz)) continue;

    // The member's OWN closed week — a member in a later timezone can still be
    // describing the same Sunday, so this is deduped and deep-linked per member.
    const memberIsoWeek = closedWeekFor(now, tz).isoWeek;
    if (member.lastRecapSentWeek === memberIsoWeek) continue;
    if (member.notificationPreferences?.weeklyRecap?.enabled === false) continue;
    if (!member.fcmTokens || member.fcmTokens.length === 0) continue;

    const headline = await getHeadline(memberIsoWeek);

    await sendNotificationToUser(
      member.fcmTokens,
      "Your weekly recap is ready",
      headline,
      { type: "weekly_recap", url: `/?recap=${memberIsoWeek}` },
      memberDoc.ref,
      { householdId, recipientUid: member.uid ?? memberDoc.id, type: "weekly_recap" }
    );

    await memberDoc.ref.update({ lastRecapSentWeek: memberIsoWeek });
  }
}

/**
 * Reads the generated `WeeklyRecap` doc for `isoWeek` and computes its push
 * headline via `buildRecapHeadline`. Degrades gracefully to the old generic
 * copy if the doc is missing (e.g. a member's own ISO week diverged from the
 * triggering timezone's week and that week's recap hasn't been generated) or
 * the read fails for any reason — a missing headline must never block the
 * push itself.
 */
async function computeRecapHeadline(
  db: admin.firestore.Firestore,
  householdId: string,
  isoWeek: string,
  currency?: string
): Promise<string> {
  const fallback = "See how your spending, habits, and points stacked up this week.";
  try {
    const snap = await db.doc(`households/${householdId}/recaps/${isoWeek}`).get();
    if (!snap.exists) return fallback;
    const recap = snap.data() as WeeklyRecap;
    return buildRecapHeadline(recap, currency);
  } catch (error) {
    logger.error(`sendweeklyrecap: failed to compute push headline for household ${householdId} week ${isoWeek}`, error);
    return fallback;
  }
}

async function generateRecap(
  db: admin.firestore.Firestore,
  householdId: string,
  week: ClosedWeek,
  premium: boolean,
  ceremonyTone: CeremonyTone
): Promise<void> {
  const now = new Date();

  // Recap week: the 7 local days of the week that CLOSED yesterday (Mon–Sun),
  // resolved once by `closedWeekFor` — never re-derived from `now` here.
  const { isoWeek, weekStart, weekEnd } = week;

  const transactionsStart = shiftDate(weekStart, -7);
  const [transactionsSnap, habitsSnap, calendarSnap] = await Promise.all([
    db
      .collection(`households/${householdId}/transactions`)
      .where("date", ">=", transactionsStart)
      .where("date", "<=", weekEnd)
      .get(),
    db.collection(`households/${householdId}/habits`).get(),
    db
      .collection(`households/${householdId}/calendarItems`)
      .where("date", ">", weekEnd)
      .where("date", "<=", shiftDate(weekEnd, 7))
      .get(),
  ]);

  const transactions: RecapTransaction[] = transactionsSnap.docs.map((d) => {
    const data = d.data();
    return {
      amount: data.amount,
      category: data.category,
      date: data.date,
      status: data.status,
    };
  });

  // The scoring half of this mapping (period → frozenDatesBy) exists only for
  // the ceremony's per-member facts; every field is optional on
  // `RecapScoringHabit`, so a partially-written habit doc still assembles.
  const habits: RecapHabit[] = habitsSnap.docs.map((d) => {
    const data = d.data();
    return {
      title: data.title,
      completedDates: data.completedDates ?? [],
      streakDays: data.streakDays ?? 0,
      period: data.period === "weekly" ? "weekly" : "daily",
      type: data.type === "negative" ? "negative" : "positive",
      basePoints: typeof data.basePoints === "number" ? data.basePoints : 0,
      scoringType: data.scoringType === "incremental" ? "incremental" : "threshold",
      targetCount: typeof data.targetCount === "number" ? data.targetCount : 1,
      assignedTo: data.assignedTo,
      completedBy: data.completedBy,
      frozenDates: data.frozenDates,
      frozenDatesBy: data.frozenDatesBy,
      pausedUntil: data.pausedUntil,
    };
  });

  const calendarItems: RecapCalendarItem[] = calendarSnap.docs.map((d) => {
    const data = d.data();
    return {
      title: data.title,
      amount: data.amount,
      date: data.date,
      type: data.type,
    };
  });

  // The recap's per-member stats must cover ALL household members — the
  // collection-group list processHousehold works from is filtered to
  // notification-enabled members only, and a member with notifications off
  // must still appear in pointsByMember. One extra read per generating
  // household per week.
  const membersSnap = await db.collection(`households/${householdId}/members`).get();
  const members: RecapMember[] = membersSnap.docs.map((d) => {
    const data = d.data() as RecapMemberDoc;
    return {
      // Member docs are keyed by uid; fall back to the doc id if the field is absent.
      uid: data.uid ?? d.id,
      displayName: data.displayName,
      isManaged: data.isManaged === true,
    };
  });

  const assembled = assembleWeeklyRecap({
    transactions,
    habits,
    members,
    calendarItems,
    weekStart,
    weekEnd,
  });

  let narrative: string;
  let narrativeSource: "ai" | "template";
  if (premium) {
    const result = await generateNarrative(assembled, geminiApiKey.value(), ceremonyTone);
    narrative = result.text;
    narrativeSource = result.source;
  } else {
    narrative = buildTemplateNarrative(assembled, ceremonyTone);
    narrativeSource = "template";
  }

  const recap: WeeklyRecap = {
    isoWeek,
    generatedAt: now.toISOString(),
    ...assembled,
    narrative,
    narrativeSource,
    premium,
    ceremonyTone,
  };

  const batch = db.batch();
  const recapRef = db.doc(`households/${householdId}/recaps/${isoWeek}`);
  batch.set(recapRef, recap);
  batch.update(db.doc(`households/${householdId}`), { lastRecapWeek: isoWeek });
  await batch.commit();

  logger.info(`sendweeklyrecap: generated recap ${isoWeek} for household ${householdId} (premium=${premium}, narrativeSource=${narrativeSource})`);
}
