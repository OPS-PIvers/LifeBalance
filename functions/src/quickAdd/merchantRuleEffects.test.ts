import { describe, expect, it } from "vitest";
import {
  describeRuleEffects,
  emptyRuleEffectCounts,
  readMerchantRules,
  ruleCreateCategory,
} from "./merchantRuleEffects";
import type { MerchantRule } from "./merchantRules";
import { pickMerchantRule } from "./merchantRules";

const UNCATEGORIZED = "Uncategorized";

describe("readMerchantRules", () => {
  it("returns nothing for a household with no rules field", () => {
    expect(readMerchantRules(undefined)).toEqual([]);
    expect(readMerchantRules(null)).toEqual([]);
    expect(readMerchantRules("not an array")).toEqual([]);
    expect(readMerchantRules({})).toEqual([]);
  });

  it("reads a well-formed rule whole", () => {
    expect(
      readMerchantRules([
        {
          id: "r1",
          pattern: "APPLE.COM/BILL",
          amount: 2.99,
          name: "Apple",
          category: "Subscriptions",
          billId: "bill-1",
          exempt: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ])
    ).toEqual([
      {
        id: "r1",
        pattern: "APPLE.COM/BILL",
        amount: 2.99,
        name: "Apple",
        category: "Subscriptions",
        billId: "bill-1",
        exempt: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  // The three required fields are exactly what the matcher's determinism rests
  // on: the pattern itself, and createdAt as the tie-breaker.
  it("drops a row missing id, pattern or createdAt", () => {
    expect(
      readMerchantRules([
        { pattern: "A", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "b", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "c", pattern: "C" },
        { id: 7, pattern: "D", createdAt: "2026-01-01T00:00:00.000Z" },
        null,
        "nope",
      ])
    ).toEqual([]);
  });

  // A half-written rule should degrade to a weaker rule, never apply a category
  // that isn't a string or throw at 3am.
  it("drops ill-typed optional fields but keeps the rule", () => {
    expect(
      readMerchantRules([
        {
          id: "r1",
          pattern: "P",
          createdAt: "2026-01-01T00:00:00.000Z",
          amount: "2.99",
          category: 12,
          billId: { id: "x" },
          name: null,
          exempt: "yes",
        },
      ])
    ).toEqual([{ id: "r1", pattern: "P", createdAt: "2026-01-01T00:00:00.000Z" }]);
  });

  it("drops a non-finite amount rather than matching on NaN", () => {
    const [rule] = readMerchantRules([
      { id: "r1", pattern: "P", createdAt: "2026-01-01T00:00:00.000Z", amount: Number.NaN },
    ]);
    expect(rule?.amount).toBeUndefined();
  });

  // `0` is the Apple Pay pre-auth stub amount — a real qualifier, not a falsy one.
  it("keeps an amount of 0", () => {
    const [rule] = readMerchantRules([
      { id: "r1", pattern: "SQ *COFFEE", createdAt: "2026-01-01T00:00:00.000Z", amount: 0 },
    ]);
    expect(rule?.amount).toBe(0);
    expect(pickMerchantRule("SQ *COFFEE HOUSE", 0, [rule!])?.id).toBe("r1");
  });

  it("only `exempt: true` survives, so nothing truthy-but-not-true exempts", () => {
    const rules = readMerchantRules([
      { id: "a", pattern: "A", createdAt: "2026-01-01T00:00:00.000Z", exempt: false },
      { id: "b", pattern: "B", createdAt: "2026-01-01T00:00:00.000Z", exempt: 1 },
      { id: "c", pattern: "C", createdAt: "2026-01-01T00:00:00.000Z", exempt: true },
    ]);
    expect(rules.map((r) => r.exempt)).toEqual([undefined, undefined, true]);
  });

  it("keeps the good rules from a partly-corrupt array", () => {
    const rules = readMerchantRules([
      { id: "ok", pattern: "APPLE", createdAt: "2026-01-01T00:00:00.000Z" },
      { junk: true },
      { id: "ok2", pattern: "COSTCO", createdAt: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(rules.map((r) => r.id)).toEqual(["ok", "ok2"]);
  });
});

describe("ruleCreateCategory", () => {
  const rule = (over: Partial<MerchantRule> = {}): MerchantRule => ({
    id: "r1",
    pattern: "NETFLIX",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  // The pre-rules behaviour, byte for byte.
  it("leaves an unmatched row uncategorized and flagged for review", () => {
    expect(ruleCreateCategory(null, UNCATEGORIZED)).toEqual({
      category: UNCATEGORIZED,
      autoCategorized: false,
      needsCategory: true,
    });
    expect(ruleCreateCategory(undefined, UNCATEGORIZED)).toEqual({
      category: UNCATEGORIZED,
      autoCategorized: false,
      needsCategory: true,
    });
  });

  it("leaves a rename- or bill-only rule's row exactly as before", () => {
    expect(ruleCreateCategory(rule({ name: "Netflix", billId: "b1" }), UNCATEGORIZED)).toEqual({
      category: UNCATEGORIZED,
      autoCategorized: false,
      needsCategory: true,
    });
  });

  // The household already answered "where does this merchant belong?", so the
  // row must NOT come back asking again.
  it("files a rule-categorized row and drops needsCategory", () => {
    const got = ruleCreateCategory(rule({ category: "Entertainment" }), UNCATEGORIZED);
    expect(got).toEqual({ category: "Entertainment", autoCategorized: true });
    expect("needsCategory" in got).toBe(false);
  });

  it("treats a blank category as no category rather than filing under ''", () => {
    expect(ruleCreateCategory(rule({ category: "   " }), UNCATEGORIZED)).toEqual({
      category: UNCATEGORIZED,
      autoCategorized: false,
      needsCategory: true,
    });
  });

  it("trims a padded category", () => {
    expect(ruleCreateCategory(rule({ category: " Groceries " }), UNCATEGORIZED).category).toBe(
      "Groceries"
    );
  });

  // A rule may classify a charge; it may never rewrite one. Nothing this helper
  // returns can reach a stored `merchant` field.
  it("never returns a merchant, even for a renaming rule", () => {
    const got = ruleCreateCategory(rule({ name: "Netflix", category: "Fun" }), UNCATEGORIZED);
    expect(Object.keys(got).sort()).toEqual(["autoCategorized", "category"]);
    expect(JSON.stringify(got)).not.toContain("Netflix");
  });
});

describe("describeRuleEffects", () => {
  it("says nothing when the rules did nothing", () => {
    expect(describeRuleEffects(emptyRuleEffectCounts())).toBe("");
  });

  it("reports each effect it has, and only those", () => {
    expect(describeRuleEffects({ ruleCategorized: 2, ruleExempted: 0, ruleBilled: 0 })).toBe(
      "Rules: 2 categorized. "
    );
    expect(describeRuleEffects({ ruleCategorized: 0, ruleExempted: 1, ruleBilled: 0 })).toBe(
      "Rules: 1 exempted. "
    );
    expect(describeRuleEffects({ ruleCategorized: 0, ruleExempted: 0, ruleBilled: 3 })).toBe(
      "Rules: 3 to bills. "
    );
    expect(describeRuleEffects({ ruleCategorized: 2, ruleExempted: 1, ruleBilled: 3 })).toBe(
      "Rules: 2 categorized, 1 exempted, 3 to bills. "
    );
  });

  // It is concatenated straight onto the balance line, so the trailing space is
  // part of the contract (same shape as describeNoSpendFires).
  it("ends in a space so the caller can concatenate blindly", () => {
    const fragment = describeRuleEffects({ ruleCategorized: 1, ruleExempted: 0, ruleBilled: 0 });
    expect(`${fragment}Balance: $12.00`).toBe("Rules: 1 categorized. Balance: $12.00");
  });

  // Push bodies get truncated by iOS; a worst-case fragment must stay short.
  it("stays short even with every effect and large counts", () => {
    expect(
      describeRuleEffects({ ruleCategorized: 150, ruleExempted: 150, ruleBilled: 150 }).length
    ).toBeLessThan(60);
  });
});
