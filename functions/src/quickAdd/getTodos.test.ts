/**
 * HTTP-layer tests for the getTodos read/export Cloud Function endpoint.
 *
 * Mirrors index.test.ts's approach: `onRequest(opts, handler)` is mocked to
 * return the raw handler so we can invoke it directly as `(req, res)`, and
 * `firebase-admin` exposes a single shared, reconfigurable mock Firestore that
 * both getTodos.ts and apiKeyValidation.ts bind to at module load. The auth /
 * rate-limit / logging helpers are the REAL functions run against the mock db.
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
  collection: ReturnType<typeof vi.fn>;
  doc: ReturnType<typeof vi.fn>;
  runTransaction: ReturnType<typeof vi.fn>;
}

const adminMock = vi.hoisted(() => {
  const db: MockDb = {
    collectionGroup: vi.fn(),
    collection: vi.fn(),
    doc: vi.fn(),
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

// Import AFTER the mocks are registered.
import { getTodos } from "./getTodos";

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
  query?: Record<string, unknown>;
}

function makeReq(opts: ReqOpts = {}): unknown {
  return {
    method: opts.method ?? "GET",
    headers: opts.headers ?? { authorization: VALID_AUTH },
    query: opts.query ?? {},
  };
}

// A well-formed key: lb_{6 alnum}_{32 hex}
const VALID_KEY = "lb_abcdef_0123456789abcdef0123456789abcdef";
const VALID_AUTH = `Bearer ${VALID_KEY}`;
const HOUSEHOLD_ID = "hh1";
const TODOS_PATH = `households/${HOUSEHOLD_ID}/todos`;

const ALL_PERMS = {
  habits: true,
  expenses: true,
  shoppingList: true,
  todos: true,
  read: true,
  receiptScanning: true,
};

function asHandler(fn: unknown): Handler {
  return fn as Handler;
}

// ---------------------------------------------------------------------------
// Mock configuration
// ---------------------------------------------------------------------------

/** Configure validateApiKey's collectionGroup query to return a valid active key. */
function configureValidKey(permissions: Record<string, boolean> = ALL_PERMS): void {
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
        limit: () => ({ get: () => Promise.resolve(snapshot) }),
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
        limit: () => ({ get: () => Promise.resolve(snapshot) }),
      }),
    }),
  });
}

/** Configure checkRateLimit's runTransaction to allow (default) or reject (429). */
function configureRateLimit(allowed: boolean): void {
  adminMock.db.runTransaction.mockImplementation(
    async (cb: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: () =>
          Promise.resolve({
            data: () =>
              allowed ? undefined : { count: 100000, windowStart: Date.now() },
          }),
        set: vi.fn(),
        update: vi.fn(),
      };
      return cb(txn);
    }
  );
}

interface TodoDoc {
  id: string;
  data: () => Record<string, unknown>;
}

const logAddMock = vi.fn(() => Promise.resolve({ id: "log1" }));

// State the collection router reads.
let todoDocs: TodoDoc[] = [];
let lastLimit: number | undefined;
/** When set, the todos-collection `.limit().get()` rejects (drives the 500 path). */
let todosReadError: Error | null = null;

function configureCollections(): void {
  lastLimit = undefined;
  adminMock.db.collection.mockImplementation((path: string) => {
    if (path === "logs/api_calls/requests") {
      return { add: logAddMock };
    }
    if (path === TODOS_PATH) {
      return {
        limit: (n: number) => {
          lastLimit = n;
          return {
            get: () =>
              todosReadError
                ? Promise.reject(todosReadError)
                : Promise.resolve({ docs: todoDocs }),
          };
        },
      };
    }
    // Unexpected path — surface it loudly in a failing test.
    throw new Error(`Unexpected collection path: ${path}`);
  });
}

function todoDoc(id: string, overrides: Record<string, unknown> = {}): TodoDoc {
  return {
    id,
    data: () => ({
      text: `Task ${id}`,
      completeByDate: "2026-07-20",
      isCompleted: false,
      assignedTo: "user1",
      createdAt: "2026-07-01T00:00:00.000Z",
      ...overrides,
    }),
  };
}

// ---------------------------------------------------------------------------
// Reset / defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  todoDocs = [];
  todosReadError = null;
  configureValidKey();
  configureRateLimit(true);
  configureCollections();
});

// ===========================================================================
// HTTP-layer behavior
// ===========================================================================

