/**
 * Tests for the callable `geminiproxy` Cloud Function.
 *
 * Mirrors index.test.ts's mocking style:
 *   - `onCall(opts, handler)` is mocked to return the raw handler so we can call
 *     it directly as `(request) => Promise<unknown>`. `HttpsError` is a real-ish
 *     class that records its `code` so we can assert on rejection codes.
 *   - `firebase-functions/params` `defineSecret` returns a stub whose `.value()`
 *     yields a fake key (the real secret is never set in tests).
 *   - `@google/genai`'s `GoogleGenAI` is mocked so we can assert what the proxy
 *     forwards to `generateContent` and control its `{ text }` result.
 *   - `firebase-admin` exposes a single shared, reconfigurable mock Firestore
 *     (quickAdd/index.test.ts style) driving the Plan 10 membership + quota
 *     enforcement branches.
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
  HttpsError: MockHttpsError,
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({ value: () => "test-secret-key" }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// @google/genai mock — single shared, reconfigurable generateContent
// ---------------------------------------------------------------------------

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

// ---------------------------------------------------------------------------
// firebase-admin mock — single shared, reconfigurable Firestore (Plan 10)
// ---------------------------------------------------------------------------

const adminMock = vi.hoisted(() => {
  const householdGet = vi.fn();
  const configGet = vi.fn();
  const txnGet = vi.fn();
  const txnUpdate = vi.fn();
  const runTransaction = vi.fn(
    async (fn: (txn: { get: typeof txnGet; update: typeof txnUpdate }) => Promise<void>) =>
      fn({ get: txnGet, update: txnUpdate })
  );
  const householdRef = { get: householdGet };
  const configRef = { get: configGet };
  const db = {
    doc: vi.fn((path: string) =>
      path === "app_config/global" ? configRef : householdRef
    ),
    runTransaction,
  };
  return { db, householdGet, configGet, txnGet, txnUpdate, runTransaction };
});

vi.mock("firebase-admin", () => ({
  firestore: () => adminMock.db,
}));

// Import AFTER mocks are registered. Functions use relative imports.
import { geminiproxy, resolveQuotaDay } from "./geminiProxy";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type CallableHandler = (request: unknown) => Promise<unknown>;

function asCallable(fn: unknown): CallableHandler {
  return fn as CallableHandler;
}

const AUTH = { uid: "user1" };
const VALID_DATA = {
  model: "gemini-3-flash-preview",
  contents: { parts: [{ text: "hello" }] },
  config: { responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
  householdId: "hh1",
};

/** The server's UTC calendar date — what resolveQuotaDay falls back to. */
const SERVER_TODAY = new Date().toISOString().slice(0, 10);

