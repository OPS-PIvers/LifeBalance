import { describe, it, expect } from "vitest";
import {
  assembleCeremony,
  buildDailyPoints,
  memberAttributedPointsOnDate,
  memberDatesFor,
  unattributedPointsOnDate,
  weekDates,
  weekHasAttribution,
  weekPointsTotal,
  type CeremonyMember,
  type RecapScoringHabit,
} from "./memberFacts";

/**
 * 🛡️ FIXTURES ARE ANCHORED TO THEIR OWN WEEK, never to an offset from "today"
 * — a weekday-dependent recap test has blocked a production deploy here before
 * (Cloud Functions run in UTC, so the date can roll between CI and deploy).
 * Every date below is a literal inside Mon 2026-06-29 → Sun 2026-07-05.
 */
const WEEK_START = "2026-06-29";
const WEEK_END = "2026-07-05";
const DAYS = weekDates(WEEK_START);
const [MON, TUE, WED, THU, FRI, SAT, SUN] = DAYS as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const JEN: CeremonyMember = { uid: "u1", displayName: "Jen" };
const PAUL: CeremonyMember = { uid: "u2", displayName: "Paul" };
const MEMBERS = [JEN, PAUL];

function habit(overrides: Partial<RecapScoringHabit> = {}): RecapScoringHabit {
  return {
    title: "Morning walk",
    period: "daily",
    type: "positive",
    basePoints: 10,
    scoringType: "threshold",
    targetCount: 1,
    completedDates: [],
    ...overrides,
  };
}

/** `completedBy` from a `{ date: { uid: count } }` literal, for readability. */
function attribution(map: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  return map;
}

describe("weekDates", () => {
  it("returns the week's 7 days, Monday first", () => {
    expect(DAYS).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });
});

describe("memberDatesFor", () => {
  it("reads a shared habit's dates out of completedBy, sorted", () => {
    const h = habit({
      completedDates: [WED, MON],
      completedBy: attribution({ [WED]: { u1: 1 }, [MON]: { u1: 2, u2: 1 } }),
    });
    expect(memberDatesFor(h, "u1")).toEqual([MON, WED]);
    expect(memberDatesFor(h, "u2")).toEqual([MON]);
  });

  it("treats an ASSIGNED chore's completions as the assignee's, with no attribution needed", () => {
    const h = habit({ assignedTo: "u2", completedDates: [MON, TUE] });
    expect(memberDatesFor(h, "u2")).toEqual([MON, TUE]);
    expect(memberDatesFor(h, "u1")).toEqual([]);
  });

  it("ignores zero/negative residue counts (a decrement can leave a node at 0)", () => {
    const h = habit({ completedDates: [MON], completedBy: attribution({ [MON]: { u1: 0, u2: -1 } }) });
    expect(memberDatesFor(h, "u1")).toEqual([]);
    expect(memberDatesFor(h, "u2")).toEqual([]);
  });
});

describe("memberAttributedPointsOnDate", () => {
  it("credits BOTH members a full award for the same threshold day", () => {
    const h = habit({ completedDates: [MON], completedBy: attribution({ [MON]: { u1: 1, u2: 1 } }) });
    expect(memberAttributedPointsOnDate(h, "u1", MON, WEEK_END)).toBe(10);
    expect(memberAttributedPointsOnDate(h, "u2", MON, WEEK_END)).toBe(10);
  });

  it("applies each member's OWN streak multiplier", () => {
    // Jen has a 4-day chain into Thursday (1.5x from day 3); Paul only Thursday.
    const h = habit({
      completedDates: [MON, TUE, WED, THU],
      completedBy: attribution({
        [MON]: { u1: 1 },
        [TUE]: { u1: 1 },
        [WED]: { u1: 1 },
        [THU]: { u1: 1, u2: 1 },
      }),
    });
    expect(memberAttributedPointsOnDate(h, "u1", THU, WEEK_END)).toBe(15);
    expect(memberAttributedPointsOnDate(h, "u2", THU, WEEK_END)).toBe(10);
  });

  it("pays an incremental habit per attributed action", () => {
    const h = habit({
      scoringType: "incremental",
      completedDates: [MON],
      completedBy: attribution({ [MON]: { u1: 3 } }),
    });
    expect(memberAttributedPointsOnDate(h, "u1", MON, WEEK_END)).toBe(30);
  });

  it("awards a threshold period ONCE, on the member's first attributed day", () => {
    const h = habit({
      period: "weekly",
      targetCount: 3,
      completedDates: [FRI],
      completedBy: attribution({ [MON]: { u1: 1 }, [WED]: { u1: 1 }, [FRI]: { u1: 1 } }),
    });
    expect(memberAttributedPointsOnDate(h, "u1", MON, WEEK_END)).toBe(10);
    expect(memberAttributedPointsOnDate(h, "u1", WED, WEEK_END)).toBe(0);
    expect(memberAttributedPointsOnDate(h, "u1", FRI, WEEK_END)).toBe(0);
  });

  it("pays nothing for a threshold period that never completed", () => {
    const h = habit({
      period: "weekly",
      targetCount: 3,
      completedDates: [],
      completedBy: attribution({ [MON]: { u1: 1 }, [WED]: { u1: 1 } }),
    });
    expect(memberAttributedPointsOnDate(h, "u1", MON, WEEK_END)).toBe(0);
  });

  it("signs a negative habit's points negative", () => {
    const h = habit({
      title: "Late snack",
      type: "negative",
      basePoints: 10,
      scoringType: "incremental",
      completedDates: [MON],
      completedBy: attribution({ [MON]: { u1: 2 } }),
    });
    expect(memberAttributedPointsOnDate(h, "u1", MON, WEEK_END)).toBe(-20);
  });

  it("bridges a per-member frozen day for that member only", () => {
    // Mon–Wed + Fri for both; Thursday frozen for Jen alone. Jen's Friday
    // therefore continues a 5-long chain (2.0x is 7+, so 1.5x here) while
    // Paul's chain restarts at Friday.
    const h = habit({
      completedDates: [MON, TUE, WED, FRI],
      completedBy: attribution({
        [MON]: { u1: 1, u2: 1 },
        [TUE]: { u1: 1, u2: 1 },
        [WED]: { u1: 1, u2: 1 },
        [FRI]: { u1: 1, u2: 1 },
      }),
      frozenDatesBy: { [THU]: ["u1"] },
    });
    expect(memberAttributedPointsOnDate(h, "u1", FRI, WEEK_END)).toBe(15);
    expect(memberAttributedPointsOnDate(h, "u2", FRI, WEEK_END)).toBe(10);
  });
});

