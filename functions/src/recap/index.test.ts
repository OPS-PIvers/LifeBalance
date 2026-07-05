/**
 * Tests for the `sendweeklyrecap` scheduled function.
 *
 * Follows the mocking conventions of `functions/src/index.test.ts`: firebase-admin,
 * firebase-functions/v2/scheduler, firebase-functions/params are all mocked.
 * Firestore is a small in-memory fake keyed entirely by full path strings
 * (matching how recap/index.ts addresses docs/collections: `db.collection(\`households/${id}/transactions\`)`,
 * `db.doc(\`households/${id}\`)`, and `householdDoc.ref.collection("members")`), supporting
 * the subset of the query API this module uses: `.where(field, op, value)` chains,
 * `.get()`, `.doc()`, `.update()`, and `db.batch()`.
 *
 * Time is pinned via fake timers to a known Sunday 17:00 instant in a known IANA
 * timezone so `isTimeToSend`/`isoWeekId` behave deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: () => Promise<void>) => handler,
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({
    value: () => "fake-gemini-key",
  }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const { generateContentMock, sendEachForMulticastMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  // Hoisted SINGLE instance: sendNotificationToUser calls admin.messaging()
  // itself, so the test and the code under test must observe the same mock fn
  // (a fresh vi.fn per messaging() call would make "not called" assertions
  // pass vacuously).
  sendEachForMulticastMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

// ---------------------------------------------------------------------------
// In-memory Firestore fake (path-keyed)
// ---------------------------------------------------------------------------

type DocData = Record<string, unknown>;

type WhereClause = { field: string; op: string; value: unknown };

function matches(data: DocData, clauses: WhereClause[]): boolean {
  return clauses.every(({ field, op, value }) => {
    const fieldValue = data[field];
    switch (op) {
      case "==":
        return fieldValue === value;
      case ">=":
        return (fieldValue as string) >= (value as string);
      case "<=":
        return (fieldValue as string) <= (value as string);
      case ">":
        return (fieldValue as string) > (value as string);
      default:
        throw new Error(`Unsupported where op: ${op}`);
    }
  });
}

class FakeStore {
  /** collectionPath -> (docId -> data) */
  private collections = new Map<string, Map<string, DocData>>();

  seedCollection(path: string, docs: Record<string, DocData>): void {
    const bucket = this.collections.get(path) ?? new Map<string, DocData>();
    for (const [id, data] of Object.entries(docs)) {
      bucket.set(id, data);
    }
    this.collections.set(path, bucket);
  }

  private ensure(path: string): Map<string, DocData> {
    if (!this.collections.has(path)) this.collections.set(path, new Map());
    return this.collections.get(path) as Map<string, DocData>;
  }

  collection = (path: string) => {
    return this.makeQuery(path, []);
  };

  private makeQuery = (path: string, clauses: WhereClause[]) => {
    const bucket = () => this.ensure(path);
    return {
      where: (field: string, op: string, value: unknown) =>
        this.makeQuery(path, [...clauses, { field, op, value }]),
      doc: (id: string) => this.makeDocRef(`${path}/${id}`),
      get: async () => {
        const entries = Array.from(bucket().entries()).filter(([, data]) => matches(data, clauses));
        return {
          docs: entries.map(([id, data]) => ({
            id,
            ref: this.makeDocRef(`${path}/${id}`),
            data: () => data,
          })),
        };
      },
    };
  };

  makeDocRef = (fullPath: string) => {
    const segments = fullPath.split("/");
    const id = segments[segments.length - 1] as string;
    const collectionPath = segments.slice(0, -1).join("/");
    return {
      id,
      __fullPath: fullPath,
      collection: (subPath: string) => this.makeQuery(`${fullPath}/${subPath}`, []),
      get: async () => {
        const data = this.ensure(collectionPath).get(id);
        return { exists: data !== undefined, data: () => data };
      },
      update: async (patch: DocData) => {
        const bucket = this.ensure(collectionPath);
        bucket.set(id, { ...(bucket.get(id) ?? {}), ...patch });
      },
    };
  };

  doc = (fullPath: string) => {
    return this.makeDocRef(fullPath);
  };

  getRaw(fullPath: string): DocData | undefined {
    const segments = fullPath.split("/");
    const id = segments[segments.length - 1] as string;
    const collectionPath = segments.slice(0, -1).join("/");
    return this.collections.get(collectionPath)?.get(id);
  }

  batch = () => {
    const ops: Array<() => void> = [];
    return {
      set: (ref: { __fullPath: string }, data: DocData) => {
        ops.push(() => {
          const segments = ref.__fullPath.split("/");
          const id = segments[segments.length - 1] as string;
          const collectionPath = segments.slice(0, -1).join("/");
          this.ensure(collectionPath).set(id, data);
        });
      },
      update: (ref: { __fullPath: string }, patch: DocData) => {
        ops.push(() => {
          const segments = ref.__fullPath.split("/");
          const id = segments[segments.length - 1] as string;
          const collectionPath = segments.slice(0, -1).join("/");
          const bucket = this.ensure(collectionPath);
          bucket.set(id, { ...(bucket.get(id) ?? {}), ...patch });
        });
      },
      commit: async () => {
        ops.forEach((op) => op());
      },
    };
  };
}

