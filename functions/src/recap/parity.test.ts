/**
 * 🛡️ THE PIN BETWEEN THE TWO RECAP ASSEMBLIES (CORE-1).
 *
 * The weekly recap's numeric assembly exists twice: once server-side, here in
 * `dataAssembly.ts` + `memberFacts.ts`, and once client-side in
 * `utils/recapAssembly.ts`. That duplication is FORCED, not lazy —
 * `functions/tsconfig.json` sets `rootDir: "src"`, so server SOURCE structurally
 * cannot import `@/…`; attempting it breaks the build and the deploy.
 *
 * Functions TESTS have no such constraint: they are excluded from
 * `functions/tsconfig.json` and run under the ROOT vitest config, where the `@/`
 * alias resolves (same trick as `quickAdd/backdatedHabitFire.test.ts`,
 * `merchantRules.test.ts`, `quantityLogic.test.ts`). So this file imports BOTH
 * copies and asserts they produce identical output over a shared fixture table.
 *
 * If a later PR changes the recap math, it must change BOTH sides or this fails —
 * which is the whole point. A divergence here would mean the client's on-demand
 * derivation showed a household different numbers than the recap document the
 * server wrote for the same week.
 *
 * 🛡️ FIXTURES ARE ANCHORED TO THEIR OWN WEEK, never to an offset from "today" —
 * a weekday-dependent recap test has blocked a production deploy here before
 * (Cloud Functions run in UTC, so the date can roll between CI and deploy). Every
 * date below is a literal inside Mon 2026-06-29 → Sun 2026-07-05 (or the prior
 * week, Mon 2026-06-22 → Sun 2026-06-28).
 */
import { describe, expect, it } from "vitest";

import { assembleWeeklyRecap, type DataAssemblyInput } from "./dataAssembly";
import {
  assembleCeremony,
  buildDailyPoints,
  memberAttributedPointsOnDate,
  memberDatesFor,
  memberPointsOnDate,
  shiftDay,
  unattributedPointsOnDate,
  weekDates,
  weekPointsTotal,
  type CeremonyMember,
  type RecapScoringHabit,
} from "./memberFacts";

import {
  assembleCeremony as clientAssembleCeremony,
  assembleWeeklyRecap as clientAssembleWeeklyRecap,
  buildDailyPoints as clientBuildDailyPoints,
  memberAttributedPointsOnDate as clientMemberAttributedPointsOnDate,
  memberDatesFor as clientMemberDatesFor,
  memberPointsOnDate as clientMemberPointsOnDate,
  shiftDay as clientShiftDay,
  unattributedPointsOnDate as clientUnattributedPointsOnDate,
  weekDates as clientWeekDates,
  weekPointsTotal as clientWeekPointsTotal,
} from "@/utils/recapAssembly";

const WEEK_START = "2026-06-29";
const WEEK_END = "2026-07-05";
const PRIOR_START = "2026-06-22";
const PRIOR_END = "2026-06-28";