describe("unattributedPointsOnDate — grandfathering", () => {
  it("scores a completion with NO attribution at the legacy habit rate", () => {
    const h = habit({ completedDates: [MON, TUE, WED] });
    // Wednesday closes a 3-day habit-level streak → 1.5x.
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(10);
    expect(unattributedPointsOnDate(h, WED, WEEK_END)).toBe(15);
  });

  it("drops to zero for a threshold day once anyone is credited", () => {
    const h = habit({ completedDates: [MON], completedBy: attribution({ [MON]: { u1: 1 } }) });
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(0);
  });

  it("keeps the units nobody holds on a partially-attributed INCREMENTAL day", () => {
    // The legacy scorer counts one unit for a past day; attribution holds it,
    // so nothing is left over.
    const h = habit({
      scoringType: "incremental",
      completedDates: [MON],
      completedBy: attribution({ [MON]: { u1: 1 } }),
    });
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(0);
  });

  it("scores a weekly habit's single unit exactly once across the week", () => {
    const h = habit({ period: "weekly", completedDates: [MON, WED, FRI] });
    const total = DAYS.reduce((sum, d) => sum + unattributedPointsOnDate(h, d, WEEK_END), 0);
    expect(total).toBe(10);
  });
});

describe("buildDailyPoints", () => {
  it("stacks each member's day and keeps total = Σ byMember + unattributed", () => {
    const habits = [
      habit({
        completedDates: [MON, TUE],
        completedBy: attribution({ [MON]: { u1: 1, u2: 1 }, [TUE]: { u1: 1 } }),
      }),
      // A fully grandfathered habit — no attribution at all.
      habit({ title: "Read", completedDates: [MON] }),
    ];
    const days = buildDailyPoints(habits, MEMBERS, WEEK_START, WEEK_END);

    expect(days).toHaveLength(7);
    const monday = days[0];
    expect(monday?.byMember).toEqual({ u1: 10, u2: 10 });
    expect(monday?.unattributed).toBe(10);
    expect(monday?.total).toBe(30);
    for (const day of days) {
      const memberSum = Object.values(day.byMember).reduce((s, v) => s + v, 0);
      expect(day.total).toBe(memberSum + day.unattributed);
    }
  });

  it("omits members who scored nothing that day", () => {
    const habits = [habit({ completedDates: [MON], completedBy: attribution({ [MON]: { u1: 1 } }) })];
    const days = buildDailyPoints(habits, MEMBERS, WEEK_START, WEEK_END);
    expect(days[0]?.byMember).toEqual({ u1: 10 });
    expect(days[1]?.byMember).toEqual({});
  });

  it("routes an assigned chore to its assignee and never to the unattributed series", () => {
    const habits = [habit({ title: "Dishes", assignedTo: "u2", completedDates: [MON, TUE] })];
    const days = buildDailyPoints(habits, MEMBERS, WEEK_START, WEEK_END);
    expect(days[0]?.byMember).toEqual({ u2: 10 });
    expect(days[0]?.unattributed).toBe(0);
  });
});

