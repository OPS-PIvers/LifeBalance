import { describe, expect, it } from "vitest";
import { TTS_DAILY_CAP, TTS_MAX_CHARS, nextTtsUsage, ttsRequestBody, ttsText } from "./ttsLogic";

describe("ttsText", () => {
  it("collapses whitespace", () => {
    expect(ttsText("  Added   milk\nto shopping. ")).toBe("Added milk to shopping.");
  });

  it("refuses empty, non-string and over-long text", () => {
    expect(ttsText("   ")).toBeNull();
    expect(ttsText(42)).toBeNull();
    expect(ttsText("a".repeat(TTS_MAX_CHARS + 1))).toBeNull();
    expect(ttsText("a".repeat(TTS_MAX_CHARS))).toHaveLength(TTS_MAX_CHARS);
  });
});

describe("nextTtsUsage", () => {
  it("starts a new day at one", () => {
    expect(nextTtsUsage(undefined, "2026-10-05")).toEqual({ date: "2026-10-05", count: 1 });
    expect(nextTtsUsage({ date: "2026-10-04", count: 499 }, "2026-10-05")).toEqual({ date: "2026-10-05", count: 1 });
  });

  it("counts up and stops at the cap", () => {
    expect(nextTtsUsage({ date: "2026-10-05", count: 3 }, "2026-10-05")).toEqual({ date: "2026-10-05", count: 4 });
    expect(nextTtsUsage({ date: "2026-10-05", count: TTS_DAILY_CAP }, "2026-10-05")).toBeNull();
  });
});

describe("ttsRequestBody", () => {
  it("asks for MP3 in a US English voice", () => {
    const body = ttsRequestBody("Hi") as { input: unknown; voice: { languageCode: string }; audioConfig: unknown };
    expect(body.input).toEqual({ text: "Hi" });
    expect(body.voice.languageCode).toBe("en-US");
    expect(body.audioConfig).toEqual({ audioEncoding: "MP3" });
  });
});
