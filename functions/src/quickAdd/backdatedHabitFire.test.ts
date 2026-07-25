import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBackdatedHabitFire, isWithinBackdateWindow } from "./backdatedHabitFire";
// The CLIENT implementation this file is a twin of. Importing it here turns
// "these must stay in lockstep" from a comment into a test: functions/tsconfig
// excludes *.test.ts, and the suite runs under the root vitest config, so the
// `@/` alias resolves. If the two ever diverge, the parity block below fails
// instead of a user's points quietly disagreeing between the two paths.
import { computeBackdatedHabitFire as clientFire } from "@/utils/habitTriggerFire";
import type { Habit } from "@/types/schema";

const TODAY = "2026-07-25"; // a Saturday
const YESTERDAY = "2026-07-24";

/** A habit both implementations accept. */
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    title: "No spend day",
    category: "Money",
    type: "positive",
    basePoints: 10,
    scoringType: "threshold",
    period: "daily",
    targetCount: 1,
    count: 0,
    totalCount: 4,
    completedDates: [],
    streakDays: 0,
    lastUpdated: `${TODAY}T08:00:00.000Z`,
    ...over,
  } as Habit;
}

/** Consecutive dates ending the day BEFORE `date`, newest first. */
function runEndingBefore(date: string, length: number): string[] {
  const out: string[] = [];
  const d = new Date(`${date}T00:00:00Z`);
  for (let i = 1; i <= length; i++) {
    const day = new Date(d.getTime() - i * 86400000);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

describe("isWithinBackdateWindow", () => {
  it("accepts today and the 30 days before it", () => {
    expect(isWithinBackdateWindow(TODAY, TODAY)).toBe(true);
    expect(isWithinBackdateWindow("2026-06-25", TODAY)).toBe(true);
  });

  it("rejects anything older than the window, or in the future", () => {
    expect(isWithinBackdateWindow("2026-06-24", TODAY)).toBe(false);
    expect(isWithinBackdateWindow("2026-07-26", TODAY)).toBe(false);
  });
});

describe("computeBackdatedHabitFire", () => {
  it("refuses to fire an archived habit", () => {
    expect(
      computeBackdatedHabitFire(habit({ archivedAt: "2026-07-01T00:00:00.000Z" }), YESTERDAY, TODAY)
    ).toBeNull();
  });

  it("refuses a future date, which would corrupt the streak chain rather than misdate it", () => {
    expect(computeBackdatedHabitFire(habit(), "2026-07-26", TODAY)).toBeNull();
  });

  // The whole reason this is back-dated: the sync runs at ~3am and credits the
  // day that ended, so the live counter (which describes TODAY) must not move.
  it("leaves the live counter alone for a past-period fire", () => {
    const fire = computeBackdatedHabitFire(habit({ count: 1 }), YESTERDAY, TODAY);
    expect(fire).not.toBeNull();
    expect(fire!.inCurrentPeriod).toBe(false);
    expect(fire!.countDelta).toBe(0);
    expect(fire!.addedDate).toBe(YESTERDAY);
    expect(fire!.totalCountDelta).toBe(1);
  });

  // Points land on `total` (lifetime) but never on today's `daily`, or a Sunday
  // credited on Monday would inflate Monday.
  it("keeps a past fire out of today's daily bucket", () => {
    const fire = computeBackdatedHabitFire(habit(), YESTERDAY, TODAY)!;
    expect(fire.pointsEarned).toBe(10);
    expect(fire.pointsDelta).toEqual({ daily: 0, weekly: 10, total: 10 });
  });

  it("pays the multiplier the streak had ON the credited day, not today's", () => {
    // Six days completed before the fire date ⇒ the fire is the 7th ⇒ 2.0×.
    const dates = runEndingBefore(YESTERDAY, 6);
    const fire = computeBackdatedHabitFire(habit({ completedDates: dates }), YESTERDAY, TODAY)!;
    expect(fire.streakAtFireDate).toBe(7);
    expect(fire.multiplier).toBe(2);
    expect(fire.pointsEarned).toBe(20);
  });

  it("awards nothing when the day was already complete", () => {
    const fire = computeBackdatedHabitFire(
      habit({ completedDates: [YESTERDAY] }),
      YESTERDAY,
      TODAY
    )!;
    expect(fire.addedDate).toBeUndefined();
    expect(fire.pointsEarned).toBe(0);
  });

  it("un-freezes a day that turns out to have been completed", () => {
    const fire = computeBackdatedHabitFire(
      habit({ frozenDates: [YESTERDAY] }),
      YESTERDAY,
      TODAY
    )!;
    expect(fire.unfrozenDate).toBe(YESTERDAY);
    expect(fire.addedDate).toBe(YESTERDAY);
  });

  it("only completes a threshold habit once its own period reaches the target", () => {
    const under = computeBackdatedHabitFire(habit({ targetCount: 3 }), YESTERDAY, TODAY, 1)!;
    expect(under.addedDate).toBeUndefined();
    expect(under.pointsEarned).toBe(0);

    const crossing = computeBackdatedHabitFire(habit({ targetCount: 3 }), YESTERDAY, TODAY, 2)!;
    expect(crossing.addedDate).toBe(YESTERDAY);
    expect(crossing.pointsEarned).toBe(10);
  });

  it("scores an incremental habit on every action", () => {
    const fire = computeBackdatedHabitFire(
      habit({ scoringType: "incremental", targetCount: 5 }),
      YESTERDAY,
      TODAY,
      0
    )!;
    expect(fire.addedDate).toBe(YESTERDAY);
    expect(fire.pointsEarned).toBe(10);
  });

  it("takes the sign from habit.type, not from basePoints", () => {
    // Both storage conventions for a negative habit must score identically.
    const positiveStored = computeBackdatedHabitFire(
      habit({ type: "negative", basePoints: 10 }),
      YESTERDAY,
      TODAY
    )!;
    const negativeStored = computeBackdatedHabitFire(
      habit({ type: "negative", basePoints: -10 }),
      YESTERDAY,
      TODAY
    )!;
    expect(positiveStored.pointsEarned).toBe(-10);
    expect(negativeStored.pointsEarned).toBe(-10);
  });

  // The weekend habit's shape: weekly cadence, credited to a Sunday from
  // Monday's email — the PREVIOUS ISO week, so the counter must not move.
  it("credits a weekly habit's previous ISO week without touching the counter", () => {
    const sunday = "2026-07-19";
    const monday = "2026-07-20";
    const fire = computeBackdatedHabitFire(
      habit({ period: "weekly", title: "No spend weekend", count: 0 }),
      sunday,
      monday
    )!;
    expect(fire.inCurrentPeriod).toBe(false);
    expect(fire.countDelta).toBe(0);
    expect(fire.addedDate).toBe(sunday);
    // Sunday is in the prior week, so it credits total but not this week.
    expect(fire.pointsDelta).toEqual({ daily: 0, weekly: 0, total: 10 });
  });

  it("gives a weekly habit the week-based multiplier thresholds", () => {
    // Two prior consecutive ISO weeks ⇒ this is the 3rd ⇒ 1.5× (weekly tiers are
    // 2 weeks → 1.5×, 4 → 2.0×, unlike daily's 3 and 7).
    const fire = computeBackdatedHabitFire(
      habit({ period: "weekly", completedDates: ["2026-07-12", "2026-07-05"] }),
      "2026-07-19",
      "2026-07-20"
    )!;
    expect(fire.streakAtFireDate).toBe(3);
    expect(fire.multiplier).toBe(1.5);
    expect(fire.pointsEarned).toBe(15);
  });
});

/**
 * Parity with utils/habitTriggerFire.ts. The client reads the machine clock in
 * two places this twin takes as a parameter (`isHabitStale` with no `today`, and
 * `getLocalDateString()` inside its streak helpers), so the system clock is
 * pinned to TODAY for the comparison — otherwise the two would legitimately
 * disagree about staleness and the test would prove nothing.
 */
describe("parity with the client computeBackdatedHabitFire", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: {
    name: string;
    habit: Habit;
    fireDate: string;
    prior?: number;
    /**
     * Fields the two implementations are KNOWN to disagree about, asserted to
     * still disagree so that reconciling them fails this test instead of
     * silently leaving a stale exception behind. See the twin's header comment.
     */
    divergentKeys?: string[];
  }[] = [
    { name: "plain past-day threshold fire", habit: habit(), fireDate: YESTERDAY },
    { name: "same-day fire", habit: habit(), fireDate: TODAY },
    {
      name: "with a 2-day run (1.5x tier)",
      habit: habit({ completedDates: runEndingBefore(YESTERDAY, 2) }),
      fireDate: YESTERDAY,
    },
    {
      name: "with a 6-day run (2.0x tier)",
      habit: habit({ completedDates: runEndingBefore(YESTERDAY, 6) }),
      fireDate: YESTERDAY,
    },
    {
      name: "already-completed day",
      habit: habit({ completedDates: [YESTERDAY] }),
      fireDate: YESTERDAY,
    },
    {
      name: "frozen day being un-frozen",
      habit: habit({ frozenDates: [YESTERDAY] }),
      fireDate: YESTERDAY,
    },
    {
      name: "threshold habit short of its target",
      habit: habit({ targetCount: 3 }),
      fireDate: YESTERDAY,
      prior: 1,
    },
    {
      name: "threshold habit crossing its target",
      habit: habit({ targetCount: 3 }),
      fireDate: YESTERDAY,
      prior: 2,
    },
    {
      name: "incremental habit",
      habit: habit({ scoringType: "incremental", targetCount: 4 }),
      fireDate: YESTERDAY,
    },
    {
      name: "negative habit stored with positive basePoints",
      habit: habit({ type: "negative", basePoints: 10 }),
      fireDate: YESTERDAY,
    },
    {
      name: "negative habit stored with negative basePoints",
      habit: habit({ type: "negative", basePoints: -10 }),
      fireDate: YESTERDAY,
    },
    {
      name: "stale habit with a leftover counter",
      habit: habit({ count: 3, lastUpdated: "2026-07-10T08:00:00.000Z" }),
      fireDate: TODAY,
    },
    {
      name: "weekly habit, current week",
      habit: habit({ period: "weekly" }),
      fireDate: YESTERDAY,
    },
    {
      // The habit's last completion (2026-07-19, a Sunday) is in the PREVIOUS
      // ISO week while `lastUpdated` is today, so the server's completedDates-
      // anchored isHabitStale calls it stale and the client's lastUpdated-only
      // one does not. Unreachable from the no-spend path (which never fires into
      // a current period), documented in the twin's header.
      name: "weekly habit with a 2-week run (known isHabitStale divergence)",
      habit: habit({ period: "weekly", completedDates: ["2026-07-19", "2026-07-12"] }),
      fireDate: YESTERDAY,
      divergentKeys: ["resetCount"],
    },
    {
      name: "paused habit whose pause bridges a gap",
      habit: habit({ completedDates: ["2026-07-10"], pausedUntil: "2026-07-23" }),
      fireDate: YESTERDAY,
    },
    {
      name: "a fire at the far edge of the back-date window",
      habit: habit(),
      fireDate: "2026-06-25",
    },
    { name: "an out-of-window fire", habit: habit(), fireDate: "2026-06-24" },
    {
      name: "an archived habit",
      habit: habit({ archivedAt: "2026-07-01T00:00:00.000Z" }),
      fireDate: YESTERDAY,
    },
  ];

  it.each(cases)("$name", ({ habit: h, fireDate, prior = 0, divergentKeys = [] }) => {
    const server = computeBackdatedHabitFire(h, fireDate, TODAY, prior);
    const client = clientFire(h, fireDate, TODAY, prior);

    if (server === null || client === null) {
      expect(server).toEqual(client);
      return;
    }

    // Each documented divergence must STILL diverge — otherwise the exception is
    // stale and should be deleted along with the twin's header note.
    for (const key of divergentKeys) {
      expect(server[key as keyof typeof server]).not.toEqual(client[key as keyof typeof client]);
    }

    const withoutDivergences = (value: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(value).filter(([k]) => !divergentKeys.includes(k)));
    expect(withoutDivergences(server)).toEqual(withoutDivergences(client));
  });
});