const [MON, TUE, WED, THU, FRI, SAT, SUN] = weekDates(WEEK_START) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const [P_MON, P_TUE, P_WED, , , , P_SUN] = weekDates(PRIOR_START) as [
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

// ---------------------------------------------------------------------------
// The shared habit table — every production shape the scorers must agree on
// ---------------------------------------------------------------------------

interface HabitCase {
  name: string;
  habit: RecapScoringHabit;
}

/**
 * 🛡️ REAL-WORLD SHAPES, not just the happy path. In particular:
 *  - a habit with `completedDates` but an EMPTY `completedBy` (household-credit
 *    completions and every pre-attribution completion look like this);
 *  - `type: 'negative'` habits, whose signed points make a day net negative;
 *  - `period: 'weekly'` habits, whose single award is parked on ONE day;
 *  - habits with PARTIAL attribution (some units held, some grandfathered).
 */
const HABIT_CASES: HabitCase[] = [
  {
    name: "grandfathered daily threshold — completedDates, no completedBy at all",
    habit: habit({ title: "Read", completedDates: [MON, TUE, WED, THU, FRI] }),
  },
  {
    name: "grandfathered daily threshold — completedBy present but EMPTY object",
    habit: habit({ title: "Stretch", completedDates: [MON, TUE, WED], completedBy: {} }),
  },
  {
    name: "attributed daily threshold — two members, streak crosses 3d and 7d",
    habit: habit({
      title: "Morning walk",
      completedDates: [P_TUE, P_WED, P_SUN, MON, TUE, WED, THU, FRI, SAT, SUN],
      completedBy: {
        [P_SUN]: { u1: 1 },
        [MON]: { u1: 1, u2: 1 },
        [TUE]: { u1: 1 },
        [WED]: { u1: 1, u2: 1 },
        [THU]: { u1: 1 },
        [FRI]: { u1: 1 },
        [SAT]: { u1: 1 },
        [SUN]: { u1: 1, u2: 1 },
      },
    }),
  },
  {
    name: "incremental daily with PARTIAL attribution (unattributed remainder)",
    habit: habit({
      title: "Glass of water",
      scoringType: "incremental",
      basePoints: 3,
      targetCount: 4,
      completedDates: [MON, TUE, WED],
      completedBy: { [MON]: { u1: 2 }, [WED]: { u1: 1, u2: 3 } },
    }),
  },
  {
    name: "negative incremental — signed points drive a day below zero",
    habit: habit({
      title: "Late night snack",
      type: "negative",
      scoringType: "incremental",
      basePoints: 10,
      targetCount: 1,
      completedDates: [TUE, THU],
      completedBy: { [TUE]: { u1: 2 }, [THU]: { u2: 1 } },
    }),
  },
  {
    name: "negative threshold, unattributed",
    habit: habit({
      title: "Skipped workout",
      type: "negative",
      basePoints: 15,
      completedDates: [TUE, SAT],
    }),
  },
  {
    name: "weekly threshold — award parks on the week's FIRST completed day",
    habit: habit({
      title: "Meal plan",
      period: "weekly",
      basePoints: 25,
      completedDates: [P_MON, WED, FRI],
      completedBy: { [WED]: { u2: 1 }, [FRI]: { u1: 1 } },
    }),
  },
  {
    name: "weekly incremental — remainder parks on the week's LATEST day",
    habit: habit({
      title: "Deep clean",
      period: "weekly",
      scoringType: "incremental",
      basePoints: 8,
      targetCount: 3,
      completedDates: [P_WED, TUE, SAT],
      completedBy: { [TUE]: { u1: 1 } },
    }),
  },
  {
    name: "weekly, fully grandfathered, 4-week streak (2.0x)",
    habit: habit({
      title: "Weekly review",
      period: "weekly",
      basePoints: 20,
      completedDates: ["2026-06-08", "2026-06-15", P_TUE, THU],
    }),
  },
  {
    name: "assigned chore for a managed kid",
    habit: habit({
      title: "Dishes",
      assignedTo: LEO.uid,
      basePoints: 5,
      completedDates: [MON, TUE, WED, THU, FRI],
    }),
  },
  {
    name: "assigned chore, incremental, with attribution recorded anyway",
    habit: habit({
      title: "Feed the cat",
      assignedTo: LEO.uid,
      scoringType: "incremental",
      basePoints: 4,
      targetCount: 2,
      completedDates: [MON, WED],
      completedBy: { [MON]: { kid_leo: 2 } },
    }),
  },
  {
    name: "frozen dates bridge the household chain",
    habit: habit({
      title: "Journal",
      completedDates: [P_SUN, MON, WED, THU, FRI, SAT, SUN],
      frozenDates: [TUE],
      completedBy: {
        [MON]: { u1: 1 },
        [WED]: { u1: 1 },
        [THU]: { u1: 1 },
        [FRI]: { u1: 1 },
        [SAT]: { u1: 1 },
        [SUN]: { u1: 1 },
      },
    }),
  },
  {
    name: "per-member freeze bridges ONLY that member's chain",
    habit: habit({
      title: "Push-ups",
      completedDates: [MON, TUE, THU, FRI, SAT],
      frozenDatesBy: { [WED]: ["u1"] },
      completedBy: {
        [MON]: { u1: 1, u2: 1 },
        [TUE]: { u1: 1, u2: 1 },
        [THU]: { u1: 1, u2: 1 },
        [FRI]: { u1: 1, u2: 1 },
        [SAT]: { u1: 1, u2: 1 },
      },
    }),
  },
  {
    name: "planned pause bridges the gap",
    habit: habit({
      title: "Run",
      completedDates: [P_MON, P_TUE, P_WED, SAT, SUN],
      pausedUntil: FRI,
      completedBy: { [SAT]: { u2: 1 }, [SUN]: { u2: 1 } },
    }),
  },
  {
    name: "zero/negative attribution residue is treated as ABSENT",
    habit: habit({
      title: "Floss",
      scoringType: "incremental",
      basePoints: 6,
      completedDates: [MON, TUE],
      completedBy: { [MON]: { u1: 0, u2: -1 }, [TUE]: { u1: 1 } },
    }),
  },
  {
    name: "basePoints absent (defaults to 0) and no scoring fields",
    habit: { title: "Bare habit", completedDates: [MON, WED] },
  },
  {
    name: "perfect week — every day completed by one member",
    habit: habit({
      title: "Vitamins",
      completedDates: [MON, TUE, WED, THU, FRI, SAT, SUN],
      completedBy: Object.fromEntries(
        [MON, TUE, WED, THU, FRI, SAT, SUN].map((d) => [d, { u1: 1 }])
      ),
    }),
  },
  {
    name: "no completions at all",
    habit: habit({ title: "Idle", completedDates: [] }),
  },
];

const MEMBER_IDS = [JEN.uid, PAUL.uid, LEO.uid];
const ALL_DATES = [...weekDates(PRIOR_START), ...weekDates(WEEK_START)];

// ---------------------------------------------------------------------------
// Full-assembly fixtures
// ---------------------------------------------------------------------------

function input(overrides: Partial<DataAssemblyInput> = {}): DataAssemblyInput {
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

const MONEY_FIXTURE: DataAssemblyInput = input({
  transactions: [
    // Current week
    { amount: 42.37, category: "Groceries", date: MON, status: "verified" },
    { amount: 18.99, category: "groceries", date: WED, status: "verified" }, // mixed casing
    { amount: 7.5, category: "Coffee", date: THU, status: "verified" },
    { amount: 0.1, category: "Coffee", date: FRI, status: "verified" },
    { amount: 0.2, category: "Coffee", date: SAT, status: "verified" },
    { amount: 2400, category: "Income", date: FRI, status: "verified" }, // excluded
    { amount: 99.01, category: "income", date: FRI, status: "verified" }, // excluded (casing)
    { amount: 500, category: "Shopping", date: SAT, status: "pending_review" }, // excluded
    // Prior week
    { amount: 61.11, category: "Groceries", date: P_MON, status: "verified" },
    { amount: 3.33, category: "Gas", date: P_WED, status: "verified" },
    // Outside both windows
    { amount: 999.99, category: "Travel", date: "2026-05-01", status: "verified" },
    { amount: 12.34, category: "Travel", date: "2026-07-09", status: "verified" },
  ],
  calendarItems: [
    { title: "Rent", amount: 1800, date: "2026-07-06", type: "expense" }, // in window
    { title: "Netflix", amount: 15.49, date: "2026-07-12", type: "expense" }, // in window (day 7)
    { title: "Car loan", amount: 320, date: "2026-07-13", type: "expense" }, // out (day 8)
    { title: "Paycheck", amount: 2400, date: "2026-07-10", type: "income" }, // wrong type
    { title: "Old bill", amount: 40, date: SUN, type: "expense" }, // before window
  ],
});

const FULL_FIXTURE: DataAssemblyInput = input({
  ...MONEY_FIXTURE,
  members: [JEN, PAUL, LEO],
  habits: HABIT_CASES.map((c, i) => ({ ...c.habit, streakDays: i % 5 })),
});

const ASSEMBLY_FIXTURES: Array<{ name: string; input: DataAssemblyInput }> = [
  { name: "completely empty household", input: input() },
  { name: "money only, no habits or members", input: MONEY_FIXTURE },
  {
    name: "habits but no members (fully grandfathered household)",
    input: input({ habits: HABIT_CASES.map((c, i) => ({ ...c.habit, streakDays: i % 5 })) }),
  },
  {
    name: "members but no habits (idle week)",
    input: input({ members: [JEN, PAUL, LEO] }),
  },
  {
    name: "negative week — two negative habits outweigh one positive",
    input: input({
      members: [JEN, PAUL],
      habits: [
        {
          ...habit({
            title: "Late night snack",
            type: "negative",
            scoringType: "incremental",
            basePoints: 10,
            completedDates: [TUE],
            completedBy: { [TUE]: { u1: 2 } },
          }),
          streakDays: 1,
        },
        {
          ...habit({
            title: "Skipped workout",
            type: "negative",
            basePoints: 15,
            completedDates: [TUE],
            completedBy: { [TUE]: { u2: 1 } },
          }),
          streakDays: 1,
        },
        {
          ...habit({
            title: "Read",
            basePoints: 10,
            completedDates: [TUE],
            completedBy: { [TUE]: { u1: 1 } },
          }),
          streakDays: 4,
        },
      ],
    }),
  },
  { name: "everything at once", input: FULL_FIXTURE },
];

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

describe("recap assembly parity — client vs server", () => {
  it("shiftDay / weekDates agree", () => {
    expect(clientWeekDates(WEEK_START)).toEqual(weekDates(WEEK_START));
    expect(clientWeekDates(PRIOR_START)).toEqual(weekDates(PRIOR_START));
    // Across a month boundary, a leap day and a DST transition.
    for (const anchor of ["2026-06-29", "2028-02-26", "2026-03-06", "2026-11-01"]) {
      for (const delta of [-8, -7, -1, 0, 1, 7, 31]) {
        expect(clientShiftDay(anchor, delta)).toBe(shiftDay(anchor, delta));
      }
    }
  });

  describe.each(HABIT_CASES)("habit scorer parity — $name", ({ habit: h }) => {
    it("memberDatesFor agrees for every member", () => {
      for (const uid of MEMBER_IDS) {
        expect(clientMemberDatesFor(h, uid)).toEqual(memberDatesFor(h, uid));
      }
    });

    it("memberAttributedPointsOnDate agrees for every member × date", () => {
      for (const uid of MEMBER_IDS) {
        for (const date of ALL_DATES) {
          expect(clientMemberAttributedPointsOnDate(h, uid, date, WEEK_END)).toBe(
            memberAttributedPointsOnDate(h, uid, date, WEEK_END)
          );
        }
      }
    });

    it("unattributedPointsOnDate agrees for every date", () => {
      for (const date of ALL_DATES) {
        expect(clientUnattributedPointsOnDate(h, date, WEEK_END)).toBe(
          unattributedPointsOnDate(h, date, WEEK_END)
        );
      }
    });

    it("memberPointsOnDate agrees for every member × date", () => {
      for (const uid of MEMBER_IDS) {
        for (const date of ALL_DATES) {
          expect(clientMemberPointsOnDate([h], uid, date, WEEK_END)).toBe(
            memberPointsOnDate([h], uid, date, WEEK_END)
          );
        }
      }
    });

    it("buildDailyPoints / weekPointsTotal agree for this habit alone", () => {
      const members = [JEN, PAUL, LEO];
      expect(clientBuildDailyPoints([h], members, WEEK_START, WEEK_END)).toEqual(
        buildDailyPoints([h], members, WEEK_START, WEEK_END)
      );
      expect(clientWeekPointsTotal([h], members, PRIOR_START, PRIOR_END)).toBe(
        weekPointsTotal([h], members, PRIOR_START, PRIOR_END)
      );
    });

    it("assembleCeremony agrees for this habit alone", () => {
      const args = { habits: [h], members: [JEN, PAUL, LEO], weekStart: WEEK_START, weekEnd: WEEK_END };
      expect(clientAssembleCeremony(args)).toEqual(assembleCeremony(args));
    });
  });

  it("assembleCeremony agrees for the whole habit table at once", () => {
    const args = {
      habits: HABIT_CASES.map((c) => c.habit),
      members: [JEN, PAUL, LEO],
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    };
    expect(clientAssembleCeremony(args)).toEqual(assembleCeremony(args));
  });

  describe.each(ASSEMBLY_FIXTURES)("assembleWeeklyRecap parity — $name", ({ input: fixture }) => {
    it("produces byte-identical output", () => {
      expect(clientAssembleWeeklyRecap(fixture)).toEqual(assembleWeeklyRecap(fixture));
    });
  });

  it("the full fixture actually exercises the shapes it claims to", () => {
    const result = assembleWeeklyRecap(FULL_FIXTURE);
    // A habit with completions but zero attribution → a non-zero unattributed series.
    expect(result.dailyPoints.some((d) => d.unattributed !== 0)).toBe(true);
    // Per-member attribution exists.
    expect(result.memberFacts.length).toBeGreaterThan(0);
    expect(result.memberFacts.some((f) => f.points !== 0)).toBe(true);
    // Money math actually ran.
    expect(result.totalSpend).toBeGreaterThan(0);
    expect(result.topCategoryDeltas.length).toBeGreaterThan(0);
    expect(result.upcomingBills.length).toBeGreaterThan(0);
  });
});
