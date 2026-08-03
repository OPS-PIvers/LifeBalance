import { describe, it, expect } from "vitest";

import {
  RECONCILE_WINDOW_MS,
  normalizeMerchant,
  pickFillTarget,
  buildFillUpdates,
  pickDuplicateShortcutRow,
  buildDuplicateMergeUpdates,
  pickReverseDuplicateRow,
  buildReverseDuplicateMergeUpdates,
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

  it("tags the resolved account when the incoming event carries one", () => {
    const updates = buildFillUpdates({
      amount: 13.31,
      merchant: "Amatista",
      accountId: "cred-123",
    });
    expect(updates).toMatchObject({ accountId: "cred-123" });
  });

  it("omits accountId when the incoming event has none", () => {
    const updates = buildFillUpdates({ amount: 13.31, merchant: "Amatista" });
    expect(updates).not.toHaveProperty("accountId");
  });

  // CARD-1 (finding 1): cardLast4 must survive the stub-fill merge instead of
  // being dropped on the floor — this is the Apple Pay $0 stub -> bank-fill
  // production path, so losing it here silently breaks card attribution for a
  // large share of real transactions.
  it("CARD-1: carries the resolved cardLast4 through the stub fill", () => {
    const target = stub("s1", "Amatista");
    const updates = buildFillUpdates(
      { amount: 13.31, merchant: "Amatista", cardLast4: "8899" },
      target,
    );
    expect(updates).toMatchObject({ cardLast4: "8899" });
  });

  it("CARD-1: omits cardLast4 when the incoming event has none", () => {
    const target = stub("s1", "Amatista");
    const updates = buildFillUpdates({ amount: 13.31, merchant: "Amatista" }, target);
    expect(updates).not.toHaveProperty("cardLast4");
  });

  it("CARD-1: does NOT overwrite a cardLast4 the stub already carries (conservative merge)", () => {
    const target: ReconcileCandidate = {
      id: "s1",
      merchant: "Amatista",
      amount: 0,
      needsAmount: true,
      cardLast4: "1234",
    };
    const updates = buildFillUpdates(
      { amount: 13.31, merchant: "Amatista", cardLast4: "8899" },
      target,
    );
    expect(updates).not.toHaveProperty("cardLast4");
  });

  it("CARD-1: still sets cardLast4 when called without a target (backward-compatible signature)", () => {
    const updates = buildFillUpdates({ amount: 13.31, merchant: "Amatista", cardLast4: "8899" });
    expect(updates).toMatchObject({ cardLast4: "8899" });
  });

  it("CARD-1: does not change WHICH target is chosen — pickFillTarget's decision is unaffected by cardLast4", () => {
    const candidates = [stub("s1", "Gas Station"), stub("s2", "Coffee Shop")];
    const withoutCard = pickFillTarget({ amount: 40, merchant: "gas station" }, candidates);
    const withCard = pickFillTarget(
      { amount: 40, merchant: "gas station", cardLast4: "8899" },
      candidates,
    );
    expect(withCard?.id).toBe(withoutCard?.id);
    expect(withCard?.id).toBe("s1");
  });
});

describe("pickFillTarget — account awareness", () => {
  it("does not fill a stub tagged to a DIFFERENT account than the incoming card", () => {
    const debitStub: ReconcileCandidate = {
      id: "s1",
      merchant: "Coffee",
      amount: 0,
      needsAmount: true,
      accountId: "checking",
    };
    const target = pickFillTarget(
      { amount: 5, merchant: "Coffee", accountId: "credit" },
      [debitStub],
    );
    expect(target).toBeNull();
  });

  it("fills a same-account stub", () => {
    const stub: ReconcileCandidate = {
      id: "s1",
      merchant: "Coffee",
      amount: 0,
      needsAmount: true,
      accountId: "credit",
    };
    const target = pickFillTarget(
      { amount: 5, merchant: "Coffee", accountId: "credit" },
      [stub],
    );
    expect(target?.id).toBe("s1");
  });

  it("still fills an untagged stub (typical Apple Pay case) — backward compatible", () => {
    const untagged: ReconcileCandidate = {
      id: "s1",
      merchant: "Loews",
      amount: 0,
      needsAmount: true,
    };
    const target = pickFillTarget(
      { amount: 13.31, merchant: "Amatista", accountId: "credit" },
      [untagged],
    );
    expect(target?.id).toBe("s1");
  });
});

