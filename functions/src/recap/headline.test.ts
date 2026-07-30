import { describe, it, expect } from "vitest";
import { buildRecapHeadline, RecapHeadlineFields } from "./headline";

function makeRecap(overrides: Partial<RecapHeadlineFields> = {}): RecapHeadlineFields {
  return {
    totalSpend: 100,
    priorWeekSpend: 100,
    habitCompletions: 0,
    pointsByMember: [],
    ...overrides,
  };
}

describe("buildRecapHeadline", () => {
  it("leads with savings when spend dropped meaningfully", () => {
    const headline = buildRecapHeadline(makeRecap({ totalSpend: 80, priorWeekSpend: 200 }));
    expect(headline).toBe("You saved $120 more than last week.");
  });

  it("leads with overspend when spend rose meaningfully", () => {
    const headline = buildRecapHeadline(makeRecap({ totalSpend: 250, priorWeekSpend: 150 }));
    expect(headline).toBe("You spent $100 more than last week.");
  });

  it("respects a household currency", () => {
    const headline = buildRecapHeadline(makeRecap({ totalSpend: 80, priorWeekSpend: 100 }), "EUR");
    expect(headline).toBe("You saved €20 more than last week.");
  });

  it("ignores sub-$1 swings and falls through to habit completions", () => {
    const headline = buildRecapHeadline(
      makeRecap({ totalSpend: 100.32, priorWeekSpend: 100, habitCompletions: 5 })
    );
    expect(headline).toBe("5 habit completions logged this week.");
  });

  it("singularizes a single habit completion", () => {
    const headline = buildRecapHeadline(makeRecap({ habitCompletions: 1 }));
    expect(headline).toBe("1 habit completion logged this week.");
  });

  it("falls through to points when there were no habit completions", () => {
    const headline = buildRecapHeadline(
      makeRecap({
        pointsByMember: [
          { memberId: "a", name: "Alex", points: 30 },
          { memberId: "b", name: "Sam", points: 15 },
        ],
      })
    );
    expect(headline).toBe("Your household earned 45 points this week.");
  });

  it("singularizes a single total point", () => {
    const headline = buildRecapHeadline(
      makeRecap({ pointsByMember: [{ memberId: "a", name: "Alex", points: 1 }] })
    );
    expect(headline).toBe("Your household earned 1 point this week.");
  });

  it("falls back to the generic message when the week had no activity", () => {
    const headline = buildRecapHeadline(makeRecap());
    expect(headline).toBe("See how your spending, habits, and points stacked up this week.");
  });

  it("handles an EMPTY pointsByMember gracefully (a week with no per-member data)", () => {
    // The assembly now emits `[]` rather than a row of zeroes for a week no
    // member holds a completion in — this must degrade to the generic copy,
    // never crash the push.
    expect(buildRecapHeadline(makeRecap({ pointsByMember: [] }))).toBe(
      "See how your spending, habits, and points stacked up this week."
    );
    // ...and the money/habit signals still win when they exist.
    expect(buildRecapHeadline(makeRecap({ pointsByMember: [], habitCompletions: 3 }))).toBe(
      "3 habit completions logged this week."
    );
  });
});