/** Admin-SDK-shaped doc snapshot (`.exists` is a property, not a function). */
function snap(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

/** Configure the mock household doc for both the direct read and the txn read. */
function setHousehold(data: Record<string, unknown> | undefined) {
  adminMock.householdGet.mockResolvedValue(snap(data));
  adminMock.txnGet.mockResolvedValue(snap(data));
}

beforeEach(() => {
  vi.clearAllMocks();
  generateContentMock.mockResolvedValue({ text: '{"ok":true}' });
  // Defaults: caller is a member, no usage yet, config doc absent
  // (kill-switch fail-open, billing fail-closed → legacy 100/day cap).
  setHousehold({ memberUids: ["user1"] });
  adminMock.configGet.mockResolvedValue(snap(undefined));
});

// ===========================================================================
// geminiproxy
// ===========================================================================

describe("geminiproxy", () => {
  it("rejects unauthenticated requests", async () => {
    await expect(
      asCallable(geminiproxy)({ data: VALID_DATA })
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a missing model with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { contents: VALID_DATA.contents, config: VALID_DATA.config },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string model with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { ...VALID_DATA, model: 123 },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects missing contents with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { model: VALID_DATA.model, config: VALID_DATA.config },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("forwards { model, contents, config } and returns the proxied { text }", async () => {
    generateContentMock.mockResolvedValue({ text: '{"merchant":"Target"}' });

    const result = await asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA });

    expect(result).toEqual({ text: '{"merchant":"Target"}' });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock).toHaveBeenCalledWith({
      model: VALID_DATA.model,
      contents: VALID_DATA.contents,
      config: VALID_DATA.config,
    });
  });

  it("maps an unknown SDK failure to an internal HttpsError", async () => {
    generateContentMock.mockRejectedValue(new Error("boom"));

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "internal" });
  });

  it("maps a Gemini 503 to a retryable 'unavailable' HttpsError", async () => {
    generateContentMock.mockRejectedValue(
      Object.assign(new Error("UNAVAILABLE"), { status: 503 })
    );

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("maps a Gemini 429 to a retryable 'resource-exhausted' HttpsError", async () => {
    generateContentMock.mockRejectedValue(
      Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 })
    );

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  // -------------------------------------------------------------------------
  // Plan 10: membership + quota enforcement
  // -------------------------------------------------------------------------

  it("rejects a missing householdId with invalid-argument", async () => {
    const { householdId: _hh, ...noHousehold } = VALID_DATA;
    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: noHousehold })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string householdId with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: { ...VALID_DATA, householdId: 42 } })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a householdId containing a path separator with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { ...VALID_DATA, householdId: "hh1/apiKeys/sneaky" },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a missing household with not-found", async () => {
    setHousehold(undefined);

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "not-found" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not a household member with permission-denied", async () => {
    setHousehold({ memberUids: ["someone-else"] });

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(adminMock.txnUpdate).not.toHaveBeenCalled();
  });

  it("rejects when memberUids is absent on the household doc", async () => {
    setHousehold({ name: "no-members-array" });

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects with failed-precondition when the aiEnabled kill-switch is off", async () => {
    adminMock.configGet.mockResolvedValue(snap({ aiEnabled: false }));

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringContaining("temporarily disabled"),
    });
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(adminMock.txnUpdate).not.toHaveBeenCalled();
  });

  it("proceeds fail-open (with the legacy cap) when the config read fails", async () => {
    adminMock.configGet.mockRejectedValue(new Error("firestore down"));

    const result = await asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(adminMock.txnUpdate).toHaveBeenCalledWith(expect.anything(), {
      aiUsage: { dailyCount: 1, lastResetDate: SERVER_TODAY },
    });
  });

  it("rejects at-cap requests with resource-exhausted and does NOT call Gemini", async () => {
    // Billing off → legacy flat cap of 100.
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 100, lastResetDate: SERVER_TODAY },
    });

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      message: expect.stringContaining("Daily AI quota exceeded"),
    });
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(adminMock.txnUpdate).not.toHaveBeenCalled();
  });

  it("increments the counter and forwards the call when under cap", async () => {
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 5, lastResetDate: SERVER_TODAY },
    });

    const result = await asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(adminMock.txnUpdate).toHaveBeenCalledTimes(1);
    expect(adminMock.txnUpdate).toHaveBeenCalledWith(expect.anything(), {
      aiUsage: { dailyCount: 6, lastResetDate: SERVER_TODAY },
    });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("resets the counter on date rollover even when yesterday was at cap", async () => {
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 100, lastResetDate: "2020-01-01" },
    });

    const result = await asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(adminMock.txnUpdate).toHaveBeenCalledWith(expect.anything(), {
      aiUsage: { dailyCount: 1, lastResetDate: SERVER_TODAY },
    });
  });

  it("applies the plan-aware FREE cap (3/day) when billing is enabled", async () => {
    adminMock.configGet.mockResolvedValue(snap({ aiEnabled: true, billingEnabled: true }));
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 3, lastResetDate: SERVER_TODAY },
    });

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("applies the plan-aware PREMIUM cap (500/day) when billing is enabled", async () => {
    adminMock.configGet.mockResolvedValue(snap({ aiEnabled: true, billingEnabled: true }));
    setHousehold({
      memberUids: ["user1"],
      subscription: { plan: "premium", status: "active" },
      aiUsage: { dailyCount: 3, lastResetDate: SERVER_TODAY },
    });

    const result = await asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(adminMock.txnUpdate).toHaveBeenCalledWith(expect.anything(), {
      aiUsage: { dailyCount: 4, lastResetDate: SERVER_TODAY },
    });
  });

  it("counts against the caller-local 'today' when it is within a day of the server date", async () => {
    // Yesterday (UTC) is always within the ±1-day clamp.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 2, lastResetDate: yesterday },
    });

    await asCallable(geminiproxy)({
      auth: AUTH,
      data: { ...VALID_DATA, today: yesterday },
    });

    // Same quota day as the stored counter → increment, not reset.
    expect(adminMock.txnUpdate).toHaveBeenCalledWith(expect.anything(), {
      aiUsage: { dailyCount: 3, lastResetDate: yesterday },
    });
  });

  it("never resets when the claimed day is EARLIER than the stored day (alternation attack)", async () => {
    // Adversarial pattern: after calls counted against SERVER_TODAY, the caller
    // claims yesterday (still within the ±1-day clamp) hoping the mismatch
    // resets the counter. Rollover must be monotonic: an earlier claimed day
    // keeps counting against the STORED day, and the stored key never moves
    // backwards — otherwise alternating two in-clamp dates bypasses the cap.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 100, lastResetDate: SERVER_TODAY },
    });

    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { ...VALID_DATA, today: yesterday },
      })
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(adminMock.txnUpdate).not.toHaveBeenCalled();
  });

  it("counts an under-cap earlier-day claim against the stored day without moving it backwards", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 5, lastResetDate: SERVER_TODAY },
    });

    await asCallable(geminiproxy)({
      auth: AUTH,
      data: { ...VALID_DATA, today: yesterday },
    });

    // Increment continues on the stored (later) day; lastResetDate unchanged.
    expect(adminMock.txnUpdate).toHaveBeenCalledWith(expect.anything(), {
      aiUsage: { dailyCount: 6, lastResetDate: SERVER_TODAY },
    });
  });

  it("clamps a far-off claimed 'today' to the server date (no date-gaming)", async () => {
    setHousehold({
      memberUids: ["user1"],
      aiUsage: { dailyCount: 100, lastResetDate: SERVER_TODAY },
    });

    // Claiming a fresh far-future day must NOT reset an at-cap counter.
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { ...VALID_DATA, today: "2099-12-31" },
      })
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// resolveQuotaDay
// ===========================================================================

