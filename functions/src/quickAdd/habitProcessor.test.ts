/**
 * Unit tests for the Cloud Function habit-processing logic.
 *
 * Tests are picked up by the root Vitest runner (vite.config.ts) and do NOT
 * go through the functions TypeScript compiler — `functions/tsconfig.json`
 * excludes `**‌/*.test.ts` so the functions build stays clean.
 *
 * The modules under test (`streakLogic.ts`, `habitProcessor.ts`) have no
 * firebase-admin dependency, so they run in a plain jsdom/Node environment
 * without any mocking of the Admin SDK.
 */

import { describe, it, expect } from "vitest";
import {
  format,
  subDays,
  startOfISOWeek,
  subWeeks,
  parseISO,
} from "date-fns";
import {
  calculateStreak,
  calculateWeeklyStreak,
  streakForPeriod,
  getMultiplier,
} from "./streakLogic";
import { processToggleHabit, Habit } from "./habitProcessor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const today = format(new Date(), "yyyy-MM-dd");
const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

/** Build an array of consecutive date strings ending on `endDate` going back `n` days. */
function buildDailyDates(endDate: string, count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(format(subDays(parseISO(endDate), i), "yyyy-MM-dd"));
  }
  return dates;
}

/** Build a date string for the Monday of the ISO week `weeksAgo` weeks before the current week. */
function isoWeekMonday(weeksAgo: number): string {
  return format(subWeeks(startOfISOWeek(new Date()), weeksAgo), "yyyy-MM-dd");
}

