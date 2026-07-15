import { describe, it, expect } from "vitest";

import {
  normalizeBillTitle,
  findBillToPay,
  expandCalendarItems,
  generateRecurringId,
  parseRecurringId,
  isRecurringId,
  type BillCalendarItem,
} from "./billMatch";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function bill(overrides: Partial<BillCalendarItem>): BillCalendarItem {
  return {
    id: "b1",
    title: "Bill",
    amount: 100,
    date: "2026-07-14",
    type: "expense",
    isPaid: false,
    ...overrides,
  };
}

const TODAY = "2026-07-14";

// ---------------------------------------------------------------------------
// normalizeBillTitle
// ---------------------------------------------------------------------------

describe("normalizeBillTitle", () => {
  it("lowercases and trims", () => {
    expect(normalizeBillTitle("  Rent  ")).toBe("rent");
  });
});

// ---------------------------------------------------------------------------
// Synthetic recurring IDs
// ---------------------------------------------------------------------------

describe("recurring IDs", () => {
  it("round-trips template id + date", () => {
    const id = generateRecurringId("tmpl", "2026-07-14");
    expect(isRecurringId(id)).toBe(true);
    expect(parseRecurringId(id)).toEqual({ templateId: "tmpl", date: "2026-07-14" });
  });

  it("returns null for a non-synthetic id", () => {
    expect(isRecurringId("plainId")).toBe(false);
    expect(parseRecurringId("plainId")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// expandCalendarItems — recurring + suppression
// ---------------------------------------------------------------------------

describe("expandCalendarItems", () => {
  it("expands a monthly template across the window", () => {
    const items = [
      bill({ id: "rent", title: "Rent", isRecurring: true, frequency: "monthly", date: "2026-01-01" }),
    ];
    const expanded = expandCalendarItems(
      items,
      new Date("2026-06-01"),
      new Date("2026-08-31")
    );
    const dates = expanded.map((i) => i.date).sort();
    expect(dates).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  it("suppresses a paid recurring instance", () => {
    const items = [
      bill({ id: "rent", title: "Rent", isRecurring: true, frequency: "monthly", date: "2026-01-01" }),
      // paid instance record for July
      bill({ id: "paid1", title: "Rent", isPaid: true, parentRecurringId: "rent", date: "2026-07-01", isRecurring: false }),
    ];
    const expanded = expandCalendarItems(
      items,
      new Date("2026-06-15"),
      new Date("2026-08-15")
    ).filter((i) => !i.isPaid);
    const dates = expanded.map((i) => i.date);
    expect(dates).not.toContain("2026-07-01");
    expect(dates).toContain("2026-08-01");
  });
});

// ---------------------------------------------------------------------------
// findBillToPay
// ---------------------------------------------------------------------------

describe("findBillToPay", () => {
  it("returns null for a blank title", () => {
    expect(findBillToPay([bill({})], "  ", TODAY)).toBeNull();
  });

  it("matches an exact (case-insensitive) title", () => {
    const items = [bill({ id: "r", title: "Rent", date: "2026-07-20" })];
    const match = findBillToPay(items, "rent", TODAY);
    expect(match?.id).toBe("r");
  });

  it("prefers exact over a contains match", () => {
    const items = [
      bill({ id: "sub", title: "Rent Insurance", date: "2026-07-16" }),
      bill({ id: "exact", title: "Rent", date: "2026-07-25" }),
    ];
    const match = findBillToPay(items, "Rent", TODAY);
    expect(match?.id).toBe("exact");
  });

  it("falls back to a contains match", () => {
    const items = [bill({ id: "e", title: "Electric Bill", date: "2026-07-18" })];
    const match = findBillToPay(items, "electric", TODAY);
    expect(match?.id).toBe("e");
  });

  it("skips already-paid bills", () => {
    const items = [bill({ id: "r", title: "Rent", isPaid: true, date: "2026-07-20" })];
    expect(findBillToPay(items, "Rent", TODAY)).toBeNull();
  });

  it("skips income items", () => {
    const items = [bill({ id: "pay", title: "Paycheck", type: "income", date: "2026-07-20" })];
    expect(findBillToPay(items, "Paycheck", TODAY)).toBeNull();
  });

  it("picks the earliest-dated bill when several share a title", () => {
    const items = [
      bill({ id: "late", title: "Rent", date: "2026-08-01" }),
      bill({ id: "early", title: "Rent", date: "2026-07-05" }),
    ];
    const match = findBillToPay(items, "Rent", TODAY);
    expect(match?.id).toBe("early");
  });

  it("matches a recurring instance and returns its synthetic id + due date", () => {
    const items = [
      bill({ id: "rent", title: "Rent", isRecurring: true, frequency: "monthly", date: "2026-01-01" }),
    ];
    const match = findBillToPay(items, "Rent", TODAY);
    // Nearest occurrence within the window on/after the range start.
    expect(match).not.toBeNull();
    expect(isRecurringId(match!.id)).toBe(true);
    expect(parseRecurringId(match!.id)?.templateId).toBe("rent");
  });

  it("returns null when nothing matches", () => {
    const items = [bill({ id: "r", title: "Rent", date: "2026-07-20" })];
    expect(findBillToPay(items, "Netflix", TODAY)).toBeNull();
  });

  it("excludes bills outside the due-date window", () => {
    const items = [bill({ id: "r", title: "Rent", date: "2027-01-01" })];
    expect(findBillToPay(items, "Rent", TODAY, 45, 45)).toBeNull();
  });
});
