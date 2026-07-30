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
import {
  buildPrompt,
  buildTemplateNarrative,
  generateNarrative,
  pointsTrendPct,
  resolveCeremonyTone,
  selectNarrativeFraming,
} from "./narrative";

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
    const result = await generateNarrative(SAMPLE, "fake-key", "household_first", 50);

    expect(result.source).toBe("template");
    expect(result.text).toBe(buildTemplateNarrative(SAMPLE));
  });
});

// ---------------------------------------------------------------------------
// Tone-aware framing (per-member points, stage 5)
// ---------------------------------------------------------------------------

/** A two-adult contest with the given leader / runner-up point totals. */
function contest(leaderPoints: number, runnerUpPoints: number): RecapNumericFields {
  return {
    ...SAMPLE,
    pointsByMember: [
      { memberId: "u1", name: "Jen", points: leaderPoints },
      { memberId: "u2", name: "Paul", points: runnerUpPoints },
    ],
    totalPoints: leaderPoints + runnerUpPoints,
    priorWeekPoints: 700,
  };
}

describe("resolveCeremonyTone", () => {
  it("maps absent and unrecognised values onto household_first", () => {
    expect(resolveCeremonyTone(undefined)).toBe("household_first");
    expect(resolveCeremonyTone("")).toBe("household_first");
    expect(resolveCeremonyTone("nonsense")).toBe("household_first");
  });

  it("passes through each recognised tone", () => {
    expect(resolveCeremonyTone("podium")).toBe("podium");
    expect(resolveCeremonyTone("adaptive")).toBe("adaptive");
    expect(resolveCeremonyTone("household_first")).toBe("household_first");
  });
});

describe("selectNarrativeFraming", () => {
  it("household_first stays together even on a blowout", () => {
    const framing = selectNarrativeFraming(contest(900, 100), "household_first");
    expect(framing.framing).toBe("together");
    expect(framing.runaway).toBe(true);
  });

  it("podium leads head-to-head even on a close week", () => {
    const framing = selectNarrativeFraming(contest(410, 385), "podium");
    expect(framing.framing).toBe("podium");
    expect(framing.leader?.name).toBe("Jen");
    expect(framing.runnerUp?.name).toBe("Paul");
    expect(framing.margin).toBe(25);
    expect(framing.runaway).toBe(false);
  });

  it("adaptive keeps a close week together and crowns a runaway one", () => {
    expect(selectNarrativeFraming(contest(410, 385), "adaptive").framing).toBe("together");
    expect(selectNarrativeFraming(contest(600, 200), "adaptive").framing).toBe("podium");
  });

  it("never frames a podium without a strict leader (a tie, or a lone scorer)", () => {
    expect(selectNarrativeFraming(contest(400, 400), "podium").framing).toBe("together");
    expect(selectNarrativeFraming(contest(400, 0), "podium").framing).toBe("together");
  });

  it("prefers derived memberFacts over pointsByMember when both are present", () => {
    const recap: RecapNumericFields = {
      ...contest(10, 5),
      memberFacts: [
        {
          memberId: "u2",
          name: "Paul",
          points: 500,
          completions: 20,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
        {
          memberId: "u1",
          name: "Jen",
          points: 100,
          completions: 4,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        },
      ],
    };
    const framing = selectNarrativeFraming(recap, "podium");
    expect(framing.leader?.name).toBe("Paul");
    expect(framing.margin).toBe(400);
  });
});

describe("buildTemplateNarrative — tone", () => {
  it("frames the head-to-head under podium and the household under household_first", () => {
    const recap = contest(410, 385);
    expect(buildTemplateNarrative(recap, "podium")).toContain(
      "Jen edged out the week with 410 points to Paul's 385"
    );
    expect(buildTemplateNarrative(recap, "household_first")).toContain("5 habit completions");
  });

  it("says 'ran away with' only for a runaway margin", () => {
    expect(buildTemplateNarrative(contest(600, 200), "podium")).toContain("ran away with the week");
    expect(buildTemplateNarrative(contest(410, 385), "podium")).toContain("edged out the week");
  });

  it("defaults to household_first when no tone is passed (pre-stage-5 behaviour)", () => {
    expect(buildTemplateNarrative(contest(600, 200))).toBe(
      buildTemplateNarrative(contest(600, 200), "household_first")
    );
  });
});

describe("pointsTrendPct", () => {
  it("returns null without a usable prior week", () => {
    expect(pointsTrendPct(SAMPLE)).toBeNull();
    expect(pointsTrendPct({ ...SAMPLE, totalPoints: 100, priorWeekPoints: 0 })).toBeNull();
  });

  it("rounds the percent change against the prior week", () => {
    expect(pointsTrendPct({ ...SAMPLE, totalPoints: 795, priorWeekPoints: 710 })).toBe(12);
    expect(pointsTrendPct({ ...SAMPLE, totalPoints: 500, priorWeekPoints: 1000 })).toBe(-50);
  });
});

describe("buildPrompt", () => {
  it("instructs the model to lead with the head-to-head under a podium framing", () => {
    const prompt = buildPrompt(contest(600, 200), "podium");
    expect(prompt).toContain("Lead with the head-to-head");
    expect(prompt).toContain("Jen finished ahead of Paul by 400 points");
  });

  it("instructs the model to lead with the household otherwise, and never to crown", () => {
    const prompt = buildPrompt(contest(600, 200), "household_first");
    expect(prompt).toContain("do not crown a winner");
    expect(prompt).not.toContain("Lead with the head-to-head");
  });
});
