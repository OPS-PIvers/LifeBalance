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
  unattributedSplitForDate,
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
  unattributedSplitForDate as clientUnattributedSplitForDate,
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
    name: "negative habit with basePoints ITSELF stored negative (real production shape)",
    habit: habit({
      title: "Doom scroll",
      type: "negative",
      basePoints: -1,
      completedDates: [WED, FRI],
      completedBy: { [WED]: { u1: 1 }, [FRI]: { u2: 1 } },
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
  // --- creditMode (RECAP-MATH) ---------------------------------------------
  // A `creditMode: 'household'` completion writes NO `completedBy` entry BY
  // DESIGN, so on the document it is indistinguishable from grandfathered
  // history — which is exactly why the recap has to read the flag to tell the
  // two apart. Production shapes: the Ivers household runs 15 of these.
  {
    name: "household credit — creditMode 'household', completions, no completedBy",
    habit: habit({
      title: "Homemade dinner",
      creditMode: "household",
      basePoints: 12,
      completedDates: [MON, TUE, WED, THU],
    }),
  },
  {
    name: "household credit, weekly threshold",
    habit: habit({
      title: "Go to liquor store",
      creditMode: "household",
      period: "weekly",
      basePoints: 20,
      completedDates: [P_TUE, WED],
    }),
  },
  {
    name: "household credit habit carrying STALE attribution (mode flipped later)",
    habit: habit({
      title: "Grocery Store",
      creditMode: "household",
      scoringType: "incremental",
      basePoints: 5,
      targetCount: 2,
      completedDates: [MON, WED],
      completedBy: { [MON]: { u1: 1 } },
    }),
  },
  {
    name: "household credit, NEGATIVE habit (signed points land in householdCredit)",
    habit: habit({
      title: "Go out to dinner",
      creditMode: "household",
      type: "negative",
      basePoints: 8,
      completedDates: [TUE, SAT],
    }),
  },
  {
    name: "creditMode 'members' with completions but EMPTY completedBy — a REAL gap",
    habit: habit({
      title: "Go into Target",
      creditMode: "members",
      scoringType: "incremental",
      basePoints: 7,
      completedDates: [TUE, FRI],
      completedBy: {},
    }),
  },
  {
    name: "assigned chore with creditMode 'household' — the mode is INERT on a chore",
    habit: habit({
      title: "Take out trash",
      assignedTo: LEO.uid,
      creditMode: "household",
      basePoints: 5,
      completedDates: [MON, TUE],
    }),
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
    // RECAP-MATH sentinels — counted-spend exclusions and the bills slice.
    { amount: 220.89, category: "Credit Card", date: TUE, status: "verified" }, // excluded
    { amount: 11.11, category: "credit card", date: THU, status: "verified" }, // excluded (casing)
    { amount: 1200, category: "Budgeted in Calendar", date: MON, status: "verified" }, // bills
    { amount: 106.77, category: "Bills", date: THU, status: "verified" }, // bills (legacy tag)
    // 🛡️ TRAILING SPACE — real production data ("Grocery & Misc. "). The
    // grouping key is lowercased but NOT trimmed, so this is its own category;
    // both copies must agree on that, whichever way it is decided.
    { amount: 55.05, category: "Grocery & Misc. ", date: WED, status: "verified" },
    { amount: 5.05, category: "Grocery & Misc.", date: THU, status: "verified" },
    // Prior week
    { amount: 61.11, category: "Groceries", date: P_MON, status: "verified" },
    { amount: 3.33, category: "Gas", date: P_WED, status: "verified" },
    { amount: 300, category: "Budgeted in Calendar", date: P_TUE, status: "verified" },
    { amount: 40, category: "Credit Card", date: P_TUE, status: "verified" }, // excluded
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

// ---------------------------------------------------------------------------
// 🛡️ THE PRODUCTION REGRESSION — the Ivers household's real 2026-W31 recap
//
// What the shipped document said, and why every number in it was wrong or
// misleading:
//
//   totalSpend       $2,649.89   ← included $220.89 of `Credit Card` SENTINEL,
//                                  which is account routing, not spending
//   priorWeekSpend     $803.12
//   ⇒ headline: "3.3x more than last week"
//
//   ...but $1,306.77 of the week was BILLS (rent/insurance/utilities, the
//   `Budgeted in Calendar` sentinel `payCalendarItem` files paid bills under).
//   Day-to-day spending was $1,122.23 against $803.12 — a real but ordinary
//   week, reported as a blowout. That same sentinel also swung $1,306.77 in
//   `topCategoryDeltas`, so the recap's #1 "category insight" was a routing tag.
//
// The amounts below reproduce those four figures exactly; the assertions on
// them live in the "2026-W31 regression" describe block at the bottom.
// ---------------------------------------------------------------------------
const W31_START = "2026-07-27";
const W31_END = "2026-08-02";
const [W31_MON, W31_TUE, W31_WED, W31_THU, W31_FRI, W31_SAT] = weekDates(W31_START) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const [W30_MON, W30_TUE, W30_WED, W30_THU] = weekDates(shiftDay(W31_START, -7)) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** $1,306.77 of bills + $220.89 of card sentinel + $1,122.23 of day-to-day. */
const W31_FIXTURE: DataAssemblyInput = input({
  weekStart: W31_START,
  weekEnd: W31_END,
  transactions: [
    // --- Bills: 950.00 + 231.50 + 125.27 = 1306.77 -------------------------
    { amount: 950, category: "Budgeted in Calendar", date: W31_MON, status: "verified" },
    { amount: 231.5, category: "Budgeted in Calendar", date: W31_WED, status: "verified" },
    // Legacy tag from an older paid bill — still a bill.
    { amount: 125.27, category: "Bills", date: W31_FRI, status: "verified" },
    // --- Credit-card SENTINEL: 180.00 + 40.89 = 220.89 (never spend) -------
    { amount: 180, category: "Credit Card", date: W31_TUE, status: "verified" },
    { amount: 40.89, category: "Credit Card", date: W31_SAT, status: "verified" },
    // --- Day-to-day: 412.55 + 88.00 + 210.18 + 96.50 + 315.00 = 1122.23 ----
    // The trailing space is real production data and is NOT trimmed, so these
    // two grocery rows are deliberately two separate categories.
    { amount: 412.55, category: "Grocery & Misc. ", date: W31_MON, status: "verified" },
    { amount: 88, category: "Grocery & Misc.", date: W31_THU, status: "verified" },
    { amount: 210.18, category: "Dining", date: W31_WED, status: "verified" },
    { amount: 96.5, category: "Gas", date: W31_THU, status: "verified" },
    { amount: 315, category: "Shopping", date: W31_SAT, status: "verified" },
    // --- Prior week (2026-W30): 380.12 + 165.00 + 88.00 + 170.00 = 803.12 --
    { amount: 380.12, category: "Grocery & Misc. ", date: W30_MON, status: "verified" },
    { amount: 165, category: "Dining", date: W30_TUE, status: "verified" },
    { amount: 88, category: "Gas", date: W30_WED, status: "verified" },
    { amount: 170, category: "Shopping", date: W30_THU, status: "verified" },
  ],
  members: [JEN, PAUL],
  habits: [
    // A household-credit habit (one of the 15 the household actually runs) next
    // to an attributed one and a per-member habit that never got a person.
    { ...habit({ title: "Homemade dinner", creditMode: "household", basePoints: 12, completedDates: [W31_MON, W31_TUE, W31_WED] }), streakDays: 3 },
    { ...habit({ title: "Morning walk", basePoints: 10, completedDates: [W31_MON, W31_TUE], completedBy: { [W31_MON]: { u1: 1 }, [W31_TUE]: { u2: 1 } } }), streakDays: 2 },
    { ...habit({ title: "Go into Target", creditMode: "members", scoringType: "incremental", basePoints: 7, completedDates: [W31_THU, W31_FRI], completedBy: {} }), streakDays: 2 },
  ],
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
  { name: "the real 2026-W31 week", input: W31_FIXTURE },
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

    it("unattributedSplitForDate agrees, and sums back to unattributedPointsOnDate", () => {
      for (const date of ALL_DATES) {
        const serverSplit = unattributedSplitForDate([h], date, WEEK_END);
        expect(clientUnattributedSplitForDate([h], date, WEEK_END)).toEqual(serverSplit);

        // 🛡️ THE INVARIANT the split exists to keep: it decomposes the figure it
        // explains, never re-derives it. An assigned chore contributes to
        // neither side (its points never reach the household pool).
        // `+ 0` collapses the negative zero `unattributedPointsOnDate` can
        // return for a zero-unit negative habit (`0 * -10 === -0`); the split
        // accumulates from a positive zero, and `Object.is(-0, 0)` is false.
        const expected = h.assignedTo ? 0 : unattributedPointsOnDate(h, date, WEEK_END) + 0;
        expect(serverSplit.householdCredit + serverSplit.unclaimed).toBe(expected);
      }
    });

    it("household credit lands on the RIGHT side of the split", () => {
      // The whole point of the field: a `creditMode: 'household'` habit's
      // unattributed points are DELIBERATE, and a members-mode one's are not.
      // Both look identical on the document (no `completedBy` either way), so a
      // scorer that ignored `creditMode` would put them in the same bucket.
      const householdCredit = ALL_DATES.reduce(
        (sum, date) => sum + unattributedSplitForDate([h], date, WEEK_END).householdCredit,
        0
      );
      const unclaimed = ALL_DATES.reduce(
        (sum, date) => sum + unattributedSplitForDate([h], date, WEEK_END).unclaimed,
        0
      );
      if (!h.assignedTo && h.creditMode === "household") {
        expect(unclaimed).toBe(0);
      } else {
        expect(householdCredit).toBe(0);
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

  // ---------------------------------------------------------------------------
  // 🛡️ memberTopStreak TIE-BREAK — dedicated fixture (not in HABIT_CASES)
  //
  // memberTopStreak's per-habit loop keeps the FIRST habit in roster order on a
  // tie (`if (!best || days > best.days)`, never `>=`). None of HABIT_CASES
  // exercises two habits with an IDENTICAL streak for the same member — the
  // `describe.each(HABIT_CASES)` tests each habit alone, and the "whole habit
  // table at once" test above mixes titles/members that never tie — so mutation
  // testing found this comparator unpinned: flipping `>` to `>=` in either copy
  // left every other parity assertion passing. Two habits, same member, same
  // 3-day streak ending on WEEK_END, closes that hole.
  // ---------------------------------------------------------------------------
  it("memberTopStreak tie-break keeps the FIRST habit in roster order (client === server)", () => {
    const tiedDates = [FRI, SAT, SUN]; // 3-day streak ending WEEK_END
    const habitA = habit({
      title: "Habit A",
      completedDates: tiedDates,
      completedBy: { [FRI]: { u1: 1 }, [SAT]: { u1: 1 }, [SUN]: { u1: 1 } },
    });
    const habitB = habit({
      title: "Habit B",
      completedDates: tiedDates,
      completedBy: { [FRI]: { u1: 1 }, [SAT]: { u1: 1 }, [SUN]: { u1: 1 } },
    });
    const args = {
      habits: [habitA, habitB],
      members: [JEN],
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    };

    const serverResult = assembleCeremony(args);
    const clientResult = clientAssembleCeremony(args);

    // The parity check: both copies must agree, byte-for-byte.
    expect(clientResult).toEqual(serverResult);

    // Pin the documented rule itself, so a future edit that breaks it (in
    // EITHER copy, in a way that keeps them agreeing with each other) is still
    // caught here rather than only by this test's own parity assertion.
    const jenFacts = serverResult.memberFacts.find((f) => f.memberId === JEN.uid);
    expect(jenFacts?.topStreak?.habitTitle).toBe("Habit A");
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
    // RECAP-MATH: BOTH halves of each new decomposition are non-zero, so a
    // fixture that quietly stopped covering one side fails here rather than
    // leaving a new branch untested.
    expect(result.billsSpend).toBeGreaterThan(0);
    expect(result.dayToDaySpend).toBeGreaterThan(0);
    expect(result.priorWeekBillsSpend).toBeGreaterThan(0);
    expect(result.unattributedSplit.householdCredit).not.toBe(0);
    expect(result.unattributedSplit.unclaimed).not.toBe(0);
  });

  // -------------------------------------------------------------------------
  // 🛡️ RECAP-MATH invariants — asserted on the SERVER copy, while the
  // `assembleWeeklyRecap parity` block above pins the client to it byte-for-byte.
  // -------------------------------------------------------------------------
  describe.each(ASSEMBLY_FIXTURES)("RECAP-MATH invariants — $name", ({ input: fixture }) => {
    it("billsSpend + dayToDaySpend === totalSpend (both weeks)", () => {
      const r = assembleWeeklyRecap(fixture);
      expect(r.billsSpend + r.dayToDaySpend).toBeCloseTo(r.totalSpend, 10);
      expect(r.priorWeekBillsSpend + r.priorWeekDayToDaySpend).toBeCloseTo(r.priorWeekSpend, 10);
    });

    it("unattributedSplit sums to Σ dailyPoints[].unattributed", () => {
      const r = assembleWeeklyRecap(fixture);
      const seriesTotal = r.dailyPoints.reduce((sum, d) => sum + d.unattributed, 0);
      expect(r.unattributedSplit.householdCredit + r.unattributedSplit.unclaimed).toBe(seriesTotal);
      // ...and each day's own split does the same, so the chart can stack it.
      for (const day of r.dailyPoints) {
        const split = day.unattributedSplit;
        expect(split).toBeDefined();
        expect((split?.householdCredit ?? 0) + (split?.unclaimed ?? 0)).toBe(day.unattributed);
      }
    });

    it("no sentinel category ever reaches topCategoryDeltas", () => {
      const r = assembleWeeklyRecap(fixture);
      for (const delta of r.topCategoryDeltas) {
        const key = delta.category.toLowerCase();
        expect(key).not.toBe("budgeted in calendar");
        expect(key).not.toBe("bills");
        expect(key).not.toBe("credit card");
        expect(key).not.toBe("income");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 🛡️ THE PRODUCTION REGRESSION — 2026-W31, the week this work was specified
  // against. Numbers are the household's real ones (see the fixture's header).
  // -------------------------------------------------------------------------
  describe("2026-W31 regression", () => {
    const result = assembleWeeklyRecap(W31_FIXTURE);

    it("drops the $220.89 Credit Card sentinel from totalSpend", () => {
      // Before: $2,649.89. The sentinel is account routing, not spending.
      expect(result.totalSpend).toBe(2429.0);
      expect(2429.0 + 220.89).toBeCloseTo(2649.89, 10);
    });

    it("splits the week into $1,306.77 of bills and $1,122.23 day-to-day", () => {
      expect(result.billsSpend).toBe(1306.77);
      expect(result.dayToDaySpend).toBe(1122.23);
      expect(result.billsSpend + result.dayToDaySpend).toBe(result.totalSpend);
    });

    it("does NOT report a misleading week-over-week increase", () => {
      expect(result.priorWeekSpend).toBe(803.12);
      expect(result.priorWeekBillsSpend).toBe(0);
      expect(result.priorWeekDayToDaySpend).toBe(803.12);

      // The shipped headline compared $2,649.89 to $803.12 — a 3.3x "increase"
      // that was almost entirely a heavy bill week.
      expect(2649.89 / result.priorWeekSpend).toBeGreaterThan(3);
      // The honest comparison, which is what the day-to-day pair is FOR.
      expect(result.dayToDaySpend / result.priorWeekDayToDaySpend).toBeLessThan(1.5);
    });

    it("no longer crowns 'Budgeted in Calendar' the #1 category insight", () => {
      // It swung $1,306.77 — larger than every real category combined — so
      // before RECAP-MATH it won this list outright.
      expect(result.topCategoryDeltas.map((d) => d.category)).toEqual([
        "Shopping",
        "Grocery & Misc.",
        "Dining",
      ]);
      expect(result.topCategoryDeltas[0]).toEqual({
        category: "Shopping",
        current: 315,
        prior: 170,
      });
    });

    it("keeps the trailing-space category separate from its trimmed twin", () => {
      // "Grocery & Misc. " is real stored data. The grouping key is lowercased
      // but NOT trimmed, so the two are two categories — pinned here so a future
      // trim is a deliberate, visible decision rather than a silent one.
      const spaced = result.topCategoryDeltas.find((d) => d.category === "Grocery & Misc. ");
      const trimmed = result.topCategoryDeltas.find((d) => d.category === "Grocery & Misc.");
      expect(trimmed).toEqual({ category: "Grocery & Misc.", current: 88, prior: 0 });
      // The spaced one's $32.43 swing didn't make the top 3 — which it would
      // have, at $500.55 vs $380.12, had the two been merged.
      expect(spaced).toBeUndefined();
    });

    it("tells deliberate household credit apart from a real attribution gap", () => {
      // "Homemade dinner" is creditMode: 'household' — earned together, on
      // purpose. "Go into Target" is creditMode: 'members' with an EMPTY
      // completedBy — a genuine gap. Before RECAP-MATH both were one number.
      expect(result.unattributedSplit.householdCredit).toBeGreaterThan(0);
      expect(result.unattributedSplit.unclaimed).toBeGreaterThan(0);
      expect(
        result.unattributedSplit.householdCredit + result.unattributedSplit.unclaimed
      ).toBe(result.dailyPoints.reduce((sum, d) => sum + d.unattributed, 0));
    });

    it("mixes household credit and a real gap on the SAME day without conflating them", () => {
      const mixed = assembleWeeklyRecap({
        ...W31_FIXTURE,
        habits: [
          {
            ...habit({
              title: "Homemade dinner",
              creditMode: "household",
              basePoints: 12,
              completedDates: [W31_MON],
            }),
            streakDays: 1,
          },
          {
            ...habit({
              title: "Go into Target",
              creditMode: "members",
              basePoints: 7,
              completedDates: [W31_MON],
              completedBy: {},
            }),
            streakDays: 1,
          },
        ],
      });
      const monday = mixed.dailyPoints.find((d) => d.date === W31_MON);
      expect(monday?.unattributedSplit).toEqual({ householdCredit: 12, unclaimed: 7 });
      expect(monday?.unattributed).toBe(19);
    });
  });
});
