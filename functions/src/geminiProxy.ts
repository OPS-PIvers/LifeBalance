/**
 * Callable Cloud Function: server-side proxy for the Gemini API.
 *
 * Stage 1 of moving the Gemini API key off the client (roadmap B1 / Plan 014).
 * The client today inlines VITE_GEMINI_API_KEY into the shipped bundle, where it
 * is extractable. This proxy holds the key as a server-side secret
 * (GEMINI_API_KEY) and performs the raw model call on the caller's behalf, so the
 * key never reaches the browser.
 *
 * This is intentionally a *thin* transport: all prompt-building and response
 * parsing stay in the client (services/geminiService.ts). The function
 * forwards the already-assembled `{ model, contents, config }` to
 * `ai.models.generateContent` and returns the plain `{ text }` the client reads
 * off the SDK response — so the client can consume it identically to the direct
 * SDK path it uses today.
 *
 * Plan 10 adds server-side spend protection before that forward: the caller
 * must be a member of the `householdId` it names, the `aiEnabled` kill-switch
 * is honored, and the daily AI quota is checked-and-incremented atomically on
 * the household doc. On the proxy path the SERVER owns the `aiUsage` counter —
 * the client skips its own increment (see geminiService.generateJsonContent),
 * so each call counts exactly once.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import { getAiDailyCap, type HouseholdEntitlementData } from "./entitlements";

/**
 * The Gemini API key, held server-side as a Cloud Functions secret. A human sets
 * it (e.g. `firebase functions:secrets:set GEMINI_API_KEY`) when the proxy is
 * activated; until then this function is dormant — the client flag
 * (VITE_USE_GEMINI_PROXY) defaults OFF, so nothing calls it.
 */
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/** Request payload the client sends — mirrors the args it passes to generateContent. */
interface GeminiProxyData {
  model?: unknown;
  contents?: unknown;
  config?: unknown;
  /** Household whose quota this call spends (Plan 10) — required. */
  householdId?: unknown;
  /**
   * Caller-local calendar date (yyyy-MM-dd), same convention as the quickAdd
   * endpoints: Cloud Functions run in UTC, so the client's local date is
   * forwarded to keep the daily-quota day boundary aligned with the user.
   * Optional; validated and clamped server-side (see resolveQuotaDay).
   */
  today?: unknown;
}

/** Plain, JSON-serializable result the client consumes the same way it reads the SDK response. */
interface GeminiProxyResult {
  text: string | undefined;
}

/**
 * Best-effort HTTP status extraction from an upstream Gemini SDK error. The
 * @google/genai ApiError carries a numeric `status` (e.g. 503); some shapes use
 * the string enum (e.g. "UNAVAILABLE"). Returns undefined when no status is found.
 */
const httpStatusOf = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    if (status === "UNAVAILABLE") return 503;
    if (status === "RESOURCE_EXHAUSTED") return 429;
  }
  return undefined;
};

/** Strict calendar-date shape the quota day accepts (yyyy-MM-dd). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the calendar day the quota transaction should count against.
 *
 * Accepts the caller-local `today` (the quickAdd convention — the client's
 * local date keeps the day boundary aligned with the user rather than UTC),
 * but CLAMPS it: if it is absent, malformed, or more than 1 calendar day away
 * from the server's UTC date, the server's UTC date is used instead. The ±1
 * day tolerance covers every real timezone offset while preventing a caller
 * from gaming the counter with a fabricated far-off date.
 */
export function resolveQuotaDay(today: unknown, nowMs: number = Date.now()): string {
  const serverToday = new Date(nowMs).toISOString().slice(0, 10);
  if (typeof today !== "string" || !DATE_RE.test(today)) return serverToday;

  const claimedMs = Date.parse(`${today}T00:00:00Z`);
  const serverMs = Date.parse(`${serverToday}T00:00:00Z`);
  if (Number.isNaN(claimedMs)) return serverToday;

  const dayDiff = Math.abs(claimedMs - serverMs) / 86_400_000;
  return dayDiff <= 1 ? today : serverToday;
}

/** Shape of the `aiUsage` counter stored on the household doc. */
interface AiUsage {
  dailyCount: number;
  lastResetDate: string;
}

/**
 * Membership + kill-switch + atomic daily-quota enforcement (Plan 10).
 *
 * The server owns the counter on the proxy path: the client no longer writes
 * `aiUsage` when VITE_USE_GEMINI_PROXY is on, so this check-and-increment is
 * the single authoritative one (no double count). Replicates the client's
 * `checkAndIncrementAiUsage` semantics exactly: reset on date rollover,
 * plan-aware cap once billing is live (legacy flat cap until then), and the
 * full `aiUsage` object written back.
 *
 * @throws HttpsError not-found / permission-denied / failed-precondition /
 *   resource-exhausted — thrown BEFORE any Gemini call so an over-cap or
 *   non-member request never spends the server-side key.
 */
