/**
 * Tests for the household calendar ICS feed (Plan 22):
 *   - `buildIcs` — pure ICS emitter, unit-tested directly (no mocks needed).
 *   - `generatecalendarfeedtoken` (callable) and `calendarfeed` (HTTP GET) —
 *     mirrors geminiProxy.test.ts / quickAdd/index.test.ts's mocking style:
 *     `onCall`/`onRequest` are mocked to return the raw handler, and
 *     `firebase-admin` exposes a single shared, reconfigurable mock Firestore.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// firebase-functions mocks
// ---------------------------------------------------------------------------

const { MockHttpsError } = vi.hoisted(() => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "HttpsError";
    }
  }
  return { MockHttpsError };
});

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  onRequest: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// firebase-admin mock — single shared, reconfigurable Firestore
// ---------------------------------------------------------------------------

const adminMock = vi.hoisted(() => {
  const householdGet = vi.fn();
  const householdUpdate = vi.fn(() => Promise.resolve());
  const calendarItemsGet = vi.fn();
  const householdRef = { get: householdGet, update: householdUpdate };
  // `.where(...)` is followed by `.limit(...).get()` in the handler; the mock
  // returns a chainable object exposing both.
  const whereResult = { limit: vi.fn(() => whereResult), get: calendarItemsGet };
  const whereFn = vi.fn(() => whereResult);
  const db = {
    doc: vi.fn(() => householdRef),
    collection: vi.fn(() => ({ where: whereFn })),
  };
  return { db, householdGet, householdUpdate, calendarItemsGet, whereFn };
});

vi.mock("firebase-admin", () => ({
  firestore: () => adminMock.db,
}));

// Import AFTER mocks are registered. Functions use relative imports.
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  generatecalendarfeedtoken,
  calendarfeed,
  type FeedCalendarItem,
} from "./calendarFeed";

// ---------------------------------------------------------------------------
// buildIcs (pure)
// ---------------------------------------------------------------------------

function snap(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

function item(overrides: Partial<FeedCalendarItem>): FeedCalendarItem {
  return {
    id: "item1",
    title: "Rent",
    amount: 1200,
    date: "2026-07-01",
    type: "expense",
    isPaid: false,
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");

describe("buildIcs", () => {
  it("wraps events in a well-formed VCALENDAR envelope", () => {
    const ics = buildIcs([item({})], "The Ivers", FIXED_NOW);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("X-WR-CALNAME:The Ivers Bills\r\n");
    expect(ics.trimEnd()).toMatch(/END:VCALENDAR$/);
  });

  it("emits a one-off unpaid item with DTSTART and no RRULE", () => {
    const ics = buildIcs(
      [item({ id: "oneoff1", date: "2026-08-15" })],
      "House",
      FIXED_NOW
    );
    expect(ics).toContain("UID:oneoff1@lifebalance.app\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260815\r\n");
    expect(ics).not.toContain("RRULE:");
  });

  it("excludes a paid one-off item entirely", () => {
    const ics = buildIcs(
      [item({ id: "paidoneoff", isPaid: true })],
      "House",
      FIXED_NOW
    );
    expect(ics).not.toContain("paidoneoff");
  });

  it("maps weekly frequency to RRULE:FREQ=WEEKLY", () => {
    const ics = buildIcs(
      [item({ id: "w1", isRecurring: true, frequency: "weekly" })],
      "House",
      FIXED_NOW
    );
    expect(ics).toContain("RRULE:FREQ=WEEKLY\r\n");
  });

  it("maps bi-weekly frequency to RRULE:FREQ=WEEKLY;INTERVAL=2", () => {
    const ics = buildIcs(
      [item({ id: "bw1", isRecurring: true, frequency: "bi-weekly" })],
      "House",
      FIXED_NOW
    );
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2\r\n");
  });

  it("maps monthly frequency to RRULE:FREQ=MONTHLY", () => {
    const ics = buildIcs(
      [item({ id: "m1", isRecurring: true, frequency: "monthly" })],
      "House",
      FIXED_NOW
    );
    expect(ics).toContain("RRULE:FREQ=MONTHLY\r\n");
  });

  it("keeps a recurring template's event even when isPaid is set on the template", () => {
    // Per-occurrence paid state lives on instance docs, not the template.
    const ics = buildIcs(
      [
        item({
          id: "rec1",
          isRecurring: true,
          frequency: "monthly",
          isPaid: true,
        }),
      ],
      "House",
      FIXED_NOW
    );
    expect(ics).toContain("UID:rec1@lifebalance.app");
    expect(ics).toContain("RRULE:FREQ=MONTHLY");
  });

  it("adds an EXDATE for a paid-instance occurrence and omits the instance doc as its own event", () => {
    const template = item({
      id: "rec2",
      isRecurring: true,
      frequency: "monthly",
      date: "2026-01-01",
    });
    const paidInstance = item({
      id: "inst1",
      parentRecurringId: "rec2",
      isPaid: true,
      date: "2026-02-01",
    });
    const ics = buildIcs([template, paidInstance], "House", FIXED_NOW);
    expect(ics).toContain("EXDATE;VALUE=DATE:20260201\r\n");
    expect(ics).not.toContain("UID:inst1@lifebalance.app");
    // Only one VEVENT was emitted (the template) — the instance doc is skipped.
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("adds an EXDATE for a deleted-instance occurrence", () => {
    const template = item({
      id: "rec3",
      isRecurring: true,
      frequency: "weekly",
      date: "2026-01-05",
    });
    const deletedInstance = item({
      id: "inst2",
      parentRecurringId: "rec3",
      isDeleted: true,
      date: "2026-01-12",
    });
    const ics = buildIcs([template, deletedInstance], "House", FIXED_NOW);
    expect(ics).toContain("EXDATE;VALUE=DATE:20260112\r\n");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("excludes a one-off item marked isDeleted", () => {
    const ics = buildIcs(
      [item({ id: "del1", isDeleted: true })],
      "House",
      FIXED_NOW
    );
    expect(ics).not.toContain("del1");
  });

  it("escapes commas, semicolons, backslashes and newlines in SUMMARY", () => {
    const ics = buildIcs(
      [item({ id: "esc1", title: "Rent, Utilities; \"Feb\"\nnote\\path" })],
      "House",
      FIXED_NOW
    );
    // Find the (possibly folded) SUMMARY line and unfold it for assertion.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Rent\\, Utilities\\; \"Feb\"\\nnote\\\\path");
  });

  it("folds a long SUMMARY line at 75-octet boundaries with a CRLF + leading space", () => {
    const longTitle = "A".repeat(120);
    const ics = buildIcs([item({ id: "long1", title: longTitle })], "House", FIXED_NOW);
    const summaryLine = ics
      .split("\r\n")
      .find((l) => l.startsWith("SUMMARY:"));
    expect(summaryLine).toBeDefined();
    expect(Buffer.byteLength(summaryLine!, "utf8")).toBeLessThanOrEqual(75);
    // The continuation line (starting with a single space) must be present.
    const lines = ics.split("\r\n");
    const idx = lines.indexOf(summaryLine!);
    expect(lines[idx + 1]!.startsWith(" ")).toBe(true);
  });
});

describe("escapeIcsText / foldIcsLine (units)", () => {
  it("escapeIcsText handles all four special characters", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("foldIcsLine leaves short lines untouched", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });
});

// ---------------------------------------------------------------------------
// generatecalendarfeedtoken (callable)
// ---------------------------------------------------------------------------

type CallableHandler = (request: unknown) => Promise<unknown>;
function asCallable(fn: unknown): CallableHandler {
  return fn as CallableHandler;
}

describe("generatecalendarfeedtoken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminMock.householdUpdate.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated requests", async () => {
    await expect(
      asCallable(generatecalendarfeedtoken)({ data: { householdId: "hh1" } })
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects a missing householdId with invalid-argument", async () => {
    await expect(
      asCallable(generatecalendarfeedtoken)({ auth: { uid: "u1" }, data: {} })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects an unknown household with not-found", async () => {
    adminMock.householdGet.mockResolvedValue(snap(undefined));
    await expect(
      asCallable(generatecalendarfeedtoken)({
        auth: { uid: "u1" },
        data: { householdId: "hh1" },
      })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects a caller who is not a member", async () => {
    adminMock.householdGet.mockResolvedValue(snap({ memberUids: ["someoneElse"] }));
    await expect(
      asCallable(generatecalendarfeedtoken)({
        auth: { uid: "u1" },
        data: { householdId: "hh1" },
      })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(adminMock.householdUpdate).not.toHaveBeenCalled();
  });

  it("writes a fresh 32-hex-char token and returns it for a member", async () => {
    adminMock.householdGet.mockResolvedValue(snap({ memberUids: ["u1", "u2"] }));
    const result = (await asCallable(generatecalendarfeedtoken)({
      auth: { uid: "u1" },
      data: { householdId: "hh1" },
    })) as { token: string };

    expect(result.token).toMatch(/^[0-9a-f]{32}$/);
    expect(adminMock.householdUpdate).toHaveBeenCalledWith({
      calendarFeedToken: result.token,
    });
  });
});

// ---------------------------------------------------------------------------
// calendarfeed (HTTP GET)
// ---------------------------------------------------------------------------

type HttpHandler = (req: unknown, res: unknown) => Promise<void>;
function asHttp(fn: unknown): HttpHandler {
  return fn as HttpHandler;
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): { json(b: unknown): void; send(b: string): void };
  set(k: string, v: string): void;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return {
        json: (b: unknown) => {
          res.body = b;
        },
        send: (b: string) => {
          res.body = b;
        },
      };
    },
    set(k: string, v: string) {
      res.headers[k] = v;
    },
  };
  return res;
}

function makeReq(query: Record<string, unknown> = {}, method = "GET") {
  return { method, query };
}

const VALID_TOKEN = "a".repeat(32);

describe("calendarfeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminMock.calendarItemsGet.mockResolvedValue({ docs: [] });
  });

  it("rejects a non-GET method with 405", async () => {
    const res = makeRes();
    await asHttp(calendarfeed)(makeReq({}, "POST"), res);
    expect(res.statusCode).toBe(405);
  });

  it("404s when hid or token is missing", async () => {
    const res = makeRes();
    await asHttp(calendarfeed)(makeReq({ hid: "hh1" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s (does not throw) on a hid containing a path separator", async () => {
    // A `/` would escape the households/ path and make db.doc() throw on an
    // odd-segment path — it must be rejected before the lookup.
    const res = makeRes();
    await asHttp(calendarfeed)(
      makeReq({ hid: "hh1/calendarItems/x", token: VALID_TOKEN }),
      res
    );
    expect(res.statusCode).toBe(404);
    expect(adminMock.householdGet).not.toHaveBeenCalled();
  });

  it("404s for an unknown household", async () => {
    adminMock.householdGet.mockResolvedValue(snap(undefined));
    const res = makeRes();
    await asHttp(calendarfeed)(makeReq({ hid: "hh1", token: VALID_TOKEN }), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s on a token mismatch", async () => {
    adminMock.householdGet.mockResolvedValue(
      snap({ name: "The Ivers", calendarFeedToken: "b".repeat(32) })
    );
    const res = makeRes();
    await asHttp(calendarfeed)(makeReq({ hid: "hh1", token: VALID_TOKEN }), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s when the household has never generated a token", async () => {
    adminMock.householdGet.mockResolvedValue(snap({ name: "The Ivers" }));
    const res = makeRes();
    await asHttp(calendarfeed)(makeReq({ hid: "hh1", token: VALID_TOKEN }), res);
    expect(res.statusCode).toBe(404);
  });

  it("returns a text/calendar ICS body on a token match", async () => {
    adminMock.householdGet.mockResolvedValue(
      snap({ name: "The Ivers", calendarFeedToken: VALID_TOKEN })
    );
    adminMock.calendarItemsGet.mockResolvedValue({
      docs: [
        {
          id: "b1",
          data: () => ({
            title: "Rent",
            amount: 1200,
            date: "2026-08-01",
            type: "expense",
            isPaid: false,
          }),
        },
      ],
    });
    const res = makeRes();
    await asHttp(calendarfeed)(makeReq({ hid: "hh1", token: VALID_TOKEN }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/calendar; charset=utf-8");
    expect(res.body as string).toContain("UID:b1@lifebalance.app");
    expect(adminMock.whereFn).toHaveBeenCalledWith("type", "==", "expense");
  });
});