const fakeStoreHolder = vi.hoisted(() => ({ instance: null as unknown }));

vi.mock("firebase-admin", () => {
  return {
    firestore: () => fakeStoreHolder.instance,
    messaging: () => ({ sendEachForMulticast: sendEachForMulticastMock }),
  };
});

// Import AFTER mocks are registered.
import { sendweeklyrecap } from "./index";

const HOUSEHOLD_ID = "hh1";
// Sunday 2026-07-05, 17:00 in America/New_York = 21:00 UTC.
const PINNED_INSTANT = new Date("2026-07-05T21:00:00Z");

function freshMember(overrides: DocData = {}): DocData {
  return {
    uid: "u1",
    displayName: "Alex",
    fcmTokens: ["token1"],
    points: { daily: 0, weekly: 10, total: 10 },
    notificationPreferences: {
      timezone: "America/New_York",
      weeklyRecap: { enabled: true },
    },
    ...overrides,
  };
}

function seedHousehold(
  store: FakeStore,
  householdData: DocData = {},
  members: Record<string, DocData> = { u1: freshMember() }
): void {
  store.seedCollection("households", { [HOUSEHOLD_ID]: householdData });
  store.seedCollection(`households/${HOUSEHOLD_ID}/members`, members);
  store.seedCollection(`households/${HOUSEHOLD_ID}/transactions`, {});
  store.seedCollection(`households/${HOUSEHOLD_ID}/habits`, {});
  store.seedCollection(`households/${HOUSEHOLD_ID}/calendarItems`, {});
}

type SchedulerHandler = () => Promise<void>;

describe("sendweeklyrecap", () => {
  let store: FakeStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(PINNED_INSTANT);
    store = new FakeStore();
    fakeStoreHolder.instance = store;
    generateContentMock.mockResolvedValue({ text: "AI summary of your week." });
    sendEachForMulticastMock.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function run(): Promise<void> {
    return (sendweeklyrecap as unknown as SchedulerHandler)();
  }

  it("generates the recap doc and sets lastRecapWeek on first run (premium household, billingEnabled off)", async () => {
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    const household = store.getRaw(`households/${HOUSEHOLD_ID}`) as { lastRecapWeek?: string };
    expect(household.lastRecapWeek).toBe("2026-W27");

    const recap = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`) as {
      isoWeek: string;
      premium: boolean;
      narrativeSource: string;
    };
    expect(recap.isoWeek).toBe("2026-W27");
    expect(recap.premium).toBe(true);
    expect(recap.narrativeSource).toBe("ai");

    const member = store.getRaw(`households/${HOUSEHOLD_ID}/members/u1`) as { lastRecapSentWeek?: string };
    expect(member.lastRecapSentWeek).toBe("2026-W27");

    // The premium member's push was actually delivered, deep-linking the recap.
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    expect(sendEachForMulticastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ["token1"],
        data: expect.objectContaining({ type: "weekly_recap", url: "/?recap=2026-W27" }),
      })
    );
  });

  it("is a no-op for regeneration on a second run in the same iso week", async () => {
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();
    const recapAfterFirst = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`);
    generateContentMock.mockClear();

    await run();

    const recapAfterSecond = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`);
    expect(recapAfterSecond).toEqual(recapAfterFirst);
    // No new Gemini call was made for a regenerate that never happened.
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("does not send a duplicate push to a member already sent for this isoWeek", async () => {
    seedHousehold(store, {}, { u1: freshMember({ lastRecapSentWeek: "2026-W27" }) });
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it("falls back to the template narrative when Gemini fails, and the run still completes with a recap doc written", async () => {
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });
    generateContentMock.mockRejectedValue(new Error("upstream failure"));

    await expect(run()).resolves.toBeUndefined();

    const recap = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`) as { narrativeSource: string };
    expect(recap.narrativeSource).toBe("template");
  }, 35_000);

  it("writes a free-household recap with premium:false, template narrative, and sends NO push", async () => {
    seedHousehold(store, { subscription: { status: "canceled" } });
    store.seedCollection("app_config", { global: { billingEnabled: true } });

    await run();

    const recap = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`) as {
      premium: boolean;
      narrativeSource: string;
    };
    expect(recap.premium).toBe(false);
    expect(recap.narrativeSource).toBe("template");
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
    // The free path must never spend the Gemini key.
    expect(generateContentMock).not.toHaveBeenCalled();

    const member = store.getRaw(`households/${HOUSEHOLD_ID}/members/u1`) as { lastRecapSentWeek?: string };
    expect(member.lastRecapSentWeek).toBeUndefined();
  });
});