async function enforceAiQuota(
  uid: string,
  householdId: string,
  today: string
): Promise<void> {
  // Lazily bound inside the handler-call path (not at module load) because this
  // module is imported from index.ts before admin.initializeApp() runs — the
  // same convention as plaid/stripe/recap.
  const db = admin.firestore();

  // 1. Membership: only a member of the household may spend its quota.
  const householdRef = db.doc(`households/${householdId}`);
  const householdSnap = await householdRef.get();
  if (!householdSnap.exists) {
    throw new HttpsError("not-found", "Household not found.");
  }
  const memberUids = householdSnap.data()?.memberUids;
  if (!Array.isArray(memberUids) || !memberUids.includes(uid)) {
    throw new HttpsError(
      "permission-denied",
      "You are not a member of this household."
    );
  }

  // 2. Operator flags: aiEnabled kill-switch (fail-open on missing doc/field or
  // read error, matching the client) and billingEnabled (fail-closed).
  let billingEnabled = false;
  try {
    const configSnap = await db.doc("app_config/global").get();
    const config = configSnap.exists ? configSnap.data() : undefined;
    if (config?.aiEnabled === false) {
      throw new HttpsError(
        "failed-precondition",
        "AI features are temporarily disabled."
      );
    }
    billingEnabled = config?.billingEnabled === true;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    // Config unreachable: fail open on the kill-switch, closed on billing.
    logger.warn("geminiproxy: app_config read failed; proceeding fail-open:", error);
  }

  // 3. Atomic check-and-increment on the household's aiUsage counter.
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(householdRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Household not found.");
    }
    const data = (snap.data() ?? {}) as HouseholdEntitlementData & {
      aiUsage?: AiUsage;
    };

    const cap = getAiDailyCap(data, billingEnabled);

    const usage = data.aiUsage ?? { dailyCount: 0, lastResetDate: today };
    // Day-rollover semantics are MONOTONIC: the counter resets only when the
    // resolved day is strictly LATER than the stored one (yyyy-MM-dd strings
    // compare lexicographically = chronologically), and the stored key never
    // moves backwards. A claimed day equal to or EARLIER than the stored day
    // keeps counting against the stored day — without this, a caller could
    // alternate `today` between two in-clamp dates (resolveQuotaDay allows
    // ±1 day of server UTC) and force a reset on every call, bypassing the
    // cap entirely. Worst case for an adversary is now one early rollover per
    // real day (bounded at 2× cap/day), not unlimited.
    const rolledOver = today > usage.lastResetDate;
    const effectiveDay = rolledOver ? today : usage.lastResetDate;
    const currentCount = rolledOver ? 0 : usage.dailyCount;

    if (currentCount >= cap) {
      // Message must contain "Daily AI quota exceeded" — the client's retry
      // helper carves this exact phrase out of its resource-exhausted retry
      // (a quota rejection can never succeed on retry today).
      throw new HttpsError(
        "resource-exhausted",
        `Daily AI quota exceeded (${cap} requests/day). Try again tomorrow.`
      );
    }

    txn.update(householdRef, {
      aiUsage: { dailyCount: currentCount + 1, lastResetDate: effectiveDay },
    });
  });
}

export const geminiproxy = onCall(
  {
    secrets: [geminiApiKey],
    cors: true,
    // A cold start (container init) plus a slow Gemini generation can run ~30–60s.
    // Keep the function timeout comfortably above the 90s client timeout in
    // geminiService.ts so the client's limit is always the binding, graceful one
    // rather than an opaque function-side cutoff (Plan 014).
    timeoutSeconds: 120,
  },
  async (request): Promise<GeminiProxyResult> => {
    // Only authenticated app users may spend the server-side key.
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const { model, contents, config, householdId, today } = (request.data ??
      {}) as GeminiProxyData;

    // `config` is optional (some callers may omit it), but model + contents are
    // required to perform a meaningful generateContent call.
    if (typeof model !== "string" || !model) {
      throw new HttpsError(
        "invalid-argument",
        "The function must be called with a non-empty 'model' string."
      );
    }
    if (contents === undefined || contents === null) {
      throw new HttpsError(
        "invalid-argument",
        "The function must be called with 'contents'."
      );
    }
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError(
        "invalid-argument",
        "The function must be called with a non-empty 'householdId' string."
      );
    }

    // Membership + kill-switch + atomic daily-quota check-and-increment
    // (Plan 10). Throws before any Gemini call, so an over-cap / non-member
    // request never spends the server-side key. Kept OUTSIDE the try below so
    // its HttpsErrors are not remapped by the upstream-Gemini error mapping.
    await enforceAiQuota(request.auth.uid, householdId, resolveQuotaDay(today));

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      const response = await ai.models.generateContent({
        model,
        // The client assembles these in the exact SDK shape; forward as-is.
        contents: contents as Parameters<typeof ai.models.generateContent>[0]["contents"],
        config: config as Parameters<typeof ai.models.generateContent>[0]["config"],
      });

      // The client reads `response.text` off the SDK result, so return exactly
      // that. Keeping the shape minimal avoids leaking other SDK internals over
      // the wire and keeps the payload JSON-serializable.
      return { text: response.text };
    } catch (error) {
      logger.error("geminiproxy generateContent failed:", error);
      // Preserve the transient-ness of upstream Gemini errors so the client's
      // retry logic (isTransientError + withTimeoutAndRetry) can retry them. A
      // generic "internal" reads as non-transient client-side, which would turn a
      // momentary Gemini 503/429 into a visible failure that the direct SDK path
      // used to retry transparently (Plan 014).
      const status = httpStatusOf(error);
      if (status === 503) {
        throw new HttpsError("unavailable", "Gemini is temporarily unavailable.");
      }
      if (status === 429) {
        throw new HttpsError("resource-exhausted", "Gemini rate limit reached.");
      }
      throw new HttpsError("internal", "Gemini request failed.");
    }
  }
);
