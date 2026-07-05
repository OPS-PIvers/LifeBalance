import { describe, it, expect } from "vitest";
import {
  assembleWeeklyRecap,
  type DataAssemblyInput,
  type RecapCalendarItem,
  type RecapHabit,
  type RecapMember,
  type RecapTransaction,
} from "./dataAssembly";

// Recap week: Mon 2026-06-29 through Sun 2026-07-05.
const WEEK_START = "2026-06-29";
const WEEK_END = "2026-07-05";

function baseInput(overrides: Partial<DataAssemblyInput> = {}): DataAssemblyInput {
  return {
    transactions: [],
    habits: [],
    members: [],
    calendarItems: [],
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    ...overrides,
  };
}

describe("assembleWeeklyRecap", () => {
  it("returns all-zero/empty output for a completely empty household", () => {
    const result = assembleWeeklyRecap(baseInput());
    expect(result).toEqual({
      totalSpend: 0,
      priorWeekSpend: 0,
      topCategoryDeltas: [],
      habitCompletions: 0,
      streaksAtRisk: [],
      pointsByMember: [],
      upcomingBills: [],
    });
  });

  it("handles a week with no transactions but other data present", () => {
    const habits: RecapHabit[] = [
      { title: "Read", completedDates: [], streakDays: 0 },
    ];
    const members: RecapMember[] = [
      { uid: "u1", displayName: "Alex", points: { daily: 0, weekly: 0, total: 0 } },
    ];
    const result = assembleWeeklyRecap(baseInput({ habits, members }));
    expect(result.totalSpend).toBe(0);
    expect(result.priorWeekSpend).toBe(0);
    expect(result.habitCompletions).toBe(0);
    expect(result.pointsByMember).toEqual([{ memberId: "u1", name: "Alex", points: 0 }]);
  });

  it("only counts verified, non-income transactions within the week window", () => {
    const transactions: RecapTransaction[] = [
      { amount: 50, category: "Groceries", date: "2026-06-30", status: "verified" },
      // pending_review — excluded
      { amount: 999, category: "Groceries", date: "2026-06-30", status: "pending_review" },
      // income — excluded
      { amount: 2000, category: "Income", date: "2026-07-01", status: "verified" },
      // outside the week window — excluded
      { amount: 100, category: "Groceries", date: "2026-06-20", status: "verified" },
      // on the last day of the week — included
      { amount: 25, category: "Dining", date: WEEK_END, status: "verified" },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.totalSpend).toBe(75);
  });

  it("sums decimal amounts exactly via cents (no floating point drift)", () => {
    const transactions: RecapTransaction[] = [
      { amount: 0.1, category: "Misc", date: "2026-06-30", status: "verified" },
      { amount: 0.2, category: "Misc", date: "2026-07-01", status: "verified" },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.totalSpend).toBe(0.3);
  });

  it("computes prior-week spend from the 7 days immediately before the recap week", () => {
    const transactions: RecapTransaction[] = [
      // Prior week: Mon 2026-06-22 through Sun 2026-06-28.
      { amount: 40, category: "Groceries", date: "2026-06-22", status: "verified" },
      { amount: 10, category: "Groceries", date: "2026-06-28", status: "verified" },
      // Not prior week (one day too early).
      { amount: 5, category: "Groceries", date: "2026-06-21", status: "verified" },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.priorWeekSpend).toBe(50);
  });

  it("computes top 3 category deltas sorted by absolute delta descending", () => {
    const transactions: RecapTransaction[] = [
      // Groceries: current 100, prior 20 -> delta 80
      { amount: 100, category: "Groceries", date: "2026-06-30", status: "verified" },
      { amount: 20, category: "Groceries", date: "2026-06-23", status: "verified" },
      // Dining: current 10, prior 60 -> delta 50
      { amount: 10, category: "Dining", date: "2026-06-30", status: "verified" },
      { amount: 60, category: "Dining", date: "2026-06-23", status: "verified" },
      // Gas: current 30, prior 0 -> delta 30
      { amount: 30, category: "Gas", date: "2026-06-30", status: "verified" },
      // Utilities: current 5, prior 0 -> delta 5 (should be excluded, only top 3)
      { amount: 5, category: "Utilities", date: "2026-06-30", status: "verified" },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.topCategoryDeltas).toEqual([
      { category: "Groceries", current: 100, prior: 20 },
      { category: "Dining", current: 10, prior: 60 },
      { category: "Gas", current: 30, prior: 0 },
    ]);
  });

  it("groups mixed-cased category names as one category, keeping first-seen casing", () => {
    const transactions: RecapTransaction[] = [
      { amount: 30, category: "Groceries", date: "2026-06-30", status: "verified" },
      { amount: 20, category: "groceries", date: "2026-07-01", status: "verified" },
      // lowercase income must still be excluded
      { amount: 500, category: "income", date: "2026-07-01", status: "verified" },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.totalSpend).toBe(50);
    expect(result.topCategoryDeltas).toEqual([
      { category: "Groceries", current: 50, prior: 0 },
    ]);
  });

  it("excludes categories with zero delta from topCategoryDeltas", () => {
    const transactions: RecapTransaction[] = [
      { amount: 20, category: "Same", date: "2026-06-30", status: "verified" },
      { amount: 20, category: "Same", date: "2026-06-23", status: "verified" },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.topCategoryDeltas).toEqual([]);
  });

  it("counts habit completions that fall within the recap week", () => {
    const habits: RecapHabit[] = [
      {
        title: "Exercise",
        completedDates: ["2026-06-29", "2026-07-01", "2026-06-20"],
        streakDays: 2,
      },
      { title: "Meditate", completedDates: [WEEK_END], streakDays: 1 },
    ];
    const result = assembleWeeklyRecap(baseInput({ habits }));
    // 2 dates from Exercise within window + 1 from Meditate = 3.
    expect(result.habitCompletions).toBe(3);
  });

  it("flags a habit as streak-at-risk when streakDays >= 3 and week's last day not completed", () => {
    const habits: RecapHabit[] = [
      { title: "Exercise", completedDates: ["2026-07-01"], streakDays: 5 },
    ];
    const result = assembleWeeklyRecap(baseInput({ habits }));
    expect(result.streaksAtRisk).toEqual([{ habitTitle: "Exercise", streakDays: 5 }]);
  });

  it("does NOT flag a habit as at-risk when the week's last day IS completed", () => {
    const habits: RecapHabit[] = [
      { title: "Exercise", completedDates: [WEEK_END], streakDays: 5 },
    ];
    const result = assembleWeeklyRecap(baseInput({ habits }));
    expect(result.streaksAtRisk).toEqual([]);
  });

  it("does NOT flag a habit as at-risk when streakDays < 3, even if last day missed", () => {
    const habits: RecapHabit[] = [
      { title: "Exercise", completedDates: ["2026-07-01"], streakDays: 2 },
    ];
    const result = assembleWeeklyRecap(baseInput({ habits }));
    expect(result.streaksAtRisk).toEqual([]);
  });

  it("maps pointsByMember from each member's stored weekly points", () => {
    const members: RecapMember[] = [
      { uid: "u1", displayName: "Alex", points: { daily: 1, weekly: 30, total: 500 } },
      { uid: "u2", displayName: "Sam", points: { daily: 0, weekly: 10, total: 100 } },
    ];
    const result = assembleWeeklyRecap(baseInput({ members }));
    expect(result.pointsByMember).toEqual([
      { memberId: "u1", name: "Alex", points: 30 },
      { memberId: "u2", name: "Sam", points: 10 },
    ]);
  });

  it("collects upcoming expense calendar items in the 7 days after the recap week", () => {
    const calendarItems: RecapCalendarItem[] = [
      { title: "Rent", amount: 1500, date: "2026-07-06", type: "expense" },
      { title: "Paycheck", amount: 2000, date: "2026-07-06", type: "income" },
      { title: "Too far", amount: 20, date: "2026-07-13", type: "expense" },
      { title: "In window edge", amount: 40, date: "2026-07-12", type: "expense" },
    ];
    const result = assembleWeeklyRecap(baseInput({ calendarItems }));
    expect(result.upcomingBills).toEqual([
      { title: "Rent", amount: 1500, date: "2026-07-06" },
      { title: "In window edge", amount: 40, date: "2026-07-12" },
    ]);
  });
});
