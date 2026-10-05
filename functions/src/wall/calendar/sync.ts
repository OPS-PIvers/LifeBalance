/**
 * Household calendar sync for the wall (docs/plans/wall-display-kiosk.md §4.5).
 *
 * For one household: make sure the US holidays feed matches the setting, sync
 * each calendar feed into `wallEvents`, and (when asked, or when the window
 * has moved) re-project the unpaid bills. Each set of rows keeps its event
 * index on a server-only `calendarFeedSecrets` doc; see syncLogic.ts.
 *
 * A feed URL is a credential. It is read from `calendarFeedSecrets` only and
 * never logged.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createHash } from "crypto";
import { sendNotificationToUser } from "../../shared/notifications";
import { FeedFetchError, fetchIcs, type IcsFetchResult } from "./icsFetch";
import { IcsParseError, expandIcs, type WallEventRow } from "./icsParse";
import {
  BILLS_INDEX_ID,
  HOLIDAYS_FEED_ID,
  US_HOLIDAYS_ICS_URL,
  diffEvents,
  parseEventIndex,
  projectBillRows,
  resolveTimeZone,
  shouldMarkStale,
  syncKey,
  toEventDoc,
  wallWindow,
  type BillItem,
  type EventIndex,
  type WallWindow,
} from "./syncLogic";

type Firestore = admin.firestore.Firestore;
type DocRef = admin.firestore.DocumentReference;

const BATCH_LIMIT = 450;

export interface HouseholdSyncOptions {
  now?: Date;
  /** Sync just this feed (after an admin adds or edits it). */
  onlyFeedId?: string;
  /** Re-project bills even when the window hasn't moved. */
  forceBills?: boolean;
  /** Skip the feeds; bills only. */
  billsOnly?: boolean;
  /** A body the caller already fetched for `onlyFeedId` (the add/edit test fetch). */
  prefetched?: IcsFetchResult;
}

export interface FeedSyncResult {
  feedId: string;
  ok: boolean;
  eventCount?: number;
  error?: string;
}

export interface HouseholdSyncSummary {
  feeds: FeedSyncResult[];
  billCount?: number;
}

interface HouseholdContext {
  db: Firestore;
  hid: string;
  timeZone: string;
  window: WallWindow;
  now: Date;
}

const toMillis = (v: unknown): number | null =>
  v instanceof admin.firestore.Timestamp ? v.toMillis() : typeof v === "number" ? v : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null;

/** Applies a diff to `wallEvents` in batches, events first, so a crash only ever causes a redo. */
async function writeRows(ctx: HouseholdContext, previous: EventIndex, rows: WallEventRow[]): Promise<EventIndex> {
  const { upserts, deletes, index } = diffEvents(previous, rows);
  const events = ctx.db.collection(`households/${ctx.hid}/wallEvents`);
  const ops: ((b: admin.firestore.WriteBatch) => void)[] = [
    ...upserts.map((row) => (b: admin.firestore.WriteBatch) => void b.set(events.doc(row.id), toEventDoc(row))),
    ...deletes.map((id) => (b: admin.firestore.WriteBatch) => void b.delete(events.doc(id))),
  ];
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = ctx.db.batch();
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
  return index;
}

/**
 * The index a row set was last written with. Without one (first sync, or an
 * index lost to a crash), fall back to querying what's actually there, with
 * empty hashes so every current row is rewritten.
 */
async function previousIndex(
  ctx: HouseholdContext,
  stored: unknown,
  field: "feedId" | "source",
  value: string
): Promise<EventIndex> {
  const parsed = parseEventIndex(stored);
  if (parsed) return parsed;
  const snap = await ctx.db.collection(`households/${ctx.hid}/wallEvents`).where(field, "==", value).get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, ""]));
}

/** Deletes every event of one feed plus its feed and secret docs. */
export async function removeFeedEverywhere(db: Firestore, hid: string, feedId: string): Promise<void> {
  const ctx: HouseholdContext = { db, hid, timeZone: "UTC", window: { start: "", end: "" }, now: new Date() };
  const secretRef = db.doc(`households/${hid}/calendarFeedSecrets/${feedId}`);
  const secret = await secretRef.get();
  const previous = await previousIndex(ctx, secret.data()?.eventIndex, "feedId", feedId);
  await writeRows(ctx, previous, []);
  await secretRef.delete();
  await db.doc(`households/${hid}/calendarFeeds/${feedId}`).delete();
}

