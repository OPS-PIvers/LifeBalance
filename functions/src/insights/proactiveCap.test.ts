import { describe, it, expect } from "vitest";
import {
  checkAndIncrementProactiveCap,
  MAX_PROACTIVE_INSIGHTS_PER_WEEK,
} from "./proactiveCap";

describe("checkAndIncrementProactiveCap", () => {
  it("allows the first write for a household with no tracking state yet", () => {
    const result = checkAndIncrementProactiveCap({}, "2026-W27");
    expect(result.allowed).toBe(true);
    expect(result.patch).toEqual({
      proactiveInsightWeek: "2026-W27",
      proactiveInsightCount: 1,
    });
  });

  it("allows a second write in the same week", () => {
    const result = checkAndIncrementProactiveCap(
      { proactiveInsightWeek: "2026-W27", proactiveInsightCount: 1 },
      "2026-W27"
    );
    expect(result.allowed).toBe(true);
    expect(result.patch).toEqual({
      proactiveInsightWeek: "2026-W27",
      proactiveInsightCount: 2,
    });
  });

  it("denies a third write in the same week (cap enforced at 2/week)", () => {
    const result = checkAndIncrementProactiveCap(
      { proactiveInsightWeek: "2026-W27", proactiveInsightCount: 2 },
      "2026-W27"
    );
    expect(result.allowed).toBe(false);
    expect(result.patch).toBeUndefined();
  });

  it("denies further writes even if the count somehow exceeds the cap", () => {
    const result = checkAndIncrementProactiveCap(
      { proactiveInsightWeek: "2026-W27", proactiveInsightCount: 5 },
      "2026-W27"
    );
    expect(result.allowed).toBe(false);
  });

  it("resets the count when the ISO week changes (rollover)", () => {
    const result = checkAndIncrementProactiveCap(
      { proactiveInsightWeek: "2026-W26", proactiveInsightCount: 2 },
      "2026-W27"
    );
    expect(result.allowed).toBe(true);
    expect(result.patch).toEqual({
      proactiveInsightWeek: "2026-W27",
      proactiveInsightCount: 1,
    });
  });

  it("exposes the cap constant as 2", () => {
    expect(MAX_PROACTIVE_INSIGHTS_PER_WEEK).toBe(2);
  });
});