describe("RECONCILE_WINDOW_MS", () => {
  it("is a tight, positive window (30 minutes)", () => {
    expect(RECONCILE_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// pickDuplicateShortcutRow — cross-source dedup of two REAL-amount captures
// ---------------------------------------------------------------------------

/** A real-amount Apple Pay capture (the "Transaction" automation, untagged). */
function applePay(
  id: string,
  merchant: string,
  amount: number,
  extra: Partial<ReconcileCandidate> = {},
): ReconcileCandidate {
  return { id, merchant, amount, needsAmount: false, ...extra };
}

/** A row that itself came from a bank notification. Never a merge TARGET for the
 *  forward path (pickDuplicateShortcutRow), but IS the merge target for the
 *  reverse path (pickReverseDuplicateRow). */
function bankRow(
  id: string,
  merchant: string,
  amount: number,
  extra: Partial<ReconcileCandidate> = {},
): ReconcileCandidate {
  return { id, merchant, amount, needsAmount: false, fromBankNotification: true, ...extra };
}

describe("pickDuplicateShortcutRow", () => {
  it("REGRESSION: folds a bank notification into the untagged real-amount Apple Pay row for the same purchase", () => {
    // The reported bug: Apple Pay captured "Target" $18.86 at full amount (not a
    // $0 stub); the bank push reports "TARGET T-2189" $18.86. Both untagged, so
    // the shared identity check only ranks them 'possible' and two rows survive.
    const candidates = [applePay("ap1", "Target", 18.86)];
    const target = pickDuplicateShortcutRow(
      { amount: 18.86, merchant: "TARGET T-2189" },
      candidates,
    );
    expect(target?.id).toBe("ap1");
  });

  it("returns null when there are no candidates", () => {
    expect(pickDuplicateShortcutRow({ amount: 5, merchant: "Coffee" }, [])).toBeNull();
  });

  it("does NOT fold into a $0 stub (that is pickFillTarget's job)", () => {
    const candidates = [stub("s1", "Target")];
    expect(
      pickDuplicateShortcutRow({ amount: 18.86, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("does NOT fold when the amount differs by even a cent", () => {
    const candidates = [applePay("ap1", "Target", 18.86)];
    expect(
      pickDuplicateShortcutRow({ amount: 18.87, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("does NOT fold when the merchant is dissimilar", () => {
    const candidates = [applePay("ap1", "Whole Foods", 18.86)];
    expect(
      pickDuplicateShortcutRow({ amount: 18.86, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("SAFETY: does NOT fold into another bank-notification row (two bank-only identical purchases stay separate)", () => {
    const candidates = [bankRow("bn1", "Starbucks", 5)];
    expect(
      pickDuplicateShortcutRow({ amount: 5, merchant: "Starbucks" }, candidates),
    ).toBeNull();
  });

  it("SAFETY: does NOT fold when two matching Apple Pay rows exist (ambiguous → keep both)", () => {
    // Two genuinely-separate identical $5 coffees, each captured by Apple Pay.
    const candidates = [
      applePay("ap1", "Starbucks", 5),
      applePay("ap2", "Starbucks", 5),
    ];
    expect(
      pickDuplicateShortcutRow({ amount: 5, merchant: "Starbucks" }, candidates),
    ).toBeNull();
  });

  it("does NOT fold into a row tagged to a DIFFERENT account than the incoming card", () => {
    const candidates = [applePay("ap1", "Target", 18.86, { accountId: "checking" })];
    expect(
      pickDuplicateShortcutRow(
        { amount: 18.86, merchant: "Target", accountId: "credit" },
        candidates,
      ),
    ).toBeNull();
  });

  it("folds into a same-account row", () => {
    const candidates = [applePay("ap1", "Target", 18.86, { accountId: "credit" })];
    const target = pickDuplicateShortcutRow(
      { amount: 18.86, merchant: "Target", accountId: "credit" },
      candidates,
    );
    expect(target?.id).toBe("ap1");
  });

  it("folds into the single eligible row while ignoring stubs and bank rows around it", () => {
    const candidates = [
      stub("s1", "Target"),
      bankRow("bn1", "Target", 18.86),
      applePay("ap1", "Target", 18.86),
    ];
    const target = pickDuplicateShortcutRow(
      { amount: 18.86, merchant: "TARGET T-2189" },
      candidates,
    );
    expect(target?.id).toBe("ap1");
  });

  it("CARD-1: does not change WHICH target is chosen — the merge decision is unaffected by cardLast4", () => {
    const candidates = [applePay("ap1", "Target", 18.86)];
    const withoutCard = pickDuplicateShortcutRow(
      { amount: 18.86, merchant: "TARGET T-2189" },
      candidates,
    );
    const withCard = pickDuplicateShortcutRow(
      { amount: 18.86, merchant: "TARGET T-2189", cardLast4: "8899" },
      candidates,
    );
    expect(withCard?.id).toBe(withoutCard?.id);
    expect(withCard?.id).toBe("ap1");
  });
});

describe("buildDuplicateMergeUpdates", () => {
  it("back-fills the resolved account onto an untagged Apple Pay row", () => {
    const target = applePay("ap1", "Target", 18.86);
    const updates = buildDuplicateMergeUpdates(
      { amount: 18.86, merchant: "TARGET T-2189", accountId: "credit" },
      target,
    );
    expect(updates).toEqual({ accountId: "credit" });
  });

  it("does NOT overwrite amount or merchant (the Apple Pay row's are kept)", () => {
    const target = applePay("ap1", "Target", 18.86);
    const updates = buildDuplicateMergeUpdates(
      { amount: 18.86, merchant: "TARGET T-2189", accountId: "credit" },
      target,
    );
    expect(updates).not.toHaveProperty("amount");
    expect(updates).not.toHaveProperty("merchant");
  });

  it("is an empty patch when there is nothing to enrich (already tagged / no incoming account)", () => {
    expect(
      buildDuplicateMergeUpdates({ amount: 18.86, merchant: "Target" }, applePay("ap1", "Target", 18.86)),
    ).toEqual({});
    expect(
      buildDuplicateMergeUpdates(
        { amount: 18.86, merchant: "Target", accountId: "credit" },
        applePay("ap1", "Target", 18.86, { accountId: "credit" }),
      ),
    ).toEqual({});
  });

  // CARD-1 (finding 1): cardLast4 must survive this merge path too.
  it("CARD-1: back-fills cardLast4 onto an untagged Apple Pay row", () => {
    const target = applePay("ap1", "Target", 18.86);
    const updates = buildDuplicateMergeUpdates(
      { amount: 18.86, merchant: "TARGET T-2189", cardLast4: "8899" },
      target,
    );
    expect(updates).toMatchObject({ cardLast4: "8899" });
  });

  it("CARD-1: does NOT overwrite a cardLast4 the target already carries (conservative merge)", () => {
    const target = applePay("ap1", "Target", 18.86, { cardLast4: "1234" });
    const updates = buildDuplicateMergeUpdates(
      { amount: 18.86, merchant: "TARGET T-2189", cardLast4: "8899" },
      target,
    );
    expect(updates).not.toHaveProperty("cardLast4");
  });
});

// ---------------------------------------------------------------------------
// pickReverseDuplicateRow — REVERSE capture ordering (bank push arrived FIRST)
// ---------------------------------------------------------------------------

describe("pickReverseDuplicateRow", () => {
  it("REVERSE REGRESSION: folds an incoming Apple Pay capture into the earlier bank-notification row for the same purchase", () => {
    // The reverse of the reported bug: the bank push landed FIRST as
    // "TARGET T-2189" $18.86 (fromBankNotification), then the Apple Pay
    // "Transaction" automation reports "Target" $18.86 moments later. Both
    // untagged → the identity check only ranks them 'possible', so two rows
    // would survive. This collapses them into the earlier bank row.
    const candidates = [bankRow("bn1", "TARGET T-2189", 18.86)];
    const target = pickReverseDuplicateRow(
      { amount: 18.86, merchant: "Target" },
      candidates,
    );
    expect(target?.id).toBe("bn1");
  });

  it("SAFETY: returns null when there are no candidates (e.g. every bank row fell outside the ~30-min window)", () => {
    expect(pickReverseDuplicateRow({ amount: 5, merchant: "Coffee" }, [])).toBeNull();
  });

  it("does NOT fold into a $0 stub (that is pickFillTarget's job)", () => {
    const candidates = [stub("s1", "Target")];
    expect(
      pickReverseDuplicateRow({ amount: 18.86, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("does NOT fold into a NON-bank (Apple Pay) row — the merge must be cross-source", () => {
    // Two Apple Pay captures of the same purchase are handled by identity dedup
    // (isLikelyDuplicate), not by either reconcile picker; the reverse path only
    // ever targets a bank row.
    const candidates = [applePay("ap1", "Target", 18.86)];
    expect(
      pickReverseDuplicateRow({ amount: 18.86, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("SAFETY: does NOT fold when the amount differs by even a cent (two separate purchases)", () => {
    const candidates = [bankRow("bn1", "Target", 18.86)];
    expect(
      pickReverseDuplicateRow({ amount: 18.87, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("SAFETY: does NOT fold when the merchant is dissimilar (two separate purchases, same amount)", () => {
    const candidates = [bankRow("bn1", "Whole Foods", 18.86)];
    expect(
      pickReverseDuplicateRow({ amount: 18.86, merchant: "Target" }, candidates),
    ).toBeNull();
  });

  it("SAFETY: does NOT fold when two matching bank rows exist (ambiguous → keep both)", () => {
    // Two genuinely-separate identical $5 coffees, each captured via the bank
    // shortcut → two candidates → under-merge rather than guess which one.
    const candidates = [
      bankRow("bn1", "Starbucks", 5),
      bankRow("bn2", "Starbucks", 5),
    ];
    expect(
      pickReverseDuplicateRow({ amount: 5, merchant: "Starbucks" }, candidates),
    ).toBeNull();
  });

  it("SAFETY: does NOT fold into a bank row tagged to a DIFFERENT account than the incoming card", () => {
    const candidates = [bankRow("bn1", "Target", 18.86, { accountId: "checking" })];
    expect(
      pickReverseDuplicateRow(
        { amount: 18.86, merchant: "Target", accountId: "credit" },
        candidates,
      ),
    ).toBeNull();
  });

  it("folds into a same-account bank row", () => {
    const candidates = [bankRow("bn1", "Target", 18.86, { accountId: "credit" })];
    const target = pickReverseDuplicateRow(
      { amount: 18.86, merchant: "Target", accountId: "credit" },
      candidates,
    );
    expect(target?.id).toBe("bn1");
  });

  it("folds into the single eligible bank row while ignoring stubs and Apple Pay rows around it", () => {
    const candidates = [
      stub("s1", "Target"),
      applePay("ap1", "Target", 18.86),
      bankRow("bn1", "TARGET T-2189", 18.86),
    ];
    const target = pickReverseDuplicateRow(
      { amount: 18.86, merchant: "Target" },
      candidates,
    );
    expect(target?.id).toBe("bn1");
  });
});

describe("buildReverseDuplicateMergeUpdates", () => {
  it("rewrites the surviving bank row into the Apple Pay capture: cleaner merchant + clears the bank flag", () => {
    const target = bankRow("bn1", "TARGET T-2189", 18.86);
    const updates = buildReverseDuplicateMergeUpdates(
      { amount: 18.86, merchant: "Target" },
      target,
    );
    expect(updates).toMatchObject({ merchant: "Target", fromBankNotification: false });
  });

  it("does NOT overwrite the amount (the exact-cent match is already guaranteed)", () => {
    const target = bankRow("bn1", "TARGET T-2189", 18.86);
    const updates = buildReverseDuplicateMergeUpdates(
      { amount: 18.86, merchant: "Target" },
      target,
    );
    expect(updates).not.toHaveProperty("amount");
  });

  it("back-fills the resolved account only when the bank row was captured untagged", () => {
    const untagged = bankRow("bn1", "TARGET T-2189", 18.86);
    expect(
      buildReverseDuplicateMergeUpdates(
        { amount: 18.86, merchant: "Target", accountId: "credit" },
        untagged,
      ),
    ).toMatchObject({ accountId: "credit" });

    // A bank-resolved account (from the card last-4) is more reliable than an
    // untagged Apple Pay capture, so it is never clobbered.
    const tagged = bankRow("bn1", "TARGET T-2189", 18.86, { accountId: "checking" });
    expect(
      buildReverseDuplicateMergeUpdates(
        { amount: 18.86, merchant: "Target", accountId: "credit" },
        tagged,
      ),
    ).not.toHaveProperty("accountId");
  });

  it("overwrites category only when a non-default one is supplied", () => {
    const target = bankRow("bn1", "TARGET T-2189", 18.86);
    expect(
      buildReverseDuplicateMergeUpdates(
        { amount: 18.86, merchant: "Target", category: "Shopping" },
        target,
      ),
    ).toMatchObject({ category: "Shopping" });

    expect(
      buildReverseDuplicateMergeUpdates(
        { amount: 18.86, merchant: "Target", category: "Uncategorized" },
        target,
      ),
    ).not.toHaveProperty("category");
  });

  it("never sets status (the merged row stays pending_review for review)", () => {
    const target = bankRow("bn1", "TARGET T-2189", 18.86);
    const updates = buildReverseDuplicateMergeUpdates(
      { amount: 18.86, merchant: "Target" },
      target,
    );
    expect(updates).not.toHaveProperty("status");
  });

  // CARD-1 (finding 1): cardLast4 must survive this merge path too.
  it("CARD-1: back-fills cardLast4 when the surviving bank row was captured untagged", () => {
    const target = bankRow("bn1", "TARGET T-2189", 18.86);
    const updates = buildReverseDuplicateMergeUpdates(
      { amount: 18.86, merchant: "Target", cardLast4: "8899" },
      target,
    );
    expect(updates).toMatchObject({ cardLast4: "8899" });
  });

  it("CARD-1: does NOT overwrite a cardLast4 the bank row already carries (conservative merge)", () => {
    const target = bankRow("bn1", "TARGET T-2189", 18.86, { cardLast4: "1234" });
    const updates = buildReverseDuplicateMergeUpdates(
      { amount: 18.86, merchant: "Target", cardLast4: "8899" },
      target,
    );
    expect(updates).not.toHaveProperty("cardLast4");
  });
});
