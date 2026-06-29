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
import {
  processToggleHabit,
  isHabitStale,
  resetStaleHabit,
  Habit,
} from "./habitProcessor";
import { getPayPeriodForTransaction } from "../plaid/payPeriod";

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

// ---------------------------------------------------------------------------
// isHabitStale — caller-local `today` (Bug A: evening double-credit)
// ---------------------------------------------------------------------------

describe("isHabitStale — caller-local today (timezone safety)", () => {
  it("daily habit updated the SAME local day is NOT stale even when the UTC server day rolled over", () => {
    // Repro: 5pm June 27 US-Pacific. The server clock (UTC) is already June 28
    // (here represented by a lastUpdated timestamp at 2026-06-28T00:00:00Z, which
    // is the UTC instant for that local evening). The Shortcut POSTs the LOCAL
    // date 2026-06-27. Anchored on the local day, the habit is NOT stale.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      // ISO timestamp on the *local* day June 27 (afternoon). parseISO of a
      // zone-less string is a local Date, so its local calendar day is June 27.
      lastUpdated: "2026-06-27T17:00:00",
    };
    expect(isHabitStale(habit, "2026-06-27")).toBe(false);
  });

  it("daily habit IS stale when `today` is a later local day than lastUpdated", () => {
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      lastUpdated: "2026-06-27T17:00:00",
    };
    expect(isHabitStale(habit, "2026-06-28")).toBe(true);
  });

  it("weekly habit is NOT stale when `today` is in the same ISO week as lastUpdated", () => {
    // 2026-06-22 is a Monday (ISO week start). 2026-06-24 is the same ISO week.
    const habit: Habit = {
      ...baseHabit,
      period: "weekly",
      lastUpdated: "2026-06-22T12:00:00",
    };
    expect(isHabitStale(habit, "2026-06-24")).toBe(false);
  });

  it("weekly habit IS stale when `today` is in a later ISO week than lastUpdated", () => {
    const habit: Habit = {
      ...baseHabit,
      period: "weekly",
      lastUpdated: "2026-06-22T12:00:00",
    };
    // 2026-06-29 is the following Monday → next ISO week → stale.
    expect(isHabitStale(habit, "2026-06-29")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isHabitStale — local-frame anchor on completedDates (Bug A, final approach)
// ---------------------------------------------------------------------------
//
// Staleness is decided SOLELY from `completedDates` (local yyyy-MM-dd strings)
// when `today` is supplied and history is non-empty — never from the UTC
// `lastUpdated` instant, which can't be classified into a local day without the
// user's timezone. This kills the threshold double-credit with no timezone guess
// AND avoids the never-reset regression (evening-yesterday completions whose UTC
// write rolled into today's UTC date must still reset on the new local day).

describe("isHabitStale — local-frame anchor (completedDates)", () => {
  it("THRESHOLD daily: completedDates has today though lastUpdated is the NEXT UTC day → NOT stale", () => {
    // 6pm US-Pacific June 27 → lastUpdated 01:00 UTC June 28. completedDates is in
    // the local frame and contains today, so the ahead UTC instant is ignored.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      count: 1,
      completedDates: ["2024-06-27"],
      lastUpdated: "2024-06-28T01:00:00Z",
    };
    expect(isHabitStale(habit, "2024-06-27")).toBe(false);
  });

  it("THRESHOLD daily: completed YESTERDAY → STILL stale on the new local day", () => {
    // maxCompletedDate (June 26) < today (June 27) → stale → resets.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      count: 1,
      completedDates: ["2024-06-26"],
      lastUpdated: "2024-06-26T20:00:00Z",
    };
    expect(isHabitStale(habit, "2024-06-27")).toBe(true);
  });

  it("GEMINI REGRESSION: evening-yesterday completion whose UTC write rolled into today's UTC date → STILL stale", () => {
    // User completes 6pm Pacific June 26 = 02:00 UTC June 27. lastUpdated lands on
    // June 27 UTC, but the completion was June 26 LOCAL. On the next local day
    // (today = June 27) the habit MUST reset — the old lastUpdated-based "today"
    // signal would have wrongly read this as not-stale (never resets). Anchoring
    // on completedDates (max = June 26 < June 27) correctly returns stale.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      count: 1,
      completedDates: ["2026-06-26"],
      lastUpdated: "2026-06-27T02:00:00Z",
    };
    expect(isHabitStale(habit, "2026-06-27")).toBe(true);
  });

  it("WEEKLY: most-recent completedDate in the current ISO week → NOT stale", () => {
    // 2024-03-11 is a Monday (ISO week start); 2024-03-13 is the same ISO week.
    const habit: Habit = {
      ...baseHabit,
      period: "weekly",
      scoringType: "threshold",
      targetCount: 1,
      count: 1,
      completedDates: ["2024-03-11"],
      lastUpdated: "2024-03-18T01:00:00Z", // even an ahead UTC instant doesn't matter
    };
    expect(isHabitStale(habit, "2024-03-13")).toBe(false);
  });

  it("WEEKLY: most-recent completedDate in a PRIOR ISO week → stale", () => {
    const habit: Habit = {
      ...baseHabit,
      period: "weekly",
      scoringType: "threshold",
      targetCount: 1,
      count: 1,
      completedDates: ["2024-03-04"], // Monday of the prior ISO week
      lastUpdated: "2024-03-04T12:00:00Z",
    };
    expect(isHabitStale(habit, "2024-03-13")).toBe(true);
  });

  it("WEEKLY GEMINI REGRESSION: prior-local-week completion whose UTC write rolled forward → STILL stale", () => {
    // Completion on Sunday 2024-03-10 (in the ISO week starting Mon 2024-03-04),
    // logged late local → UTC write 2024-03-11T01:00Z (which is the NEXT ISO
    // week). completedDates is the local anchor: max ISO week (Mar 4) < today's
    // ISO week (Mar 11) → stale.
    const habit: Habit = {
      ...baseHabit,
      period: "weekly",
      scoringType: "threshold",
      targetCount: 1,
      count: 1,
      completedDates: ["2024-03-10"],
      lastUpdated: "2024-03-11T01:00:00Z",
    };
    expect(isHabitStale(habit, "2024-03-13")).toBe(true);
  });

  it("falls back to the legacy lastUpdated comparison when completedDates is empty", () => {
    // No local completion signal: a same-local-day lastUpdated (zone-less, parsed
    // local) is not stale; a prior-day one is. (e.g. a target>1 incremental that
    // has count but no completion yet — judged by the fallback branch.)
    const sameDay: Habit = {
      ...baseHabit,
      period: "daily",
      completedDates: [],
      lastUpdated: "2026-06-27T17:00:00",
    };
    expect(isHabitStale(sameDay, "2026-06-27")).toBe(false);

    const priorDay: Habit = {
      ...baseHabit,
      period: "daily",
      completedDates: [],
      lastUpdated: "2026-06-26T17:00:00",
    };
    expect(isHabitStale(priorDay, "2026-06-27")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetStaleHabit — caller-local `today` mirrors client getHabitResetUpdate
// ---------------------------------------------------------------------------

describe("resetStaleHabit — caller-local today", () => {
  it("strips `today` from completedDates and recomputes streakDays (daily)", () => {
    // Completed today plus the two prior days (a live 3-day streak).
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      count: 1,
      completedDates: [
        "2026-06-27",
        "2026-06-26",
        "2026-06-25",
      ],
      streakDays: 3,
    };
    const update = resetStaleHabit(habit, "2026-06-27");
    expect(update.count).toBe(0);
    // `today` is dropped, preserving the invariant "count reflects today ⟺
    // today in completedDates".
    expect(update.completedDates).toEqual(["2026-06-26", "2026-06-25"]);
    // streakDays recomputed from the today-stripped list anchored on today.
    // 2026-06-26 is "yesterday" relative to 2026-06-27 → live 2-day streak.
    expect(update.streakDays).toBe(
      streakForPeriod(["2026-06-26", "2026-06-25"], "daily", "2026-06-27")
    );
    expect(update.streakDays).toBe(2);
  });

  it("is a no-op on completedDates for a genuine new-day reset (today not present)", () => {
    // Completion was on a prior day; today is not in completedDates → filter
    // leaves history intact.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      count: 0,
      completedDates: ["2026-06-25", "2026-06-24"],
      streakDays: 2,
    };
    const update = resetStaleHabit(habit, "2026-06-27");
    expect(update.count).toBe(0);
    expect(update.completedDates).toEqual(["2026-06-25", "2026-06-24"]);
  });

  it("recomputes a period-aware (ISO-week) streak for weekly habits", () => {
    const habit: Habit = {
      ...baseHabit,
      period: "weekly",
      count: 1,
      completedDates: [isoWeekMonday(0), isoWeekMonday(1)],
      streakDays: 2,
    };
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const update = resetStaleHabit(habit, todayStr);
    expect(update.streakDays).toBe(
      streakForPeriod(update.completedDates ?? [], "weekly", todayStr)
    );
  });

  it("preserves prior behavior when `today` is omitted (count zeroed, history untouched)", () => {
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      count: 1,
      completedDates: ["2026-06-27", "2026-06-26"],
      streakDays: 2,
    };
    const update = resetStaleHabit(habit);
    expect(update.count).toBe(0);
    // No completedDates / streakDays fields when today is omitted (back-compat).
    expect(update.completedDates).toBeUndefined();
    expect(update.streakDays).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end-ish: evening scenario no longer double-credits (Bug A)
// ---------------------------------------------------------------------------

describe("quickAddHabit evening scenario — no double-credit", () => {
  /**
   * Mirror index.ts's call order:
   *   1. if (isHabitStale(habit, today)) habit = reset(habit, today)
   *   2. processToggleHabit(habit, direction, today)
   */
  function runHandler(
    habit: Habit,
    direction: "up" | "down",
    today: string
  ): ReturnType<typeof processToggleHabit> {
    let h = habit;
    if (isHabitStale(h, today)) {
      const resetUpdate = resetStaleHabit(h, today);
      h = { ...h, ...resetUpdate, count: 0 };
    }
    return processToggleHabit(h, direction, today);
  }

  it("does NOT re-award points for a day already completed (UTC rolled over, same local day)", () => {
    // 5pm June 27 US-Pacific; server is June 28 UTC. The daily threshold habit
    // was already completed earlier today.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      basePoints: 10,
      count: 1,
      totalCount: 1,
      completedDates: ["2026-06-27"],
      streakDays: 1,
      lastUpdated: "2026-06-27T17:00:00",
    };

    const result = runHandler(habit, "up", "2026-06-27");
    expect(result).not.toBeNull();
    // The day was already scored — a second toggle on the same local day must
    // award 0 additional points (count goes 1→2 but it was already complete).
    expect(result!.pointsChange).toBe(0);
    expect(result!.updatedHabit.completedDates).toContain("2026-06-27");
  });

  it("WOULD double-credit with the buggy reset (regression guard)", () => {
    // Demonstrates the bug class: if the reset preserved completedDates AND zeroed
    // count (the old server behavior, i.e. resetStaleHabit WITHOUT today), the
    // subsequent toggle re-awards the day. We assert the fixed path differs.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      basePoints: 10,
      count: 1,
      totalCount: 1,
      completedDates: ["2026-06-27"],
      streakDays: 1,
      lastUpdated: "2026-06-27T17:00:00",
    };

    // Buggy path: stale by UTC `new Date()` (no today), reset keeps the date but
    // zeroes count, toggle then sees wasCompletedBefore=false → re-awards.
    const buggyReset = resetStaleHabit(habit); // no today
    const buggyHabit: Habit = { ...habit, ...buggyReset, count: 0 };
    const buggyResult = processToggleHabit(buggyHabit, "up", "2026-06-27");
    expect(buggyResult!.pointsChange).toBe(10); // the erroneous re-award

    // Fixed path awards nothing.
    const fixedResult = runHandler(habit, "up", "2026-06-27");
    expect(fixedResult!.pointsChange).toBe(0);
  });

  it("THRESHOLD: evening-FIRST-completion with NEXT-UTC-day lastUpdated does NOT double-credit", () => {
    // First completion of local June 27 was logged at 6pm Pacific → lastUpdated
    // 2024-06-28T01:00Z (next UTC day). A SECOND trigger the same local evening
    // must NOT reset (and re-award): the local frame still says June 27.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      basePoints: 10,
      count: 1,
      totalCount: 1,
      completedDates: ["2024-06-27"],
      streakDays: 1,
      lastUpdated: "2024-06-28T01:00:00Z",
    };
    // Pre-condition: the fixed staleness check sees it as NOT stale.
    expect(isHabitStale(habit, "2024-06-27")).toBe(false);
    const result = runHandler(habit, "up", "2024-06-27");
    expect(result).not.toBeNull();
    expect(result!.pointsChange).toBe(0); // no re-award
  });

  it("INCREMENTAL (target>1): awards each action's points and NEVER double-credits, regardless of a mid-evening reset", () => {
    // "Drink 3 glasses" (+10 each). First glass logged this local evening → count 1,
    // completedDates empty (not yet at target 3). Because completedDates is empty,
    // staleness falls back to the lastUpdated comparison; a next-UTC-day write may
    // flag this stale and reset the in-progress COUNT — but that is purely a
    // cosmetic tally edge. The POINTS invariant holds: an incremental action
    // always awards exactly ONE action's points (here +10) and can never
    // double-credit, because incremental points are granted per action regardless
    // of completion/reset state.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "incremental",
      targetCount: 3,
      basePoints: 10,
      count: 1,
      totalCount: 1,
      completedDates: [],
      streakDays: 0,
      lastUpdated: "2024-06-28T01:00:00Z",
    };
    const result = runHandler(habit, "up", "2024-06-27");
    expect(result).not.toBeNull();
    // Exactly one action's points — no double-credit (the only points invariant
    // that matters for incremental habits).
    expect(result!.pointsChange).toBe(10);
  });

  it("genuine new local day still resets and re-counts correctly (no false 'not stale')", () => {
    // Threshold completed YESTERDAY, not reset overnight (count 1, lastUpdated
    // yesterday). On the new local day it MUST reset then award today's completion.
    const habit: Habit = {
      ...baseHabit,
      period: "daily",
      scoringType: "threshold",
      targetCount: 1,
      basePoints: 10,
      count: 1,
      totalCount: 1,
      completedDates: ["2024-06-26"],
      streakDays: 1,
      lastUpdated: "2024-06-26T20:00:00Z",
    };
    expect(isHabitStale(habit, "2024-06-27")).toBe(true);
    const result = runHandler(habit, "up", "2024-06-27");
    expect(result).not.toBeNull();
    // Today's fresh completion is awarded (streak 2 → 1.0x at <3 → 10 pts).
    expect(result!.pointsChange).toBe(10);
    expect(result!.updatedHabit.completedDates).toContain("2024-06-27");
    expect(result!.updatedHabit.count).toBe(1); // reset to 0 then +1
  });
});

// ---------------------------------------------------------------------------
// getPayPeriodForTransaction — quickAddExpense pay-period scoping (Bug B)
// ---------------------------------------------------------------------------

describe("getPayPeriodForTransaction (quickAddExpense scoping)", () => {
  it("scopes a back-dated expense (date < lastPaycheckDate) to '' (NOT the current period)", () => {
    expect(getPayPeriodForTransaction("2026-06-20", "2026-06-25")).toBe("");
  });

  it("scopes a same-day expense (date == lastPaycheckDate) to the current period", () => {
    expect(getPayPeriodForTransaction("2026-06-25", "2026-06-25")).toBe(
      "2026-06-25"
    );
  });

  it("scopes an after-period expense (date > lastPaycheckDate) to the current period", () => {
    expect(getPayPeriodForTransaction("2026-06-28", "2026-06-25")).toBe(
      "2026-06-25"
    );
  });

  it("returns '' when the household has no tracked lastPaycheckDate", () => {
    expect(getPayPeriodForTransaction("2026-06-28", undefined)).toBe("");
  });
});
