/**
 * GET /getTodos
 *
 * Read/export the household's shared to-dos as JSON, authenticated by the same
 * `lb_..._...` Bearer API key the write-only quickAdd* endpoints use — the
 * read counterpart that lets an iOS Shortcut pull to-dos OUT of LifeBalance and
 * push them into Apple Reminders.
 *
 * Gated on the generic `read` permission scope (NOT the write-only `todos`
 * scope), so a capture-only key cannot exfiltrate data unless `read` is
 * explicitly enabled. Future GET export endpoints (habits, bills, …) reuse the
 * same scope + rate-limit bucket.
 *
 * Lives in its own file (rather than the quickAdd/index.ts barrel body) to
 * minimize merge conflicts with concurrent edits to the expense endpoint; it
 * is re-exported from that barrel and surfaced for deploy from
 * functions/src/index.ts.
 */

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  validateApiKey,
  extractApiKey,
  checkRateLimit,
  logApiCall,
  isValidFirestoreId,
} from "./apiKeyValidation";

const db = admin.firestore();

/** Minimal subset of the Express/Firebase response object used below. */
interface HttpResponse {
  status(code: number): { json(body: unknown): void; send(body: string): void };
  set(header: string, value: string): void;
}

// The Firestore read is bounded at a FIXED cap (like calendarfeed) and
// filtered/sorted in memory, so it never needs a new composite index — a
// household never has anywhere near this many to-dos, so the whole set is read
// and the in-memory filter/sort/slice below sees everything.
const READ_CAP = 500;
// `limit` is a RESULTS cap applied AFTER filtering + sorting (not the read
// bound), so `limit=10` deterministically returns the first 10 sorted, open
// to-dos rather than "whatever survived filtering the first 10 docs read".
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// Common response helpers (mirror quickAdd/index.ts — kept local so a change to
// the POST endpoints' CORS/response shape can never accidentally alter this GET).
function jsonResponse(
  res: HttpResponse,
  status: number,
  data: Record<string, unknown>
): void {
  res.status(status).json(data);
}

function errorResponse(
  res: HttpResponse,
  status: number,
  message: string,
  code: string
): void {
  res.status(status).json({
    success: false,
    message,
    error: { code },
  });
}

// Production hosting origins (see quickAdd/index.ts for the rationale). This
// endpoint is consumed primarily by iOS Shortcuts / curl, which send no Origin
// header and are unaffected by CORS; the allowlist just bounds the blast radius
// if a browser UI is ever pointed at it. GET differs from the POST endpoints
// only in the allowed method advertised on preflight.
const ALLOWED_ORIGINS = new Set<string>([
  "https://lifebalance-26080.web.app",
  "https://lifebalance-26080.firebaseapp.com",
]);

function applyCorsHeaders(
  req: { headers: { origin?: string } },
  res: HttpResponse
): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}

/**
 * Pick the first usable string from a query-param value. Express parses repeated
 * params into arrays and nested `a[b]=c` params into objects — we only ever want
 * a single scalar string, so anything else collapses to undefined.
 */
function firstQueryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

/**
 * Normalize a stored timestamp field to an ISO string. Functions read raw
 * `doc.data()` (no converters), so a serverTimestamp() field comes back as a
 * Firestore Timestamp, while migrated/older docs may already hold an ISO string.
 * Anything unrecognized → null rather than leaking an opaque object into JSON.
 */
function toIsoStringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const ts = value as { toDate?: () => Date; toMillis?: () => number };
    try {
      if (typeof ts.toDate === "function") return ts.toDate().toISOString();
      if (typeof ts.toMillis === "function") {
        return new Date(ts.toMillis()).toISOString();
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** A clean, Shortcut-friendly to-do shape (no churny internal fields). */
interface ExportedTodo {
  id: string;
  text: string;
  completeByDate: string;
  dueTime: string | null;
  dueAt: string | null;
  reminderMinutesBefore: number | null;
  isCompleted: boolean;
  completedAt: string | null;
  assignedTo: string | null;
  priority: string;
  notes: string | null;
  isImportant: boolean;
  recurrence: Record<string, unknown> | null;
  createdAt: string | null;
}

/**
 * Map one raw `todos` doc to the exported shape, guarding every field read
 * against the untyped `doc.data()`. Excludes internal fields (`reminderSentAt`,
 * `source`, `points`, `subtasks`).
 */
function mapTodo(id: string, data: Record<string, unknown>): ExportedTodo {
  const completeByDate =
    typeof data.completeByDate === "string" ? data.completeByDate : "";
  const dueTime = typeof data.dueTime === "string" ? data.dueTime : null;
  // Convenience combined ISO wall-clock when both a date and a time exist (the
  // Shortcut can feed it straight into a Reminders due-date without recomposing).
  const dueAt =
    completeByDate && dueTime ? `${completeByDate}T${dueTime}:00` : null;
  const priority =
    data.priority === "low" || data.priority === "high" || data.priority === "medium"
      ? data.priority
      : "medium";

  return {
    id,
    text: typeof data.text === "string" ? data.text : "",
    completeByDate,
    dueTime,
    dueAt,
    reminderMinutesBefore:
      typeof data.reminderMinutesBefore === "number"
        ? data.reminderMinutesBefore
        : null,
    isCompleted: data.isCompleted === true,
    completedAt: toIsoStringOrNull(data.completedAt),
    assignedTo: typeof data.assignedTo === "string" ? data.assignedTo : null,
    priority,
    notes: typeof data.notes === "string" ? data.notes : null,
    isImportant: data.isImportant === true,
    recurrence:
      data.recurrence && typeof data.recurrence === "object"
        ? (data.recurrence as Record<string, unknown>)
        : null,
    createdAt: toIsoStringOrNull(data.createdAt),
  };
}

export const getTodos = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers (GET-aware).
    applyCorsHeaders(req, res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "GET") {
      errorResponse(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 1. Validate API Key. Authorization header ONLY — never a query-string key
    //    (repo privacy rule: no keys/PII in URLs; query strings land in logs).
    const apiKey = extractApiKey(req.headers.authorization);
    if (!apiKey) {
      errorResponse(res, 401, "Missing or invalid Authorization header", "UNAUTHORIZED");
      return;
    }

    const validation = await validateApiKey(apiKey);
    if (!validation.valid || !validation.householdId) {
      errorResponse(res, 401, validation.error || "Invalid API key", "UNAUTHORIZED");
      return;
    }

    const { householdId, permissions } = validation;

    // 2. Check permissions (generic read/export scope)
    if (!permissions?.read) {
      errorResponse(res, 403, "API key does not have read permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "read");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Parse optional query params (all optional).
    const query: Record<string, unknown> = req.query || {};

    // includeCompleted: "true"/"1" include completed; default false → only open.
    const rawIncludeCompleted = firstQueryString(query.includeCompleted);
    const includeCompleted =
      rawIncludeCompleted === "true" || rawIncludeCompleted === "1";

    // assignedTo: optional uid filter, validated to a safe Firestore id.
    const rawAssignedTo = firstQueryString(query.assignedTo);
    if (rawAssignedTo !== undefined && rawAssignedTo !== "") {
      if (!isValidFirestoreId(rawAssignedTo)) {
        errorResponse(res, 400, "assignedTo contains invalid characters", "BAD_REQUEST");
        return;
      }
    }
    const assigneeFilter =
      rawAssignedTo && rawAssignedTo !== "" ? rawAssignedTo : undefined;

    // limit: positive integer, default 200, hard-capped at 500. Applied to the
    // RESULT set after filtering + sorting (see the slice below), not to the read.
    const rawLimit = firstQueryString(query.limit);
    let resultsLimit = DEFAULT_LIMIT;
    if (rawLimit !== undefined && rawLimit !== "") {
      if (!/^\d+$/.test(rawLimit)) {
        errorResponse(res, 400, "limit must be a positive integer", "BAD_REQUEST");
        return;
      }
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        errorResponse(res, 400, "limit must be a positive integer", "BAD_REQUEST");
        return;
      }
      resultsLimit = Math.min(parsed, MAX_LIMIT);
    }

    try {
      // 5. Bounded read + in-memory filter/sort (like calendarfeed) — no new
      //    composite index needed. The read cap is fixed (not the caller's
      //    `limit`) so filtering/sorting sees the whole set.
      const snap = await db
        .collection(`households/${householdId}/todos`)
        .limit(READ_CAP)
        .get();

      // "Saved for later": parked to-dos are NOT committed work — they carry an
      // inert placeholder due date and no classification. This endpoint bypasses
      // the client context's provider-level split entirely, so without this
      // explicit exclusion an iOS Shortcut would pull parked items into Apple
      // Reminders as if they were real tasks (complete with a fabricated due
      // date). Filtered on the RAW doc, before mapping, because the exported
      // shape deliberately carries no `savedForLater` field.
      let todos = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
        .filter(({ data }) => data.savedForLater !== true)
        .map(({ id, data }) => mapTodo(id, data));

      if (!includeCompleted) {
        todos = todos.filter((t) => !t.isCompleted);
      }
      if (assigneeFilter) {
        todos = todos.filter((t) => t.assignedTo === assigneeFilter);
      }

      // Sort by due date asc, then due time asc (untimed last), then createdAt.
      // Undated to-dos (completeByDate "") sort LAST via a high sentinel, where
      // "no due date" conventionally lives — not first (as "" < "2026-…" would).
      todos.sort((a, b) => {
        const aDate = a.completeByDate || "9999-99-99";
        const bDate = b.completeByDate || "9999-99-99";
        if (aDate !== bDate) return aDate < bDate ? -1 : 1;
        const aTime = a.dueTime ?? "99:99";
        const bTime = b.dueTime ?? "99:99";
        if (aTime !== bTime) return aTime < bTime ? -1 : 1;
        const aCreated = a.createdAt ?? "";
        const bCreated = b.createdAt ?? "";
        if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
        return 0;
      });

      // Apply the caller's results cap AFTER sorting so `limit` is deterministic.
      if (todos.length > resultsLimit) {
        todos = todos.slice(0, resultsLimit);
      }

      // 6. Log + respond.
      await logApiCall(householdId, apiKey.substring(0, 16), "read", { query }, 200);

      jsonResponse(res, 200, {
        success: true,
        data: {
          todos,
          count: todos.length,
        },
      });
    } catch (error) {
      logger.error("Error in getTodos:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "read", { query: req.query }, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);
