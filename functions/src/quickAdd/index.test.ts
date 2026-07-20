/**
 * HTTP-layer tests for the quickAdd Cloud Function endpoints.
 *
 * These are picked up by the ROOT Vitest runner (vite.config.ts has no `include`
 * restriction for `test`), exactly like habitProcessor.test.ts. Unlike that file,
 * `index.ts` imports firebase-admin and firebase-functions at module load, so we
 * mock both:
 *   - `onRequest(opts, handler)` is mocked to return the raw handler so we can
 *     call it directly as `(req, res) => Promise<void>`.
 *   - `firebase-admin` exposes a single shared, reconfigurable mock Firestore that
 *     both `index.ts` and `apiKeyValidation.ts` bind to at module load.
 *
 * `validateApiKey` / `checkRateLimit` / `logApiCall` are the REAL functions from
 * apiKeyValidation.ts — they run against the mock db, so we drive their branches
 * by configuring the db method return values per test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// firebase-functions mocks
// ---------------------------------------------------------------------------

vi.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
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
  collectionGroup: ReturnType<typeof vi.fn>;
  doc: ReturnType<typeof vi.fn>;
  collection: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
  runTransaction: ReturnType<typeof vi.fn>;
}

const adminMock = vi.hoisted(() => {
  const db: MockDb = {
    collectionGroup: vi.fn(),
    doc: vi.fn(),
    collection: vi.fn(),
    batch: vi.fn(),
    runTransaction: vi.fn(),
  };
  return { db };
});

vi.mock("firebase-admin", () => {
  const FieldValue = {
    serverTimestamp: () => "TS",
    increment: (n: number) => ({ __inc: n }),
  };
  const Timestamp = {
    fromMillis: (ms: number) => ({ __ts: ms }),
  };
  const firestore = Object.assign(() => adminMock.db, { FieldValue, Timestamp });
  return { firestore };
});

// Import AFTER mocks are registered. Functions use relative imports.
import {
  quickAddHabit,
  quickAddExpense,
  quickAddShoppingItem,
  quickAddNaturalLanguage,
  quickAddBillPay,
  quickAddTodo,
} from "./index";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type Handler = (req: unknown, res: unknown) => Promise<void>;

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

interface ReqOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function makeReq(opts: ReqOpts = {}): unknown {
  return {
    method: opts.method ?? "POST",
    headers: opts.headers ?? { authorization: VALID_AUTH },
    body: opts.body ?? {},
  };
}

// A well-formed key: lb_{6 alnum}_{32 hex}
const VALID_KEY = "lb_abcdef_0123456789abcdef0123456789abcdef";
const VALID_AUTH = `Bearer ${VALID_KEY}`;

const ALL_PERMS = {
  habits: true,
  expenses: true,
  shoppingList: true,
  receiptScanning: true,
};

// Cast through unknown to satisfy the handler's (req, res) signature in tests.
function asHandler(fn: unknown): Handler {
  return fn as Handler;
}

// ---------------------------------------------------------------------------
// Mock configuration helpers
// ---------------------------------------------------------------------------

const HOUSEHOLD_ID = "hh1";

/** Configure validateApiKey's collectionGroup query to return a valid active key. */
function configureValidKey(
  permissions: Record<string, boolean> = ALL_PERMS
): void {
  const keyDoc = {
    id: "key1",
    data: () => ({ permissions, createdBy: "user1", status: "active" }),
    ref: {
      parent: { parent: { id: HOUSEHOLD_ID } },
      update: vi.fn(() => Promise.resolve()),
    },
  };
  const snapshot = { empty: false, docs: [keyDoc] };
  adminMock.db.collectionGroup.mockReturnValue({
    where: () => ({
      where: () => ({
        limit: () => ({
          get: () => Promise.resolve(snapshot),
        }),
      }),
    }),
  });
}

/** Configure the collectionGroup query to return an empty snapshot (revoked/missing key). */
function configureEmptyKey(): void {
  const snapshot = { empty: true, docs: [] };
  adminMock.db.collectionGroup.mockReturnValue({
    where: () => ({
      where: () => ({
        limit: () => ({
          get: () => Promise.resolve(snapshot),
        }),
      }),
    }),
  });
}

/**
 * Configure checkRateLimit's runTransaction to allow (default) or reject (429).
 * Allowed: txn.get() returns an empty doc (first request).
 * Rejected: txn.get() returns a doc with count >= the per-type limit.
 */
