import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RecapNumericFields } from "./narrative";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Import AFTER mocks are registered.
import { buildTemplateNarrative, generateNarrative } from "./narrative";

const SAMPLE: RecapNumericFields = {
  totalSpend: 120.5,
  priorWeekSpend: 80,
  topCategoryDeltas: [{ category: "Groceries", current: 100, prior: 60 }],
  habitCompletions: 5,
  streaksAtRisk: [{ habitTitle: "Exercise", streakDays: 4 }],
  pointsByMember: [{ memberId: "u1", name: "Alex", points: 30 }],
  upcomingBills: [{ title: "Rent", amount: 1500, date: "2026-07-06" }],
};

const EMPTY_SAMPLE: RecapNumericFields = {
  totalSpend: 0,
  priorWeekSpend: 0,
  topCategoryDeltas: [],
  habitCompletions: 0,
  streaksAtRisk: [],
  pointsByMember: [],
  upcomingBills: [],
};

describe("buildTemplateNarrative", () => {
  it("is deterministic for the same input", () => {
    expect(buildTemplateNarrative(SAMPLE)).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("produces a readable sentence mentioning spend and habits", () => {
    const text = buildTemplateNarrative(SAMPLE);
    expect(text).toContain("$120.50");
    expect(text).toContain("$80.00");
    expect(text).toContain("5 habit completions");
    expect(text).toContain("1 streak at risk");
  });

  it("handles a fully empty week gracefully", () => {
    const text = buildTemplateNarrative(EMPTY_SAMPLE);
    expect(text).toContain("No verified spending was logged this week.");
    expect(text).toContain("No habit activity was logged this week");
  });
});

describe("generateNarrative", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns source 'ai' on a successful Gemini call", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "Great week! Keep saving." });

    const result = await generateNarrative(SAMPLE, "fake-key");

    expect(result).toEqual({ text: "Great week! Keep saving.", source: "ai" });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the template when Gemini throws", async () => {
    generateContentMock.mockRejectedValueOnce(new Error("upstream failure"));

    const result = await generateNarrative(SAMPLE, "fake-key");

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("falls back to the template when Gemini returns a malformed/empty response", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "" });

    const result = await generateNarrative(SAMPLE, "fake-key");

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });

  it("falls back to the template when Gemini hangs past the timeout", async () => {
    generateContentMock.mockImplementationOnce(
      () => new Promise(() => {
        // Never resolves — simulates a hang.
      })
    );

    // Inject a short timeout so the test doesn't wait the real 30 seconds.
    const result = await generateNarrative(SAMPLE, "fake-key", 50);

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });
});
