import { describe, expect, it } from "vitest";
import { formatQuantity as serverFormat, mergeQuantity as serverMerge, resolveNewQuantityField as serverResolveNewQuantityField } from "./quantityLogic";
// The CLIENT implementation this file is a twin of. Importing it here turns
// "these must stay in lockstep" from a comment into a test: functions/tsconfig
// excludes *.test.ts, and the suite runs under the root vitest config, so the
// `@/` alias resolves (same trick as merchantRules.test.ts /
// backdatedHabitFire.test.ts). One shared table run through both
// implementations catches drift that two hand-kept tables could not.
import {
  formatQuantity as clientFormat,
  mergeQuantity as clientMerge,
  resolveNewQuantityField as clientResolveNewQuantityField,
} from "@/utils/grocerySmartDefaults";

interface FormatCase {
  name: string;
  count: number;
  unit: string;
  expected: string;
}

const formatCases: FormatCase[] = [
  { name: "count + unit", count: 2, unit: "lbs", expected: "2 lbs" },
  { name: "count-only", count: 3, unit: "", expected: "3" },
  { name: "default 1/no-unit collapses to empty", count: 1, unit: "", expected: "" },
  { name: "1 with a unit is NOT collapsed", count: 1, unit: "dozen", expected: "1 dozen" },
  { name: "decimal count", count: 1.5, unit: "lbs", expected: "1.5 lbs" },
];

describe("formatQuantity parity", () => {
  it.each(formatCases)("$name", ({ count, unit, expected }) => {
    expect(serverFormat({ count, unit })).toBe(expected);
    expect(clientFormat({ count, unit })).toBe(expected);
    expect(serverFormat({ count, unit })).toBe(clientFormat({ count, unit }));
  });
});

interface MergeCase {
  name: string;
  existing: string | number | null | undefined;
  addCount: number;
  expected: string;
}

const mergeCases: MergeCase[] = [
  { name: "adds while preserving the unit", existing: "2 lbs", addCount: 1, expected: "3 lbs" },
  { name: "adds a count-only quantity", existing: "2", addCount: 1, expected: "3" },
  { name: "missing existing counts as 1", existing: undefined, addCount: 1, expected: "2" },
  { name: "null existing counts as 1", existing: null, addCount: 1, expected: "2" },
  { name: "blank existing counts as 1", existing: "", addCount: 1, expected: "2" },
  { name: "legacy raw-number existing (no migration needed)", existing: 2, addCount: 1, expected: "3" },
  { name: "adds more than 1 at once", existing: "1 lbs", addCount: 3, expected: "4 lbs" },
  { name: "non-numeric-leading text is left untouched", existing: "dozen", addCount: 1, expected: "dozen" },
];

describe("mergeQuantity parity", () => {
  it.each(mergeCases)("$name", ({ existing, addCount, expected }) => {
    expect(serverMerge(existing, addCount)).toBe(expected);
    expect(clientMerge(existing, addCount)).toBe(expected);
    expect(serverMerge(existing, addCount)).toBe(clientMerge(existing, addCount));
  });

  it("never string-concatenates (the historical bug)", () => {
    expect(serverMerge("2 lbs", 1)).not.toBe("2 lbs1");
  });
});

describe("resolveNewQuantityField parity", () => {
  it("omits the field entirely when no quantity was supplied", () => {
    expect(serverResolveNewQuantityField(undefined)).toBeUndefined();
    expect(clientResolveNewQuantityField(undefined)).toBeUndefined();
  });

  it("omits the field for an explicit count of 1 (matches the app-wide '1 is implicit' convention)", () => {
    expect(serverResolveNewQuantityField(1)).toBeUndefined();
    expect(clientResolveNewQuantityField(1)).toBeUndefined();
  });

  it("writes the formatted string for any other explicit count", () => {
    expect(serverResolveNewQuantityField(2)).toBe("2");
    expect(clientResolveNewQuantityField(2)).toBe("2");
    expect(serverResolveNewQuantityField(0.5)).toBe("0.5");
    expect(clientResolveNewQuantityField(0.5)).toBe("0.5");
  });
});
