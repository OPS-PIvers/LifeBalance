/**
 * GET/POST /voicemisses — the wall's voice miss log for the nightly
 * voice-learning routine (.claude/skills/voice-learning/SKILL.md, docs/DECISIONS.md
 * "Voice misses").
 *
 *  - GET  → the household's misses, oldest first (expired ones are deleted,
 *           never returned).
 *  - POST `{ "delete": [id, …] }` → deletes exactly those misses (the ones the
 *           run read), so misses logged during the run survive to the next.
 *
 * Authenticated by a household `lb_…` API key with the `voiceLearning` scope
 * (Authorization: Bearer). The key only ever reaches its own household. The
 * misses' text is never written to logs or the API call audit trail.
 */
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { checkRateLimit, extractApiKey, hasScope, logApiCall, validateApiKey } from "../quickAdd/apiKeyValidation";
import { VOICE_MISS_PAGE, isExpired, parseDeleteBody, sortMisses, toExportedMiss, type ExportedVoiceMiss } from "./voiceMissesLogic";

const db = admin.firestore();

function fail(res: { status(code: number): { json(body: unknown): void } }, status: number, message: string, code: string): void {
  res.status(status).json({ success: false, message, error: { code } });
}

export const voicemisses = onRequest({ cors: false, region: "us-central1" }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    fail(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
    return;
  }
  // Authorization header only: never a query-string key.
  const apiKey = extractApiKey(req.headers.authorization);
  if (!apiKey) {
    fail(res, 401, "Missing or invalid Authorization header", "UNAUTHORIZED");
    return;
  }
  const validation = await validateApiKey(apiKey);
  if (!validation.valid || !validation.householdId) {
    fail(res, 401, validation.error || "Invalid API key", "UNAUTHORIZED");
    return;
  }
  const { householdId, permissions } = validation;
  if (!hasScope(permissions, "voiceLearning")) {
    fail(res, 403, "API key does not have the voiceLearning permission", "FORBIDDEN");
    return;
  }
  const rateLimit = await checkRateLimit(householdId, "voiceLearning");
  if (!rateLimit.allowed) {
    res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
    fail(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
    return;
  }

  const misses = db.collection(`households/${householdId}/voiceMisses`);
  const keyPrefix = apiKey.substring(0, 16);
  try {
    if (req.method === "GET") {
      // Oldest first, so a backlog over one page drains in order (single-field index: automatic).
      const snap = await misses.orderBy("at").limit(VOICE_MISS_PAGE).get();
      const now = Date.now();
      const batch = db.batch();
      let expired = 0;
      const live: ExportedVoiceMiss[] = [];
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (isExpired(data, now)) {
          batch.delete(d.ref);
          expired += 1;
        } else {
          live.push(toExportedMiss(d.id, data));
        }
      }
      if (expired > 0) await batch.commit();
      const sorted = sortMisses(live);
      await logApiCall(householdId, keyPrefix, "voiceMisses:list", { count: sorted.length, expired }, 200);
      res.status(200).json({ success: true, data: { misses: sorted, count: sorted.length, more: snap.size === VOICE_MISS_PAGE } });
      return;
    }

    const parsed = parseDeleteBody(req.body);
    if ("error" in parsed) {
      fail(res, 400, parsed.error, "BAD_REQUEST");
      return;
    }
    const batch = db.batch();
    for (const id of parsed.ids) batch.delete(misses.doc(id));
    if (parsed.ids.length > 0) await batch.commit();
    await logApiCall(householdId, keyPrefix, "voiceMisses:delete", { count: parsed.ids.length }, 200);
    res.status(200).json({ success: true, data: { deleted: parsed.ids.length } });
  } catch (error) {
    logger.error("Error in voicemisses:", error);
    await logApiCall(householdId, keyPrefix, `voiceMisses:${req.method}`, {}, 500);
    fail(res, 500, "Internal server error", "INTERNAL_ERROR");
  }
});