describe("getTodos — HTTP-layer behavior", () => {
  it("OPTIONS preflight returns 204", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
  });

  it("non-GET (POST) returns 405 METHOD_NOT_ALLOWED", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ method: "POST" }), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });

  it("allowlisted origin gets a matching Access-Control-Allow-Origin with GET method", async () => {
    const res = makeRes();
    await asHandler(getTodos)(
      makeReq({
        method: "OPTIONS",
        headers: { authorization: VALID_AUTH, origin: "https://lifebalance-26080.web.app" },
      }),
      res
    );
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(
      "https://lifebalance-26080.web.app"
    );
    expect(res.headers["Access-Control-Allow-Methods"]).toBe("GET, OPTIONS");
  });

  it("missing Authorization header returns 401 UNAUTHORIZED", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("invalid key format returns 401", async () => {
    const res = makeRes();
    await asHandler(getTodos)(
      makeReq({ headers: { authorization: "Bearer garbage" } }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("well-formed key not found / revoked returns 401", async () => {
    configureEmptyKey();
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("valid key WITHOUT read permission returns 403 FORBIDDEN", async () => {
    configureValidKey({ ...ALL_PERMS, read: false });
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("a key that omits read entirely (legacy key) returns 403", async () => {
    configureValidKey({ habits: true, expenses: true, shoppingList: true });
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("rate limit exceeded returns 429 RATE_LIMITED and sets Retry-After", async () => {
    configureRateLimit(false);
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("returns 500 INTERNAL_ERROR when the todos read throws", async () => {
    todosReadError = new Error("firestore unavailable");
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
});

// ===========================================================================
// Filtering / query params
// ===========================================================================

describe("getTodos — filtering and query params", () => {
  it("by default returns only incomplete to-dos", async () => {
    todoDocs = [
      todoDoc("a", { isCompleted: false }),
      todoDoc("b", { isCompleted: true, completedAt: "2026-07-19T12:00:00.000Z" }),
      todoDoc("c", { isCompleted: false }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { success: boolean; data: { todos: { id: string }[]; count: number } };
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(2);
    expect(body.data.todos.map((t) => t.id).sort()).toEqual(["a", "c"]);
  });

  it("includeCompleted=true returns completed AND incomplete", async () => {
    todoDocs = [
      todoDoc("a", { isCompleted: false }),
      todoDoc("b", { isCompleted: true }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { includeCompleted: "true" } }), res);

    const body = res.body as { data: { count: number } };
    expect(body.data.count).toBe(2);
  });

  it('includeCompleted="1" also includes completed', async () => {
    todoDocs = [todoDoc("a", { isCompleted: false }), todoDoc("b", { isCompleted: true })];
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { includeCompleted: "1" } }), res);
    expect((res.body as { data: { count: number } }).data.count).toBe(2);
  });

  // "Saved for later": this endpoint bypasses the client context's split, so
  // without an explicit exclusion an iOS Shortcut would pull parked items into
  // Apple Reminders as real tasks (with a fabricated due date).
  it("excludes parked (savedForLater) to-dos", async () => {
    todoDocs = [
      todoDoc("active", { isCompleted: false }),
      todoDoc("parked", { isCompleted: false, savedForLater: true }),
      // false / absent both mean "not parked" — no migration, absent is the norm.
      todoDoc("unparked", { isCompleted: false, savedForLater: false }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);

    const body = res.body as { data: { todos: { id: string }[]; count: number } };
    expect(body.data.count).toBe(2);
    expect(body.data.todos.map((t) => t.id).sort()).toEqual(["active", "unparked"]);
  });

  it("excludes parked to-dos even when includeCompleted is set", async () => {
    todoDocs = [
      todoDoc("done", { isCompleted: true }),
      todoDoc("parked", { isCompleted: false, savedForLater: true }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { includeCompleted: "true" } }), res);

    const body = res.body as { data: { todos: { id: string }[]; count: number } };
    expect(body.data.todos.map((t) => t.id)).toEqual(["done"]);
  });

  it("assignedTo filters to a single member", async () => {
    todoDocs = [
      todoDoc("a", { assignedTo: "user1" }),
      todoDoc("b", { assignedTo: "user2" }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { assignedTo: "user2" } }), res);

    const body = res.body as { data: { todos: { id: string }[]; count: number } };
    expect(body.data.count).toBe(1);
    expect(body.data.todos[0]?.id).toBe("b");
  });

  it("rejects an assignedTo with path-traversal characters with 400", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { assignedTo: "../evil" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("reads with a fixed cap of 500 regardless of the requested limit", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { limit: "9999" } }), res);
    expect(res.statusCode).toBe(200);
    // The Firestore read is always bounded at 500 (not the caller's limit) so
    // the in-memory filter/sort sees the whole set; `limit` caps the RESULT.
    expect(lastLimit).toBe(500);
  });

  it("reads the fixed cap even when no limit is given", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect(lastLimit).toBe(500);
  });

  it("applies limit as a RESULTS cap AFTER sorting, not to the read", async () => {
    // 8 open todos with distinct due dates → deterministic sort order.
    todoDocs = Array.from({ length: 8 }, (_, i) =>
      todoDoc(`t${i}`, { completeByDate: `2026-07-1${i}` })
    );
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { limit: "5" } }), res);
    const body = res.body as { data: { todos: { id: string }[]; count: number } };
    // Read still bounded at 500; only the RESULT set is capped at 5, and it's
    // the first 5 by sort order (not the first 5 read).
    expect(lastLimit).toBe(500);
    expect(body.data.count).toBe(5);
    expect(body.data.todos.map((t) => t.id)).toEqual([
      "t0", "t1", "t2", "t3", "t4",
    ]);
  });

  it("returns all matching todos when the count is under the limit", async () => {
    todoDocs = [todoDoc("a"), todoDoc("b")];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    expect((res.body as { data: { count: number } }).data.count).toBe(2);
  });

  it("rejects a non-numeric limit with 400", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { limit: "abc" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("rejects a zero / negative limit with 400", async () => {
    const res = makeRes();
    await asHandler(getTodos)(makeReq({ query: { limit: "0" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
});

// ===========================================================================
// Response shape
// ===========================================================================

describe("getTodos — JSON response shape", () => {
  it("returns a clean, Shortcut-friendly to-do shape with sensible defaults", async () => {
    todoDocs = [
      todoDoc("t1", {
        text: "Call dentist",
        completeByDate: "2026-07-21",
        dueTime: "15:00",
        reminderMinutesBefore: 30,
        assignedTo: "user1",
        isImportant: true,
        notes: "front desk",
        // Internal fields that must NOT leak into the export.
        reminderSentAt: "2026-07-21T14:30:00.000Z",
        source: "shortcut",
      }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);

    const body = res.body as {
      data: { todos: Record<string, unknown>[]; count: number };
    };
    const todo = body.data.todos[0]!;
    expect(todo).toEqual({
      id: "t1",
      text: "Call dentist",
      completeByDate: "2026-07-21",
      dueTime: "15:00",
      dueAt: "2026-07-21T15:00:00",
      reminderMinutesBefore: 30,
      isCompleted: false,
      completedAt: null,
      assignedTo: "user1",
      priority: "medium",
      notes: "front desk",
      isImportant: true,
      recurrence: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    // Internal fields excluded.
    expect(todo).not.toHaveProperty("reminderSentAt");
    expect(todo).not.toHaveProperty("source");
  });

  it("nulls dueAt when there is no dueTime and defaults priority to 'medium'", async () => {
    todoDocs = [todoDoc("t2", { completeByDate: "2026-07-22" })];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);

    const todo = (res.body as { data: { todos: Record<string, unknown>[] } }).data.todos[0]!;
    expect(todo.dueTime).toBeNull();
    expect(todo.dueAt).toBeNull();
    expect(todo.reminderMinutesBefore).toBeNull();
    expect(todo.priority).toBe("medium");
    expect(todo.isImportant).toBe(false);
  });

  it("normalizes a Firestore Timestamp createdAt to an ISO string", async () => {
    const ts = { toDate: () => new Date("2026-07-05T08:00:00.000Z") };
    todoDocs = [todoDoc("t3", { createdAt: ts })];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);

    const todo = (res.body as { data: { todos: Record<string, unknown>[] } }).data.todos[0]!;
    expect(todo.createdAt).toBe("2026-07-05T08:00:00.000Z");
  });

  it("sorts by completeByDate asc, then dueTime asc (untimed last)", async () => {
    todoDocs = [
      todoDoc("later", { completeByDate: "2026-07-22" }),
      todoDoc("earlyNoTime", { completeByDate: "2026-07-20" }),
      todoDoc("earlyTimed", { completeByDate: "2026-07-20", dueTime: "09:00" }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);

    const ids = (res.body as { data: { todos: { id: string }[] } }).data.todos.map(
      (t) => t.id
    );
    expect(ids).toEqual(["earlyTimed", "earlyNoTime", "later"]);
  });

  it("sorts undated todos (empty completeByDate) last, not first", async () => {
    todoDocs = [
      todoDoc("undated", { completeByDate: "" }),
      todoDoc("dated", { completeByDate: "2026-07-20" }),
    ];
    const res = makeRes();
    await asHandler(getTodos)(makeReq(), res);
    const ids = (res.body as { data: { todos: { id: string }[] } }).data.todos.map(
      (t) => t.id
    );
    expect(ids).toEqual(["dated", "undated"]);
  });
});