describe("resolveQuotaDay", () => {
  // Fixed reference instant: 2026-07-09T12:00:00Z.
  const NOW = Date.parse("2026-07-09T12:00:00Z");

  it("uses the server UTC date when 'today' is absent", () => {
    expect(resolveQuotaDay(undefined, NOW)).toBe("2026-07-09");
  });

  it("uses the server UTC date when 'today' is malformed", () => {
    expect(resolveQuotaDay("07/09/2026", NOW)).toBe("2026-07-09");
    expect(resolveQuotaDay("2026-7-9", NOW)).toBe("2026-07-09");
    expect(resolveQuotaDay(20260709, NOW)).toBe("2026-07-09");
    expect(resolveQuotaDay("not-a-date", NOW)).toBe("2026-07-09");
  });

  it("accepts the caller's date when within ±1 calendar day", () => {
    expect(resolveQuotaDay("2026-07-08", NOW)).toBe("2026-07-08");
    expect(resolveQuotaDay("2026-07-09", NOW)).toBe("2026-07-09");
    expect(resolveQuotaDay("2026-07-10", NOW)).toBe("2026-07-10");
  });

  it("clamps a date more than 1 day away to the server date", () => {
    expect(resolveQuotaDay("2026-07-07", NOW)).toBe("2026-07-09");
    expect(resolveQuotaDay("2026-07-11", NOW)).toBe("2026-07-09");
    expect(resolveQuotaDay("2099-12-31", NOW)).toBe("2026-07-09");
  });
});
