/**
 * Tests for the callable `createkidprofile` Cloud Function (Plan 051 — server-side
 * managed-kid-profile cap enforcement).
 *
 * Mirrors geminiProxy.test.ts's mocking style:
 *   - `onCall(opts, handler)` is mocked to return the raw handler so we can call it
 *     directly. `HttpsError` records its `code` for rejection assertions.
 *   - `firebase-admin` exposes a single shared, reconfigurable mock Firestore whose
 *     `doc().get()` reads from a path→data store, `doc().set()` is a spy, and
 *     `collection().where().get()` returns a configurable managed-member count.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const adminMock = vi.hoisted(() => {
  const store: Record<string, Record<string, unknown> | undefined> = {};
  let managedCount = 0;
  const setMock = vi.fn(async () => undefined);

  const db = {
    doc: (path: string) => ({
      get: async () => ({
        exists: store[path] !== undefined,
        data: () => store[path],
      }),
      set: setMock,
    }),
    collection: (_path: string) => ({
      where: () => ({ get: async () => ({ size: managedCount }) }),
    }),
  };

  // admin.firestore() returns the db; admin.firestore.FieldValue.serverTimestamp()
  // is a static on the same function object.
  const firestore = (() => db) as (() => typeof db) & {
    FieldValue: { serverTimestamp: () => string };
  };
  firestore.FieldValue = { serverTimestamp: () => "SERVER_TS" };

  return {
    db,
    firestore,
    setMock,
    store,
    setManaged: (n: number) => {
      managedCount = n;
    },
    reset: () => {
      for (const k of Object.keys(store)) delete store[k];
      managedCount = 0;
      setMock.mockClear();
    },
  };
});

vi.mock("firebase-admin", () => ({ firestore: adminMock.firestore }));

// Import AFTER mocks are registered.
import { createkidprofile } from "./createKidProfile";

type CallableHandler = (request: unknown) => Promise<{ memberId: string }>;
const call = createkidprofile as unknown as CallableHandler;

const AUTH = { uid: "parent1" };
const HH = "hh1";
const MEMBER_PATH = `households/${HH}/members/parent1`;
const CONFIG_PATH = "app_config/global";
const HOUSEHOLD_PATH = `households/${HH}`;

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    auth: AUTH,
    data: { householdId: HH, displayName: "Leo", ...overrides },
  };
}

beforeEach(() => {
  adminMock.reset();
  // Default: caller is a member (parent) of the household.
  adminMock.store[MEMBER_PATH] = { displayName: "Parent", role: "admin" };
});

describe("createkidprofile — auth & validation", () => {
  it("rejects an unauthenticated caller", async () => {
    await expect(call({ data: { householdId: HH, displayName: "Leo" } })).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("rejects a missing householdId", async () => {
    await expect(call({ auth: AUTH, data: { displayName: "Leo" } })).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("rejects a blank displayName", async () => {
    await expect(call(validRequest({ displayName: "   " }))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("rejects a displayName over 50 chars", async () => {
    await expect(call(validRequest({ displayName: "x".repeat(51) }))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("rejects a caller who is not a member of the household", async () => {
    delete adminMock.store[MEMBER_PATH];
    await expect(call(validRequest())).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(adminMock.setMock).not.toHaveBeenCalled();
  });
});

describe("createkidprofile — cap enforcement", () => {
  it("billing dormant: creates regardless of existing count (no config doc)", async () => {
    adminMock.setManaged(99);
    const res = await call(validRequest());
    expect(res.memberId).toMatch(/^kid_/);
    expect(adminMock.setMock).toHaveBeenCalledOnce();
  });

  it("billing live + free plan under cap: creates", async () => {
    adminMock.store[CONFIG_PATH] = { billingEnabled: true };
    adminMock.store[HOUSEHOLD_PATH] = {}; // no subscription → free
    adminMock.setManaged(1); // free cap is 2
    const res = await call(validRequest());
    expect(res.memberId).toMatch(/^kid_/);
    expect(adminMock.setMock).toHaveBeenCalledOnce();
  });

  it("billing live + free plan at cap: rejects with resource-exhausted", async () => {
    adminMock.store[CONFIG_PATH] = { billingEnabled: true };
    adminMock.store[HOUSEHOLD_PATH] = {};
    adminMock.setManaged(2); // free cap reached
    await expect(call(validRequest())).rejects.toMatchObject({
      code: "resource-exhausted",
    });
    expect(adminMock.setMock).not.toHaveBeenCalled();
  });

  it("billing live + premium plan: allows beyond the free cap (premium cap 10)", async () => {
    adminMock.store[CONFIG_PATH] = { billingEnabled: true };
    adminMock.store[HOUSEHOLD_PATH] = { subscription: { plan: "premium", status: "active" } };
    adminMock.setManaged(2); // over free cap, under premium cap
    const res = await call(validRequest());
    expect(res.memberId).toMatch(/^kid_/);
    expect(adminMock.setMock).toHaveBeenCalledOnce();
  });

  it("writes a well-formed managed-kid doc (uid matches id, role/isManaged set)", async () => {
    const res = await call(validRequest({ avatarColor: "amber", avatarEmoji: "🦊" }));
    // set() is called on the doc ref with just the payload.
    const [payload] = adminMock.setMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      uid: res.memberId,
      displayName: "Leo",
      role: "kid",
      isManaged: true,
      managedByUid: "parent1",
      avatarColor: "amber",
      avatarEmoji: "🦊",
      allowanceCents: 0,
    });
  });
});
