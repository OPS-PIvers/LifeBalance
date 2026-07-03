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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
  const sendEachForMulticast = vi.fn();
  return { db, sendEachForMulticast };
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
    messaging: () => ({ sendEachForMulticast: adminMock.sendEachForMulticast }),
  };
});

// Import AFTER mocks are registered.
import {
  deletehousehold,
  findBillsDueOnDate,
  sendbillreminders,
  type BillCalendarItem,
} from "./index";

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

// ===========================================================================
// findBillsDueOnDate (recurring bill expansion for sendbillreminders)
// ===========================================================================

describe("findBillsDueOnDate", () => {
  const monthlyRent: BillCalendarItem = {
    id: "rent",
    date: "2026-01-01",
    isRecurring: true,
    frequency: "monthly",
    isPaid: false,
    amount: 1200,
  };

  it("matches a recurring monthly bill on occurrences AFTER the anchor date", () => {
    // The template's stored `date` stays at the anchor forever; a raw string
    // comparison would only ever match 2026-01-01.
    expect(findBillsDueOnDate([monthlyRent], "2026-02-01")).toHaveLength(1);
    expect(findBillsDueOnDate([monthlyRent], "2026-03-01")).toHaveLength(1);
    expect(findBillsDueOnDate([monthlyRent], "2026-01-01")).toHaveLength(1);
  });

  it("does not match dates that are not occurrences", () => {
    expect(findBillsDueOnDate([monthlyRent], "2026-02-02")).toHaveLength(0);
    // Never before the anchor.
    expect(findBillsDueOnDate([monthlyRent], "2025-12-01")).toHaveLength(0);
  });

  it("clamps monthly occurrences to month-end from the anchor (Jan 31 -> Feb 28 -> Mar 31)", () => {
    const bill: BillCalendarItem = {
      id: "b1",
      date: "2026-01-31",
      isRecurring: true,
      frequency: "monthly",
    };
    expect(findBillsDueOnDate([bill], "2026-02-28")).toHaveLength(1);
    expect(findBillsDueOnDate([bill], "2026-03-31")).toHaveLength(1);
    // Clamping must derive from the anchor, not compound from Feb 28.
    expect(findBillsDueOnDate([bill], "2026-03-28")).toHaveLength(0);
  });

  it("matches weekly and bi-weekly occurrences", () => {
    const weekly: BillCalendarItem = {
      id: "w1",
      date: "2026-06-01",
      isRecurring: true,
      frequency: "weekly",
    };
    const biweekly: BillCalendarItem = {
      id: "bw1",
      date: "2026-06-01",
      isRecurring: true,
      frequency: "bi-weekly",
    };
    expect(findBillsDueOnDate([weekly], "2026-06-08")).toHaveLength(1);
    expect(findBillsDueOnDate([weekly], "2026-06-09")).toHaveLength(0);
    expect(findBillsDueOnDate([biweekly], "2026-06-15")).toHaveLength(1);
    expect(findBillsDueOnDate([biweekly], "2026-06-08")).toHaveLength(0);
  });

  it("suppresses occurrences covered by a paid or deleted instance doc", () => {
    const paidInstance: BillCalendarItem = {
      id: "rent_instance_2026-02-01",
      date: "2026-02-01",
      isPaid: true,
      parentRecurringId: "rent",
      amount: 1200,
    };
    const deletedInstance: BillCalendarItem = {
      id: "rent_instance_2026-03-01",
      date: "2026-03-01",
      isDeleted: true,
      parentRecurringId: "rent",
    };
    const items = [monthlyRent, paidInstance, deletedInstance];
    expect(findBillsDueOnDate(items, "2026-02-01")).toHaveLength(0);
    expect(findBillsDueOnDate(items, "2026-03-01")).toHaveLength(0);
    // The next uncovered occurrence is still due.
    expect(findBillsDueOnDate(items, "2026-04-01")).toHaveLength(1);
  });

  it("matches non-recurring bills only on their exact date and only when unpaid", () => {
    const oneOff: BillCalendarItem = { id: "o1", date: "2026-02-01", amount: 50 };
    const paidOneOff: BillCalendarItem = {
      id: "o2",
      date: "2026-02-01",
      isPaid: true,
    };
    expect(findBillsDueOnDate([oneOff, paidOneOff], "2026-02-01")).toEqual([
      oneOff,
    ]);
    expect(findBillsDueOnDate([oneOff], "2026-02-02")).toHaveLength(0);
  });
});