async function notifyAdminsStale(ctx: HouseholdContext, label: string): Promise<void> {
  const members = await ctx.db.collection(`households/${ctx.hid}/members`).where("role", "==", "admin").get();
  for (const member of members.docs) {
    const tokens = member.data().fcmTokens;
    if (!Array.isArray(tokens) || tokens.length === 0) continue;
    try {
      await sendNotificationToUser(
        tokens.filter((t): t is string => typeof t === "string"),
        "A wall calendar stopped updating",
        `"${label}" hasn't synced for a day. Re-paste its link in Settings → Wall display.`,
        { type: "calendar_feed_stale", url: "/settings?section=wall" },
        member.ref,
        { householdId: ctx.hid, recipientUid: member.id, type: "calendar_feed_stale" }
      );
    } catch (error) {
      logger.warn("wall calendar: stale push failed", { hid: ctx.hid, error: String(error) });
    }
  }
}

function userMessage(error: unknown): string {
  if (error instanceof FeedFetchError || error instanceof IcsParseError) return error.message;
  return "Couldn't sync this calendar. It'll be retried.";
}

async function syncFeed(
  ctx: HouseholdContext,
  feedRef: DocRef,
  feed: Record<string, unknown>,
  prefetched?: IcsFetchResult
): Promise<FeedSyncResult> {
  const feedId = feedRef.id;
  const secretRef = ctx.db.doc(`households/${ctx.hid}/calendarFeedSecrets/${feedId}`);
  const secretSnap = await secretRef.get();
  const secret = secretSnap.data() ?? {};
  const ownerKey = typeof feed.ownerKey === "string" ? feed.ownerKey : "family";
  const key = syncKey(ctx.window, ctx.timeZone, ownerKey);
  const sameKey = secret.syncKey === key && parseEventIndex(secret.eventIndex) !== null;
  const nowTs = admin.firestore.Timestamp.fromDate(ctx.now);

  try {
    if (typeof secret.url !== "string") throw new FeedFetchError("This calendar's link is missing. Remove it and add it again.");
    const result =
      prefetched ??
      (await fetchIcs(
        secret.url,
        sameKey
          ? {
              ...(typeof secret.etag === "string" ? { etag: secret.etag } : {}),
              ...(typeof secret.lastModified === "string" ? { lastModified: secret.lastModified } : {}),
            }
          : {}
      ));

    let eventCount = typeof feed.eventCount === "number" ? feed.eventCount : 0;
    let truncated = feed.truncated === true;
    if (result.status === "ok") {
      // Servers without ETags still send identical bodies; skip the parse then.
      const bodyHash = createHash("sha1").update(result.text).digest("base64");
      if (!(sameKey && secret.bodyHash === bodyHash)) {
        const expanded = expandIcs(result.text, {
          feedId,
          ownerKey,
          source: feed.kind === "holidays" ? "holiday" : "feed",
          timeZone: ctx.timeZone,
          windowStart: ctx.window.start,
          windowEnd: ctx.window.end,
        });
        const previous = await previousIndex(ctx, secret.eventIndex, "feedId", feedId);
        const index = await writeRows(ctx, previous, expanded.rows);
        eventCount = expanded.rows.length;
        truncated = expanded.truncated;
        if (expanded.skipped > 0) {
          logger.warn("wall calendar: skipped unreadable events", { hid: ctx.hid, feedId, skipped: expanded.skipped });
        }
        await secretRef.set(
          {
            eventIndex: JSON.stringify(index),
            syncKey: key,
            bodyHash,
            etag: result.etag ?? admin.firestore.FieldValue.delete(),
            lastModified: result.lastModified ?? admin.firestore.FieldValue.delete(),
          },
          { merge: true }
        );
      }
    }

    await feedRef.update({
      lastSyncAt: nowTs,
      lastSuccessAt: nowTs,
      eventCount,
      truncated,
      stale: false,
      lastError: admin.firestore.FieldValue.delete(),
    });
    return { feedId, ok: true, eventCount };
  } catch (error) {
    const message = userMessage(error);
    if (!(error instanceof FeedFetchError || error instanceof IcsParseError)) {
      logger.error("wall calendar: feed sync failed", { hid: ctx.hid, feedId, error: String(error) });
    }
    const markStale = shouldMarkStale(toMillis(feed.lastSuccessAt), toMillis(feed.createdAt), feed.stale === true, ctx.now.getTime());
    await feedRef.update({ lastSyncAt: nowTs, lastError: message, ...(markStale ? { stale: true } : {}) });
    if (markStale) await notifyAdminsStale(ctx, typeof feed.label === "string" ? feed.label : "A calendar");
    return { feedId, ok: false, error: message };
  }
}