function configureRateLimit(allowed: boolean): void {
  adminMock.db.runTransaction.mockImplementation(
    async (cb: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: () =>
          Promise.resolve({
            data: () =>
              allowed
                ? undefined
                : { count: 100000, windowStart: Date.now() },
          }),
        set: vi.fn(),
        update: vi.fn(),
      };
      return cb(txn);
    }
  );
}

/** Configure checkRateLimit's runTransaction to throw (Firestore error → must fail closed). */
function configureRateLimitError(): void {
  adminMock.db.runTransaction.mockRejectedValue(
    new Error("firestore unavailable")
  );
}

/** logApiCall writes to db.collection('logs/api_calls/requests').add(...). */
const logAddMock = vi.fn(() => Promise.resolve({ id: "log1" }));

/**
 * Generic db.collection() router. Returns an object whose `.add`, `.where`,
 * and `.doc` are configurable via the per-test overrides map keyed by path.
 */
interface CollectionOverride {
  add?: ReturnType<typeof vi.fn>;
  whereGetDocs?: unknown[];
  /** Docs returned by an un-filtered `.get()` on the collection ref (full scan). */
  getDocs?: unknown[];
  /** Docs returned by `.where('titleLower', '==', ...).limit(1).get()` (indexed exact match). */
  whereLimitDocs?: unknown[];
}

let collectionOverrides: Record<string, CollectionOverride> = {};

function configureCollections(): void {
  adminMock.db.collection.mockImplementation((path: string) => {
    if (path === "logs/api_calls/requests") {
      return { add: logAddMock };
    }
    const override = collectionOverrides[path] ?? {};
    const add = override.add ?? vi.fn(() => Promise.resolve({ id: "new1" }));
    const docs = override.whereGetDocs ?? [];
    const scanDocs = override.getDocs ?? [];
    const limitDocs = override.whereLimitDocs ?? [];
    return {
      add,
      doc: () => ({ id: "preallocated1" }),
      get: () => Promise.resolve({ docs: scanDocs }),
      where: () => ({
        get: () => Promise.resolve({ docs }),
        limit: () => ({
          get: () => Promise.resolve({ docs: limitDocs, empty: limitDocs.length === 0 }),
        }),
      }),
    };
  });
}

/** db.doc() router for arbitrary paths. */
interface DocOverride {
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}
let docOverrides: Record<string, DocOverride> = {};

function configureDocs(): void {
  adminMock.db.doc.mockImplementation((path: string) => {
    const override = docOverrides[path] ?? {};
    return {
      id: path.split("/").pop() ?? path,
      get:
        override.get ??
        vi.fn(() => Promise.resolve({ exists: false, data: () => undefined })),
      update: override.update ?? vi.fn(() => Promise.resolve()),
    };
  });
}

/** db.batch() returns a recording batch. */
let lastBatch: {
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
};

function configureBatch(): void {
  adminMock.db.batch.mockImplementation(() => {
    lastBatch = {
      update: vi.fn(),
      set: vi.fn(),
      commit: vi.fn(() => Promise.resolve()),
    };
    return lastBatch;
  });
}

// A non-stale daily habit fixture (lastUpdated = now → isHabitStale false).
function nonStaleHabitData(): Record<string, unknown> {
  return {
    title: "Read",
    category: "Health",
    type: "positive",
    basePoints: 10,
    scoringType: "threshold",
    period: "daily",
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reset / defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  collectionOverrides = {};
  docOverrides = {};
  configureValidKey();
  configureRateLimit(true);
  configureCollections();
  configureDocs();
  configureBatch();
});

// ===========================================================================
// COMMON HTTP-layer behavior (quickAddHabit representative + spot checks)
// ===========================================================================

