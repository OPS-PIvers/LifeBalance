/**
 * Wall calendar Cloud Functions (docs/plans/wall-display-kiosk.md §4.5).
 *
 *   addwallcalendarfeed / updatewallcalendarfeed / removewallcalendarfeed  (admin)
 *   syncwallcalendarsnow   (member or active display; once per 2 min per household)
 *   syncwallcalendars      (every 15 min, households with an active wall)
 *   projectwallbills       (calendarItems written → bill lines within seconds)
 *   onwallsettingswritten  (bills / holidays / zone toggled → re-sync)
 *   setwallhomeaddress     (admin; the origin for alert travel times, server-only)
 *
 * Feed links are credentials: they live in calendarFeedSecrets (no client
 * access) and are never returned or logged.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HOUSEHOLD_ID_RE, requireAdmin, requireHouseholdId, requireMemberOrDisplay } from "../auth";
import { FeedFetchError, fetchIcs, normalizeFeedUrl, type IcsFetchResult } from "./icsFetch";
import { IcsParseError, expandIcs } from "./icsParse";
import { hasActiveWall, householdsWithActiveWalls, removeFeedEverywhere, syncHouseholdCalendars } from "./sync";
import { updateHouseholdTravel } from "./travel";
import { HOME_SECRET_ID, TRAVEL_MODES, homeAddress } from "./travelLogic";
import {
  HOLIDAYS_FEED_ID,
  MANUAL_SYNC_COOLDOWN_MS,
  MAX_FEEDS_PER_HOUSEHOLD,
  resolveTimeZone,
  wallWindow,
} from "./syncLogic";

const LABEL_MAX = 40;

function requireLabel(raw: unknown): string {
  const label = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!label || label.length > LABEL_MAX) {
    throw new HttpsError("invalid-argument", "Give the calendar a name (up to 40 characters).");
  }
  return label;
}

async function requireOwnerKey(householdId: string, raw: unknown): Promise<string> {
  if (raw === "family") return "family";
  if (typeof raw === "string" && HOUSEHOLD_ID_RE.test(raw)) {
    const member = await admin.firestore().doc(`households/${householdId}/members/${raw}`).get();
    if (member.exists) return raw;
  }
  throw new HttpsError("invalid-argument", "Pick whose calendar this is.");
}

/** The optional alert fields a feed may carry (absent = leave as is). */
function alertFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (data.alerts !== undefined) {
    if (typeof data.alerts !== "boolean") throw new HttpsError("invalid-argument", "Alerts are on or off.");
    out.alerts = data.alerts;
  }
  if (data.travelMode !== undefined) {
    const mode = TRAVEL_MODES.find((m) => m === data.travelMode);
    if (!mode) throw new HttpsError("invalid-argument", "Pick how you get there.");
    out.travelMode = mode;
  }
  return out;
}

/** Travel times are a nicety: never let them fail a sync or a settings change. */
async function refreshTravel(householdId: string): Promise<void> {
  try {
    await updateHouseholdTravel(admin.firestore(), householdId);
  } catch (error) {
    logger.error("wall travel: update failed", { householdId, error: String(error) });
  }
}

function requireFeedId(raw: unknown): string {
  if (typeof raw !== "string" || !HOUSEHOLD_ID_RE.test(raw) || raw === HOLIDAYS_FEED_ID || raw.startsWith("_")) {
    throw new HttpsError("invalid-argument", "That calendar can't be changed here.");
  }
  return raw;
}

/** Fetches and parses a link before it's saved, so a bad link fails on the phone right away. */
async function testFeed(url: string, householdId: string): Promise<IcsFetchResult> {
  const settings = (await admin.firestore().doc(`households/${householdId}/wallSettings/config`).get()).data() ?? {};
  const timeZone = resolveTimeZone(settings.timeZone);
  const window = wallWindow(new Date(), timeZone);
  try {
    const result = await fetchIcs(url);
    if (result.status === "ok") {
      expandIcs(result.text, {
        feedId: "test",
        ownerKey: "family",
        source: "feed",
        timeZone,
        windowStart: window.start,
        windowEnd: window.end,
      });
    }
    return result;
  } catch (error) {
    if (error instanceof FeedFetchError || error instanceof IcsParseError) {
      throw new HttpsError("failed-precondition", error.message);
    }
    // Anything else is our bug, not the link's: log it (never the URL, it's a
    // credential) and answer with something the admin can act on instead of
    // the callable's bare "internal".
    logger.error("wall calendar: test fetch failed unexpectedly", { householdId, error: String(error) });
    throw new HttpsError(
      "failed-precondition",
      "LifeBalance couldn't read that calendar. Check the link, and if it still fails, tell us which calendar app it's from."
    );
  }
}

