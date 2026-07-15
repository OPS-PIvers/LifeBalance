import { describe, it, expect } from "vitest";
import {
  assembleDailyBriefing,
  type AssembleDailyBriefingInput,
} from "./dataAssembly";

const TODAY = "2026-07-14";

function baseInput(
  overrides: Partial<AssembleDailyBriefingInput> = {}
): AssembleDailyBriefingInput {
  return {
    calendarItems: [],
    transactions: [],
    habits: [],
    today: TODAY,
    ...overrides,
  };
}

describe("assembleDailyBriefing", () => {
  it("returns an all-zero, no-content summary for empty inputs", () => {
    const s = assembleDailyBriefing(baseInput());
    expect(s).toEqual({
      billsDueCount: 0,
      billsDueTotal: 0,
      pendingReviewCount: 0,
      habitsTotal: 0,
      habitsCompleted: 0,
      habitsRemaining: 0,
      streaksAtRisk: 0,
      hasContent: false,
    });
  });

  it("counts unpaid one-off bills due today and sums their amounts", () => {
    const s = assembleDailyBriefing(
      baseInput({
        calendarItems: [
          { id: "b1", date: TODAY, amount: 100 },
          { id: "b2", date: TODAY, amount: 25.5 },
          { id: "b3", date: "2026-07-20", amount: 40 }, // future, not today
          { id: "b4", date: TODAY, amount: 10, isPaid: true }, // paid, excluded
        ],
      })
    );
    expect(s.billsDueCount).toBe(2);
    expect(s.billsDueTotal).toBeCloseTo(125.5);
    expect(s.hasContent).toBe(true);
  });

  it("counts only pending_review transactions", () => {
    const s = assembleDailyBriefing(
      baseInput({
        transactions: [
          { status: "pending_review" },
          { status: "pending_review" },
          { status: "verified" },
        ],
      })
    );
    expect(s.pendingReviewCount).toBe(2);
    expect(s.hasContent).toBe(true);
  });

  it("computes daily habit completion and remaining, ignoring weekly habits", () => {
    const s = assembleDailyBriefing(
      baseInput({
        habits: [
          { period: "daily", completedDates: [TODAY] },
          { period: "daily", completedDates: [] },
          { period: "daily" },
          { period: "weekly", completedDates: [] }, // ignored
        ],
      })
    );
    expect(s.habitsTotal).toBe(3);
    expect(s.habitsCompleted).toBe(1);
    expect(s.habitsRemaining).toBe(2);
    expect(s.hasContent).toBe(true);
  });

  it("flags streaks at risk: 3+ day streak not completed today", () => {
    const s = assembleDailyBriefing(
      baseInput({
        habits: [
          { period: "daily", streakDays: 5, completedDates: [] }, // at risk
          { period: "daily", streakDays: 5, completedDates: [TODAY] }, // safe (done)
          { period: "daily", streakDays: 2, completedDates: [] }, // streak too short
          { period: "weekly", streakDays: 9, completedDates: [] }, // weekly, ignored
        ],
      })
    );
    expect(s.streaksAtRisk).toBe(1);
  });

  it("has no content when every daily habit is done and nothing else is pending", () => {
    const s = assembleDailyBriefing(
      baseInput({
        habits: [
          { period: "daily", streakDays: 4, completedDates: [TODAY] },
          { period: "daily", streakDays: 1, completedDates: [TODAY] },
        ],
      })
    );
    expect(s.habitsRemaining).toBe(0);
    expect(s.streaksAtRisk).toBe(0);
    expect(s.hasContent).toBe(false);
  });

  it("expands a monthly recurring bill onto today", () => {
    const s = assembleDailyBriefing(
      baseInput({
        today: "2026-08-14",
        calendarItems: [
          {
            id: "rent",
            date: "2026-07-14",
            isRecurring: true,
            frequency: "monthly",
            amount: 1500,
          },
        ],
      })
    );
    expect(s.billsDueCount).toBe(1);
    expect(s.billsDueTotal).toBe(1500);
  });
});
