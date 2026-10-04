import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALL_TIME_ZONE,
  STALE_AFTER_MS,
  diffEvents,
  parseEventIndex,
  projectBillRows,
  resolveTimeZone,
  rowHash,
  shouldMarkStale,
  syncKey,
  toEventDoc,
  wallWindow,
  type BillItem,
} from "./syncLogic";
import type { WallEventRow } from "./icsParse";

describe("wallWindow", () => {
  it("runs from the previous month's first day to the end of the month three months out, in the household zone", () => {
    expect(wallWindow(new Date("2026-10-04T12:00:00Z"), "America/Chicago")).toEqual({ start: "2026-09-01", end: "2027-01-31" });
    // 03:00Z on Nov 1 is still Oct 31 in Chicago.
    expect(wallWindow(new Date("2026-11-01T03:00:00Z"), "America/Chicago").start).toBe("2026-09-01");
    expect(wallWindow(new Date("2026-11-01T03:00:00Z"), "UTC").start).toBe("2026-10-01");
  });
});

describe("resolveTimeZone", () => {
  it("takes the first valid IANA zone, else the default", () => {
    expect(resolveTimeZone(undefined, "Nope/Zone", "America/Denver")).toBe("America/Denver");
    expect(resolveTimeZone(42, "")).toBe(DEFAULT_WALL_TIME_ZONE);
  });
});

describe("syncKey", () => {
  it("changes with the window, zone and owner", () => {
    const w = { start: "2026-09-01", end: "2027-01-31" };
    const base = syncKey(w, "America/Chicago", "u1");
    expect(syncKey(w, "America/Denver", "u1")).not.toBe(base);
    expect(syncKey(w, "America/Chicago", "family")).not.toBe(base);
    expect(syncKey({ ...w, start: "2026-10-01" }, "America/Chicago", "u1")).not.toBe(base);
  });
});

describe("projectBillRows", () => {
  const window = { start: "2026-10-01", end: "2026-12-31" };
  const items: BillItem[] = [
    { id: "rent", title: "Rent", type: "expense", date: "2026-01-01", isRecurring: true, frequency: "monthly", amount: 1500 },
    { id: "rent-oct", parentRecurringId: "rent", date: "2026-10-01", isPaid: true },
    { id: "car", title: "Car insurance", type: "expense", date: "2026-11-15", isPaid: false, amount: 200, accountId: "chk" } as BillItem,
    { id: "paid", title: "Paid already", type: "expense", date: "2026-11-16", isPaid: true },
    { id: "pay", title: "Paycheck", type: "income", date: "2026-10-15", isPaid: false },
    { id: "old", title: "Old", type: "expense", date: "2026-09-30", isPaid: false },
  ];

  it("lists unpaid expense occurrences only: paid instances, paid one-offs, income and out-of-window days drop out", () => {
    const rows = projectBillRows(items, window);
    expect(rows.map((r) => [r.date, r.title])).toEqual([
      ["2026-11-01", "Rent"],
      ["2026-11-15", "Car insurance"],
      ["2026-12-01", "Rent"],
    ]);
  });

  it("never carries amounts, accounts or buckets", () => {
    for (const row of projectBillRows(items, window)) {
      expect(Object.keys(toEventDoc(row)).sort()).toEqual(["allDay", "date", "ownerKey", "source", "title"]);
      expect(row).toMatchObject({ source: "bill", ownerKey: "family", allDay: true });
    }
  });

  it("gives each occurrence a stable id", () => {
    const a = projectBillRows(items, window).map((r) => r.id);
    expect(projectBillRows(items, window).map((r) => r.id)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("diffEvents", () => {
  const row = (id: string, title: string): WallEventRow => ({ id, source: "feed", feedId: "f", ownerKey: "family", title, allDay: true, date: "2026-10-05" });

  it("upserts new and changed rows, deletes vanished ones, keeps the rest", () => {
    const previous = { a: rowHash(row("a", "A")), b: rowHash(row("b", "B")), gone: "x" };
    const diff = diffEvents(previous, [row("a", "A"), row("b", "B2"), row("c", "C")]);
    expect(diff.upserts.map((r) => r.id)).toEqual(["b", "c"]);
    expect(diff.deletes).toEqual(["gone"]);
    expect(Object.keys(diff.index).sort()).toEqual(["a", "b", "c"]);
  });

  it("rewrites everything against an empty-hash fallback index", () => {
    const diff = diffEvents({ a: "", stale: "" }, [row("a", "A")]);
    expect(diff.upserts.map((r) => r.id)).toEqual(["a"]);
    expect(diff.deletes).toEqual(["stale"]);
  });
});

describe("parseEventIndex", () => {
  it("round-trips and rejects junk", () => {
    expect(parseEventIndex(JSON.stringify({ a: "h" }))).toEqual({ a: "h" });
    expect(parseEventIndex("[1]")).toBeNull();
    expect(parseEventIndex("{")).toBeNull();
    expect(parseEventIndex(undefined)).toBeNull();
  });
});

describe("shouldMarkStale", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  it("flips once a feed has gone a day without a success", () => {
    expect(shouldMarkStale(now - STALE_AFTER_MS - 1, null, false, now)).toBe(true);
    expect(shouldMarkStale(now - STALE_AFTER_MS + 1000, null, false, now)).toBe(false);
    expect(shouldMarkStale(now - STALE_AFTER_MS - 1, null, true, now)).toBe(false);
  });
  it("measures a never-synced feed from its creation", () => {
    expect(shouldMarkStale(null, now - STALE_AFTER_MS - 1, false, now)).toBe(true);
    expect(shouldMarkStale(null, null, false, now)).toBe(false);
  });
});
