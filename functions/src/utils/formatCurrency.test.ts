import { describe, it, expect } from "vitest";
import { formatCurrency, DEFAULT_CURRENCY } from "./formatCurrency";

describe("DEFAULT_CURRENCY", () => {
  it("is USD", () => {
    expect(DEFAULT_CURRENCY).toBe("USD");
  });
});

describe("formatCurrency", () => {
  it("formats a positive amount with two decimals by default", () => {
    expect(formatCurrency(123.45)).toBe("$123.45");
  });

  it("pads cents to two decimal places", () => {
    expect(formatCurrency(0.1)).toBe("$0.10");
  });

  it("renders negatives with a leading minus sign", () => {
    expect(formatCurrency(-50)).toBe("-$50.00");
  });

  it("rounds to whole dollars when decimals: 0", () => {
    // Intl rounds 1234.5 up to 1235 here.
    expect(formatCurrency(1234.5, { decimals: 0 })).toBe("$1,235");
  });

  it("uses the requested currency symbol", () => {
    expect(formatCurrency(1000, { currency: "EUR" })).toContain("€");
  });

  it("falls back to USD for an invalid currency code", () => {
    expect(formatCurrency(5, { currency: "NOTREAL" })).toBe("$5.00");
  });

  it("treats a missing amount as zero", () => {
    expect(formatCurrency(undefined as unknown as number)).toBe("$0.00");
  });

  it("treats null and NaN amounts as zero", () => {
    expect(formatCurrency(null as unknown as number)).toBe("$0.00");
    expect(formatCurrency(NaN)).toBe("$0.00");
  });
});