/** Creates or removes the built-in holidays feed to match the setting. */
async function reconcileHolidays(ctx: HouseholdContext, enabled: boolean): Promise<void> {
  const feedRef = ctx.db.doc(`households/${ctx.hid}/calendarFeeds/${HOLIDAYS_FEED_ID}`);
  const existing = await feedRef.get();
  if (enabled && !existing.exists) {
    const batch = ctx.db.batch();
    batch.set(feedRef, {
      label: "US holidays",
      ownerKey: "family",
      kind: "holidays",
      createdBy: "system",
      createdAt: admin.firestore.Timestamp.fromDate(ctx.now),
      eventCount: 0,
      stale: false,
    });
    batch.set(ctx.db.doc(`households/${ctx.hid}/calendarFeedSecrets/${HOLIDAYS_FEED_ID}`), { url: US_HOLIDAYS_ICS_URL });
    await batch.commit();
  } else if (!enabled && existing.exists) {
    await removeFeedEverywhere(ctx.db, ctx.hid, HOLIDAYS_FEED_ID);
  }
}

/** Re-projects bill lines; `showBills: false` clears them. */
async function syncBills(ctx: HouseholdContext, showBills: boolean, force: boolean): Promise<number | undefined> {
  const indexRef = ctx.db.doc(`households/${ctx.hid}/calendarFeedSecrets/${BILLS_INDEX_ID}`);
  const indexSnap = await indexRef.get();
  const stored = indexSnap.data() ?? {};
  const key = `${syncKey(ctx.window, ctx.timeZone, "family")}|${showBills ? "on" : "off"}`;
  if (!force && stored.syncKey === key) return undefined;

  let rows: WallEventRow[] = [];
  if (showBills) {
    const items = await ctx.db.collection(`households/${ctx.hid}/calendarItems`).get();
    rows = projectBillRows(
      items.docs.map((d) => ({ ...(d.data() as Omit<BillItem, "id">), id: d.id })),
      ctx.window
    );
  }
  const previous = await previousIndex(ctx, stored.eventIndex, "source", "bill");
  const index = await writeRows(ctx, previous, rows);
  await indexRef.set({ eventIndex: JSON.stringify(index), syncKey: key });
  return rows.length;
}

export async function householdTimeZone(db: Firestore, hid: string, settings: Record<string, unknown>): Promise<string> {
  if (typeof settings.timeZone === "string") return resolveTimeZone(settings.timeZone);
  const admins = await db.collection(`households/${hid}/members`).where("role", "==", "admin").get();
  const zones = admins.docs.map((d) => (d.data().notificationPreferences as { timezone?: unknown } | undefined)?.timezone);
  return resolveTimeZone(...zones);
}

export async function syncHouseholdCalendars(
  db: Firestore,
  hid: string,
  options: HouseholdSyncOptions = {}
): Promise<HouseholdSyncSummary> {
  const now = options.now ?? new Date();
  const settings = (await db.doc(`households/${hid}/wallSettings/config`).get()).data() ?? {};
  const timeZone = await householdTimeZone(db, hid, settings);
  const ctx: HouseholdContext = { db, hid, timeZone, window: wallWindow(now, timeZone), now };
  const summary: HouseholdSyncSummary = { feeds: [] };

  if (!options.billsOnly) {
    if (!options.onlyFeedId) await reconcileHolidays(ctx, settings.holidaysEnabled !== false);
    const feedDocs = options.onlyFeedId
      ? [await db.doc(`households/${hid}/calendarFeeds/${options.onlyFeedId}`).get()]
      : (await db.collection(`households/${hid}/calendarFeeds`).get()).docs;
    for (const feedSnap of feedDocs) {
      if (!feedSnap.exists) continue;
      summary.feeds.push(
        await syncFeed(ctx, feedSnap.ref, feedSnap.data() ?? {}, feedSnap.id === options.onlyFeedId ? options.prefetched : undefined)
      );
    }
  }

  if (!options.onlyFeedId) {
    summary.billCount = await syncBills(ctx, settings.showBills !== false, options.forceBills === true);
  }
  return summary;
}

/** Households that have at least one active wall; only those are synced. */
export async function householdsWithActiveWalls(db: Firestore): Promise<string[]> {
  const snap = await db.collectionGroup("displays").where("status", "==", "active").get();
  const hids = new Set<string>();
  for (const doc of snap.docs) {
    const hid = doc.ref.parent.parent?.id;
    if (hid) hids.add(hid);
  }
  return [...hids];
}

export async function hasActiveWall(db: Firestore, hid: string): Promise<boolean> {
  const snap = await db.collection(`households/${hid}/displays`).where("status", "==", "active").limit(1).get();
  return !snap.empty;
}
