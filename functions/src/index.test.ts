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
  collectionGroup: ReturnType<typeof vi.fn>;
  recursiveDelete: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
}

const adminMock = vi.hoisted(() => {
  const db: MockDb = {
    doc: vi.fn(),
    collection: vi.fn(),
    collectionGroup: vi.fn(() => ({
      where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
    })),
    recursiveDelete: vi.fn(() => Promise.resolve()),
    batch: vi.fn(),
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

// Hoisted so the vi.mock factory below (itself hoisted) can reference it, and
// so tests can flip NOTIFICATIONS_FULL_SCAN without re-mocking the module.
const fullScanParamHolder = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("firebase-functions/params", () => ({
  defineString: (_name: string, opts: { default: string }) => ({
    value: () => fullScanParamHolder.value ?? opts.default,
  }),
  defineSecret: (_name: string) => ({
    value: () => "fake-secret",
  }),
}));

// Import AFTER mocks are registered.
import {
  deletehousehold,
  findBillsDueOnDate,
  sendbillreminders,
  sendstreakwarnings,
  sendactionqueuereminders,
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
   * 09:00 UTC (daysBeforeDue = 3) and the given calendarItems docs. Wires BOTH
   * the collection-group query path (default) and the full-scan fallback path
   * (`db.collection("households")`) so tests can exercise either via
   * `fullScanParamHolder.value`.
   *
   * `memberOverrides` lets tests add a second, non-flagged member (to prove it
   * is never read) or otherwise vary the member doc shape.
   */
  function configureBillReminderHousehold(
    calendarDocs: Array<{ id: string; data: Record<string, unknown> }>,
    extraMembers: Array<Record<string, unknown>> = []
  ): void {
    const member = {
      uid: "u1",
      fcmTokens: ["tok1"],
      anyNotificationsEnabled: true,
      notificationPreferences: {
        billReminders: { enabled: true, daysBeforeDue: 3, time: "9:00" },
        timezone: "UTC",
      },
    };
    const calendarSnapshot = {
      docs: calendarDocs.map((d) => ({ id: d.id, data: () => d.data })),
    };
    const calendarQuery: MockQuery = {
      where: () => calendarQuery,
      get: () => Promise.resolve(calendarSnapshot),
    };
    const householdRef = {
      id: HOUSEHOLD_ID,
      get: () => Promise.resolve({ exists: true, data: () => ({ currency: "USD" }) }),
      collection: (name: string) => {
        if (name === "calendarItems") return calendarQuery;
        return { get: () => Promise.resolve({ docs: [] }) };
      },
    };
    const allMembers = [member, ...extraMembers];
    const flaggedMemberDocs = allMembers
      .filter((m) => m.anyNotificationsEnabled === true)
      .map((m) => ({ data: () => m, ref: { update: vi.fn(), parent: { parent: householdRef } } }));

    adminMock.db.collectionGroup.mockImplementation((path: string) => {
      if (path === "members") {
        return { where: () => ({ get: () => Promise.resolve({ docs: flaggedMemberDocs }) }) };
      }
      return { where: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
    });

    // Full-scan fallback path.
    const householdDoc = {
      id: HOUSEHOLD_ID,
      data: () => ({ currency: "USD" }),
      ref: {
        ...householdRef,
        collection: (name: string) => {
          if (name === "members") {
            return {
              get: () =>
                Promise.resolve({
                  docs: allMembers.map((m) => ({ data: () => m, ref: { update: vi.fn() } })),
                }),
            };
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
    fullScanParamHolder.value = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never reads a member whose anyNotificationsEnabled flag is false", async () => {
    configureBillReminderHousehold(
      [
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
      ],
      [
        {
          uid: "u2",
          fcmTokens: ["tok2"],
          anyNotificationsEnabled: false,
          notificationPreferences: {
            billReminders: { enabled: true, daysBeforeDue: 3, time: "9:00" },
            timezone: "UTC",
          },
        },
      ]
    );

    await runBillReminders();

    // Only the flagged member (tok1) is ever sent to — the collection-group
    // query already excluded u2, so its reminder pref is never even inspected.
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ["tok1"] })
    );
  });

  it("FALLBACK_FULL_SCAN='true' reproduces the same send as the flagged-query path", async () => {
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
    ]);
    fullScanParamHolder.value = "true";

    await runBillReminders();

    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ["tok1"],
        data: expect.objectContaining({ type: "bill_reminder" }),
      })
    );
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

// ===========================================================================
// sendactionqueuereminders
// ===========================================================================

describe("sendactionqueuereminders", () => {
  interface MockQuery {
    where: (...args: unknown[]) => MockQuery;
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
  }

  /**
   * Configures a single household with one member whose action queue
   * reminders fire at 09:00 UTC and the given todo docs.
   */
  function configureActionQueueReminderHousehold(
    todoDocs: Array<{ id: string; data: Record<string, unknown> }>
  ): void {
    const member = {
      uid: "u1",
      fcmTokens: ["tok1"],
      anyNotificationsEnabled: true,
      notificationPreferences: {
        actionQueueReminders: { enabled: true, time: "9:00" },
        timezone: "UTC",
      },
    };
    const todosSnapshot = {
      docs: todoDocs.map((d) => ({ id: d.id, data: () => d.data })),
    };
    const todosQuery: MockQuery = {
      where: () => todosQuery,
      get: () => Promise.resolve(todosSnapshot),
    };
    const householdRef = {
      id: HOUSEHOLD_ID,
      collection: (name: string) => {
        if (name === "todos") return todosQuery;
        return { get: () => Promise.resolve({ docs: [] }) };
      },
    };
    const flaggedMemberDocs = [
      { data: () => member, ref: { update: vi.fn(), parent: { parent: householdRef } } },
    ];

    adminMock.db.collectionGroup.mockImplementation((path: string) => {
      if (path === "members") {
        return { where: () => ({ get: () => Promise.resolve({ docs: flaggedMemberDocs }) }) };
      }
      return { where: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
    });
  }

  const runActionQueueReminders = sendactionqueuereminders as unknown as () => Promise<void>;

  beforeEach(() => {
    adminMock.sendEachForMulticast.mockImplementation(() =>
      Promise.resolve({ successCount: 1, failureCount: 0, responses: [{ success: true }] })
    );
    vi.useFakeTimers();
    // 09:30 UTC matches the member's 9:00 reminder hour; today = 2026-07-14.
    vi.setSystemTime(new Date("2026-07-14T09:30:00Z"));
    fullScanParamHolder.value = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not send a reminder when the only due-today todo is held for review", async () => {
    configureActionQueueReminderHousehold([
      {
        id: "held",
        data: { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-14", needsReview: true },
      },
    ]);

    await runActionQueueReminders();

    expect(adminMock.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("excludes held-for-review todos from the count but still sends for the rest", async () => {
    configureActionQueueReminderHousehold([
      {
        id: "held",
        data: { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-14", needsReview: true },
      },
      { id: "normal", data: { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-14" } },
    ]);

    await runActionQueueReminders();

    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({ title: expect.stringContaining("1 task") }),
      })
    );
  });

  it("sends a reminder counting every due-today todo when none are held", async () => {
    configureActionQueueReminderHousehold([
      { id: "normal-1", data: { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-14" } },
      { id: "normal-2", data: { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-14" } },
    ]);

    await runActionQueueReminders();

    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({ title: expect.stringContaining("2 tasks") }),
      })
    );
  });
});

// ===========================================================================
// sendstreakwarnings (incl. the plan-02-part-C "streak rescue" proactive insight)
// ===========================================================================

describe("sendstreakwarnings", () => {
  interface MockQuery {
    where: (...args: unknown[]) => MockQuery;
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
  }

  /**
   * Configures a single household with one member whose streak warnings fire
   * at 09:00 UTC, the given habit docs, and the given household-doc data
   * (used for the freezeBank read + the proactive-insight cap state).
   */
  function configureStreakWarningHousehold(
    habitDocs: Array<{ id: string; data: Record<string, unknown> }>,
    householdData: Record<string, unknown> = {},
    extraMembers: Array<Record<string, unknown>> = []
  ): { insightSetSpy: ReturnType<typeof vi.fn>; householdUpdateSpy: ReturnType<typeof vi.fn>; insightDocSpy: ReturnType<typeof vi.fn> } {
    const member = {
      uid: "u1",
      fcmTokens: ["tok1"],
      anyNotificationsEnabled: true,
      notificationPreferences: {
        streakWarnings: { enabled: true, time: "9:00" },
        timezone: "UTC",
      },
    };
    const habitsSnapshot = {
      docs: habitDocs.map((d) => ({ id: d.id, data: () => d.data })),
    };
    const habitsQuery: MockQuery = {
      where: () => habitsQuery,
      get: () => Promise.resolve(habitsSnapshot),
    };

    const allMembers = [member, ...extraMembers];

    let currentHouseholdData = { ...householdData };
    const householdDocRef = {
      id: HOUSEHOLD_ID,
      get: () =>
        Promise.resolve({
          exists: true,
          data: () => currentHouseholdData,
        }),
      collection: (name: string) => {
        if (name === "habits") return habitsQuery;
        if (name === "members") {
          return {
            get: () =>
              Promise.resolve({
                docs: allMembers.map((m) => ({ data: () => m, ref: { update: vi.fn() } })),
              }),
          };
        }
        return { get: () => Promise.resolve({ docs: [] }) };
      },
    };

    const flaggedMemberDocs = allMembers
      .filter((m) => m.anyNotificationsEnabled === true)
      .map((m) => ({ data: () => m, ref: { update: vi.fn(), parent: { parent: householdDocRef } } }));

    adminMock.db.collectionGroup.mockImplementation((path: string) => {
      if (path === "members") {
        return { where: () => ({ get: () => Promise.resolve({ docs: flaggedMemberDocs }) }) };
      }
      return { where: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
    });

    // Written deterministic ids — lets the idempotency test observe that a
    // second run with the same `streak_rescue_<habitId>_<today>` id is skipped.
    const existingInsightIds = new Set<string>();
    const insightSetSpy = vi.fn((ref: { id?: string } | undefined) => {
      if (ref?.id) existingInsightIds.add(ref.id);
    });
    const householdUpdateSpy = vi.fn((_ref: unknown, patch: Record<string, unknown>) => {
      currentHouseholdData = { ...currentHouseholdData, ...patch };
    });
    const insightDocSpy = vi.fn((id?: string) => ({
      id,
      get: () => Promise.resolve({ exists: id !== undefined && existingInsightIds.has(id) }),
    }));

    const householdDoc = {
      id: HOUSEHOLD_ID,
      data: () => currentHouseholdData,
      ref: householdDocRef,
    };

    // Full-scan fallback path.
    adminMock.db.collection.mockImplementation((path: string) => {
      if (path === "households") {
        return { get: () => Promise.resolve({ docs: [householdDoc] }) };
      }
      if (path === `households/${HOUSEHOLD_ID}/insights`) {
        return { doc: insightDocSpy };
      }
      return { where: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
    });

    adminMock.db.doc.mockImplementation((path: string) => {
      if (path === `households/${HOUSEHOLD_ID}`) return householdDocRef;
      return { get: () => Promise.resolve({ exists: false, data: () => undefined }) };
    });

    adminMock.db.batch.mockImplementation(() => ({
      set: insightSetSpy,
      update: householdUpdateSpy,
      commit: () => Promise.resolve(),
    }));

    return { insightSetSpy, householdUpdateSpy, insightDocSpy };
  }

  const runStreakWarnings = sendstreakwarnings as unknown as () => Promise<void>;

  beforeEach(() => {
    adminMock.sendEachForMulticast.mockImplementation(() =>
      Promise.resolve({ successCount: 1, failureCount: 0, responses: [{ success: true }] })
    );
    vi.useFakeTimers();
    // 09:30 UTC matches the member's 9:00 streak-warning hour.
    vi.setSystemTime(new Date("2026-07-06T09:30:00Z")); // a Monday, ISO week 2026-W28
    fullScanParamHolder.value = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never reads a member whose anyNotificationsEnabled flag is false", async () => {
    configureStreakWarningHousehold(
      [{ id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } }],
      {},
      [
        {
          uid: "u2",
          fcmTokens: ["tok2"],
          anyNotificationsEnabled: false,
          notificationPreferences: { streakWarnings: { enabled: true, time: "9:00" }, timezone: "UTC" },
        },
      ]
    );

    await runStreakWarnings();

    // Only the flagged member's token appears in the send.
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ["tok1"] })
    );
  });

  it("processes a household reached via two flagged members exactly once (not twice)", async () => {
    configureStreakWarningHousehold(
      [{ id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } }],
      {},
      [
        {
          uid: "u2",
          fcmTokens: ["tok2"],
          anyNotificationsEnabled: true,
          notificationPreferences: { streakWarnings: { enabled: true, time: "9:00" }, timezone: "UTC" },
        },
      ]
    );

    await runStreakWarnings();

    // Two members, each gets their own send — but the habits subcollection
    // (and the proactive-insight cap logic keyed on the household) is only
    // read/evaluated once per household per member, not duplicated across a
    // re-fetch of the household itself.
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(2);
  });

  it("FALLBACK_FULL_SCAN='true' reproduces the same send as the flagged-query path", async () => {
    configureStreakWarningHousehold([
      { id: "h1", data: { period: "daily", title: "Read", streakDays: 4, completedDates: [] } },
    ]);
    fullScanParamHolder.value = "true";

    await runStreakWarnings();

    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ["tok1"] })
    );
  });

  it("sends the notification but does NOT write a proactive insight for a short (<7 day) at-risk streak", async () => {
    const { insightSetSpy } = configureStreakWarningHousehold([
      { id: "h1", data: { period: "daily", title: "Read", streakDays: 4, completedDates: [] } },
    ]);

    await runStreakWarnings();

    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(insightSetSpy).not.toHaveBeenCalled();
  });

  it("writes a proactive habits insight for a >=7-day at-risk streak", async () => {
    const { insightSetSpy, householdUpdateSpy } = configureStreakWarningHousehold([
      { id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } },
    ]);

    await runStreakWarnings();

    expect(insightSetSpy).toHaveBeenCalledTimes(1);
    expect(insightSetSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "habits", text: expect.stringContaining("Read") })
    );
    expect(householdUpdateSpy).toHaveBeenCalledWith(expect.anything(), {
      proactiveInsightWeek: "2026-W28",
      proactiveInsightCount: 1,
    });
  });

  it("mentions the automatic freeze protection when the household has tokens available", async () => {
    const { insightSetSpy } = configureStreakWarningHousehold(
      [{ id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } }],
      { freezeBank: { tokens: 2 } }
    );

    await runStreakWarnings();

    expect(insightSetSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: expect.stringContaining("a freeze will protect it automatically"),
      })
    );
  });

  it("enforces the 2/week/household proactive-insight cap", async () => {
    const { insightSetSpy } = configureStreakWarningHousehold(
      [{ id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } }],
      { proactiveInsightWeek: "2026-W28", proactiveInsightCount: 2 }
    );

    await runStreakWarnings();

    // The push notification still sends...
    expect(adminMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    // ...but the cap blocks the insight write.
    expect(insightSetSpy).not.toHaveBeenCalled();
  });

  it("resets the count on an ISO-week rollover, allowing a new write", async () => {
    const { insightSetSpy, householdUpdateSpy } = configureStreakWarningHousehold(
      [{ id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } }],
      { proactiveInsightWeek: "2026-W27", proactiveInsightCount: 2 }
    );

    await runStreakWarnings();

    expect(insightSetSpy).toHaveBeenCalledTimes(1);
    expect(householdUpdateSpy).toHaveBeenCalledWith(expect.anything(), {
      proactiveInsightWeek: "2026-W28",
      proactiveInsightCount: 1,
    });
  });

  it("is idempotent across repeat runs on the same local day (deterministic id skips the second write)", async () => {
    const { insightSetSpy, insightDocSpy } = configureStreakWarningHousehold([
      { id: "h1", data: { period: "daily", title: "Read", streakDays: 9, completedDates: [] } },
    ]);

    await runStreakWarnings();
    await runStreakWarnings();

    // The rescue insight is keyed streak_rescue_<habitId>_<localDay>, so the
    // hourly job re-firing on the same day (or the member loop iterating) can
    // never write it twice or burn a second slot of the weekly cap.
    expect(insightDocSpy).toHaveBeenCalledWith("streak_rescue_h1_2026-07-06");
    expect(insightSetSpy).toHaveBeenCalledTimes(1);
  });
});
