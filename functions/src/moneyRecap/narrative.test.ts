import { describe, it, expect } from "vitest";
import { buildTemplateNarrative, type MoneyRecapNumericFields } from "./narrative";

function base(overrides: Partial<MoneyRecapNumericFields> = {}): MoneyRecapNumericFields {
  return {
    month: "2026-06",
    totalIncome: 0,
    totalSpend: 0,
    priorMonthSpend: 0,
    bucketResults: [],
    topExpense: null,
    netWorthDelta: null,
    ...overrides,
  };
}

describe("buildTemplateNarrative", () => {
  it("handles a completely empty month", () => {
    expect(buildTemplateNarrative(base())).toBe("No verified spending was logged this month.");
  });

  it("describes a month that spent more than the prior month", () => {
    const text = buildTemplateNarrative(
      base({ totalIncome: 5000, totalSpend: 3480.25, priorMonthSpend: 3120.5 })
    );
    expect(text).toContain("$3480.25 this month, more than last month's $3120.50");
    expect(text).toContain("$1519.75 of income unspent");
  });

  it("flags an over-budget bucket", () => {
    const text = buildTemplateNarrative(
      base({
        totalSpend: 645.1,
        priorMonthSpend: 600,
        bucketResults: [
          { bucketId: "g", bucketName: "Groceries", limit: 600, spent: 645.1, overUnder: 45.1 },
        ],
      })
    );
    expect(text).toContain("Groceries ran $45.10 over budget");
  });

  it("praises a month where every bucket landed under its limit", () => {
    const text = buildTemplateNarrative(
      base({
        totalSpend: 500,
        priorMonthSpend: 500,
        bucketResults: [
          { bucketId: "g", bucketName: "Groceries", limit: 600, spent: 500, overUnder: -100 },
        ],
      })
    );
    expect(text).toContain("at or under its limit");
  });

  it("notes an overspend (spent more than income)", () => {
    const text = buildTemplateNarrative(
      base({ totalIncome: 3000, totalSpend: 3400, priorMonthSpend: 3000 })
    );
    expect(text).toContain("$400.00 more than you took in");
  });
});
