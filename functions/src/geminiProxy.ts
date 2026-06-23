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
 * parsing stay in the client (services/geminiService.ts). The function only
 * forwards the already-assembled `{ model, contents, config }` to
 * `ai.models.generateContent` and returns the plain `{ text }` the client reads
 * off the SDK response — so the client can consume it identically to the direct
 * SDK path it uses today.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";

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
}

/** Plain, JSON-serializable result the client consumes the same way it reads the SDK response. */
interface GeminiProxyResult {
  text: string | undefined;
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

    const { model, contents, config } = (request.data ?? {}) as GeminiProxyData;

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
      throw new HttpsError("internal", "Gemini request failed.");
    }
  }
);