describe("quickAdd common HTTP-layer behavior", () => {
  it("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  it("non-POST (GET) returns 405 METHOD_NOT_ALLOWED", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });

  it("request with no Origin header gets no CORS headers but still succeeds (iOS Shortcuts/curl)", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ method: "OPTIONS", headers: { authorization: VALID_AUTH } }),
      res
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("request from the allowlisted production origin gets a matching Access-Control-Allow-Origin", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({
        method: "OPTIONS",
        headers: { authorization: VALID_AUTH, origin: "https://lifebalance-26080.web.app" },
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(
      "https://lifebalance-26080.web.app"
    );
    expect(res.headers["Vary"]).toBe("Origin");
  });

  it("request from a non-allowlisted origin gets no Access-Control-Allow-Origin header", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({
        method: "OPTIONS",
        headers: { authorization: VALID_AUTH, origin: "https://evil.example.com" },
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("missing Authorization header returns 401 UNAUTHORIZED", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("invalid key format returns 401 (validateApiKey rejects)", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ headers: { authorization: "Bearer garbage" } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("well-formed key not found / revoked returns 401", async () => {
    configureEmptyKey();
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "h1" } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("valid key without habits permission returns 403 FORBIDDEN", async () => {
    configureValidKey({ ...ALL_PERMS, habits: false });
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "h1" } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("rate limit exceeded returns 429 RATE_LIMITED and sets Retry-After", async () => {
    configureRateLimit(false);
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "h1" } }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("rate-limit check ERROR fails CLOSED (429), never open", async () => {
    // A Firestore error during the limit check must DENY the request, not grant
    // it — otherwise the public endpoints could be flooded by inducing errors.
    configureRateLimitError();
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "h1" } }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("expense endpoint also rejects non-POST with 405", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(makeReq({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });

  it("shopping endpoint also handles OPTIONS with 204", async () => {
    const res = makeRes();
    await asHandler(quickAddShoppingItem)(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });
});

// ===========================================================================
// quickAddHabit — validation + happy path
// ===========================================================================

describe("quickAddHabit validation & happy path", () => {
  it("neither habitId nor habitName returns 400 BAD_REQUEST", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("habitId with invalid characters returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "bad/id" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("habitName too long (>100) returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ body: { habitName: "x".repeat(101) } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("invalid direction returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ body: { habitId: "h1", direction: "sideways" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("habit not found returns 404 NOT_FOUND without echoing the lookup input", async () => {
    docOverrides[`households/${HOUSEHOLD_ID}/habits/h1`] = {
      get: vi.fn(() => Promise.resolve({ exists: false })),
    };
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "h1" } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect((res.body as { message: string }).message).not.toContain("h1");
  });

  it("happy path toggles habit up, commits batch, updates habit + household points", async () => {
    docOverrides[`households/${HOUSEHOLD_ID}/habits/h1`] = {
      get: vi.fn(() =>
        Promise.resolve({ exists: true, id: "h1", data: () => nonStaleHabitData() })
      ),
      update: vi.fn(() => Promise.resolve()),
    };
    const res = makeRes();
    await asHandler(quickAddHabit)(makeReq({ body: { habitId: "h1" } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    // Batch committed once.
    expect(lastBatch.commit).toHaveBeenCalledTimes(1);
    // Two updates: the habit ref and the household ref (pointsChange = +10 != 0).
    expect(lastBatch.update).toHaveBeenCalledTimes(2);
  });

  it("habitName resolves via the indexed titleLower exact match, skipping the full scan", async () => {
    const habitsPath = `households/${HOUSEHOLD_ID}/habits`;
    collectionOverrides[habitsPath] = {
      // whereLimitDocs backs the titleLower exact-match query. getDocs (the
      // full-scan fallback) is deliberately left empty — if the code fell
      // through to the fuzzy scan it would find nothing and 404, so a 200
      // here proves the indexed path was used.
      whereLimitDocs: [
        { id: "h1", data: () => nonStaleHabitData() },
      ],
      getDocs: [],
    };
    configureCollections();
    docOverrides[`households/${HOUSEHOLD_ID}/habits/h1`] = {
      get: vi.fn(() =>
        Promise.resolve({ exists: true, id: "h1", data: () => nonStaleHabitData() })
      ),
      update: vi.fn(() => Promise.resolve()),
    };

    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ body: { habitName: "  Read  " } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it("habitName falls back to the fuzzy full-scan when no titleLower exact match exists", async () => {
    const habitsPath = `households/${HOUSEHOLD_ID}/habits`;
    collectionOverrides[habitsPath] = {
      whereLimitDocs: [], // no indexed exact match (un-backfilled doc)
      getDocs: [
        { id: "h1", data: () => nonStaleHabitData() },
      ],
    };
    configureCollections();
    docOverrides[`households/${HOUSEHOLD_ID}/habits/h1`] = {
      get: vi.fn(() =>
        Promise.resolve({ exists: true, id: "h1", data: () => nonStaleHabitData() })
      ),
      update: vi.fn(() => Promise.resolve()),
    };

    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ body: { habitName: "Read" } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it("habitName with no exact or fuzzy match returns 404", async () => {
    const habitsPath = `households/${HOUSEHOLD_ID}/habits`;
    collectionOverrides[habitsPath] = { whereLimitDocs: [], getDocs: [] };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddHabit)(
      makeReq({ body: { habitName: "Nonexistent" } }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

// ===========================================================================
// quickAddExpense
// ===========================================================================

describe("quickAddExpense", () => {
  it("missing amount returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { merchant: "Coffee" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("NaN amount returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: "not a number", merchant: "Coffee" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("currency string '$50.00' is parsed to 50 and a transaction is added", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: "$50.00", merchant: "Coffee" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { amount: 50 } });
    expect(add).toHaveBeenCalledTimes(1);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(50);
    expect(txData.status).toBe("pending_review");
    expect(txData.source).toBe("shortcut");
  });

  it("accounting notation '(50.00)' is stored as abs 50", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: "(50.00)", merchant: "Coffee" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ data: { amount: 50 } });
  });

  // --- Bank-notification reconciliation (fromBankNotification) ---

  /** Build a query-snapshot doc for the recent-transactions reconcile lookup. */
  function txDoc(id: string, data: Record<string, unknown>) {
    return {
      id,
      ref: { update: vi.fn(() => Promise.resolve()) },
      data: () => data,
    };
  }

  it("fromBankNotification fills the lone $0 stub (cross-merchant, time-only) instead of adding a row", async () => {
    const stub = txDoc("stub1", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Loews Sapphire Falls Fb",
      needsAmount: true,
    });
    const add = vi.fn(() => Promise.resolve({ id: "txNew" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add,
      whereGetDocs: [stub],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: {
          amount: 13.31,
          merchant: "Amatista Cookhouse",
          fromBankNotification: true,
        },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      merged: true,
      data: { transactionId: "stub1", amount: 13.31 },
    });
    // Filled the stub; did NOT create a new transaction.
    expect(stub.ref.update).toHaveBeenCalledTimes(1);
    const updates = stub.ref.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updates).toMatchObject({
      amount: 13.31,
      merchant: "Amatista Cookhouse",
      needsAmount: false,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it("fromBankNotification does NOT merge when two unfilled stubs are present (creates a row)", async () => {
    const s1 = txDoc("s1", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Loews Sapphire Falls Fb",
      needsAmount: true,
    });
    const s2 = txDoc("s2", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Some Other Hold",
      needsAmount: true,
    });
    const add = vi.fn(() => Promise.resolve({ id: "txNew" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add,
      whereGetDocs: [s1, s2],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: {
          amount: 13.31,
          merchant: "Amatista Cookhouse",
          fromBankNotification: true,
        },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(add).toHaveBeenCalledTimes(1);
    expect(s1.ref.update).not.toHaveBeenCalled();
    expect(s2.ref.update).not.toHaveBeenCalled();
    expect(res.body).not.toMatchObject({ merged: true });
  });

  it("fromBankNotification fills the merchant-matching stub even amid multiple stubs", async () => {
    const s1 = txDoc("s1", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Gas Station",
      needsAmount: true,
    });
    const s2 = txDoc("s2", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Coffee Shop",
      needsAmount: true,
    });
    const add = vi.fn(() => Promise.resolve({ id: "txNew" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add,
      whereGetDocs: [s1, s2],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: { amount: 42, merchant: "Gas Station", fromBankNotification: true },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(s1.ref.update).toHaveBeenCalledTimes(1);
    expect(s2.ref.update).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ merged: true, data: { transactionId: "s1" } });
  });

  it("WITHOUT the fromBankNotification flag, a real amount never absorbs a $0 stub", async () => {
    const stub = txDoc("stub1", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Loews",
      needsAmount: true,
    });
    const add = vi.fn(() => Promise.resolve({ id: "txNew" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add,
      whereGetDocs: [stub],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: 20, merchant: "Lunch Place" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(add).toHaveBeenCalledTimes(1);
    expect(stub.ref.update).not.toHaveBeenCalled();
  });

  it("fromBankNotification ignores non-shortcut rows when finding a stub (creates a row)", async () => {
    // A manual/Plaid stub-shaped row must NOT be touched by reconciliation.
    const manual = txDoc("m1", {
      source: "manual",
      status: "pending_review",
      amount: 0,
      merchant: "Loews",
      needsAmount: true,
    });
    const add = vi.fn(() => Promise.resolve({ id: "txNew" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add,
      whereGetDocs: [manual],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: {
          amount: 13.31,
          merchant: "Amatista Cookhouse",
          fromBankNotification: true,
        },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(add).toHaveBeenCalledTimes(1);
    expect(manual.ref.update).not.toHaveBeenCalled();
  });

  it("zero-dollar hold WITH a merchant creates an awaiting-amount stub (needsAmount:true, amount 0, pending_review)", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: 0, merchant: "Gas" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { amount: 0, status: "pending_review" },
    });
    expect(add).toHaveBeenCalledTimes(1);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(0);
    expect(txData.needsAmount).toBe(true);
    expect(txData.status).toBe("pending_review");
    expect(txData.source).toBe("shortcut");
    expect(txData.merchant).toBe("Gas");
    expect(logAddMock).toHaveBeenCalled();
  });

  it("zero-dollar hold with NO merchant still skips (no transaction, skipped:true)", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(makeReq({ body: { amount: 0 } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, skipped: true });
    expect(add).not.toHaveBeenCalled();
    // logApiCall still fires for the skipped event.
    expect(logAddMock).toHaveBeenCalled();
  });

  it("zero-dollar hold with a blank/whitespace merchant still skips", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: 0, merchant: "   " } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, skipped: true });
    expect(add).not.toHaveBeenCalled();
  });

  it("missing merchant returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(makeReq({ body: { amount: 50 } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("invalid date format returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: 50, merchant: "Coffee", date: "2020/01/01" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("without expenses permission returns 403", async () => {
    configureValidKey({ ...ALL_PERMS, expenses: false });
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { amount: 50, merchant: "Coffee" } }),
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  // --- Server-side email parsing (emailText) ---

  const WF_EMAIL = `Your credit card was used for a purchase over $1.00.

You made a purchase of $6.02 with credit card ...8899.

Merchant: Google CLOUD
Date: 07/01/2026`;

  it("emailText alone creates a transaction from server-parsed fields", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: WF_EMAIL } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { amount: 6.02, merchant: "Google CLOUD", date: "2026-07-01" },
    });
    expect(add).toHaveBeenCalledTimes(1);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(6.02);
    expect(txData.merchant).toBe("Google CLOUD");
    expect(txData.date).toBe("2026-07-01");
    expect(txData.source).toBe("shortcut");
  });

  it("emailText is redacted from the audit log", async () => {
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add: vi.fn(() => Promise.resolve({ id: "tx1" })),
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: WF_EMAIL } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(logAddMock).toHaveBeenCalled();
    const logged = logAddMock.mock.calls[0]?.[0] as {
      requestBody: Record<string, unknown>;
    };
    expect(logged.requestBody.emailText).toMatch(/^\[redacted email text/);
  });

  it("explicit fields win over emailText-parsed values", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: { emailText: WF_EMAIL, amount: 99, merchant: "Override Store" },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(99);
    expect(txData.merchant).toBe("Override Store");
  });

  it("emailText defaults fromBankNotification: fills a lone $0 stub without the explicit flag", async () => {
    const stub = txDoc("stub1", {
      source: "shortcut",
      status: "pending_review",
      amount: 0,
      merchant: "Google CLOUD",
      needsAmount: true,
    });
    const add = vi.fn(() => Promise.resolve({ id: "txNew" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = {
      add,
      whereGetDocs: [stub],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: WF_EMAIL } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ merged: true, data: { amount: 6.02 } });
    expect(stub.ref.update).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it("emailText with an amount but no merchant lands under a placeholder merchant", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "Charge approved. Amount: $12.00." } }),
      res
    );
    expect(res.statusCode).toBe(200);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(12);
    expect(txData.merchant).toBe("Card purchase");
  });

  it("emailText with a merchant but no amount creates an awaiting-amount stub", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: {
          emailText:
            "A transaction at STARBUCKS on 07/01/2026 requires your attention.",
        },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(0);
    expect(txData.needsAmount).toBe(true);
    expect(txData.merchant).toBe("STARBUCKS");
  });

  it("blank explicit fields do not block emailText-parsed values", async () => {
    // A Shortcut with an empty variable sends "" — the parser's values must
    // still fill in (cardLast4 for routing, date, amount).
    const add = vi.fn(() => Promise.resolve({ id: "tx1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/transactions`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({
        body: { emailText: WF_EMAIL, amount: "", merchant: "", cardLast4: "", date: "" },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    const txData = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(txData.amount).toBe(6.02);
    expect(txData.merchant).toBe("Google CLOUD");
    expect(txData.date).toBe("2026-07-01");
    // The parsed card digits survive the blank explicit value: the sanitized
    // audit-log body carries the normalized last-4 used for account routing.
    const logged = logAddMock.mock.calls[0]?.[0] as {
      requestBody: Record<string, unknown>;
    };
    expect(logged.requestBody.cardLast4).toBe("8899");
  });

  it("unparseable emailText returns 400 with a wording hint", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "Your statement is ready to view." } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect((res.body as { message: string }).message).toMatch(/wording/);
  });

  it("non-string emailText returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: 12345 } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("present-but-empty emailText returns a Shortcut-wiring hint, not the generic amount error", async () => {
    // The email automation ran but the body never reached the server (the
    // emailText field isn't wired to "Get Text from Input"). The notification
    // must name that mis-wiring instead of complaining about `amount`.
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    const message = (res.body as { message: string }).message;
    expect(message).toMatch(/emailText was empty/);
    expect(message).toMatch(/Get Text from Input/);
    expect(message).not.toMatch(/amount must be a valid number/);
  });

  it("empty emailText alongside a valid amount is ignored — the expense still lands", async () => {
    // A Wallet/Transaction automation built by duplicating the email one can
    // carry a leftover empty emailText row next to perfectly good fields. The
    // request must succeed, not 400 with an email-wiring hint.
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "", amount: 13.31, merchant: "Chipotle" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it("whitespace-only emailText gets the same empty-emailText 400", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "   \n " } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /emailText was empty/
    );
  });

  it("empty-emailText failure is audit-logged with the emailText redacted", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(logAddMock).toHaveBeenCalled();
    const logged = logAddMock.mock.calls[0]?.[0] as {
      requestBody: Record<string, unknown>;
      responseStatus: number;
    };
    expect(logged.responseStatus).toBe(400);
    expect(logged.requestBody.emailText).toMatch(/^\[redacted email text/);
  });

  it("unparseable emailText failure is audit-logged", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { emailText: "Your statement is ready to view." } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(logAddMock).toHaveBeenCalled();
    const logged = logAddMock.mock.calls[0]?.[0] as {
      requestBody: Record<string, unknown>;
      responseStatus: number;
    };
    expect(logged.responseStatus).toBe(400);
    expect(logged.requestBody.emailText).toMatch(/^\[redacted email text/);
  });

  it("invalid-amount 400 names the body fields that did arrive and is audit-logged", async () => {
    const res = makeRes();
    await asHandler(quickAddExpense)(
      makeReq({ body: { merchant: "Coffee", cardLast4: "8899" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    const message = (res.body as { message: string }).message;
    expect(message).toMatch(/amount must be a valid number/);
    expect(message).toMatch(/Body fields received: merchant, cardLast4/);
    const logged = logAddMock.mock.calls[0]?.[0] as {
      responseStatus: number;
    };
    expect(logged.responseStatus).toBe(400);
  });
});

// ===========================================================================
// quickAddShoppingItem
// ===========================================================================

describe("quickAddShoppingItem", () => {
  it("single item happy path (no duplicate) returns 200 and creates item", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "s1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/shoppingList`] = {
      add,
      whereGetDocs: [],
    };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddShoppingItem)(
      makeReq({ body: { item: "Milk" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { name: "Milk" } });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("empty items array returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddShoppingItem)(
      makeReq({ body: { items: [] } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("more than 20 items returns 400", async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ item: `i${i}` }));
    const res = makeRes();
    await asHandler(quickAddShoppingItem)(makeReq({ body: { items } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("batch item missing 'item' field returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddShoppingItem)(
      makeReq({ body: { items: [{ quantity: 2 }] } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("without shoppingList permission returns 403", async () => {
    configureValidKey({ ...ALL_PERMS, shoppingList: false });
    const res = makeRes();
    await asHandler(quickAddShoppingItem)(
      makeReq({ body: { item: "Milk" } }),
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

// ===========================================================================
// quickAddNaturalLanguage
// ===========================================================================

describe("quickAddNaturalLanguage", () => {
  it("missing text returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddNaturalLanguage)(makeReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("empty text after trim returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddNaturalLanguage)(
      makeReq({ body: { text: "   " } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("text too long (>500) returns 400", async () => {
    const res = makeRes();
    await asHandler(quickAddNaturalLanguage)(
      makeReq({ body: { text: "x".repeat(501) } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("expense-y text with expenses permission queues a pendingItem (type expense)", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "p1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/pendingItems`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddNaturalLanguage)(
      makeReq({ body: { text: "I spent $20 on lunch" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { type: "expense" } });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("expense-y text WITHOUT expenses permission returns 403", async () => {
    // Keep shoppingList true so the initial "at least one permission" gate passes,
    // then the per-type expense check fails.
    configureValidKey({
      habits: true,
      expenses: false,
      shoppingList: true,
      receiptScanning: false,
    });
    const res = makeRes();
    await asHandler(quickAddNaturalLanguage)(
      makeReq({ body: { text: "I spent $20 on lunch" } }),
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("shopping text with shoppingList permission returns 200 type shopping", async () => {
    const add = vi.fn(() => Promise.resolve({ id: "p2" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/pendingItems`] = { add };
    configureCollections();
    const res = makeRes();
    await asHandler(quickAddNaturalLanguage)(
      makeReq({ body: { text: "add milk to shopping list" } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { type: "shopping" } });
  });
});

// ===========================================================================
// quickAddBillPay (F-MONEY-11)
// ===========================================================================

/** A raw Firestore-style doc: { id, data() }. */
function docOf(id: string, data: Record<string, unknown>): unknown {
  return { id, data: () => data };
}

describe("quickAddBillPay", () => {
  const BILL_TODAY = "2026-07-14";

  function configureBillWorld(opts: {
    calendarDocs: unknown[];
    accountDocs: unknown[];
    household?: Record<string, unknown>;
  }): void {
    collectionOverrides[`households/${HOUSEHOLD_ID}/calendarItems`] = {
      getDocs: opts.calendarDocs,
    };
    collectionOverrides[`households/${HOUSEHOLD_ID}/accounts`] = {
      getDocs: opts.accountDocs,
    };
    configureCollections();
    docOverrides[`households/${HOUSEHOLD_ID}`] = {
      get: vi.fn(() =>
        Promise.resolve({
          data: () => opts.household ?? { currency: "USD", lastPaycheckDate: "2026-07-01" },
        })
      ),
    };
    configureDocs();
  }

  it("returns 403 when the key lacks the bills permission", async () => {
    configureValidKey({ habits: true, expenses: true, shoppingList: true, bills: false });
    const res = makeRes();
    await asHandler(quickAddBillPay)(makeReq({ body: { title: "Rent" } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("returns 400 when title is missing", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, bills: true });
    const res = makeRes();
    await asHandler(quickAddBillPay)(makeReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns 404 when no unpaid bill matches", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, bills: true });
    configureBillWorld({
      calendarDocs: [
        docOf("rent", { title: "Rent", amount: 1200, date: "2026-07-20", type: "expense", isPaid: true }),
      ],
      accountDocs: [docOf("chk", { type: "checking", order: 0 })],
    });
    const res = makeRes();
    await asHandler(quickAddBillPay)(
      makeReq({ body: { title: "Rent", today: BILL_TODAY } }),
      res
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("pays a matching non-recurring bill from the first checking account (200 + atomic batch)", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, bills: true });
    configureBillWorld({
      calendarDocs: [
        docOf("rent", { title: "Rent", amount: 1200, date: "2026-07-20", type: "expense", isPaid: false }),
      ],
      accountDocs: [
        docOf("sav", { type: "savings", order: 0 }),
        docOf("chk", { type: "checking", order: 1 }),
      ],
    });
    const res = makeRes();
    await asHandler(quickAddBillPay)(
      makeReq({ body: { title: "rent", today: BILL_TODAY } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { title: "Rent", amount: 1200, accountId: "chk", date: "2026-07-20" },
    });
    // One atomic batch: bill update + account decrement + transaction set, committed once.
    expect(lastBatch.commit).toHaveBeenCalledTimes(1);
    expect(lastBatch.update).toHaveBeenCalledTimes(2); // calendar item + account balance
    expect(lastBatch.set).toHaveBeenCalledTimes(1); // transaction
  });

  it("returns 400 when there is no checking account", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, bills: true });
    configureBillWorld({
      calendarDocs: [
        docOf("rent", { title: "Rent", amount: 1200, date: "2026-07-20", type: "expense", isPaid: false }),
      ],
      accountDocs: [docOf("sav", { type: "savings", order: 0 })],
    });
    const res = makeRes();
    await asHandler(quickAddBillPay)(
      makeReq({ body: { title: "Rent", today: BILL_TODAY } }),
      res
    );
    expect(res.statusCode).toBe(400);
  });
});

// ===========================================================================
// quickAddTodo (F-TODO-07)
// ===========================================================================

describe("quickAddTodo", () => {
  const TODO_TODAY = "2026-07-14";

  it("returns 403 when the key lacks the todos permission", async () => {
    configureValidKey({ habits: true, expenses: true, shoppingList: true, todos: false });
    const res = makeRes();
    await asHandler(quickAddTodo)(makeReq({ body: { text: "Take out trash" } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("returns 400 when text is missing", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const res = makeRes();
    await asHandler(quickAddTodo)(makeReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns 400 when dueDate is not YYYY-MM-DD", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash", dueDate: "07/14/2026" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns 400 when isImportant is not a boolean", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash", isImportant: "yes" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns 400 when dueTime is not HH:mm 24-hour", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash", dueTime: "3pm" } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns 400 when reminderMinutesBefore is provided without dueTime", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash", reminderMinutesBefore: 30 } }),
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns 400 when reminderMinutesBefore is negative or non-integer", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    for (const bad of [-5, 2.5, "soon"]) {
      const res = makeRes();
      await asHandler(quickAddTodo)(
        makeReq({ body: { text: "Take out trash", dueTime: "15:00", reminderMinutesBefore: bad } }),
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
    }
  });

  it("writes dueTime and reminderMinutesBefore (F-TODO-14), accepting a numeric string", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const add = vi.fn(() => Promise.resolve({ id: "todo-timed" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/todos`] = { add };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({
        body: {
          text: "Call dentist",
          dueDate: "2026-08-01",
          dueTime: "15:00",
          reminderMinutesBefore: "30",
          today: TODO_TODAY,
        },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { dueTime: "15:00", reminderMinutesBefore: 30 },
    });
    const written = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({ dueTime: "15:00", reminderMinutesBefore: 30 });
    // The sent marker must not be pre-set — the reminder job stamps it.
    expect("reminderSentAt" in written).toBe(false);
  });

  it("omits the time fields entirely when not provided", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const add = vi.fn(() => Promise.resolve({ id: "todo-plain" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/todos`] = { add };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash", today: TODO_TODAY } }),
      res
    );

    expect(res.statusCode).toBe(200);
    const written = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("dueTime" in written).toBe(false);
    expect("reminderMinutesBefore" in written).toBe(false);
  });

  it("creates a to-do defaulting the due date to caller-local today (200)", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const add = vi.fn(() => Promise.resolve({ id: "todo1" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/todos`] = { add };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash", today: TODO_TODAY } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        todoId: "todo1",
        text: "Take out trash",
        completeByDate: TODO_TODAY,
        assignedTo: null,
        isImportant: false,
      },
    });
    expect(add).toHaveBeenCalledTimes(1);
    const written = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      text: "Take out trash",
      completeByDate: TODO_TODAY,
      isCompleted: false,
      source: "shortcut",
    });
    expect(written.assignedTo).toBeUndefined();
  });

  it("honors an explicit dueDate and isImportant flag", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    const add = vi.fn(() => Promise.resolve({ id: "todo2" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/todos`] = { add };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({
        body: {
          text: "Renew passport",
          dueDate: "2026-08-01",
          isImportant: true,
          today: TODO_TODAY,
        },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { completeByDate: "2026-08-01", isImportant: true },
    });
    const written = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({ completeByDate: "2026-08-01", isImportant: true });
  });

  it("resolves assignedTo by exact uid", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    collectionOverrides[`households/${HOUSEHOLD_ID}/members`] = {
      getDocs: [
        docOf("uid-sam", { displayName: "Sam" }),
        docOf("uid-jordan", { displayName: "Jordan" }),
      ],
    };
    const add = vi.fn(() => Promise.resolve({ id: "todo3" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/todos`] = { add };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Water plants", assignedTo: "uid-sam", today: TODO_TODAY } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { assignedTo: "uid-sam" } });
    const written = add.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written.assignedTo).toBe("uid-sam");
  });

  it("resolves assignedTo by a unique fuzzy display-name match", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    collectionOverrides[`households/${HOUSEHOLD_ID}/members`] = {
      getDocs: [
        docOf("uid-sam", { displayName: "Sam" }),
        docOf("uid-jordan", { displayName: "Jordan" }),
      ],
    };
    const add = vi.fn(() => Promise.resolve({ id: "todo4" }));
    collectionOverrides[`households/${HOUSEHOLD_ID}/todos`] = { add };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Water plants", assignedTo: "jordan", today: TODO_TODAY } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { assignedTo: "uid-jordan" } });
  });

  it("returns 404 when assignedTo matches no member", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    collectionOverrides[`households/${HOUSEHOLD_ID}/members`] = {
      getDocs: [docOf("uid-sam", { displayName: "Sam" })],
    };
    configureCollections();

    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Water plants", assignedTo: "Zzyzx", today: TODO_TODAY } }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    configureValidKey({ habits: false, expenses: false, shoppingList: false, todos: true });
    configureRateLimit(false);
    const res = makeRes();
    await asHandler(quickAddTodo)(
      makeReq({ body: { text: "Take out trash" } }),
      res
    );
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
  });
});
