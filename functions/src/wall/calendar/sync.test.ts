/**
 * syncHouseholdCalendars against an in-memory stand-in for firebase-admin's
 * Firestore (path → data), with the network fetch and push sender mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const fake = vi.hoisted(() => {
  class Timestamp {
    constructor(private ms: number) {}
    static fromMillis(ms: number) { return new Timestamp(ms); }
    static fromDate(d: Date) { return new Timestamp(d.getTime()); }
    toMillis() { return this.ms; }
  }
  const DELETE = { __delete: true };
  const store = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  let autoId = 0;

  const merge = (path: string, patch: Record<string, unknown>, base: Record<string, unknown>) => {
    const next = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      if (v === DELETE) delete next[k];
      else next[k] = v;
    }
    store.set(path, next);
    writes.push(path);
  };

  type Snap = { id: string; ref: Ref; exists: boolean; data: () => Record<string, unknown> | undefined };
  type Ref = {
    id: string; path: string; parent: { parent: { id: string } | null };
    get: () => Promise<Snap>;
    set: (d: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void>;
    update: (d: Record<string, unknown>) => Promise<void>;
    delete: () => Promise<void>;
  };
  const docRef = (path: string): Ref => {
    const parts = path.split("/");
    const ref: Ref = {
      id: parts.at(-1) ?? "",
      path,
      parent: { parent: parts.length >= 4 ? { id: parts.at(-3) ?? "" } : null },
      get: async () => ({ id: ref.id, ref, exists: store.has(path), data: () => store.get(path) }),
      set: async (d, o) => merge(path, d, o?.merge ? store.get(path) ?? {} : {}),
      update: async (d) => {
        const cur = store.get(path);
        if (!cur) throw new Error(`update of missing doc ${path}`);
        merge(path, d, cur);
      },
      delete: async () => { store.delete(path); writes.push(path); },
    };
    return ref;
  };

  const query = (match: (p: string) => boolean, filters: [string, unknown][], limit?: number) => ({
    where: (f: string, _op: string, v: unknown) => query(match, [...filters, [f, v]], limit),
    limit: (n: number) => query(match, filters, n),
    get: async () => {
      let docs = [...store.entries()]
        .filter(([p, d]) => match(p) && filters.every(([f, v]) => d[f] === v))
        .map(([p]) => docRef(p))
        .map((ref) => ({ id: ref.id, ref, exists: true, data: () => store.get(ref.path) }));
      if (limit !== undefined) docs = docs.slice(0, limit);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const depth = (p: string) => p.split("/").length;
  const collection = (path: string) => ({
    ...query((p) => p.startsWith(`${path}/`) && depth(p) === depth(path) + 1, []),
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
  });

  const db = {
    doc: docRef,
    collection,
    collectionGroup: (name: string) => query((p) => p.split("/").at(-2) === name, []),
    batch: () => {
      const ops: (() => Promise<void>)[] = [];
      return {
        set: (ref: Ref, d: Record<string, unknown>) => ops.push(() => ref.set(d)),
        delete: (ref: Ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
  const firestore = Object.assign(() => db, {
    Timestamp,
    FieldValue: { delete: () => DELETE, serverTimestamp: () => ({ __serverTs: true }) },
  });
  return { store, writes, db, firestore, Timestamp, reset: () => { store.clear(); writes.length = 0; autoId = 0; } };
});

vi.mock("firebase-admin", () => ({ firestore: fake.firestore }));

const send = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../shared/notifications", () => ({ sendNotificationToUser: send }));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./icsFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./icsFetch")>()),
  fetchIcs: fetchMock,
}));

import { FeedFetchError } from "./icsFetch";
import { householdsWithActiveWalls, removeFeedEverywhere, syncHouseholdCalendars } from "./sync";
import { STALE_AFTER_MS, US_HOLIDAYS_ICS_URL } from "./syncLogic";

const HID = "h1";
const NOW = new Date("2026-10-04T17:00:00Z");
const db = fake.db as unknown as Parameters<typeof syncHouseholdCalendars>[0];

const ics = (...events: [uid: string, date: string, title: string][]) =>
  [
    "BEGIN:VCALENDAR",
    ...events.flatMap(([uid, date, title]) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${title}`, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");

const HOLIDAYS = ics(["thx", "20261126", "Thanksgiving"]);
let feedBody = ics(["a", "20261010", "Game"], ["b", "20261011", "Recital"]);

const events = () =>
  [...fake.store.entries()]
    .filter(([p]) => p.startsWith(`households/${HID}/wallEvents/`))
    .map(([, d]) => d)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
const titles = (source?: string) => events().filter((e) => !source || e.source === source).map((e) => e.title);
const feed = (id: string) => fake.store.get(`households/${HID}/calendarFeeds/${id}`) ?? {};

beforeEach(() => {
  fake.reset();
  send.mockClear();
  fetchMock.mockReset();
  feedBody = ics(["a", "20261010", "Game"], ["b", "20261011", "Recital"]);
  fetchMock.mockImplementation(async (url: string) => ({ status: "ok", text: url === US_HOLIDAYS_ICS_URL ? HOLIDAYS : feedBody, etag: '"e1"' }));
  const s = fake.store;
  s.set(`households/${HID}/wallSettings/config`, { timeZone: "America/Chicago" });
  s.set(`households/${HID}/members/admin1`, { role: "admin", fcmTokens: ["tok"] });
  s.set(`households/${HID}/displays/d1`, { status: "active" });
  s.set(`households/${HID}/calendarFeeds/f1`, { label: "Paul", ownerKey: "admin1", kind: "ics", createdAt: fake.Timestamp.fromDate(NOW) });
  s.set(`households/${HID}/calendarFeedSecrets/f1`, { url: "https://cal.example.com/p.ics" });
  s.set(`households/${HID}/calendarItems/rent`, { title: "Rent", type: "expense", date: "2026-01-01", isRecurring: true, frequency: "monthly", amount: 1500, isPaid: false });
});

describe("syncHouseholdCalendars", () => {
  it("creates the holidays feed, syncs every feed and projects bills on the first run", async () => {
    const summary = await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(summary.feeds.map((f) => [f.feedId, f.ok, f.eventCount])).toEqual([
      ["f1", true, 2],
      ["holidays", true, 1],
    ]);
    expect(titles("feed")).toEqual(["Game", "Recital"]);
    expect(titles("holiday")).toEqual(["Thanksgiving"]);
    // Sep 1 2026 → Jan 31 2027: five rent occurrences.
    expect(titles("bill")).toEqual(["Rent", "Rent", "Rent", "Rent", "Rent"]);
    expect(events().find((e) => e.title === "Game")).toMatchObject({ ownerKey: "admin1", feedId: "f1", date: "2026-10-10" });
    expect(events().some((e) => "amount" in e)).toBe(false);
    expect(feed("f1")).toMatchObject({ eventCount: 2, stale: false });
    expect(feed("holidays")).toMatchObject({ kind: "holidays", ownerKey: "family" });
    // The link stays in the secret doc only.
    expect(JSON.stringify(feed("f1"))).not.toContain("cal.example.com");
  });

  it("re-syncs an unchanged feed without touching wallEvents, sending its ETag", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    fake.writes.length = 0;
    await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(fake.writes.filter((p) => p.includes("/wallEvents/"))).toEqual([]);
    expect(fetchMock).toHaveBeenLastCalledWith(US_HOLIDAYS_ICS_URL, { etag: '"e1"' });
  });

  it("applies a changed feed as a diff", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    feedBody = ics(["a", "20261010", "Game (moved field)"], ["c", "20261012", "Dentist"]);
    fake.writes.length = 0;
    await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(titles("feed")).toEqual(["Game (moved field)", "Dentist"]);
    expect(fake.writes.filter((p) => p.includes("/wallEvents/"))).toHaveLength(3); // 1 changed, 1 added, 1 deleted
  });

  it("treats a 304 as success", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    fetchMock.mockResolvedValue({ status: "not-modified" });
    const later = new Date(NOW.getTime() + 60_000);
    await syncHouseholdCalendars(db, HID, { now: later });
    expect(titles("feed")).toEqual(["Game", "Recital"]);
    expect((feed("f1").lastSuccessAt as { toMillis(): number }).toMillis()).toBe(later.getTime());
  });

  it("records errors, marks a day-old failure stale and tells admins once", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    fetchMock.mockRejectedValue(new FeedFetchError("That calendar link no longer works."));
    await syncHouseholdCalendars(db, HID, { now: new Date(NOW.getTime() + 60_000) });
    expect(feed("f1")).toMatchObject({ lastError: "That calendar link no longer works.", stale: false });
    expect(send).not.toHaveBeenCalled();
    expect(titles("feed")).toEqual(["Game", "Recital"]); // old lines stay up

    const dayLater = new Date(NOW.getTime() + STALE_AFTER_MS + 60_000);
    await syncHouseholdCalendars(db, HID, { now: dayLater });
    expect(feed("f1").stale).toBe(true);
    expect(send).toHaveBeenCalledTimes(2); // f1 and the holidays feed, to the one admin
    expect(send.mock.calls[0]).toEqual([
      ["tok"],
      expect.any(String),
      expect.stringContaining('"Paul"'),
      expect.objectContaining({ url: "/settings?section=wall" }),
      expect.anything(),
      { householdId: HID, recipientUid: "admin1", type: "calendar_feed_stale" },
    ]);
    await syncHouseholdCalendars(db, HID, { now: new Date(dayLater.getTime() + 60_000) });
    expect(send).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValue({ status: "ok", text: feedBody });
    await syncHouseholdCalendars(db, HID, { now: new Date(dayLater.getTime() + 120_000) });
    expect(feed("f1").stale).toBe(false);
    expect(feed("f1").lastError).toBeUndefined();
  });

  it("removes the holidays feed and its lines when holidays are turned off", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    fake.store.set(`households/${HID}/wallSettings/config`, { timeZone: "America/Chicago", holidaysEnabled: false });
    await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(titles("holiday")).toEqual([]);
    expect(fake.store.has(`households/${HID}/calendarFeeds/holidays`)).toBe(false);
    expect(fake.store.has(`households/${HID}/calendarFeedSecrets/holidays`)).toBe(false);
  });

  it("re-projects bills only when forced or the window moved, and clears them when hidden", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    fake.store.set(`households/${HID}/calendarItems/rent-nov`, { parentRecurringId: "rent", date: "2026-11-01", isPaid: true });
    await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(titles("bill")).toHaveLength(5); // same window, not forced: untouched
    await syncHouseholdCalendars(db, HID, { now: NOW, billsOnly: true, forceBills: true });
    expect(events().filter((e) => e.source === "bill").map((e) => e.date)).not.toContain("2026-11-01");
    expect(titles("bill")).toHaveLength(4);

    fake.store.set(`households/${HID}/wallSettings/config`, { timeZone: "America/Chicago", showBills: false });
    await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(titles("bill")).toEqual([]);
    expect(titles("feed")).toEqual(["Game", "Recital"]);
  });

  it("syncs only the named feed, from a prefetched body", async () => {
    const summary = await syncHouseholdCalendars(db, HID, {
      now: NOW,
      onlyFeedId: "f1",
      prefetched: { status: "ok", text: ics(["z", "20261020", "Prefetched"]) },
    });
    expect(summary.feeds).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Prefetched"]);
  });

  it("falls back to the first admin's zone when the wall has none", async () => {
    fake.store.set(`households/${HID}/wallSettings/config`, {});
    fake.store.set(`households/${HID}/members/admin1`, { role: "admin", notificationPreferences: { timezone: "America/Los_Angeles" } });
    feedBody = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:t", "DTSTART:20261010T170000Z", "SUMMARY:Timed", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    await syncHouseholdCalendars(db, HID, { now: NOW });
    expect(events().find((e) => e.title === "Timed")?.start).toBe("2026-10-10T10:00:00-07:00");
  });
});

describe("removeFeedEverywhere", () => {
  it("deletes the feed's lines, secret and doc, and nothing else", async () => {
    await syncHouseholdCalendars(db, HID, { now: NOW });
    await removeFeedEverywhere(db, HID, "f1");
    expect(titles("feed")).toEqual([]);
    expect(titles("holiday")).toEqual(["Thanksgiving"]);
    expect(fake.store.has(`households/${HID}/calendarFeeds/f1`)).toBe(false);
    expect(fake.store.has(`households/${HID}/calendarFeedSecrets/f1`)).toBe(false);
  });
});

describe("householdsWithActiveWalls", () => {
  it("lists each household with an active display once", async () => {
    fake.store.set(`households/${HID}/displays/d2`, { status: "active" });
    fake.store.set(`households/h2/displays/d3`, { status: "revoked" });
    fake.store.set(`households/h3/displays/d4`, { status: "active" });
    expect((await householdsWithActiveWalls(db)).sort()).toEqual([HID, "h3"]);
  });
});
