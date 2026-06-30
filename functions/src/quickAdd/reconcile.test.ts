import { describe, it, expect } from "vitest";

import {
  RECONCILE_WINDOW_MS,
  normalizeMerchant,
  pickFillTarget,
  buildFillUpdates,
  type ReconcileCandidate,
} from "./reconcile";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An Apple Pay $0 awaiting-amount stub. */
function stub(id: string, merchant: string): ReconcileCandidate {
  return { id, merchant, amount: 0, needsAmount: true };
}

/** A normal real-amount pending row (NOT a stub). */
function real(id: string, merchant: string, amount: number): ReconcileCandidate {
  return { id, merchant, amount, needsAmount: false };
}

describe("normalizeMerchant", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeMerchant("Trader Joe's #423")).toBe("trader joe s 423");
    expect(normalizeMerchant("  AMATISTA   Cookhouse  ")).toBe("amatista cookhouse");
  });

  it("returns empty string for punctuation-only / blank input", () => {
    expect(normalizeMerchant("   ")).toBe("");
    expect(normalizeMerchant("!!!")).toBe("");
  });

  it("treats differently-formatted versions of the same name as equal", () => {
    expect(normalizeMerchant("Costco Wholesale")).toBe(
      normalizeMerchant("costco   wholesale"),
    );
  });
});

describe("pickFillTarget", () => {
  it("returns null when there are no candidates at all", () => {
    expect(pickFillTarget({ amount: 13.31, merchant: "Amatista" }, [])).toBeNull();
  });

  it("returns null when there are no stubs (only real rows)", () => {
    const candidates = [real("r1", "Coffee", 5), real("r2", "Gas", 40)];
    expect(pickFillTarget({ amount: 5, merchant: "Coffee" }, candidates)).toBeNull();
  });

  it("fills the single merchant-matching stub even when other stubs exist", () => {
    const candidates = [
      stub("s1", "Gas Station"),
      stub("s2", "Coffee Shop"),
    ];
    const target = pickFillTarget({ amount: 40, merchant: "gas station" }, candidates);
    expect(target?.id).toBe("s1");
  });

  it("does NOT merge when two stubs share the incoming merchant (ambiguous)", () => {
    const candidates = [stub("s1", "Coffee"), stub("s2", "Coffee")];
    expect(pickFillTarget({ amount: 5, merchant: "Coffee" }, candidates)).toBeNull();
  });

  it("cross-system: fills the lone stub when the merchant does NOT match (time-only)", () => {
    // The real-world case from the screenshot: Apple Pay said "Loews Sapphire
    // Falls Fb", the bank says "Amatista Cookhouse" — different strings, one stub.
    const candidates = [stub("s1", "Loews Sapphire Falls Fb")];
    const target = pickFillTarget(
      { amount: 13.31, merchant: "Amatista Cookhouse" },
      candidates,
    );
    expect(target?.id).toBe("s1");
  });

  it("does NOT merge cross-system when two unfilled stubs exist (under-merge)", () => {
    const candidates = [
      stub("s1", "Loews Sapphire Falls Fb"),
      stub("s2", "Some Other Hold"),
    ];
    expect(
      pickFillTarget({ amount: 13.31, merchant: "Amatista Cookhouse" }, candidates),
    ).toBeNull();
  });

  it("ignores real rows when counting stubs for the time-only fallback", () => {
    // One stub + several real rows → still 'exactly one stub' → fill it.
    const candidates = [
      real("r1", "Whatever", 9),
      stub("s1", "Loews Sapphire Falls Fb"),
      real("r2", "Another", 20),
    ];
    const target = pickFillTarget(
      { amount: 13.31, merchant: "Amatista Cookhouse" },
      candidates,
    );
    expect(target?.id).toBe("s1");
  });

  it("prefers the merchant match over the time-only fallback", () => {
    // Two stubs, one matches by merchant → strong match wins, not ambiguous.
    const candidates = [stub("s1", "Amatista Cookhouse"), stub("s2", "Gas")];
    const target = pickFillTarget(
      { amount: 13.31, merchant: "Amatista Cookhouse" },
      candidates,
    );
    expect(target?.id).toBe("s1");
  });

  it("falls back to time-only when the incoming merchant is blank/punctuation", () => {
    const candidates = [stub("s1", "Loews")];
    const target = pickFillTarget({ amount: 13.31, merchant: "   " }, candidates);
    expect(target?.id).toBe("s1");
  });
});

describe("buildFillUpdates", () => {
  it("sets the real amount, swaps in the bank merchant, and clears the stub flag", () => {
    const updates = buildFillUpdates({ amount: 13.31, merchant: "Amatista Cookhouse" });
    expect(updates).toEqual({
      amount: 13.31,
      merchant: "Amatista Cookhouse",
      needsAmount: false,
    });
  });

  it("overwrites category only when a non-default one is supplied", () => {
    expect(
      buildFillUpdates({ amount: 13.31, merchant: "Amatista", category: "Dining" }),
    ).toMatchObject({ category: "Dining" });

    const withDefault = buildFillUpdates({
      amount: 13.31,
      merchant: "Amatista",
      category: "Uncategorized",
    });
    expect(withDefault).not.toHaveProperty("category");
  });

  it("never sets status (the filled row stays pending_review for review)", () => {
    const updates = buildFillUpdates({ amount: 13.31, merchant: "Amatista" });
    expect(updates).not.toHaveProperty("status");
  });
});

describe("RECONCILE_WINDOW_MS", () => {
  it("is a tight, positive window (30 minutes)", () => {
    expect(RECONCILE_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});
