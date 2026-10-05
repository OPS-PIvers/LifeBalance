/**
 * `walltts`: speaks a short phrase for the wall (a voice confirmation, an
 * event alert, a line of the day brief) with Google Cloud Text-to-Speech.
 * Members and the household's active display may call it.
 *
 * Auth to Google uses the function's own service account (no API key), so
 * the only setup is enabling the Text-to-Speech API on the project. When
 * this fails the wall falls back to the iPad's built-in voice.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { requireHouseholdId, requireMemberOrDisplay } from "./auth";
import { getGoogleAccessToken } from "./googleAuth";
import { TTS_URL, nextTtsUsage, ttsRequestBody, ttsText } from "./ttsLogic";

export const walltts = onCall(
  { cors: true, timeoutSeconds: 20 },
  async (request): Promise<{ audioContent: string; mimeType: string }> => {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const householdId = requireHouseholdId(data.householdId);
    await requireMemberOrDisplay(request, householdId);
    const text = ttsText(data.text);
    if (!text) throw new HttpsError("invalid-argument", "Nothing to say, or too much at once.");

    const db = admin.firestore();
    const usageRef = db.doc(`households/${householdId}/apiUsage/wallTts`);
    const today = new Date().toISOString().slice(0, 10);
    await db.runTransaction(async (txn) => {
      const next = nextTtsUsage((await txn.get(usageRef)).data(), today);
      if (!next) throw new HttpsError("resource-exhausted", "The wall has spoken a lot today. It uses the iPad's voice until tomorrow.");
      txn.set(usageRef, next);
    });

    let res: Response;
    try {
      res = await fetch(TTS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getGoogleAccessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(ttsRequestBody(text)),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logger.warn("walltts: request failed", { householdId, error: String(error) });
      throw new HttpsError("unavailable", "Couldn't reach the speech service.");
    }
    if (!res.ok) {
      // Never log the text: it's household content.
      logger.error("walltts: speech service refused", { householdId, status: res.status, body: (await res.text()).slice(0, 300) });
      throw new HttpsError("unavailable", "The speech service isn't available. Is the Text-to-Speech API enabled?");
    }
    const body = (await res.json()) as { audioContent?: unknown };
    if (typeof body.audioContent !== "string") throw new HttpsError("unavailable", "The speech service sent no audio.");
    return { audioContent: body.audioContent, mimeType: "audio/mpeg" };
  }
);
