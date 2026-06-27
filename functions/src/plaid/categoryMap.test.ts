import { describe, it, expect } from "vitest";
import { mapPfcToBucket, pfcPrimaryToLabel, UNCATEGORIZED } from "./categoryMap";

describe("pfcPrimaryToLabel", () => {
  it("maps known PFC primaries to friendly labels (case-insensitive)", () => {
    expect(pfcPrimaryToLabel("FOOD_AND_DRINK")).toBe("Dining");
    expect(pfcPrimaryToLabel("transportation")).toBe("Transport");
    expect(pfcPrimaryToLabel("RENT_AND_UTILITIES")).toBe("Utilities");
  });
  it("returns the sentinel for unknown/absent primaries", () => {
    expect(pfcPrimaryToLabel("SOMETHING_NEW")).toBe(UNCATEGORIZED);
    expect(pfcPrimaryToLabel(undefined)).toBe(UNCATEGORIZED);
    expect(pfcPrimaryToLabel(null)).toBe(UNCATEGORIZED);
  });
});

describe("mapPfcToBucket", () => {
  const buckets = ["Groceries", "Dining", "Gas", "Utilities"];

  it("clamps a mapped label to an existing bucket (case-insensitive)", () => {
    expect(mapPfcToBucket("FOOD_AND_DRINK", buckets)).toBe("Dining");
    expect(mapPfcToBucket("RENT_AND_UTILITIES", ["utilities"])).toBe("utilities");
  });

  it("returns 'Uncategorized' when the label has no matching bucket (never bucket[0])", () => {
    // TRANSPORTATION → 'Transport', which isn't in buckets → sentinel, not 'Groceries'
    expect(mapPfcToBucket("TRANSPORTATION", buckets)).toBe(UNCATEGORIZED);
  });

  it("returns 'Uncategorized' for unknown PFC or empty bucket list", () => {
    expect(mapPfcToBucket("MYSTERY", buckets)).toBe(UNCATEGORIZED);
    expect(mapPfcToBucket("FOOD_AND_DRINK", [])).toBe(UNCATEGORIZED);
  });
});
