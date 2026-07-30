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
 * Time is pinned via fake timers to a known MONDAY 07:00 instant in a known IANA
 * timezone — the ceremony's generation moment — so `isTimeToSend`/`isoWeekId`
 * behave deterministically. The week the run DESCRIBES is the one that closed
 * the day before; see `CLOSED_WEEK` / `CURRENT_WEEK` below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: () => Promise<void>) => handler,
}));

// Hoisted so the vi.mock factory below (itself hoisted) can reference it, and
// so a test can flip NOTIFICATIONS_FULL_SCAN without re-mocking the module.
const fullScanParamHolder = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({
    value: () => "fake-gemini-key",
  }),
  defineString: (_name: string, opts: { default: string }) => ({
    value: () => fullScanParamHolder.value ?? opts.default,
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

  /**
   * Minimal fake for `db.collectionGroup("members")`: scans every seeded
   * collection whose path ends in `/members` (or is exactly "members"),
   * applies the `.where()` clauses, and returns docs whose `ref` exposes
   * `parent.parent` pointing at the owning household doc ref — mirroring the
   * real Firestore collection-group doc ref shape that
   * `loadNotifiableMembersByHousehold` relies on.
   */
  collectionGroup = (collectionId: string) => {
    return this.makeGroupQuery(collectionId, []);
  };

  private makeGroupQuery = (collectionId: string, clauses: WhereClause[]) => {
    return {
      where: (field: string, op: string, value: unknown) =>
        this.makeGroupQuery(collectionId, [...clauses, { field, op, value }]),
      get: async () => {
        const docs: Array<{ id: string; ref: unknown; data: () => DocData }> = [];
        for (const [path, bucket] of this.collections.entries()) {
          const segments = path.split("/");
          if (segments[segments.length - 1] !== collectionId) continue;
          for (const [id, data] of bucket.entries()) {
            if (!matches(data, clauses)) continue;
            docs.push({ id, ref: this.makeDocRef(`${path}/${id}`), data: () => data });
          }
        }
        return { docs };
      },
    };
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
    // Parent doc ref (one level up from the containing collection), e.g. for
    // "households/hh1/members/u1" -> the "households/hh1" doc ref. Undefined
    // for top-level docs (collectionPath has no further "/").
    const parentDocSegments = collectionPath.split("/");
    const parentDocPath = parentDocSegments.slice(0, -1).join("/");
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
      // Mirrors the real Firestore DocumentReference shape enough for
      // loadNotifiableMembersByHousehold's `memberDoc.ref.parent.parent`.
      parent: {
        parent: parentDocPath ? this.makeDocRef(parentDocPath) : undefined,
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
// MONDAY 2026-07-06, 07:00 in America/New_York = 11:00 UTC — the ceremony's
// generation moment (stage 5). The week it describes is the one that just
// CLOSED: Mon 2026-06-29 → Sun 2026-07-05, i.e. ISO week 2026-W27. Every
// expectation below is anchored to that week, never to the week the pinned
// instant itself falls in (2026-W28) — naming the recap after "now" is exactly
// the off-by-one the Monday move introduced.
const PINNED_INSTANT = new Date("2026-07-06T11:00:00Z");
/** The ISO week the pinned instant's run describes. */
const CLOSED_WEEK = "2026-W27";
/** The ISO week the pinned instant itself falls in — must never be used as an id. */
const CURRENT_WEEK = "2026-W28";

function freshMember(overrides: DocData = {}): DocData {
  return {
    uid: "u1",
    displayName: "Alex",
    fcmTokens: ["token1"],
    points: { daily: 0, weekly: 10, total: 10 },
    // Plan 06 PR-2: sendweeklyrecap now sources its household list from the
    // anyNotificationsEnabled collection-group query, so every seeded member
    // must carry the flag to be considered at all.
    anyNotificationsEnabled: true,
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
    fullScanParamHolder.value = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function run(): Promise<void> {
    return (sendweeklyrecap as unknown as SchedulerHandler)();
  }

  it("never generates/sends for a household whose only member has anyNotificationsEnabled: false", async () => {
    seedHousehold(store, {}, { u1: freshMember({ anyNotificationsEnabled: false }) });
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    // Documented tradeoff: no recap doc is generated when no member is
    // flagged, since generation piggybacks on the same flagged member list.
    expect(store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`)).toBeUndefined();
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it("processes a household reached via two flagged members exactly once (single recap doc, two pushes)", async () => {
    seedHousehold(store, {}, {
      u1: freshMember(),
      u2: freshMember({ uid: "u2", displayName: "Sam", fcmTokens: ["token2"] }),
    });
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    // Single recap doc for the household, not duplicated.
    expect(store.getRaw(`households/${HOUSEHOLD_ID}/recaps/2026-W27`)).toBeDefined();
    // Both flagged members received their own push.
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(2);
  });

  it("FALLBACK_FULL_SCAN='true' reproduces the same generation/send as the flagged-query path", async () => {
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });
    fullScanParamHolder.value = "true";

    await run();

    const household = store.getRaw(`households/${HOUSEHOLD_ID}`) as { lastRecapWeek?: string };
    expect(household.lastRecapWeek).toBe("2026-W27");
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

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

  // -------------------------------------------------------------------------
  // Monday-morning generation (per-member points, stage 5)
  // -------------------------------------------------------------------------

  it("names the recap after the week that CLOSED, not the week the run falls in", async () => {
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    expect(store.getRaw(`households/${HOUSEHOLD_ID}/recaps/${CLOSED_WEEK}`)).toBeDefined();
    expect(store.getRaw(`households/${HOUSEHOLD_ID}/recaps/${CURRENT_WEEK}`)).toBeUndefined();
    const household = store.getRaw(`households/${HOUSEHOLD_ID}`) as { lastRecapWeek?: string };
    expect(household.lastRecapWeek).toBe(CLOSED_WEEK);
    expect(sendEachForMulticastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: `/?recap=${CLOSED_WEEK}` }),
      })
    );
  });

  it("does NOT fire at the old Sunday 17:00 slot", async () => {
    // Sunday 2026-07-05, 17:00 America/New_York = 21:00 UTC — the pre-stage-5
    // trigger. The week is not closed yet, so nothing may be generated.
    vi.setSystemTime(new Date("2026-07-05T21:00:00Z"));
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    expect(store.getRaw(`households/${HOUSEHOLD_ID}/recaps/${CLOSED_WEEK}`)).toBeUndefined();
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it("does NOT fire at a non-Monday morning", async () => {
    // Tuesday 2026-07-07, 07:00 America/New_York = 11:00 UTC.
    vi.setSystemTime(new Date("2026-07-07T11:00:00Z"));
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    expect(store.getRaw(`households/${HOUSEHOLD_ID}`)).toEqual({});
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it("writes the household's ceremonyTone onto the recap and frames the template with it", async () => {
    seedHousehold(store, { ceremonyTone: "podium", subscription: { status: "canceled" } });
    store.seedCollection("app_config", { global: { billingEnabled: true } });
    store.seedCollection(`households/${HOUSEHOLD_ID}/habits`, {
      h1: {
        title: "Morning walk",
        period: "daily",
        type: "positive",
        basePoints: 10,
        scoringType: "threshold",
        targetCount: 1,
        streakDays: 7,
        completedDates: ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"],
        completedBy: {
          "2026-06-29": { u1: 1, u2: 1 },
          "2026-06-30": { u1: 1 },
          "2026-07-01": { u1: 1 },
          "2026-07-02": { u1: 1 },
        },
      },
    });

    await run();

    const recap = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/${CLOSED_WEEK}`) as {
      ceremonyTone: string;
      memberFacts: Array<{ memberId: string; points: number }>;
      dailyPoints: Array<{ date: string; total: number }>;
      totalPoints: number;
    };
    expect(recap.ceremonyTone).toBe("podium");
    expect(recap.dailyPoints).toHaveLength(7);
    expect(recap.dailyPoints[0]?.date).toBe("2026-06-29");
    expect(recap.memberFacts.map((f) => f.memberId)).toEqual(["u1"]);
    expect(recap.totalPoints).toBeGreaterThan(0);
  });

  it("defaults an absent ceremonyTone to household_first on the written doc", async () => {
    seedHousehold(store);
    store.seedCollection("app_config", { global: { billingEnabled: false } });

    await run();

    const recap = store.getRaw(`households/${HOUSEHOLD_ID}/recaps/${CLOSED_WEEK}`) as {
      ceremonyTone: string;
    };
    expect(recap.ceremonyTone).toBe("household_first");
  });
});
