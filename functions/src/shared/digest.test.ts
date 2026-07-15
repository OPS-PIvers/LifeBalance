import { describe, it, expect } from "vitest";
import {
  computeHabitsPending,
  computeStreaksAtRisk,
  computeTodosToday,
  buildDigestMessage,
  type DigestHabit,
  type DigestTodo,
} from "./digest";

describe("computeHabitsPending", () => {
  it("counts daily habits not completed today", () => {
    const habits: DigestHabit[] = [
      { period: "daily", completedDates: ["2026-07-13"] },
      { period: "daily", completedDates: ["2026-07-14"] },
      { period: "weekly", completedDates: [] },
    ];
    expect(computeHabitsPending(habits, "2026-07-14")).toBe(1);
  });

  it("treats a missing completedDates array as not completed", () => {
    expect(computeHabitsPending([{ period: "daily" }], "2026-07-14")).toBe(1);
  });

  it("ignores non-daily habits entirely", () => {
    expect(computeHabitsPending([{ period: "weekly" }], "2026-07-14")).toBe(0);
  });
});

describe("computeStreaksAtRisk", () => {
  it("counts only daily habits with streakDays >= 3 not completed today", () => {
    const habits: DigestHabit[] = [
      { period: "daily", streakDays: 5, completedDates: [] },
      { period: "daily", streakDays: 2, completedDates: [] },
      { period: "daily", streakDays: 5, completedDates: ["2026-07-14"] },
      { period: "weekly", streakDays: 10, completedDates: [] },
    ];
    expect(computeStreaksAtRisk(habits, "2026-07-14")).toBe(1);
  });

  it("treats a missing streakDays as 0", () => {
    expect(computeStreaksAtRisk([{ period: "daily" }], "2026-07-14")).toBe(0);
  });
});

describe("computeTodosToday", () => {
  const todos: DigestTodo[] = [
    { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-14" },
    { assignedTo: "u1", isCompleted: true, completeByDate: "2026-07-14" },
    { assignedTo: "u2", isCompleted: false, completeByDate: "2026-07-14" },
    { assignedTo: "u1", isCompleted: false, completeByDate: "2026-07-15" },
  ];

  it("counts only the given member's incomplete todos due today", () => {
    expect(computeTodosToday(todos, "u1", "2026-07-14")).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    expect(computeTodosToday(todos, "u3", "2026-07-14")).toBe(0);
  });
});

describe("buildDigestMessage", () => {
  const allEnabled = { habits: true, todos: true, streaks: true, bills: true };
  const zeroCounts = {
    habitsPending: 0,
    todosToday: 0,
    streaksAtRisk: 0,
    billsDueCount: 0,
    billsDueTotalFormatted: "$0.00",
  };

  it("returns null when every count is zero", () => {
    expect(buildDigestMessage(zeroCounts, allEnabled)).toBeNull();
  });

  it("returns null when counts are nonzero but the category is disabled", () => {
    const counts = { ...zeroCounts, habitsPending: 3 };
    expect(
      buildDigestMessage(counts, { habits: false, todos: true, streaks: true, bills: true })
    ).toBeNull();
  });

  it("composes a multi-part body in bills, habits, streaks, todos order", () => {
    const counts = {
      habitsPending: 2,
      todosToday: 1,
      streaksAtRisk: 1,
      billsDueCount: 3,
      billsDueTotalFormatted: "$120.00",
    };
    const message = buildDigestMessage(counts, allEnabled);
    expect(message).toEqual({
      title: "Your daily digest",
      body: "3 bills due ($120.00), 2 habits pending, 1 streak at risk, 1 to-do today",
    });
  });

  it("singularizes counts of 1", () => {
    const counts = {
      habitsPending: 1,
      todosToday: 0,
      streaksAtRisk: 0,
      billsDueCount: 1,
      billsDueTotalFormatted: "$10.00",
    };
    const message = buildDigestMessage(counts, allEnabled);
    expect(message?.body).toBe("1 bill due ($10.00), 1 habit pending");
  });

  it("omits parts for categories the member hasn't enabled even with nonzero counts", () => {
    const counts = {
      habitsPending: 2,
      todosToday: 5,
      streaksAtRisk: 0,
      billsDueCount: 0,
      billsDueTotalFormatted: "$0.00",
    };
    const message = buildDigestMessage(counts, {
      habits: true,
      todos: false,
      streaks: true,
      bills: true,
    });
    expect(message?.body).toBe("2 habits pending");
  });
});
