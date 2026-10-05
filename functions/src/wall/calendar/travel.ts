/**
 * Travel times for the wall's starting-soon alerts
 * (docs/plans/wall-display-kiosk.md §12 "Alerts").
 *
 * For each household with a home address: timed events today/tomorrow, from
 * calendars with alerts on, that have a real place as their location, get a
 * Google Routes duration in `wallTravel/{eventId}` (live traffic for
 * driving). Looked up once ~4 h out and again inside ~95 min.
 *
 * The home address is server-only (`calendarFeedSecrets/_home`). Only the
 * minutes reach the wall; event locations go to Google, never to logs.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createHash } from "crypto";
import { formatInTimeZone } from "date-fns-tz";
import { getGoogleAccessToken } from "../googleAuth";
import { householdTimeZone } from "./sync";
import {
  HOME_SECRET_ID,
  ROUTES_URL,
  homeAddress,
  needsTravelCheck,
  routableLocation,
  routeMinutes,
  routesRequestBody,
  travelModeOf,
  type TravelMode,
} from "./travelLogic";

type Firestore = admin.firestore.Firestore;

export interface TravelDeps {
  fetch: typeof fetch;
  token: () => Promise<string>;
}

const defaultDeps: TravelDeps = { fetch: (...args) => fetch(...args), token: getGoogleAccessToken };

/** Kept out of wallTravel: which home a duration was measured from, without the address. */
export const homeKeyOf = (address: string): string => createHash("sha1").update(address).digest("hex").slice(0, 12);

class RoutesError extends Error {}

async function lookUp(deps: TravelDeps, origin: string, destination: string, mode: TravelMode, start: string): Promise<number | null> {
  const res = await deps.fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await deps.token()}`,
      "Content-Type": "application/json",
      "X-Goog-FieldMask": "routes.duration",
    },
    body: JSON.stringify(routesRequestBody(origin, destination, mode, start)),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return routeMinutes(await res.json());
  const text = (await res.text()).slice(0, 300);
  // A place Google can't find is the event's problem, not the API's.
  if (res.status === 400 || res.status === 404) return null;
  logger.error("wall travel: Routes refused", { status: res.status, body: text });
  throw new RoutesError(
    res.status === 403
      ? "Travel times need the Routes API turned on (see the wall setup guide)."
      : "Google Routes couldn't be reached. Travel times will be retried."
  );
}

/** Deletes travel docs for events that ended over an hour ago. */
async function forgetFinished(
  db: Firestore,
  travelCol: admin.firestore.CollectionReference,
  existing: Map<string, admin.firestore.DocumentData>,
  nowMs: number
): Promise<void> {
  const stale = [...existing.entries()].filter(([, t]) => typeof t.start !== "string" || Date.parse(t.start) < nowMs - 3_600_000);
  if (stale.length === 0) return;
  const batch = db.batch();
  for (const [id] of stale) batch.delete(travelCol.doc(id));
  await batch.commit();
}

export async function updateHouseholdTravel(
  db: Firestore,
  hid: string,
  now: Date = new Date(),
  deps: TravelDeps = defaultDeps
): Promise<{ checked: number }> {
  const home = homeAddress((await db.doc(`households/${hid}/calendarFeedSecrets/${HOME_SECRET_ID}`).get()).data()?.address);
  const feeds = await db.collection(`households/${hid}/calendarFeeds`).get();
  const modes = new Map<string, TravelMode>();
  for (const f of feeds.docs) if (f.data().alerts === true) modes.set(f.id, travelModeOf(f.data().travelMode));
  const travelCol = db.collection(`households/${hid}/wallTravel`);
  const existing = new Map((await travelCol.get()).docs.map((d) => [d.id, d.data()]));
  const settingsRef = db.doc(`households/${hid}/wallSettings/config`);
  const settings = (await settingsRef.get()).data() ?? {};
  const nowMs = now.getTime();

  // Nothing to look up (no home address, or no calendar with alerts): still
  // forget finished events, and drop an error nothing is running into now.
  if (!home || modes.size === 0) {
    await forgetFinished(db, travelCol, existing, nowMs);
    if (typeof settings.travelError === "string") await settingsRef.set({ travelError: admin.firestore.FieldValue.delete() }, { merge: true });
    return { checked: 0 };
  }

  const tz = await householdTimeZone(db, hid, settings);
  const days = [formatInTimeZone(now, tz, "yyyy-MM-dd"), formatInTimeZone(new Date(now.getTime() + 86_400_000), tz, "yyyy-MM-dd")];
  const events = await db.collection(`households/${hid}/wallEvents`).where("date", "in", days).get();
  const homeKey = homeKeyOf(home);

  let checked = 0;
  let error: string | null = null;
  for (const doc of events.docs) {
    const e = doc.data();
    const mode = typeof e.feedId === "string" ? modes.get(e.feedId) : undefined;
    const destination = routableLocation(typeof e.location === "string" ? e.location : undefined);
    const startMs = typeof e.start === "string" ? Date.parse(e.start) : NaN;
    if (!mode || !destination || e.allDay === true || Number.isNaN(startMs)) continue;
    const prev = existing.get(doc.id);
    const same = prev && prev.start === e.start && prev.mode === mode && prev.homeKey === homeKey && prev.location === homeKeyOf(destination);
    const last = same && typeof prev.checkedAt === "string" ? Date.parse(prev.checkedAt) : null;
    if (!needsTravelCheck(startMs, nowMs, last)) continue;
    try {
      const minutes = await lookUp(deps, home, destination, mode, e.start as string);
      await travelCol.doc(doc.id).set({
        minutes,
        mode,
        start: e.start,
        checkedAt: now.toISOString(),
        homeKey,
        location: homeKeyOf(destination),
      });
      checked += 1;
    } catch (err) {
      error = err instanceof RoutesError ? err.message : "Google Routes couldn't be reached. Travel times will be retried.";
      if (!(err instanceof RoutesError)) logger.warn("wall travel: lookup failed", { hid, error: String(err) });
      break; // one failure is enough to know; try again next run
    }
  }

  await forgetFinished(db, travelCol, existing, nowMs);

  const before = typeof settings.travelError === "string" ? settings.travelError : null;
  if (error !== before && (error !== null || checked > 0)) {
    await settingsRef.set({ travelError: error ?? admin.firestore.FieldValue.delete() }, { merge: true });
  }
  return { checked };
}
