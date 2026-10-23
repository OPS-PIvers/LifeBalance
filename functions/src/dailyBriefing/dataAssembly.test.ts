import { describe, it, expect } from "vitest";
import {
  assembleDailyBriefing,
  toBillCalendarItem,
  type AssembleDailyBriefingInput,
} from "./dataAssembly";
import { type BillCalendarItem } from "../shared/bills";

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

/** Raw calendarItems docs as the scheduled job reads them, through the real mapper. */
function billsFromDocs(docs: Record<string, Record<string, unknown>>): BillCalendarItem[] {
  return Object.entries(docs)
    .map(([id, data]) => toBillCalendarItem(id, data))
    .filter((i): i is BillCalendarItem => i !== null);
}

function billsDueOn(today: string, docs: Record<string, Record<string, unknown>>) {
  return assembleDailyBriefing(baseInput({ calendarItems: billsFromDocs(docs), today }));
}

describe("toBillCalendarItem", () => {
  it("drops paychecks and docs with no type", () => {
    expect(toBillCalendarItem("p", { type: "income", date: TODAY, amount: 2000 })).toBeNull();
    expect(toBillCalendarItem("x", { date: TODAY, amount: 50 })).toBeNull();
  });

  it("keeps the schedule and amount history the bill math reads", () => {
    expect(
      toBillCalendarItem("rent", {
        type: "expense",
        title: "Rent",
        date: "2026-01-15",
        amount: 1500,
        isRecurring: true,
        frequency: "semi-monthly",
        semiMonthlyDays: [15, 31],
        weekendShift: "before",
        earlierAmounts: [{ before: "2026-06-01", amount: 1400 }],
      })
    ).toEqual({
      id: "rent",
      date: "2026-01-15",
      amount: 1500,
      isRecurring: true,
      frequency: "semi-monthly",
      isPaid: false,
      isDeleted: false,
      parentRecurringId: undefined,
      semiMonthlyDays: [15, 31],
      weekendShift: "before",
      earlierAmounts: [{ before: "2026-06-01", amount: 1400 }],
      isOverride: undefined,
    });
  });

  it("narrows malformed fields instead of passing them through", () => {
    expect(
      toBillCalendarItem("b", {
        type: "expense",
        date: 20260714,
        amount: Number.NaN,
        isPaid: "yes",
        frequency: 7,
        weekendShift: "sideways",
      })
    ).toMatchObject({
      date: "",
      amount: undefined,
      isPaid: false,
      frequency: undefined,
      weekendShift: undefined,
    });
  });
});

describe("assembleDailyBriefing — bills due today match the app's schedule", () => {
  // 2026-08-15 is a Saturday; with weekendShift "before" it is due Friday 08-14.
  const shifted = {
    phone: {
      type: "expense",
      date: "2026-01-15",
      amount: 80,
      isRecurring: true,
      frequency: "monthly",
      weekendShift: "before",
    },
  };

  it("reports a weekend-shifted bill on the shifted day, not the nominal one", () => {
    expect(billsDueOn("2026-08-14", shifted).billsDueCount).toBe(1);
    expect(billsDueOn("2026-08-15", shifted).billsDueCount).toBe(0);
  });

  it("drops a weekend-shifted bill once its shifted occurrence is paid", () => {
    const paid = {
      ...shifted,
      paid: {
        type: "expense",
        date: "2026-08-14",
        amount: 80,
        isPaid: true,
        parentRecurringId: "phone",
      },
    };
    expect(billsDueOn("2026-08-14", paid).billsDueCount).toBe(0);
    expect(billsDueOn("2026-08-15", paid).billsDueCount).toBe(0);
  });

  it("uses a twice-a-month series' stored days, not days derived from its anchor", () => {
    const docs = {
      rent: {
        type: "expense",
        date: "2026-01-15",
        amount: 700,
        isRecurring: true,
        frequency: "semi-monthly",
        semiMonthlyDays: [15, 31],
      },
    };
    expect(billsDueOn("2026-08-31", docs)).toMatchObject({ billsDueCount: 1, billsDueTotal: 700 });
    expect(billsDueOn("2026-08-30", docs).billsDueCount).toBe(0);
  });

  it("totals a \"Just this month\" amount instead of the series amount", () => {
    const docs = {
      power: {
        type: "expense",
        date: "2026-01-14",
        amount: 120,
        isRecurring: true,
        frequency: "monthly",
      },
      override: {
        type: "expense",
        date: TODAY,
        amount: 98.68,
        isPaid: false,
        isOverride: true,
        parentRecurringId: "power",
      },
    };
    expect(billsDueOn(TODAY, docs)).toMatchObject({ billsDueCount: 1, billsDueTotal: 98.68 });
  });

  it("totals what the occurrence cost before a \"This and future months\" change", () => {
    const docs = {
      water: {
        type: "expense",
        date: "2026-01-14",
        amount: 60,
        isRecurring: true,
        frequency: "monthly",
        earlierAmounts: [{ before: "2026-08-01", amount: 45 }],
      },
    };
    expect(billsDueOn(TODAY, docs).billsDueTotal).toBe(45);
    expect(billsDueOn("2026-08-14", docs).billsDueTotal).toBe(60);
  });

  it("does not count a paycheck due today as a bill", () => {
    const docs = {
      pay: { type: "income", date: TODAY, amount: 2400, isRecurring: true, frequency: "bi-weekly" },
      bill: { type: "expense", date: TODAY, amount: 30 },
    };
    expect(billsDueOn(TODAY, docs)).toMatchObject({ billsDueCount: 1, billsDueTotal: 30 });
  });
});
