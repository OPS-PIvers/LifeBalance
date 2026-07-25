import { describe, it, expect } from "vitest";
import { resolveTodoCategory, MAX_TODO_CATEGORY_LENGTH } from "./todoCategoryMatch";

const HOUSEHOLD_CATEGORIES = ["Home", "Work", "Errands"];

describe("resolveTodoCategory", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveTodoCategory(undefined, HOUSEHOLD_CATEGORIES)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(resolveTodoCategory("", HOUSEHOLD_CATEGORIES)).toBeUndefined();
  });

  it("returns undefined for a whitespace-only string", () => {
    expect(resolveTodoCategory("   ", HOUSEHOLD_CATEGORIES)).toBeUndefined();
  });

  it("resolves an exact match to the stored casing", () => {
    expect(resolveTodoCategory("Home", HOUSEHOLD_CATEGORIES)).toBe("Home");
  });

  it("resolves a differently-cased match to the household's canonical casing", () => {
    expect(resolveTodoCategory("home", HOUSEHOLD_CATEGORIES)).toBe("Home");
    expect(resolveTodoCategory("WORK", HOUSEHOLD_CATEGORIES)).toBe("Work");
    expect(resolveTodoCategory("eRRands", HOUSEHOLD_CATEGORIES)).toBe("Errands");
  });

  it("stores the trimmed input as-is when it matches nothing in the household list", () => {
    expect(resolveTodoCategory("Garden", HOUSEHOLD_CATEGORIES)).toBe("Garden");
  });

  it("stores the trimmed input as-is when the household list is absent", () => {
    expect(resolveTodoCategory("Garden", undefined)).toBe("Garden");
  });

  it("stores the trimmed input as-is when the household list is empty", () => {
    expect(resolveTodoCategory("Garden", [])).toBe("Garden");
  });

  it("trims surrounding whitespace before matching and storing", () => {
    expect(resolveTodoCategory("  home  ", HOUSEHOLD_CATEGORIES)).toBe("Home");
    expect(resolveTodoCategory("  Garden  ", HOUSEHOLD_CATEGORIES)).toBe("Garden");
  });

  it("does not mutate the input when it is exactly at the length cap", () => {
    const exact = "x".repeat(MAX_TODO_CATEGORY_LENGTH);
    expect(resolveTodoCategory(exact, undefined)).toBe(exact);
  });

  it("truncates input longer than the length cap before storing", () => {
    const long = "y".repeat(MAX_TODO_CATEGORY_LENGTH + 25);
    const result = resolveTodoCategory(long, undefined);
    expect(result).toHaveLength(MAX_TODO_CATEGORY_LENGTH);
    expect(result).toBe(long.slice(0, MAX_TODO_CATEGORY_LENGTH));
  });

  it("truncates before matching, so an over-length near-match still resolves to canonical casing", () => {
    const canonical = "A".repeat(MAX_TODO_CATEGORY_LENGTH);
    // Same first 50 chars (lowercased) plus extra tail that truncation drops
    // before the case-insensitive comparison runs.
    const overLongInput = "a".repeat(MAX_TODO_CATEGORY_LENGTH) + "-extra-tail";
    expect(resolveTodoCategory(overLongInput, [canonical])).toBe(canonical);
  });
});
