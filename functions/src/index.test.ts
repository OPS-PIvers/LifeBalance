/**
 * Tests for the callable Cloud Functions in index.ts.
 *
 * Like quickAdd/index.test.ts, these are picked up by the ROOT Vitest runner.
 * `index.ts` imports firebase-admin and firebase-functions at module load, plus
 * the v2 scheduler / firestore trigger entry points and the quickAdd HTTP
 * functions, so we mock all of them:
 *   - `onCall(opts, handler)` is mocked to return the raw handler so we can call
 *     it directly as `(request) => Promise<unknown>`. `HttpsError` is a real-ish
 *     class that records its `code` so we can assert on rejection codes.
 *   - `onSchedule` / `onDocumentWritten` / `onRequest` are mocked to no-op
 *     factories — index.ts registers handlers with them at module load, but the
 *     callables under test never invoke those.
 *   - `firebase-admin` exposes a single shared, reconfigurable mock Firestore.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// firebase-functions mocks
// ---------------------------------------------------------------------------

// Defined via vi.hoisted so it is initialized before the hoisted vi.mock
// factory below references it (a plain top-level class would not be).
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

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// firebase-admin mock — single shared, reconfigurable Firestore
// ---------------------------------------------------------------------------

interface MockDb {
  doc: ReturnType<typeof vi.fn>;
  collection: ReturnType<typeof vi.fn>;
  recursiveDelete: ReturnType<typeof vi.fn>;
}

const adminMock = vi.hoisted(() => {
  const db: MockDb = {
    doc: vi.fn(),
    collection: vi.fn(),
    recursiveDelete: vi.fn(() => Promise.resolve()),
  };
  return { db };
});

vi.mock("firebase-admin", () => {
  const FieldValue = {
    serverTimestamp: () => "TS",
    increment: (n: number) => ({ __inc: n }),
    arrayRemove: (...v: unknown[]) => ({ __arrayRemove: v }),
    arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
  };
  const firestore = Object.assign(() => adminMock.db, { FieldValue });
  return {
    initializeApp: vi.fn(),
    firestore,
    messaging: () => ({ sendEachForMulticast: vi.fn() }),
  };
});

// Import AFTER mocks are registered.
import { deletehousehold } from "./index";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type CallableHandler = (request: unknown) => Promise<unknown>;

function asCallable(fn: unknown): CallableHandler {
  return fn as CallableHandler;
}

const HOUSEHOLD_ID = "hh1";
const ADMIN_UID = "admin1";

interface MemberDocConfig {
  exists: boolean;
  role?: string;
}

/**
 * Configure db.doc() to return a member doc with the given existence/role for
 * the household-member path, and a generic doc otherwise. Returns the recorded
 * member doc ref so callers can assert against it.
 */
function configureMemberDoc(config: MemberDocConfig): { householdRef: { __path: string } } {
  const householdRef = { __path: `households/${HOUSEHOLD_ID}` };
  adminMock.db.doc.mockImplementation((path: string) => {
    if (path === `households/${HOUSEHOLD_ID}/members/${ADMIN_UID}`) {
      return {
        get: () =>
          Promise.resolve({
            exists: config.exists,
            data: () => (config.role ? { role: config.role } : {}),
          }),
      };
    }
    if (path === `households/${HOUSEHOLD_ID}`) {
      return householdRef;
    }
    return { get: () => Promise.resolve({ exists: false, data: () => undefined }) };
  });
  return { householdRef };
}

/** Configure the inviteCodes collection query to return the given doc refs. */
function configureInviteCodes(refs: Array<{ delete: ReturnType<typeof vi.fn> }>): void {
  adminMock.db.collection.mockImplementation((path: string) => {
    if (path === "inviteCodes") {
      return {
        where: () => ({
          get: () => Promise.resolve({ docs: refs.map((ref) => ({ ref })) }),
        }),
      };
    }
    return {
      where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
    };
  });
}

// ---------------------------------------------------------------------------
// Reset / defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.db.recursiveDelete.mockImplementation(() => Promise.resolve());
  configureMemberDoc({ exists: true, role: "admin" });
  configureInviteCodes([]);
});

// ===========================================================================
// deletehousehold
// ===========================================================================

describe("deletehousehold", () => {
  it("rejects unauthenticated requests", async () => {
    await expect(
      asCallable(deletehousehold)({ data: { householdId: HOUSEHOLD_ID } })
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(adminMock.db.recursiveDelete).not.toHaveBeenCalled();
  });

  it("rejects a missing householdId with invalid-argument", async () => {
    await expect(
      asCallable(deletehousehold)({ auth: { uid: ADMIN_UID }, data: {} })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(adminMock.db.recursiveDelete).not.toHaveBeenCalled();
  });

  it("rejects a non-string householdId with invalid-argument", async () => {
    await expect(
      asCallable(deletehousehold)({
        auth: { uid: ADMIN_UID },
        data: { householdId: 123 },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(adminMock.db.recursiveDelete).not.toHaveBeenCalled();
  });

  it("rejects with permission-denied when the member doc is missing", async () => {
    configureMemberDoc({ exists: false });
    await expect(
      asCallable(deletehousehold)({
        auth: { uid: ADMIN_UID },
        data: { householdId: HOUSEHOLD_ID },
      })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(adminMock.db.recursiveDelete).not.toHaveBeenCalled();
  });

  it("rejects with permission-denied when the caller is not an admin", async () => {
    configureMemberDoc({ exists: true, role: "member" });
    await expect(
      asCallable(deletehousehold)({
        auth: { uid: ADMIN_UID },
        data: { householdId: HOUSEHOLD_ID },
      })
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(adminMock.db.recursiveDelete).not.toHaveBeenCalled();
  });

  it("recursively deletes the household and its invite codes on the happy path", async () => {
    const { householdRef } = configureMemberDoc({ exists: true, role: "admin" });
    const inviteA = { delete: vi.fn(() => Promise.resolve()) };
    const inviteB = { delete: vi.fn(() => Promise.resolve()) };
    configureInviteCodes([inviteA, inviteB]);

    const result = await asCallable(deletehousehold)({
      auth: { uid: ADMIN_UID },
      data: { householdId: HOUSEHOLD_ID },
    });

    expect(result).toEqual({ success: true });
    // Recursively deleted the household document ref.
    expect(adminMock.db.recursiveDelete).toHaveBeenCalledTimes(1);
    expect(adminMock.db.recursiveDelete).toHaveBeenCalledWith(householdRef);
    // Each matching invite code was deleted.
    expect(inviteA.delete).toHaveBeenCalledTimes(1);
    expect(inviteB.delete).toHaveBeenCalledTimes(1);
  });

  it("succeeds when there are no invite codes to delete", async () => {
    configureMemberDoc({ exists: true, role: "admin" });
    configureInviteCodes([]);

    const result = await asCallable(deletehousehold)({
      auth: { uid: ADMIN_UID },
      data: { householdId: HOUSEHOLD_ID },
    });

    expect(result).toEqual({ success: true });
    expect(adminMock.db.recursiveDelete).toHaveBeenCalledTimes(1);
  });
});
