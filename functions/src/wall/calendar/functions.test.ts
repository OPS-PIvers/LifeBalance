/**
 * The wall calendar callables: who may call them, input validation, the
 * manual-sync cooldown, and that a feed link only ever lands in the secret doc.
 * The sync engine itself is covered by sync.test.ts and is mocked here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockHttpsError } = vi.hoisted(() => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { MockHttpsError };
});

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (_o: unknown, h: unknown) => h }));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (_p: unknown, h: unknown) => h }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const fake = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  let autoId = 0;
  const docRef = (path: string) => ({
    id: path.split("/").pop() ?? "",
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => {
      store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...d } : { ...d });
    },
    update: async (d: Record<string, unknown>) => { store.set(path, { ...(store.get(path) ?? {}), ...d }); },
  });
  type Ref = ReturnType<typeof docRef>;
  const db = {
    doc: docRef,
    collection: (path: string) => ({
      doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
      get: async () => {
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(`${path}/`) && p.split("/").length === path.split("/").length + 1)
          .map((p) => ({ id: p.split("/").pop() }));
        return { docs };
      },
    }),
    batch: () => {
      const ops: (() => Promise<void>)[] = [];
      return {
        set: (ref: Ref, d: Record<string, unknown>) => ops.push(() => ref.set(d)),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) =>
      fn({ get: (ref: Ref) => ref.get(), set: (ref: Ref, d: Record<string, unknown>, o?: { merge?: boolean }) => void ref.set(d, o) }),
  };
  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => ({ __serverTs: true }) } });
  return { store, firestore, reset: () => { store.clear(); autoId = 0; } };
});
vi.mock("firebase-admin", () => ({ firestore: fake.firestore }));

const sync = vi.hoisted(() => ({
  syncHouseholdCalendars: vi.fn(async (_db: unknown, _hid: string, opts: { onlyFeedId?: string }) => ({
    feeds: opts.onlyFeedId ? [{ feedId: opts.onlyFeedId, ok: true, eventCount: 3 }] : [],
  })),
  removeFeedEverywhere: vi.fn(async () => undefined),
  hasActiveWall: vi.fn(async () => true),
  householdsWithActiveWalls: vi.fn(async () => []),
}));
vi.mock("./sync", () => sync);
const travel = vi.hoisted(() => ({ updateHouseholdTravel: vi.fn(async () => ({ checked: 0 })) }));
vi.mock("./travel", () => travel);

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./icsFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./icsFetch")>()),
  fetchIcs: fetchMock,
}));

import { addwallcalendarfeed, removewallcalendarfeed, syncwallcalendarsnow, updatewallcalendarfeed } from "./functions";

type Handler = (req: unknown) => Promise<unknown>;
const call = (fn: unknown, data: unknown, auth: unknown) => (fn as Handler)({ data, auth });
const HID = "h1";
const adminAuth = { uid: "admin1", token: {} };
const memberAuth = { uid: "kid1", token: {} };
const displayAuth = (hid = HID, did = "d1") => ({ uid: `display_${did}`, token: { display: true, hid, did } });
const VALID_ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20261010\r\nSUMMARY:A\r\nEND:VEVENT\r\nEND:VCALENDAR";

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ status: "ok", text: VALID_ICS });
  fake.store.set(`households/${HID}/members/admin1`, { role: "admin" });
  fake.store.set(`households/${HID}/members/kid1`, { role: "member" });
  fake.store.set(`households/${HID}/displays/d1`, { status: "active" });
});

describe("addwallcalendarfeed", () => {
  const add = { householdId: HID, url: "webcal://cal.example.com/p.ics", label: "  Paul's  work ", ownerKey: "kid1" };

  it("tests the link, keeps it in the secret doc only, and syncs the new feed", async () => {
    await expect(call(addwallcalendarfeed, add, adminAuth)).resolves.toEqual({ feedId: "auto1", eventCount: 3 });
    expect(fetchMock).toHaveBeenCalledWith("https://cal.example.com/p.ics");
    expect(fake.store.get(`households/${HID}/calendarFeedSecrets/auto1`)).toEqual({ url: "https://cal.example.com/p.ics" });
    const feedDoc = fake.store.get(`households/${HID}/calendarFeeds/auto1`);
    expect(feedDoc).toMatchObject({ label: "Paul's work", ownerKey: "kid1", kind: "ics", createdBy: "admin1" });
    expect(JSON.stringify(feedDoc)).not.toContain("example.com");
    expect(sync.syncHouseholdCalendars).toHaveBeenCalledWith(expect.anything(), HID, expect.objectContaining({ onlyFeedId: "auto1", prefetched: expect.anything() }));
  });

  it("is admin-only and refuses displays", async () => {
    await expect(call(addwallcalendarfeed, add, memberAuth)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call(addwallcalendarfeed, add, displayAuth())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call(addwallcalendarfeed, add, undefined)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects bad labels, owners and internal links before fetching", async () => {
    await expect(call(addwallcalendarfeed, { ...add, label: "" }, adminAuth)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(addwallcalendarfeed, { ...add, ownerKey: "stranger" }, adminAuth)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(addwallcalendarfeed, { ...add, url: "http://169.254.169.254/latest" }, adminAuth)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a link that isn't a calendar inline and saves nothing", async () => {
    fetchMock.mockResolvedValue({ status: "ok", text: "<html>Sign in</html>" });
    await expect(call(addwallcalendarfeed, add, adminAuth)).rejects.toMatchObject({ code: "failed-precondition", message: "That link isn't a calendar file." });
    expect([...fake.store.keys()].some((k) => k.includes("calendarFeed"))).toBe(false);
  });

  it("caps feeds per household, not counting holidays", async () => {
    for (let i = 0; i < 20; i++) fake.store.set(`households/${HID}/calendarFeeds/f${i}`, {});
    await expect(call(addwallcalendarfeed, add, adminAuth)).rejects.toMatchObject({ code: "resource-exhausted" });
  });
});

describe("updatewallcalendarfeed / removewallcalendarfeed", () => {
  beforeEach(() => {
    fake.store.set(`households/${HID}/calendarFeeds/f1`, { label: "Old", ownerKey: "family", kind: "ics" });
    fake.store.set(`households/${HID}/calendarFeedSecrets/f1`, { url: "https://a.example.com/x.ics", eventIndex: "{}", etag: '"e"' });
  });

  it("renames and re-owns without refetching the link", async () => {
    await call(updatewallcalendarfeed, { householdId: HID, feedId: "f1", label: "New", ownerKey: "admin1" }, adminAuth);
    expect(fake.store.get(`households/${HID}/calendarFeeds/f1`)).toMatchObject({ label: "New", ownerKey: "admin1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns on alerts from the full Settings form without re-syncing the feed", async () => {
    await call(
      updatewallcalendarfeed,
      { householdId: HID, feedId: "f1", label: "Old", ownerKey: "family", alerts: true, travelMode: "walk" },
      adminAuth
    );
    expect(fake.store.get(`households/${HID}/calendarFeeds/f1`)).toMatchObject({ alerts: true, travelMode: "walk" });
    expect(sync.syncHouseholdCalendars).not.toHaveBeenCalled();
    expect(travel.updateHouseholdTravel).toHaveBeenCalled();
    await expect(
      call(updatewallcalendarfeed, { householdId: HID, feedId: "f1", travelMode: "boat" }, adminAuth)
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("re-syncs when the owner changes (it's on every event)", async () => {
    await call(updatewallcalendarfeed, { householdId: HID, feedId: "f1", label: "Old", ownerKey: "admin1", alerts: false }, adminAuth);
    expect(sync.syncHouseholdCalendars).toHaveBeenCalledWith(expect.anything(), HID, expect.objectContaining({ onlyFeedId: "f1" }));
  });

  it("replaces a link from scratch, dropping the old validators", async () => {
    await call(updatewallcalendarfeed, { householdId: HID, feedId: "f1", url: "https://b.example.com/y.ics" }, adminAuth);
    expect(fake.store.get(`households/${HID}/calendarFeedSecrets/f1`)).toEqual({ url: "https://b.example.com/y.ics" });
  });

  it("won't touch the built-in holidays feed or the bills index", async () => {
    for (const feedId of ["holidays", "_bills"]) {
      await expect(call(removewallcalendarfeed, { householdId: HID, feedId }, adminAuth)).rejects.toMatchObject({ code: "invalid-argument" });
    }
    await call(removewallcalendarfeed, { householdId: HID, feedId: "f1" }, adminAuth);
    expect(sync.removeFeedEverywhere).toHaveBeenCalledWith(expect.anything(), HID, "f1");
  });
});

describe("syncwallcalendarsnow", () => {
  it("lets members and this household's active display sync, once per two minutes", async () => {
    await expect(call(syncwallcalendarsnow, { householdId: HID }, displayAuth())).resolves.toEqual({ ok: true, failed: 0 });
    expect(typeof fake.store.get(`households/${HID}/wallSettings/config`)?.lastManualSyncAt).toBe("string");
    await expect(call(syncwallcalendarsnow, { householdId: HID }, memberAuth)).rejects.toMatchObject({ code: "resource-exhausted" });
    fake.store.set(`households/${HID}/wallSettings/config`, { lastManualSyncAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    await expect(call(syncwallcalendarsnow, { householdId: HID }, memberAuth)).resolves.toMatchObject({ ok: true });
  });

  it("refuses revoked displays, other households' displays and strangers", async () => {
    fake.store.set(`households/${HID}/displays/d2`, { status: "revoked" });
    await expect(call(syncwallcalendarsnow, { householdId: HID }, displayAuth(HID, "d2"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call(syncwallcalendarsnow, { householdId: HID }, displayAuth("h2", "d1"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(call(syncwallcalendarsnow, { householdId: HID }, { uid: "nobody", token: {} })).rejects.toMatchObject({ code: "permission-denied" });
    expect(sync.syncHouseholdCalendars).not.toHaveBeenCalled();
  });
});
