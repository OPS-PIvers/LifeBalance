/**
 * Household calendar ICS feed (Plan 22 — Phase 6 family-calendar bet, cheapest
 * slice first). Two functions:
 *
 *  - `generatecalendarfeedtoken` (callable, member-auth): mints a random
 *    128-bit capability token and writes it to the household doc via the
 *    Admin SDK. Deliberately server-side random generation — not because
 *    `firestore.rules` blocks a client write (it doesn't; the household
 *    update rule is field-permissive, see `types/schema.ts`'s
 *    `pendingRedemptions`/`redemptionHistory` precedent) but because the
 *    token must come from a real CSPRNG, and centralizing "regenerate"
 *    keeps read + rotate in one place.
 *  - `calendarfeed` (HTTP GET, public): `?hid=<householdId>&token=<token>`.
 *    On any mismatch (bad household id OR bad token) returns 404 — the two
 *    cases are deliberately indistinguishable so a scan can't enumerate
 *    valid household ids. On match, emits a `text/calendar` ICS document of
 *    the household's unpaid EXPENSE calendar items (v1 excludes income —
 *    this is a bills feed). Recurring templates are emitted as a single
 *    VEVENT with an RRULE (weekly/bi-weekly/monthly) plus EXDATE for
 *    occurrences already covered by a paid/deleted instance doc, mirroring
 *    the template/instance interpretation documented next to
 *    `findBillsDueOnDate` (functions/src/index.ts) — the calendar CLIENT
 *    (Google/Apple Calendar) does the occurrence expansion, not us.
 *
 * The token is a capability URL: NEVER log it.
 */

import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { formatCurrency } from "./utils/formatCurrency";

/** Minimal subset of the Express/Firebase response object used below. */
interface HttpResponse {
  status(code: number): { json(body: unknown): void; send(body: string): void };
  set(header: string, value: string): void;
}

/** Minimal subset of the Express/Firebase request object used below. */
interface HttpRequestLike {
  method: string;
  query: Record<string, unknown>;
}

/**
 * Shape of a `calendarItems` doc this feed cares about. Recurring bills are
 * stored as a single TEMPLATE doc whose `date` is the original anchor
 * occurrence (never advanced); paying/deleting a single occurrence writes a
 * separate INSTANCE doc carrying `parentRecurringId` plus `isPaid`/`isDeleted`
 * rather than mutating the template — same interpretation as
 * `functions/src/index.ts`'s `BillCalendarItem` / `findBillsDueOnDate`, with
 * `title`/`amount`/`type` added for feed rendering (not needed by the bill
 * reminder job, so not present on that narrower type).
 */
export interface FeedCalendarItem {
  id: string;
  title: string;
  amount: number;
  date: string; // yyyy-MM-dd
  type: "income" | "expense";
  isPaid: boolean;
  isRecurring?: boolean;
  frequency?: "weekly" | "bi-weekly" | "monthly";
  isDeleted?: boolean;
  parentRecurringId?: string;
}

const RRULE_BY_FREQUENCY: Record<string, string> = {
  weekly: "FREQ=WEEKLY",
  "bi-weekly": "FREQ=WEEKLY;INTERVAL=2",
  monthly: "FREQ=MONTHLY",
};

/**
 * Escape RFC 5545 TEXT value content: backslash, then newline, comma,
 * semicolon. Order matters — backslash must be escaped first or the escapes
 * added for the other characters would themselves get re-escaped.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Fold a single unfolded content line per RFC 5545 §3.1: lines longer than 75
 * octets are split with a CRLF followed by a single leading space (a "soft"
 * line break invisible to parsers). Splits only at UTF-8 character
 * boundaries — never inside a multi-byte codepoint.
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let isFirst = true;
  while (start < bytes.length) {
    // Continuation lines carry a leading space that counts toward the 75-octet
    // budget, so they get one fewer byte of content than the first line.
    const budget = isFirst ? 75 : 74;
    let end = Math.min(start + budget, bytes.length);
    // Back off while the next byte is a UTF-8 continuation byte (10xxxxxx) so
    // we never split a multi-byte character across two folded lines.
    while (end > start + 1 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
      end--;
    }
    chunks.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    isFirst = false;
  }
  return chunks.join("\r\n ");
}

/** Format a Date as a UTC ICS DATE-TIME value (`YYYYMMDDTHHMMSSZ`). */
function toIcsDateTimeUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Format a `yyyy-MM-dd` string as an ICS DATE value (`YYYYMMDD`). */
function toIcsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

/**
 * Build a complete VCALENDAR document (CRLF-joined, folded, escaped) for a
 * household's unpaid EXPENSE calendar items. Pure function — no Firestore
 * access — so it's fully unit-testable.
 *
 * @param items All of the household's `calendarItems` docs (templates AND
 *   instance docs) already filtered by the caller to `type === 'expense'`.
 * @param householdName Used for the calendar's display name (X-WR-CALNAME).
 * @param now Injectable clock for deterministic DTSTAMP in tests.
 */
