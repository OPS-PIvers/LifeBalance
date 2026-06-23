/**
 * Tests for the callable `geminiproxy` Cloud Function.
 *
 * Mirrors index.test.ts's mocking style:
 *   - `onCall(opts, handler)` is mocked to return the raw handler so we can call
 *     it directly as `(request) => Promise<unknown>`. `HttpsError` is a real-ish
 *     class that records its `code` so we can assert on rejection codes.
 *   - `firebase-functions/params` `defineSecret` returns a stub whose `.value()`
 *     yields a fake key (the real secret is never set in tests).
 *   - `@google/genai`'s `GoogleGenAI` is mocked so we can assert what the proxy
 *     forwards to `generateContent` and control its `{ text }` result.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// firebase-functions mocks
// ---------------------------------------------------------------------------

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
  HttpsError: MockHttpsError,
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({ value: () => "test-secret-key" }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// @google/genai mock — single shared, reconfigurable generateContent
// ---------------------------------------------------------------------------

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

// Import AFTER mocks are registered. Functions use relative imports.
import { geminiproxy } from "./geminiProxy";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type CallableHandler = (request: unknown) => Promise<unknown>;

function asCallable(fn: unknown): CallableHandler {
  return fn as CallableHandler;
}

const AUTH = { uid: "user1" };
const VALID_DATA = {
  model: "gemini-3-flash-preview",
  contents: { parts: [{ text: "hello" }] },
  config: { responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  generateContentMock.mockResolvedValue({ text: '{"ok":true}' });
});

// ===========================================================================
// geminiproxy
// ===========================================================================

describe("geminiproxy", () => {
  it("rejects unauthenticated requests", async () => {
    await expect(
      asCallable(geminiproxy)({ data: VALID_DATA })
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a missing model with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { contents: VALID_DATA.contents, config: VALID_DATA.config },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string model with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { ...VALID_DATA, model: 123 },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects missing contents with invalid-argument", async () => {
    await expect(
      asCallable(geminiproxy)({
        auth: AUTH,
        data: { model: VALID_DATA.model, config: VALID_DATA.config },
      })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("forwards { model, contents, config } and returns the proxied { text }", async () => {
    generateContentMock.mockResolvedValue({ text: '{"merchant":"Target"}' });

    const result = await asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA });

    expect(result).toEqual({ text: '{"merchant":"Target"}' });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock).toHaveBeenCalledWith({
      model: VALID_DATA.model,
      contents: VALID_DATA.contents,
      config: VALID_DATA.config,
    });
  });

  it("maps an SDK failure to an internal HttpsError", async () => {
    generateContentMock.mockRejectedValue(new Error("upstream 503"));

    await expect(
      asCallable(geminiproxy)({ auth: AUTH, data: VALID_DATA })
    ).rejects.toMatchObject({ code: "internal" });
  });
});
