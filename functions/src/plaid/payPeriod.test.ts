import { describe, it, expect } from "vitest";
import { getPayPeriodForTransaction } from "./payPeriod";

// Parity with utils/paycheckPeriodCalculator.ts (kept in sync across the workspace).
describe("getPayPeriodForTransaction (functions port)", () => {
  it("returns the paycheck date for a transaction on/after it", () => {
    expect(getPayPeriodForTransaction("2026-06-15", "2026-06-15")).toBe("2026-06-15");
    expect(getPayPeriodForTransaction("2026-06-20", "2026-06-15")).toBe("2026-06-15");
  });
  it("returns '' for a pre-period transaction", () => {
    expect(getPayPeriodForTransaction("2026-06-10", "2026-06-15")).toBe("");
  });
  it("returns '' when no paycheck is tracked", () => {
    expect(getPayPeriodForTransaction("2026-06-20", undefined)).toBe("");
  });
});
