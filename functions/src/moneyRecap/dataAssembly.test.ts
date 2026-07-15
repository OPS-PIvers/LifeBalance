import { describe, it, expect } from "vitest";
import {
  assembleMonthlyMoneyRecap,
  type MoneyDataAssemblyInput,
  type RecapBucketSnapshot,
  type RecapTransaction,
} from "./dataAssembly";

// Recap month: June 2026; prior month: May 2026.
const MONTH = "2026-06";
const MONTH_START = "2026-06-01";
const MONTH_END = "2026-06-30";
const PRIOR_START = "2026-05-01";
const PRIOR_END = "2026-05-31";

function baseInput(overrides: Partial<MoneyDataAssemblyInput> = {}): MoneyDataAssemblyInput {
  return {
    transactions: [],
    bucketSnapshots: [],
    month: MONTH,
    monthStart: MONTH_START,
    monthEnd: MONTH_END,
    priorMonthStart: PRIOR_START,
    priorMonthEnd: PRIOR_END,
    netWorthDelta: null,
    ...overrides,
  };
}

function tx(overrides: Partial<RecapTransaction> = {}): RecapTransaction {
  return {
    amount: 10,
    merchant: "Shop",
    category: "Groceries",
    date: "2026-06-10",
    status: "verified",
    ...overrides,
  };
}

describe("assembleMonthlyMoneyRecap", () => {
  it("returns all-zero/empty output for a completely empty household", () => {
    expect(assembleMonthlyMoneyRecap(baseInput())).toEqual({
      totalIncome: 0,
      totalSpend: 0,
      priorMonthSpend: 0,
      bucketResults: [],
      topExpense: null,
      netWorthDelta: null,
    });
  });

  it("sums verified non-income spend for the month and income separately", () => {
    const transactions: RecapTransaction[] = [
      tx({ amount: 40.25, date: "2026-06-03" }),
      tx({ amount: 12.5, date: "2026-06-20", category: "Gas" }),
      tx({ amount: 2000, date: "2026-06-01", category: "Income" }),
      // Pending spend is excluded.
      tx({ amount: 999, date: "2026-06-15", status: "pending_review" }),
      // Prior-month spend counts only toward priorMonthSpend.
      tx({ amount: 30, date: "2026-05-10" }),
      // Outside both windows.
      tx({ amount: 500, date: "2026-04-10" }),
    ];
    const result = assembleMonthlyMoneyRecap(baseInput({ transactions }));
    expect(result.totalSpend).toBe(52.75);
    expect(result.totalIncome).toBe(2000);
    expect(result.priorMonthSpend).toBe(30);
  });

  it("groups bucket snapshots by bucketId, summing across periods, sorted over-budget first", () => {
    const bucketSnapshots: RecapBucketSnapshot[] = [
      // Groceries spans two periods in the month → summed: limit 600, spent 700 (over).
      { bucketId: "g", bucketName: "Groceries", limit: 300, totalSpent: 400, periodEndDate: "2026-06-15" },
      { bucketId: "g", bucketName: "Groceries", limit: 300, totalSpent: 300, periodEndDate: "2026-06-30" },
      // Dining: under budget.
      { bucketId: "d", bucketName: "Dining", limit: 200, totalSpent: 150, periodEndDate: "2026-06-30" },
    ];
    const result = assembleMonthlyMoneyRecap(baseInput({ bucketSnapshots }));
    // Sorted by overUnder descending → the over-budget bucket leads.
    expect(result.bucketResults).toEqual([
      { bucketId: "g", bucketName: "Groceries", limit: 600, spent: 700, overUnder: 100 },
      { bucketId: "d", bucketName: "Dining", limit: 200, spent: 150, overUnder: -50 },
    ]);
  });

  it("picks the biggest verified non-income expense as topExpense", () => {
    const transactions: RecapTransaction[] = [
      tx({ amount: 40, merchant: "Cafe", date: "2026-06-02" }),
      tx({ amount: 312.4, merchant: "Costco", category: "Groceries", date: "2026-06-14" }),
      // A bigger income row must NOT win.
      tx({ amount: 5000, merchant: "Payroll", category: "Income", date: "2026-06-01" }),
      // A bigger pending row must NOT win.
      tx({ amount: 900, merchant: "Pending", date: "2026-06-05", status: "pending_review" }),
    ];
    const result = assembleMonthlyMoneyRecap(baseInput({ transactions }));
    expect(result.topExpense).toEqual({
      merchant: "Costco",
      amount: 312.4,
      category: "Groceries",
      date: "2026-06-14",
    });
  });

  it("passes netWorthDelta through unchanged", () => {
    expect(assembleMonthlyMoneyRecap(baseInput({ netWorthDelta: -420.5 })).netWorthDelta).toBe(-420.5);
  });

  it("avoids floating-point drift when summing many small amounts", () => {
    const transactions: RecapTransaction[] = Array.from({ length: 3 }, () =>
      tx({ amount: 0.1, date: "2026-06-10" })
    );
    // 0.1 * 3 in float is 0.30000000000000004; cents math yields exactly 0.3.
    expect(assembleMonthlyMoneyRecap(baseInput({ transactions })).totalSpend).toBe(0.3);
  });
});
