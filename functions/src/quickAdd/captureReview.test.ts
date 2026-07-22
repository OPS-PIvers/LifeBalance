import { describe, it, expect } from "vitest";

import {
  getCaptureReviewMode,
  isManualReview,
  type CaptureType,
  type CaptureReviewMode,
} from "./captureReview";

const ALL_TYPES: CaptureType[] = ["expense", "shopping", "todo"];

describe("getCaptureReviewMode (per-type defaults)", () => {
  it("treats undefined as the per-type default", () => {
    expect(getCaptureReviewMode(undefined, "expense")).toBe("review");
    expect(getCaptureReviewMode(undefined, "shopping")).toBe("auto");
    expect(getCaptureReviewMode(undefined, "todo")).toBe("auto");
  });

  it("treats null as the per-type default", () => {
    expect(getCaptureReviewMode(null, "expense")).toBe("review");
    expect(getCaptureReviewMode(null, "shopping")).toBe("auto");
    expect(getCaptureReviewMode(null, "todo")).toBe("auto");
  });

  it("treats an empty map as the per-type default", () => {
    expect(getCaptureReviewMode({}, "expense")).toBe("review");
    expect(getCaptureReviewMode({}, "shopping")).toBe("auto");
    expect(getCaptureReviewMode({}, "todo")).toBe("auto");
  });

  it("an explicit override for one type wins, leaving the others at default", () => {
    const map: Partial<Record<CaptureType, CaptureReviewMode>> = { expense: "auto" };
    expect(getCaptureReviewMode(map, "expense")).toBe("auto");
    expect(getCaptureReviewMode(map, "shopping")).toBe("auto");
    expect(getCaptureReviewMode(map, "todo")).toBe("auto");
  });

  it('honors an explicit "review" override on a type that defaults to "auto"', () => {
    expect(getCaptureReviewMode({ shopping: "review" }, "shopping")).toBe("review");
    expect(getCaptureReviewMode({ todo: "review" }, "todo")).toBe("review");
  });

  it('honors an explicit "auto" override on a type that defaults to "review"', () => {
    expect(getCaptureReviewMode({ expense: "auto" }, "expense")).toBe("auto");
  });

  it("every type can be overridden independently in the same map", () => {
    const map: Partial<Record<CaptureType, CaptureReviewMode>> = {
      expense: "auto",
      shopping: "review",
      todo: "review",
    };
    expect(getCaptureReviewMode(map, "expense")).toBe("auto");
    expect(getCaptureReviewMode(map, "shopping")).toBe("review");
    expect(getCaptureReviewMode(map, "todo")).toBe("review");
  });
});

describe("isManualReview", () => {
  it('matches getCaptureReviewMode === "review" for every type/setting combination', () => {
    for (const type of ALL_TYPES) {
      expect(isManualReview(undefined, type)).toBe(getCaptureReviewMode(undefined, type) === "review");
      expect(isManualReview({ [type]: "review" }, type)).toBe(true);
      expect(isManualReview({ [type]: "auto" }, type)).toBe(false);
    }
  });

  it("reflects the legacy default per type when unset", () => {
    expect(isManualReview(undefined, "expense")).toBe(true);
    expect(isManualReview(undefined, "shopping")).toBe(false);
    expect(isManualReview(undefined, "todo")).toBe(false);
  });
});