export function buildIcs(
  items: FeedCalendarItem[],
  householdName: string,
  now: Date = new Date()
): string {
  // Dates already covered by a paid/deleted instance doc, keyed by template id
  // — same grouping `findBillsDueOnDate` (functions/src/index.ts) uses to
  // suppress already-handled occurrences, here turned into EXDATE values.
  const coveredDates = new Map<string, string[]>();
  for (const item of items) {
    if (item.parentRecurringId && (item.isPaid || item.isDeleted)) {
      const dates = coveredDates.get(item.parentRecurringId) ?? [];
      dates.push(item.date);
      coveredDates.set(item.parentRecurringId, dates);
    }
  }

  const dtstamp = toIcsDateTimeUtc(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LifeBalance//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldIcsLine(`X-WR-CALNAME:${escapeIcsText(`${householdName} Bills`)}`),
  ];

  for (const item of items) {
    // Instance docs only exist to mark an occurrence paid/deleted on a parent
    // template — never emitted as their own event. A one-off deleted item is
    // also never due.
    if (item.parentRecurringId || item.isDeleted) continue;

    const isRecurring = item.isRecurring && RRULE_BY_FREQUENCY[item.frequency ?? ""];
    // Non-recurring bills that are already paid are no longer "due" — exclude
    // them from the feed (matches findBillsDueOnDate's `!item.isPaid` gate).
    // Recurring templates keep `isPaid` meaningless at the template level —
    // per-occurrence paid state lives on instance docs (handled via EXDATE
    // above), so the template itself is always emitted.
    if (!isRecurring && item.isPaid) continue;

    const summary = `${item.title} (${formatCurrency(item.amount)})`;
    lines.push(
      "BEGIN:VEVENT",
      foldIcsLine(`UID:${item.id}@lifebalance.app`),
      foldIcsLine(`DTSTAMP:${dtstamp}`),
      foldIcsLine(`DTSTART;VALUE=DATE:${toIcsDate(item.date)}`),
      foldIcsLine(`SUMMARY:${escapeIcsText(summary)}`)
    );
    if (isRecurring) {
      lines.push(foldIcsLine(`RRULE:${RRULE_BY_FREQUENCY[item.frequency ?? ""]}`));
      const exdates = coveredDates.get(item.id);
      if (exdates && exdates.length > 0) {
        lines.push(
          foldIcsLine(`EXDATE;VALUE=DATE:${exdates.map(toIcsDate).join(",")}`)
        );
      }
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/**
 * Callable: generate (or regenerate) the household's calendar feed token.
 * Any member may enable/rotate the feed — matches the field-permissive
 * household-doc rule and the "any member can see the bill calendar" bar (it's
 * already visible to every member in-app).
 */
export const generatecalendarfeedtoken = onCall(
  { cors: true },
  async (request) => {
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

    // Lazily bound inside the handler (not module scope) — this module is
    // imported from index.ts before admin.initializeApp() runs, same
    // convention as geminiProxy.ts / plaid / stripe.
    const db = admin.firestore();
    const householdRef = db.doc(`households/${householdId}`);
    const householdSnap = await householdRef.get();
    if (!householdSnap.exists) {
      throw new HttpsError("not-found", "Household not found.");
    }
    const memberUids = householdSnap.data()?.memberUids;
    if (!Array.isArray(memberUids) || !memberUids.includes(request.auth.uid)) {
      throw new HttpsError(
        "permission-denied",
        "You are not a member of this household."
      );
    }

    const token = crypto.randomBytes(16).toString("hex");
    await householdRef.update({ calendarFeedToken: token });

    logger.info("generatecalendarfeedtoken: token rotated", {
      householdId,
      generatedBy: request.auth.uid,
    });

    return { token };
  }
);

/**
 * HTTP GET: `?hid=<householdId>&token=<token>`. Returns a `text/calendar` ICS
 * feed of the household's unpaid expense calendar items on token match, or a
 * bare 404 on ANY mismatch (unknown household, missing/rotated token) —
 * deliberately indistinguishable so the endpoint can't be used to enumerate
 * valid household ids.
 */
export const calendarfeed = onRequest(
  { cors: false, maxInstances: 2 },
  async (req: HttpRequestLike, res: HttpResponse) => {
    if (req.method !== "GET") {
      res.status(405).send("Method not allowed");
      return;
    }

    const hid = req.query.hid;
    const token = req.query.token;
    if (typeof hid !== "string" || !hid || typeof token !== "string" || !token) {
      res.status(404).send("Not found");
      return;
    }

    const db = admin.firestore();
    const householdRef = db.doc(`households/${hid}`);
    const householdSnap = await householdRef.get();
    if (!householdSnap.exists) {
      res.status(404).send("Not found");
      return;
    }

    const data = householdSnap.data() ?? {};
    const storedToken = data.calendarFeedToken;
    if (
      typeof storedToken !== "string" ||
      !constantTimeEquals(storedToken, token)
    ) {
      res.status(404).send("Not found");
      return;
    }

    const itemsSnap = await db
      .collection(`households/${hid}/calendarItems`)
      .where("type", "==", "expense")
      .get();
    const items = itemsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() } as FeedCalendarItem)
    );

    const householdName =
      typeof data.name === "string" && data.name ? data.name : "LifeBalance";
    const ics = buildIcs(items, householdName);

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.status(200).send(ics);
  }
);

/**
 * Constant-time-ish string comparison to avoid a trivial timing side-channel
 * on the token check. Falls back to `false` (not throwing) on length
 * mismatch, since `crypto.timingSafeEqual` requires equal-length buffers.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