/** Minimal valid Habit fixture (daily, threshold, positive). */
const baseHabit: Habit = {
  id: "h1",
  title: "Test Habit",
  category: "Health",
  type: "positive",
  basePoints: 10,
  scoringType: "threshold",
  period: "daily",
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// getMultiplier — daily thresholds
// ---------------------------------------------------------------------------

describe("getMultiplier — daily", () => {
  it("returns 1.0 for streak 1 (no bonus)", () => {
    expect(getMultiplier(1, true, "daily")).toBe(1.0);
  });

  it("returns 1.0 for streak 2 (just below 1.5x threshold)", () => {
    expect(getMultiplier(2, true, "daily")).toBe(1.0);
  });

  it("returns 1.5 for streak 3 (lower boundary of 1.5x)", () => {
    expect(getMultiplier(3, true, "daily")).toBe(1.5);
  });

  it("returns 1.5 for streak 6 (upper boundary before 2.0x)", () => {
    expect(getMultiplier(6, true, "daily")).toBe(1.5);
  });

  it("returns 2.0 for streak 7 (lower boundary of 2.0x)", () => {
    expect(getMultiplier(7, true, "daily")).toBe(2.0);
  });

  it("returns 2.0 for streak 100 (well above threshold)", () => {
    expect(getMultiplier(100, true, "daily")).toBe(2.0);
  });

  it("returns 1.0 for a negative habit regardless of streak (no bonus)", () => {
    expect(getMultiplier(10, false, "daily")).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// getMultiplier — weekly thresholds
// ---------------------------------------------------------------------------

describe("getMultiplier — weekly", () => {
  it("returns 1.0 for streak 1 (no bonus)", () => {
    expect(getMultiplier(1, true, "weekly")).toBe(1.0);
  });

  it("returns 1.5 for streak 2 (lower boundary of 1.5x)", () => {
    expect(getMultiplier(2, true, "weekly")).toBe(1.5);
  });

  it("returns 1.5 for streak 3 (upper boundary before 2.0x)", () => {
    expect(getMultiplier(3, true, "weekly")).toBe(1.5);
  });

  it("returns 2.0 for streak 4 (lower boundary of 2.0x)", () => {
    expect(getMultiplier(4, true, "weekly")).toBe(2.0);
  });

  it("returns 2.0 for streak 10 (well above threshold)", () => {
    expect(getMultiplier(10, true, "weekly")).toBe(2.0);
  });

  it("returns 1.0 for a negative habit regardless of streak", () => {
    expect(getMultiplier(5, false, "weekly")).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// calculateStreak — daily helpers
// ---------------------------------------------------------------------------

describe("calculateStreak (daily)", () => {
  it("returns 0 for empty dates", () => {
    expect(calculateStreak([])).toBe(0);
  });

  it("returns 1 for a single completion today", () => {
    expect(calculateStreak([today])).toBe(1);
  });

  it("returns 1 for a single completion yesterday (streak still alive)", () => {
    expect(calculateStreak([yesterday])).toBe(1);
  });

  it("returns 0 when most recent completion is 2 days ago", () => {
    const twoDaysAgo = format(subDays(new Date(), 2), "yyyy-MM-dd");
    expect(calculateStreak([twoDaysAgo])).toBe(0);
  });

  it("calculates a 7-day streak correctly", () => {
    const dates = buildDailyDates(today, 7);
    expect(calculateStreak(dates)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// calculateWeeklyStreak — ISO-week-based streak
// ---------------------------------------------------------------------------

describe("calculateWeeklyStreak (weekly)", () => {
  it("returns 0 for empty dates", () => {
    expect(calculateWeeklyStreak([])).toBe(0);
  });

  it("returns 1 for a completion in the current ISO week only", () => {
    // Monday of the current week is always in the current week.
    const thisWeekMonday = isoWeekMonday(0);
    expect(calculateWeeklyStreak([thisWeekMonday])).toBe(1);
  });

  it("returns 1 for a completion in the previous ISO week only", () => {
    const lastWeekMonday = isoWeekMonday(1);
    expect(calculateWeeklyStreak([lastWeekMonday])).toBe(1);
  });

  it("returns 0 when most recent completion is 2 full ISO weeks ago", () => {
    const twoWeeksAgoMonday = isoWeekMonday(2);
    expect(calculateWeeklyStreak([twoWeeksAgoMonday])).toBe(0);
  });

  it("returns 2 for completions in the current + previous ISO week", () => {
    const thisWeekMonday = isoWeekMonday(0);
    const lastWeekMonday = isoWeekMonday(1);
    expect(calculateWeeklyStreak([thisWeekMonday, lastWeekMonday])).toBe(2);
  });

  it("returns 3 for completions in 3 consecutive ISO weeks", () => {
    const dates = [isoWeekMonday(0), isoWeekMonday(1), isoWeekMonday(2)];
    expect(calculateWeeklyStreak(dates)).toBe(3);
  });

  it("returns 4 for completions in 4 consecutive ISO weeks", () => {
    const dates = [
      isoWeekMonday(0),
      isoWeekMonday(1),
      isoWeekMonday(2),
      isoWeekMonday(3),
    ];
    expect(calculateWeeklyStreak(dates)).toBe(4);
  });

  it("does NOT reset the streak for a ~7-day gap within the SAME ISO week", () => {
    // Two completions: one on Thursday this week and one on Wednesday last week.
    // That is approximately 8 days apart, yet they are in consecutive ISO weeks —
    // the streak should be 2, not 0.
    const thisThursday = format(
      new Date(isoWeekMonday(0) + "T00:00:00").setDate(
        new Date(isoWeekMonday(0)).getDate() + 3
      ),
      "yyyy-MM-dd"
    );
    const lastWednesday = format(
      new Date(isoWeekMonday(1) + "T00:00:00").setDate(
        new Date(isoWeekMonday(1)).getDate() + 2
      ),
      "yyyy-MM-dd"
    );
    // Verify these are genuinely in different ISO weeks (sanity check).
    const thisWeekStart = isoWeekMonday(0);
    const lastWeekStart = isoWeekMonday(1);
    expect(format(startOfISOWeek(new Date(thisThursday)), "yyyy-MM-dd")).toBe(
      thisWeekStart
    );
    expect(format(startOfISOWeek(new Date(lastWednesday)), "yyyy-MM-dd")).toBe(
      lastWeekStart
    );

    // Now the actual assertion: consecutive ISO weeks → streak 2.
    expect(calculateWeeklyStreak([thisThursday, lastWednesday])).toBe(2);
  });

  it("deduplicates multiple completions within the same ISO week", () => {
    const thisWeekMonday = isoWeekMonday(0);
    const thisWeekTuesday = format(
      new Date(thisWeekMonday + "T00:00:00").setDate(
        new Date(thisWeekMonday).getDate() + 1
      ),
      "yyyy-MM-dd"
    );
    // Two completions in the same week should still count as streak 1.
    expect(calculateWeeklyStreak([thisWeekMonday, thisWeekTuesday])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// streakForPeriod — dispatch helper
// ---------------------------------------------------------------------------

describe("streakForPeriod", () => {
  it("delegates to calculateStreak for 'daily'", () => {
    const dates = buildDailyDates(today, 3);
    expect(streakForPeriod(dates, "daily")).toBe(calculateStreak(dates));
  });

  it("delegates to calculateWeeklyStreak for 'weekly'", () => {
    const dates = [isoWeekMonday(0), isoWeekMonday(1)];
    expect(streakForPeriod(dates, "weekly")).toBe(
      calculateWeeklyStreak(dates)
    );
  });
});

// ---------------------------------------------------------------------------
// Injectable `today` — timezone safety (Cloud Functions run in UTC)
// ---------------------------------------------------------------------------

describe("injectable today (timezone safety)", () => {
  it("calculateStreak anchors 'today'/'yesterday' to the supplied local date", () => {
    // A completion dated 2024-03-15, evaluated as if the local date is the same
    // day, is a live 1-day streak — regardless of the server's UTC clock.
    expect(calculateStreak(["2024-03-15"], "2024-03-15")).toBe(1);
    // Evaluated as if local "today" is the next day, the streak is still alive
    // (completion was "yesterday").
    expect(calculateStreak(["2024-03-15"], "2024-03-16")).toBe(1);
    // Two local days later, the streak has lapsed.
    expect(calculateStreak(["2024-03-15"], "2024-03-17")).toBe(0);
  });

  it("calculateWeeklyStreak anchors the current ISO week to the supplied date", () => {
    // 2024-03-11 is a Monday (ISO week start). A completion that week, evaluated
    // with a local 'today' in the same ISO week, is a 1-week streak.
    expect(calculateWeeklyStreak(["2024-03-11"], "2024-03-13")).toBe(1);
    // Evaluated two ISO weeks later, the streak has lapsed.
    expect(calculateWeeklyStreak(["2024-03-11"], "2024-03-25")).toBe(0);
  });

  it("processToggleHabit uses the supplied local date for the completion day", () => {
    const habit: Habit = {
      ...baseHabit,
      completedDates: [],
      count: 0,
      streakDays: 0,
    };
    const result = processToggleHabit(habit, "up", "2024-03-15");
    expect(result).not.toBeNull();
    // The completion is recorded on the supplied local date, not the UTC date.
    expect(result?.updatedHabit.completedDates).toContain("2024-03-15");
  });
});

// ---------------------------------------------------------------------------
// processToggleHabit — daily multiplier boundaries
// ---------------------------------------------------------------------------

describe("processToggleHabit — daily multiplier at streak boundaries", () => {
  it("applies 1.5x on day 3 (prospective streak = 3)", () => {
    // History: 2 consecutive days ending yesterday.
    // Toggling today makes the prospective streak = 3 → 1.5x.
    const habit: Habit = {
      ...baseHabit,
      completedDates: [
        format(subDays(new Date(), 1), "yyyy-MM-dd"),
        format(subDays(new Date(), 2), "yyyy-MM-dd"),
      ],
      streakDays: 2,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(1.5);
    expect(result?.pointsChange).toBe(15); // 10 * 1.5
  });

  it("applies 1.5x on day 6 (prospective streak = 6)", () => {
    // History: 5 consecutive days ending yesterday → prospective = 6 → 1.5x.
    const habit: Habit = {
      ...baseHabit,
      completedDates: buildDailyDates(yesterday, 5),
      streakDays: 5,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(1.5);
    expect(result?.pointsChange).toBe(15);
  });

  it("applies 2.0x on day 7 (prospective streak = 7)", () => {
    // History: 6 consecutive days ending yesterday → prospective = 7 → 2.0x.
    const habit: Habit = {
      ...baseHabit,
      completedDates: buildDailyDates(yesterday, 6),
      streakDays: 6,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(2.0);
    expect(result?.pointsChange).toBe(20); // 10 * 2.0
  });

  it("prospective multiplier — threshold habit earns bonus on the threshold day itself", () => {
    // Habit requires count=1; we are about to hit the target for the first time.
    // History: 6 days ending yesterday → prospective streak including today = 7 → 2.0x.
    const habit: Habit = {
      ...baseHabit,
      scoringType: "threshold",
      targetCount: 1,
      basePoints: 100,
      completedDates: buildDailyDates(yesterday, 6),
      streakDays: 6,
      count: 0,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(2.0);
    expect(result?.pointsChange).toBe(200); // 100 * 2.0
  });
});

// ---------------------------------------------------------------------------
// processToggleHabit — weekly multiplier boundaries
// ---------------------------------------------------------------------------

describe("processToggleHabit — weekly habit streak multipliers", () => {
  const weeklyHabit: Habit = {
    ...baseHabit,
    period: "weekly",
    scoringType: "threshold",
    targetCount: 1,
    basePoints: 50,
    completedDates: [],
    count: 0,
    streakDays: 0,
  };

  it("applies 1.5x when prospective weekly streak = 2", () => {
    // History: completion in the previous ISO week only.
    // Toggling today adds this week → streak = 2 → 1.5x.
    const habit: Habit = {
      ...weeklyHabit,
      completedDates: [isoWeekMonday(1)],
      streakDays: 1,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(1.5);
    expect(result?.pointsChange).toBe(75); // 50 * 1.5
  });

  it("applies 1.5x when prospective weekly streak = 3", () => {
    // History: completions in the previous two ISO weeks.
    const habit: Habit = {
      ...weeklyHabit,
      completedDates: [isoWeekMonday(1), isoWeekMonday(2)],
      streakDays: 2,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(1.5);
    expect(result?.pointsChange).toBe(75);
  });

  it("applies 2.0x when prospective weekly streak = 4", () => {
    // History: completions in the previous three ISO weeks.
    const habit: Habit = {
      ...weeklyHabit,
      completedDates: [isoWeekMonday(1), isoWeekMonday(2), isoWeekMonday(3)],
      streakDays: 3,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    expect(result?.multiplier).toBe(2.0);
    expect(result?.pointsChange).toBe(100); // 50 * 2.0
  });

  it("does NOT reset the streak for a ~7-day gap that still spans consecutive ISO weeks", () => {
    // Simulate a weekly habit completed on Thursday last week and toggled now
    // (this week).  Day gap can be 8+, but ISO weeks are consecutive → streak 2.
    const lastThursday = format(
      new Date(isoWeekMonday(1) + "T00:00:00").setDate(
        new Date(isoWeekMonday(1)).getDate() + 3
      ),
      "yyyy-MM-dd"
    );
    const habit: Habit = {
      ...weeklyHabit,
      completedDates: [lastThursday],
      streakDays: 1,
    };
    const result = processToggleHabit(habit, "up");
    expect(result).not.toBeNull();
    // Prospective streak includes this week → 2 → 1.5x.
    expect(result?.multiplier).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// processToggleHabit — negative habit sign fix (GHSA-style regression tests)
// ---------------------------------------------------------------------------

describe("processToggleHabit — negative habit sign", () => {
  /** Negative incremental habit (e.g. "Late night snack" -10 pts each). */
  const negativeIncremental: Habit = {
    ...baseHabit,
    type: "negative",
    scoringType: "incremental",
    basePoints: 10,
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
  };

  /** Negative threshold habit (e.g. "Skip exercise" -20 pts when reached). */
  const negativeThreshold: Habit = {
    ...baseHabit,
    type: "negative",
    scoringType: "threshold",
    basePoints: 20,
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
  };

  it("(a) negative incremental toggled up yields a NEGATIVE pointsChange", () => {
    const result = processToggleHabit(negativeIncremental, "up");
    expect(result).not.toBeNull();
    // sign = -1, direction up → pointsChange = -1 * floor(10 * 1.0) = -10
    expect(result!.pointsChange).toBe(-10);
  });

  it("(a) negative incremental toggled down yields a POSITIVE pointsChange (undo)", () => {
    // When we undo a logged negative habit, the user gets those points back.
    const withCount: Habit = { ...negativeIncremental, count: 1, totalCount: 1 };
    const result = processToggleHabit(withCount, "down");
    expect(result).not.toBeNull();
    // sign = -1, direction down → pointsChange = -(-1) * floor(10 * 1.0) = +10
    expect(result!.pointsChange).toBe(10);
  });

  it("(b) negative threshold habit reaching target yields a NEGATIVE pointsChange", () => {
    const result = processToggleHabit(negativeThreshold, "up");
    expect(result).not.toBeNull();
    // sign = -1, threshold just-completed → pointsChange = -1 * floor(20 * 1.0) = -20
    expect(result!.pointsChange).toBe(-20);
  });

  it("(b) negative threshold habit un-completing yields a POSITIVE pointsChange (undo)", () => {
    const completed: Habit = {
      ...negativeThreshold,
      count: 1,
      totalCount: 1,
      completedDates: [today],
    };
    const result = processToggleHabit(completed, "down");
    expect(result).not.toBeNull();
    // sign = -1, threshold just-lost → pointsChange = -(-1) * floor(20 * 1.0) = +20
    expect(result!.pointsChange).toBe(20);
  });

  it("(c) positive habit is byte-identical to pre-fix behaviour (sign=1 is a no-op)", () => {
    // Positive habit with 6-day streak → prospective streak 7 → 2.0x multiplier.
    const positiveHabit: Habit = {
      ...baseHabit,
      type: "positive",
      scoringType: "threshold",
      basePoints: 10,
      targetCount: 1,
      count: 0,
      completedDates: buildDailyDates(yesterday, 6),
      streakDays: 6,
    };
    const result = processToggleHabit(positiveHabit, "up");
    expect(result).not.toBeNull();
    expect(result!.multiplier).toBe(2.0);
    // sign = 1 → pointsChange = 1 * floor(10 * 2.0) = 20
    expect(result!.pointsChange).toBe(20);
  });
});