export const addwallcalendarfeed = onCall(
  { cors: true, timeoutSeconds: 120 },
  async (request): Promise<{ feedId: string; eventCount: number }> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const householdId = requireHouseholdId(data.householdId);
    const uid = await requireAdmin(request, householdId);
    const label = requireLabel(data.label);
    const ownerKey = await requireOwnerKey(householdId, data.ownerKey);
    const url = normalizeFeedUrl(data.url);
    const alerts = alertFields(data);

    const db = admin.firestore();
    const feeds = await db.collection(`households/${householdId}/calendarFeeds`).get();
    if (feeds.docs.filter((d) => d.id !== HOLIDAYS_FEED_ID).length >= MAX_FEEDS_PER_HOUSEHOLD) {
      throw new HttpsError("resource-exhausted", `A household can have up to ${MAX_FEEDS_PER_HOUSEHOLD} calendars.`);
    }

    const prefetched = await testFeed(url, householdId);
    const feedRef = db.collection(`households/${householdId}/calendarFeeds`).doc();
    const batch = db.batch();
    batch.set(feedRef, {
      label,
      ownerKey,
      kind: "ics",
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      eventCount: 0,
      stale: false,
      ...alerts,
    });
    batch.set(db.doc(`households/${householdId}/calendarFeedSecrets/${feedRef.id}`), { url });
    await batch.commit();

    const summary = await syncHouseholdCalendars(db, householdId, { onlyFeedId: feedRef.id, prefetched });
    if (alerts.alerts === true) await refreshTravel(householdId);
    return { feedId: feedRef.id, eventCount: summary.feeds[0]?.eventCount ?? 0 };
  }
);

export const updatewallcalendarfeed = onCall(
  { cors: true, timeoutSeconds: 120 },
  async (request): Promise<{ ok: true }> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const householdId = requireHouseholdId(data.householdId);
    await requireAdmin(request, householdId);
    const feedId = requireFeedId(data.feedId);
    const db = admin.firestore();
    const feedRef = db.doc(`households/${householdId}/calendarFeeds/${feedId}`);
    const current = await feedRef.get();
    if (!current.exists) throw new HttpsError("not-found", "That calendar doesn't exist.");

    const patch: Record<string, unknown> = { ...alertFields(data) };
    if (data.label !== undefined) patch.label = requireLabel(data.label);
    if (data.ownerKey !== undefined) patch.ownerKey = await requireOwnerKey(householdId, data.ownerKey);
    let prefetched: IcsFetchResult | undefined;
    if (data.url !== undefined && data.url !== "") {
      const url = normalizeFeedUrl(data.url);
      prefetched = await testFeed(url, householdId);
      // A new link starts over: forget the old validators and body hash.
      await db.doc(`households/${householdId}/calendarFeedSecrets/${feedId}`).set({ url }, { merge: false });
      patch.stale = false;
    }
    // Settings sends the whole form, so compare with what's stored: only a new
    // link or owner changes the events (the label isn't on them). Turning
    // alerts on or changing how you get there needs no re-sync.
    const before = current.data() ?? {};
    const eventsChange = prefetched !== undefined || (patch.ownerKey !== undefined && patch.ownerKey !== before.ownerKey);
    if (Object.keys(patch).length > 0) await feedRef.update(patch);
    if (eventsChange) await syncHouseholdCalendars(db, householdId, { onlyFeedId: feedId, prefetched });
    if (patch.alerts !== undefined || patch.travelMode !== undefined) await refreshTravel(householdId);
    return { ok: true };
  }
);