// ===========================================================================
// sendbillreminders (scheduled handler wiring)
// ===========================================================================

describe("sendbillreminders", () => {
  interface MockQuery {
    where: (...args: unknown[]) => MockQuery;
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
  }

  /**
   * Configure a single household with one member whose bill reminders fire at
   * 09:00 UTC (daysBeforeDue = 3) and the given calendarItems docs.
   */
  function configureBillReminderHousehold(
    calendarDocs: Array<{ id: string; data: Record<string, unknown> }>
  ): void {
    const member = {
      uid: "u1",
      fcmTokens: ["tok1"],
      notificationPreferences: {
        billReminders: { enabled: true, daysBeforeDue: 3, time: "9:00" },
        timezone: "UTC",
      },
    };
    const membersSnapshot = {
      docs: [{ data: () => member, ref: { update: vi.fn() } }],
    };
    const calendarSnapshot = {
      docs: calendarDocs.map((d) => ({ id: d.id, data: () => d.data })),
    };
    const calendarQuery: MockQuery = {
      where: () => calendarQuery,
      get: () => Promise.resolve(calendarSnapshot),
    };
    const householdDoc = {
      id: HOUSEHOLD_ID,
      data: () => ({ currency: "USD" }),
      ref: {
        collection: (name: string) => {
          if (name === "members") {
            return { get: () => Promise.resolve(membersSnapshot) };
          }
          if (name === "calendarItems") return calendarQuery;
          return { get: () => Promise.resolve({ docs: [] }) };
        },
      },
    };
    adminMock.db.collection.mockImplementation((path: string) => {
      if (path === "households") {
        return { get: () => Promise.resolve({ docs: [householdDoc] }) };
      }
      return { where: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
    });
  }

  const runBillReminders = sendbillreminders as unknown as () => Promise<void>;

  beforeEach(() => {
    adminMock.sendEachForMulticast.mockImplementation(() =>
      Promise.resolve({ successCount: 1, failureCount: 0, responses: [{ success: true }] })
    );
    vi.useFakeTimers();
    // 09:30 UTC matches the member's 9:00 reminder hour; today = 2026-02-26,
    // so with daysBeforeDue = 3 the target date is 2026-03-01.
    vi.setSystemTime(new Date("2026-02-26T09:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a reminder for a LATER occurrence of a recurring bill (not just the anchor)", async () => {
    configureBillReminderHousehold([
      {
        id: "rent",
        data: {
          type: "expense",
          date: "2026-01-01", // anchor; occurrence due 2026-03-01
          isRecurring: true,
          frequency: "monthly",
          isPaid: false,
          amount: 1200,
        },
      },
    ]);

    await runBillReminders();

    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ["tok1"],
        data: expect.objectContaining({ type: "bill_reminder" }),
      })
    );
  });

  it("does not send a reminder when the target occurrence was already paid", async () => {
    configureBillReminderHousehold([
      {
        id: "rent",
        data: {
          type: "expense",
          date: "2026-01-01",
          isRecurring: true,
          frequency: "monthly",
          isPaid: false,
          amount: 1200,
        },
      },
      {
        id: "rent_instance_2026-03-01",
        data: {
          type: "expense",
          date: "2026-03-01",
          isPaid: true,
          parentRecurringId: "rent",
          amount: 1200,
        },
      },
    ]);

    await runBillReminders();

    expect(adminMock.sendEachForMulticast).not.toHaveBeenCalled();
  });
});
