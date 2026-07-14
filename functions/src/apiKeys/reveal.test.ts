/**
 * Tests for the callable `attachapikeyencryption` and `revealapikey` functions.
 *
 * Mirrors geminiProxy.test.ts's mocking style:
 *   - `onCall(opts, handler)` returns the raw handler so we call it directly.
 *   - `HttpsError` records its `code` for rejection assertions.
 *   - `defineSecret(...).value()` yields a fixed test secret.
 *   - `firebase-admin` exposes a reconfigurable mock Firestore whose `doc(path)`
 *     routes to a member ref (`members/...`) or the api-key ref (`apiKeys/...`).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";
import { encryptSecret } from "./crypto";

const TEST_SECRET = "test-enc-secret";

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
  defineSecret: (_name: string) => ({ value: () => TEST_SECRET }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const adminMock = vi.hoisted(() => {
  const memberGet = vi.fn();
  const keyGet = vi.fn();
  const keyUpdate = vi.fn();
  const memberRef = { get: memberGet };
  const keyRef = { get: keyGet, update: keyUpdate };
  const db = {
    doc: vi.fn((path: string) =>
      path.includes("/members/") ? memberRef : keyRef
    ),
  };
  return { db, memberGet, keyGet, keyUpdate };
});

vi.mock("firebase-admin", () => ({
  firestore: () => adminMock.db,
}));

// Import AFTER mocks are registered.
import { attachapikeyencryption, revealapikey } from "./reveal";

type CallableHandler = (request: unknown) => Promise<unknown>;
const asCallable = (fn: unknown): CallableHandler => fn as CallableHandler;

const AUTH = { uid: "admin-uid" };
const HID = "household-1";
const KEY_ID = "key-1";
const PLAIN = "lb_househ_0123456789abcdef0123456789abcdef";
const HASH = createHash("sha256").update(PLAIN).digest("hex");

/** Admin-SDK-shaped snapshot (`.exists` is a property, not a function). */
function snap(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

function setAdminMember(isAdmin: boolean, exists = true) {
  adminMock.memberGet.mockResolvedValue(
    snap(exists ? { role: isAdmin ? "admin" : "member" } : undefined)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setAdminMember(true);
});

describe("attachapikeyencryption", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      asCallable(attachapikeyencryption)({ data: { householdId: HID, keyId: KEY_ID, key: PLAIN } })
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects a non-admin caller", async () => {
    setAdminMember(false);
    await expect(
      asCallable(attachapikeyencryption)({
        auth: AUTH,
        data: { householdId: HID, keyId: KEY_ID, key: PLAIN },
      })
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it.each([
    { householdId: "", keyId: KEY_ID, key: PLAIN },
    { householdId: "a/b", keyId: KEY_ID, key: PLAIN },
    { householdId: HID, keyId: "", key: PLAIN },
    { householdId: HID, keyId: KEY_ID, key: "" },
  ])("rejects invalid args %o", async (data) => {
    await expect(
      asCallable(attachapikeyencryption)({ auth: AUTH, data })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("404s when the key doc is missing", async () => {
    adminMock.keyGet.mockResolvedValue(snap(undefined));
    await expect(
      asCallable(attachapikeyencryption)({
        auth: AUTH,
        data: { householdId: HID, keyId: KEY_ID, key: PLAIN },
      })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects when the provided key does not match the doc's hash", async () => {
    adminMock.keyGet.mockResolvedValue(snap({ hashedKey: "different-hash" }));
    await expect(
      asCallable(attachapikeyencryption)({
        auth: AUTH,
        data: { householdId: HID, keyId: KEY_ID, key: PLAIN },
      })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(adminMock.keyUpdate).not.toHaveBeenCalled();
  });

  it("stores an encrypted copy when the key matches", async () => {
    adminMock.keyGet.mockResolvedValue(snap({ hashedKey: HASH }));
    const result = await asCallable(attachapikeyencryption)({
      auth: AUTH,
      data: { householdId: HID, keyId: KEY_ID, key: PLAIN },
    });
    expect(result).toEqual({ success: true });
    expect(adminMock.keyUpdate).toHaveBeenCalledTimes(1);
    const payload = adminMock.keyUpdate.mock.calls[0]![0] as {
      encryptedKey: string;
    };
    // A versioned GCM payload, and hashedKey/keyPrefix are never touched.
    expect(payload.encryptedKey.startsWith("v1:")).toBe(true);
    expect(Object.keys(payload)).toEqual(["encryptedKey"]);
  });
});

describe("revealapikey", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      asCallable(revealapikey)({ data: { householdId: HID, keyId: KEY_ID } })
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects a non-admin caller", async () => {
    setAdminMember(false);
    await expect(
      asCallable(revealapikey)({ auth: AUTH, data: { householdId: HID, keyId: KEY_ID } })
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("404s when the key doc is missing", async () => {
    adminMock.keyGet.mockResolvedValue(snap(undefined));
    await expect(
      asCallable(revealapikey)({ auth: AUTH, data: { householdId: HID, keyId: KEY_ID } })
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("fails precondition for a legacy key with no encrypted copy", async () => {
    adminMock.keyGet.mockResolvedValue(snap({ hashedKey: HASH }));
    await expect(
      asCallable(revealapikey)({ auth: AUTH, data: { householdId: HID, keyId: KEY_ID } })
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("returns the decrypted plaintext for an encrypted key", async () => {
    const encryptedKey = encryptSecret(PLAIN, TEST_SECRET);
    adminMock.keyGet.mockResolvedValue(snap({ hashedKey: HASH, encryptedKey }));
    const result = await asCallable(revealapikey)({
      auth: AUTH,
      data: { householdId: HID, keyId: KEY_ID },
    });
    expect(result).toEqual({ key: PLAIN });
  });

  it("500s (internal) when the stored ciphertext cannot be decrypted", async () => {
    adminMock.keyGet.mockResolvedValue(
      snap({ hashedKey: HASH, encryptedKey: "v1:bad:bad:bad" })
    );
    await expect(
      asCallable(revealapikey)({ auth: AUTH, data: { householdId: HID, keyId: KEY_ID } })
    ).rejects.toMatchObject({ code: "internal" });
  });
});