export const removewallcalendarfeed = onCall({ cors: true }, async (request): Promise<{ ok: true }> => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const householdId = requireHouseholdId(data.householdId);
  await requireAdmin(request, householdId);
  const feedId = requireFeedId(data.feedId);
  await removeFeedEverywhere(admin.firestore(), householdId, feedId);
  return { ok: true };
});

export const syncwallcalendarsnow = onCall(
  { cors: true, timeoutSeconds: 300 },
  async (request): Promise<{ ok: true; failed: number }> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const householdId = requireHouseholdId(data.householdId);
    await requireMemberOrDisplay(request, householdId);
    const db = admin.firestore();
    const settingsRef = db.doc(`households/${householdId}/wallSettings/config`);
    const now = Date.now();
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(settingsRef);
      const last = snap.data()?.lastManualSyncAt;
      const lastMs = typeof last === "string" ? Date.parse(last) : NaN;
      if (!Number.isNaN(lastMs) && now - lastMs < MANUAL_SYNC_COOLDOWN_MS) {
        throw new HttpsError("resource-exhausted", "Calendars synced a moment ago. Try again in a couple of minutes.");
      }
      txn.set(settingsRef, { lastManualSyncAt: new Date(now).toISOString() }, { merge: true });
    });
    const summary = await syncHouseholdCalendars(db, householdId, { forceBills: true });
    await refreshTravel(householdId);
    return { ok: true, failed: summary.feeds.filter((f) => !f.ok).length };
  }
);

export const syncwallcalendars = onSchedule(
  { schedule: "every 15 minutes", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const db = admin.firestore();
    const hids = await householdsWithActiveWalls(db);
    const now = new Date();
    for (const hid of hids) {
      try {
        await syncHouseholdCalendars(db, hid, { now });
        await updateHouseholdTravel(db, hid, now);
      } catch (error) {
        logger.error("syncwallcalendars: household failed", { hid, error: String(error) });
      }
    }
    logger.info(`syncwallcalendars: synced ${hids.length} household(s)`);
  }
);

export const projectwallbills = onDocumentWritten("households/{householdId}/calendarItems/{itemId}", async (event) => {
  const hid = event.params.householdId;
  const db = admin.firestore();
  if (!(await hasActiveWall(db, hid))) return;
  await syncHouseholdCalendars(db, hid, { billsOnly: true, forceBills: true });
});

const RESYNC_KEYS = ["showBills", "holidaysEnabled", "timeZone"] as const;

export const onwallsettingswritten = onDocumentWritten("households/{householdId}/wallSettings/{docId}", async (event) => {
  if (event.params.docId !== "config") return;
  const before = event.data?.before.data() ?? {};
  const after = event.data?.after.data() ?? {};
  if (!RESYNC_KEYS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))) return;
  const db = admin.firestore();
  const hid = event.params.householdId;
  if (!(await hasActiveWall(db, hid))) return;
  await syncHouseholdCalendars(db, hid, { forceBills: true });
});

/**
 * The home address alert travel times start from. Like a feed link it's kept
 * server-only; the wall only ever learns "22 min". An empty address removes it.
 */
export const setwallhomeaddress = onCall({ cors: true }, async (request): Promise<{ ok: true; set: boolean }> => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const householdId = requireHouseholdId(data.householdId);
  await requireAdmin(request, householdId);
  const db = admin.firestore();
  const secretRef = db.doc(`households/${householdId}/calendarFeedSecrets/${HOME_SECRET_ID}`);
  const settingsRef = db.doc(`households/${householdId}/wallSettings/config`);
  const raw = typeof data.address === "string" ? data.address.trim() : "";
  if (!raw) {
    await secretRef.delete();
    await settingsRef.set(
      { homeAddressSet: false, travelError: admin.firestore.FieldValue.delete() },
      { merge: true }
    );
    return { ok: true, set: false };
  }
  const address = homeAddress(raw);
  if (!address) throw new HttpsError("invalid-argument", "Enter a street address (up to 200 characters).");
  await secretRef.set({ address });
  await settingsRef.set({ homeAddressSet: true }, { merge: true });
  await refreshTravel(householdId);
  return { ok: true, set: true };
});