describe("weekPointsTotal", () => {
  it("sums only the requested week", () => {
    const habits = [
      habit({
        completedDates: ["2026-06-22", MON],
        completedBy: attribution({ "2026-06-22": { u1: 1 }, [MON]: { u1: 1 } }),
      }),
    ];
    expect(weekPointsTotal(habits, MEMBERS, WEEK_START, WEEK_END)).toBe(10);
    expect(weekPointsTotal(habits, MEMBERS, "2026-06-22", "2026-06-28")).toBe(10);
  });
});

describe("weekHasAttribution", () => {
  it("is false for a fully grandfathered week and true once anyone is credited", () => {
    expect(weekHasAttribution([habit({ completedDates: [MON] })], WEEK_START)).toBe(false);
    expect(
      weekHasAttribution(
        [habit({ completedDates: [MON], completedBy: attribution({ [MON]: { u1: 1 } }) })],
        WEEK_START
      )
    ).toBe(true);
  });

  it("ignores attribution OUTSIDE the week", () => {
    const h = habit({
      completedDates: ["2026-06-22"],
      completedBy: attribution({ "2026-06-22": { u1: 1 } }),
    });
    expect(weekHasAttribution([h], WEEK_START)).toBe(false);
  });
});

describe("assembleCeremony", () => {
  const habits = [
    habit({
      title: "Morning walk",
      completedDates: [...DAYS],
      completedBy: attribution({
        [MON]: { u1: 1, u2: 1 },
        [TUE]: { u1: 1, u2: 1 },
        [WED]: { u1: 1 },
        [THU]: { u1: 1 },
        [FRI]: { u1: 1 },
        [SAT]: { u1: 1, u2: 2 },
        [SUN]: { u1: 1 },
      }),
    }),
    habit({
      title: "Read",
      scoringType: "incremental",
      basePoints: 5,
      completedDates: [SAT],
      completedBy: attribution({ [SAT]: { u2: 2 } }),
    }),
  ];

  it("gives each member their own points, completions and best day", () => {
    const { memberFacts } = assembleCeremony({ habits, members: MEMBERS, weekStart: WEEK_START, weekEnd: WEEK_END });
    const jen = memberFacts.find((f) => f.memberId === "u1");
    const paul = memberFacts.find((f) => f.memberId === "u2");

    // Jen walked all 7 days: 10 + 10 + 15 + 15 + 15 + 15 + 20 = 100.
    expect(jen?.points).toBe(100);
    expect(jen?.completions).toBe(7);
    expect(jen?.bestDay).toEqual({ date: SUN, points: 20 });

    // Paul: Mon/Tue walks at 1x, Saturday's walk restarts his chain (1 unit
    // counts once for a threshold habit) plus two incremental reads.
    expect(paul?.completions).toBe(2 + 2 + 2);
    expect(paul?.bestDay?.date).toBe(SAT);
  });

  it("reports each member's top streak in the habit's own cadence", () => {
    const { memberFacts } = assembleCeremony({ habits, members: MEMBERS, weekStart: WEEK_START, weekEnd: WEEK_END });
    expect(memberFacts.find((f) => f.memberId === "u1")?.topStreak).toEqual({
      habitTitle: "Morning walk",
      days: 7,
      period: "daily",
    });
  });

  it("names a perfect DAILY habit and never a weekly one", () => {
    const withWeekly = [
      ...habits,
      habit({
        title: "Meal plan",
        period: "weekly",
        completedDates: [SUN],
        completedBy: attribution({ [SUN]: { u1: 1 } }),
      }),
    ];
    const { memberFacts } = assembleCeremony({
      habits: withWeekly,
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(memberFacts.find((f) => f.memberId === "u1")?.perfectHabits).toEqual(["Morning walk"]);
    expect(memberFacts.find((f) => f.memberId === "u2")?.perfectHabits).toEqual([]);
  });

  it("totals to the sum of the day series", () => {
    const { dailyPoints, totalPoints } = assembleCeremony({
      habits,
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(dailyPoints.reduce((s, d) => s + d.total, 0)).toBe(totalPoints);
  });

  it("is deterministic — regenerating the same closed week yields the same document", () => {
    const input = { habits, members: MEMBERS, weekStart: WEEK_START, weekEnd: WEEK_END };
    expect(assembleCeremony(input)).toEqual(assembleCeremony(input));
  });

  it("produces zeroes, not nulls, for a household that did nothing", () => {
    const { memberFacts, totalPoints } = assembleCeremony({
      habits: [],
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(totalPoints).toBe(0);
    expect(memberFacts).toEqual([
      { memberId: "u1", name: "Jen", points: 0, completions: 0, bestDay: null, topStreak: null, perfectHabits: [] },
      { memberId: "u2", name: "Paul", points: 0, completions: 0, bestDay: null, topStreak: null, perfectHabits: [] },
    ]);
  });
});
