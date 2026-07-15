import { describe, it, expect } from "vitest";
import { buildTemplateNarrative } from "./narrative";
import { type DailyBriefingSummary } from "./dataAssembly";

function summary(
  overrides: Partial<DailyBriefingSummary> = {}
): DailyBriefingSummary {
  return {
    billsDueCount: 0,
    billsDueTotal: 0,
    pendingReviewCount: 0,
    habitsTotal: 0,
    habitsCompleted: 0,
    habitsRemaining: 0,
    streaksAtRisk: 0,
    hasContent: true,
    ...overrides,
  };
}

describe("buildTemplateNarrative", () => {
  it("mentions bills, pending, and habits with correct pluralization", () => {
    const text = buildTemplateNarrative(
      summary({
        billsDueCount: 2,
        billsDueTotal: 125.5,
        pendingReviewCount: 1,
        habitsTotal: 4,
        habitsRemaining: 3,
      })
    );
    expect(text).toContain("2 bills due today ($125.50)");
    expect(text).toContain("1 transaction to review");
    expect(text).toContain("3 habits left to check off");
  });

  it("uses singular nouns for single items", () => {
    const text = buildTemplateNarrative(
      summary({ billsDueCount: 1, billsDueTotal: 50, habitsRemaining: 1 })
    );
    expect(text).toContain("1 bill due today ($50.00)");
    expect(text).toContain("1 habit left to check off");
  });

  it("appends a streak-at-risk warning when applicable", () => {
    const text = buildTemplateNarrative(
      summary({ habitsRemaining: 1, streaksAtRisk: 2 })
    );
    expect(text).toContain("2 streaks are at risk");
    expect(text).toContain("don't let them slip");
  });

  it("joins three clauses with an Oxford comma", () => {
    const text = buildTemplateNarrative(
      summary({
        billsDueCount: 1,
        billsDueTotal: 10,
        pendingReviewCount: 2,
        habitsRemaining: 3,
      })
    );
    expect(text).toContain(", and 3 habits left to check off.");
  });

  it("still produces a caught-up lead when only a streak is at risk", () => {
    // habitsRemaining 0 but streaksAtRisk>0 is an inconsistent-looking edge;
    // the template should not crash and should surface the streak warning.
    const text = buildTemplateNarrative(summary({ streaksAtRisk: 1 }));
    expect(text).toContain("all caught up");
    expect(text).toContain("1 streak is at risk");
  });
});
