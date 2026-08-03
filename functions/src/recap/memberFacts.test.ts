import { describe, it, expect } from "vitest";
import {
  assembleCeremony,
  buildDailyPoints,
  memberAttributedPointsOnDate,
  memberDatesFor,
  memberPointsOnDate,
  unattributedPointsOnDate,
  unattributedSplitForDate,
  weekDates,
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
const LEO: CeremonyMember = { uid: "kid_leo", displayName: "Leo", isManaged: true };
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

  it("keeps an assigned chore OUT of the household series entirely", () => {
    // A chore credits its assignee's own member doc, never the household pool
    // (the client's `calculateHouseholdPointsForDate` skips `assignedTo`
    // outright), so it belongs to neither the stacked members nor the
    // grandfathering remainder.
    const habits = [habit({ title: "Dishes", assignedTo: "kid_leo", completedDates: [MON, TUE] })];
    const days = buildDailyPoints(habits, [...MEMBERS, LEO], WEEK_START, WEEK_END);
    expect(days[0]?.byMember).toEqual({});
    expect(days[0]?.unattributed).toBe(0);
    expect(days[0]?.total).toBe(0);
    // It still counts, in full, as the assignee's own score.
    expect(memberPointsOnDate(habits, "kid_leo", MON, WEEK_END)).toBe(10);
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

describe("assigned chores vs the household aggregates", () => {
  /** A chore-heavy kid week: Leo scrubs every day, the adults do nothing. */
  const choreWeek = [habit({ title: "Dishes", assignedTo: "kid_leo", completedDates: [...DAYS] })];
  const roster = [...MEMBERS, LEO];

  it("excludes kid chore points from the household week total", () => {
    expect(weekPointsTotal(choreWeek, roster, WEEK_START, WEEK_END)).toBe(0);
  });

  it("still gives the kid their full personal figure", () => {
    const { memberFacts } = assembleCeremony({
      habits: choreWeek,
      members: roster,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    const leo = memberFacts.find((f) => f.memberId === "kid_leo");
    // 7 daily completions: 10 + 10 + 15 (3-day streak → 1.5x) ×4 + 20 (7th day → 2x).
    expect(leo?.points).toBe(10 + 10 + 15 + 15 + 15 + 15 + 20);
    expect(leo?.completions).toBe(7);
    expect(leo?.isManaged).toBe(true);
  });

  it("never crowns the kid — their points never enter another member's row", () => {
    const { memberFacts, dailyPoints, totalPoints } = assembleCeremony({
      habits: choreWeek,
      members: roster,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(totalPoints).toBe(0);
    for (const day of dailyPoints) expect(day.byMember).toEqual({});
    expect(memberFacts.find((f) => f.memberId === "u1")?.points).toBe(0);
    expect(memberFacts.find((f) => f.memberId === "u2")?.points).toBe(0);
  });

  it("marks adults with no `isManaged` key at all (Firestore rejects undefined)", () => {
    const { memberFacts } = assembleCeremony({
      habits: choreWeek,
      members: roster,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    const jen = memberFacts.find((f) => f.memberId === "u1");
    expect(jen && "isManaged" in jen).toBe(false);
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

  it("emits NO memberFacts for a household with no per-member data at all", () => {
    // An idle week (and, identically, a household whose entire history predates
    // the attribution layer) must not fabricate a deck of confident zeroes —
    // `hasCeremonyData` reads false and the client shows its pre-deck layout.
    const { memberFacts, dailyPoints, totalPoints } = assembleCeremony({
      habits: [],
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(memberFacts).toEqual([]);
    expect(totalPoints).toBe(0);
    // The household series is still emitted in full — 7 honest zero days.
    expect(dailyPoints).toHaveLength(7);
  });

  it("emits NO memberFacts for a fully GRANDFATHERED week, but keeps its household points", () => {
    // Completions with no `completedBy` anywhere: nobody holds them, so there
    // is no personal card or head-to-head to draw — yet the points are real and
    // stay visible through the `unattributed` series.
    const grandfathered = [habit({ title: "Read", completedDates: [MON, TUE] })];
    const { memberFacts, dailyPoints, totalPoints } = assembleCeremony({
      habits: grandfathered,
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(memberFacts).toEqual([]);
    expect(totalPoints).toBe(20);
    expect(dailyPoints[0]?.unattributed).toBe(10);
  });

  it("keeps a member who scored nothing as a legitimate zero once ANYONE has data", () => {
    const someData = [
      habit({ completedDates: [MON], completedBy: attribution({ [MON]: { u1: 1 } }) }),
    ];
    const { memberFacts } = assembleCeremony({
      habits: someData,
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(memberFacts.map((f) => [f.memberId, f.points])).toEqual([
      ["u1", 10],
      ["u2", 0],
    ]);
  });
});

// ---------------------------------------------------------------------------
// RECAP-MATH — WHY a chunk of points belongs to nobody
// ---------------------------------------------------------------------------

describe("unattributedSplitForDate", () => {
  it("routes a creditMode: 'household' habit to householdCredit", () => {
    const h = habit({ creditMode: "household", basePoints: 12, completedDates: [MON] });
    expect(unattributedSplitForDate([h], MON, WEEK_END)).toEqual({
      householdCredit: 12,
      unclaimed: 0,
    });
  });

  it("routes an explicit creditMode: 'members' habit with NO attribution to unclaimed", () => {
    // The real gap: a habit fired by something that never recorded a person.
    const h = habit({
      creditMode: "members",
      basePoints: 7,
      completedDates: [MON],
      completedBy: attribution({}),
    });
    expect(unattributedSplitForDate([h], MON, WEEK_END)).toEqual({
      householdCredit: 0,
      unclaimed: 7,
    });
  });

  it("routes a habit with NO creditMode at all to unclaimed (grandfathered history)", () => {
    // Absent reads as 'members', so there is deliberately no third bucket:
    // legacy history and a real gap are the same shape on the document.
    const h = habit({ basePoints: 10, completedDates: [MON] });
    expect(unattributedSplitForDate([h], MON, WEEK_END)).toEqual({
      householdCredit: 0,
      unclaimed: 10,
    });
  });

  it("keeps both apart on the SAME day", () => {
    const habits = [
      habit({
        title: "Homemade dinner",
        creditMode: "household",
        basePoints: 12,
        completedDates: [MON],
      }),
      habit({
        title: "Go into Target",
        creditMode: "members",
        basePoints: 7,
        completedDates: [MON],
      }),
    ];
    expect(unattributedSplitForDate(habits, MON, WEEK_END)).toEqual({
      householdCredit: 12,
      unclaimed: 7,
    });
  });

  it("splits only the REMAINDER when a household-credit habit carries stale attribution", () => {
    const h = habit({
      creditMode: "household",
      scoringType: "incremental",
      basePoints: 5,
      targetCount: 3,
      completedDates: [MON],
      completedBy: attribution({ [MON]: { u1: 1 } }),
    });
    const split = unattributedSplitForDate([h], MON, WEEK_END);
    expect(split.householdCredit + split.unclaimed).toBe(
      unattributedPointsOnDate(h, MON, WEEK_END)
    );
  });

  it("ignores creditMode on an ASSIGNED chore — it never reaches the household pool", () => {
    const h = habit({
      assignedTo: LEO.uid,
      creditMode: "household",
      basePoints: 5,
      completedDates: [MON],
    });
    expect(unattributedSplitForDate([h], MON, WEEK_END)).toEqual({
      householdCredit: 0,
      unclaimed: 0,
    });
  });

  it("carries the sign of a negative household-credit habit", () => {
    const h = habit({
      creditMode: "household",
      type: "negative",
      basePoints: 8,
      completedDates: [MON],
    });
    expect(unattributedSplitForDate([h], MON, WEEK_END)).toEqual({
      householdCredit: -8,
      unclaimed: 0,
    });
  });
});

describe("buildDailyPoints / assembleCeremony unattributedSplit", () => {
  const habits = [
    habit({
      title: "Homemade dinner",
      creditMode: "household",
      basePoints: 12,
      completedDates: [MON, TUE],
    }),
    habit({
      title: "Go into Target",
      creditMode: "members",
      basePoints: 7,
      completedDates: [TUE],
      completedBy: attribution({}),
    }),
    habit({
      title: "Morning walk",
      basePoints: 10,
      completedDates: [MON],
      completedBy: attribution({ [MON]: { u1: 1 } }),
    }),
  ];

  it("decomposes every day without changing the day's own figures", () => {
    const days = buildDailyPoints(habits, MEMBERS, WEEK_START, WEEK_END);
    expect(days[0]?.unattributedSplit).toEqual({ householdCredit: 12, unclaimed: 0 });
    expect(days[0]?.unattributed).toBe(12);
    expect(days[0]?.byMember).toEqual({ u1: 10 });
    expect(days[0]?.total).toBe(22);

    expect(days[1]?.unattributedSplit).toEqual({ householdCredit: 12, unclaimed: 7 });
    expect(days[1]?.unattributed).toBe(19);

    for (const day of days) {
      const split = day.unattributedSplit;
      expect((split?.householdCredit ?? 0) + (split?.unclaimed ?? 0)).toBe(day.unattributed);
    }
  });

  it("sums the week's split to Σ dailyPoints[].unattributed", () => {
    const { dailyPoints, unattributedSplit } = assembleCeremony({
      habits,
      members: MEMBERS,
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    expect(unattributedSplit).toEqual({ householdCredit: 24, unclaimed: 7 });
    expect(unattributedSplit.householdCredit + unattributedSplit.unclaimed).toBe(
      dailyPoints.reduce((sum, d) => sum + d.unattributed, 0)
    );
  });
});
