import { describe, it, expect } from "vitest";

import {
  fingerprint,
  merchantSimilar,
  identityNames,
  namesSimilar,
  isLikelyDuplicate,
  DUPLICATE_WINDOW_DAYS,
  INCOME_CATEGORY,
  type IdentityTransaction,
} from "./transactionIdentity";

// Minimal factory — only fields the identity module reads, with sensible
// defaults overridable per-test.
const txn = (over: Partial<IdentityTransaction> = {}): IdentityTransaction => ({
  amount: 42.5,
  merchant: "Amatista Cookhouse",
  date: "2026-06-27",
  category: "Dining",
  status: "pending_review",
  ...over,
});

describe("merchantSimilar", () => {
  it("matches identical normalized names", () => {
    expect(merchantSimilar("Amatista Cookhouse", "amatista   cookhouse")).toBe(true);
  });

  it("matches when one name is a token subset of the other", () => {
    expect(merchantSimilar("Amatista", "Amatista Cookhouse")).toBe(true);
  });

  it("does not match unrelated names", () => {
    expect(merchantSimilar("Loews Sapphire Falls Fb", "Amatista Cookhouse")).toBe(false);
  });

  it("does not match when either side is blank/punctuation-only", () => {
    expect(merchantSimilar("", "Amatista")).toBe(false);
    expect(merchantSimilar("!!!", "Amatista")).toBe(false);
    expect(merchantSimilar("", "")).toBe(false);
  });

  it("does not match on single-character tokens (no false positives from stray letters)", () => {
    expect(merchantSimilar("s", "Trader Joe's")).toBe(false);
    expect(merchantSimilar("Trader Joe's", "s")).toBe(false);
    // Exact equality of short names still works via the equality path.
    expect(merchantSimilar("H&M", "h&m")).toBe(true);
  });
});

describe("identityNames", () => {
  it("returns both names when both are present", () => {
    expect(identityNames({ merchant: "Jimmy Johns", bankDescriptor: "PURCHASE JIMMY JOHNS MPLS MN CARD7752" }))
      .toEqual(["Jimmy Johns", "PURCHASE JIMMY JOHNS MPLS MN CARD7752"]);
  });

  it("drops empty/whitespace-only values", () => {
    expect(identityNames({ merchant: "Jimmy Johns", bankDescriptor: "   " })).toEqual(["Jimmy Johns"]);
    expect(identityNames({ merchant: "", bankDescriptor: undefined })).toEqual([]);
  });

  it("de-duplicates exact repeats", () => {
    expect(identityNames({ merchant: "Jimmy Johns", bankDescriptor: "Jimmy Johns" })).toEqual(["Jimmy Johns"]);
  });

  it("returns just the merchant when there is no bankDescriptor", () => {
    expect(identityNames({ merchant: "Amatista Cookhouse" })).toEqual(["Amatista Cookhouse"]);
  });
});

describe("namesSimilar", () => {
  it("matches via the CLEANED display merchant (crux example: cleaned name is a subset of the other side)", () => {
    // Screenshot row: "PURCHASE JIMMY JOHNS MINNEAPOLIS MN CARD7752" is cleaned
    // to "Jimmy Johns" for display. The nightly email's own raw descriptor
    // ("JIMMY JOHNS # 123 MINNEAPOLIS MN") is a superset of the cleaned name's
    // tokens, so the cleaned name alone recognises it.
    const scanned = { merchant: "Jimmy Johns", bankDescriptor: "PURCHASE JIMMY JOHNS MINNEAPOLIS MN CARD7752" };
    const email = { merchant: "JIMMY JOHNS # 123 MINNEAPOLIS MN" };
    expect(namesSimilar(scanned, email)).toBe(true);
    expect(namesSimilar(email, scanned)).toBe(true);
  });

  it("matches via the RAW bankDescriptor when the cleaned name invents tokens the raw text lacks (Amazon example)", () => {
    // "AMZN Mktp US*2H4KL" is cleaned to "Amazon" for display — a token
    // ("amazon") that appears NOWHERE in the raw bank text, so comparing only
    // the cleaned merchant against another system's raw descriptor misses.
    const scanned = { merchant: "Amazon", bankDescriptor: "AMZN Mktp US*2H4KL" };
    const other = { merchant: "AMZN MKTP US*2H4KL AMZN.COM/BILL WA" };
    // The cleaned name alone would NOT match (different tokens entirely).
    expect(merchantSimilar(scanned.merchant, other.merchant)).toBe(false);
    // But the raw descriptor pairing recognises it.
    expect(namesSimilar(scanned, other)).toBe(true);
    expect(namesSimilar(other, scanned)).toBe(true);
  });

  it("behaves exactly like merchantSimilar(merchant, merchant) when neither side has a bankDescriptor", () => {
    const cases: [string, string][] = [
      ["Amatista Cookhouse", "amatista   cookhouse"],
      ["Amatista", "Amatista Cookhouse"],
      ["Loews Sapphire Falls Fb", "Amatista Cookhouse"],
      ["", "Amatista"],
      ["!!!", "Amatista"],
      ["", ""],
    ];
    for (const [a, b] of cases) {
      expect(namesSimilar({ merchant: a }, { merchant: b })).toBe(merchantSimilar(a, b));
    }
  });

  it("returns false when either side has no usable name at all", () => {
    expect(namesSimilar({ merchant: "" }, { merchant: "Amatista", bankDescriptor: "AMATISTA #4" })).toBe(false);
    expect(namesSimilar({ merchant: "Amatista" }, { merchant: "   ", bankDescriptor: "   " })).toBe(false);
  });

  it("ignores an empty/whitespace-only bankDescriptor rather than treating it as a usable name", () => {
    const a = { merchant: "Jimmy Johns", bankDescriptor: "   " };
    const b = { merchant: "Jimmy Johns" };
    expect(namesSimilar(a, b)).toBe(true); // still matches via merchant
  });
});

describe("fingerprint", () => {
  it("combines account, amount-cents, and date", () => {
    expect(fingerprint(txn({ accountId: "acc1", amount: 12.34, date: "2026-06-27" }))).toBe(
      "acc1|1234|2026-06-27",
    );
  });

  it("uses 'none' for an unknown account", () => {
    expect(fingerprint(txn({ accountId: undefined, amount: 12.34, date: "2026-06-27" }))).toBe(
      "none|1234|2026-06-27",
    );
  });

  it("takes the absolute value of amount (sign-agnostic)", () => {
    expect(fingerprint(txn({ amount: -12.34 }))).toBe(fingerprint(txn({ amount: 12.34 })));
  });
});

describe("isLikelyDuplicate — table-driven policy matrix", () => {
  type Case = {
    name: string;
    a: Partial<IdentityTransaction>;
    b: Partial<IdentityTransaction>;
    expected: ReturnType<typeof isLikelyDuplicate>;
  };

  const cases: Case[] = [
    {
      name: "Plaid-then-email: same account/amount/date, similar merchant → duplicate",
      a: { accountId: "checking", amount: 13.31, date: "2026-06-27", merchant: "Amatista Cookhouse" },
      b: { accountId: "checking", amount: 13.31, date: "2026-06-28", merchant: "AMATISTA COOKHOUSE #4" },
      expected: "duplicate",
    },
    {
      name: "email-then-Plaid: same pair reversed order → duplicate (symmetric)",
      a: { accountId: "checking", amount: 13.31, date: "2026-06-28", merchant: "AMATISTA COOKHOUSE #4" },
      b: { accountId: "checking", amount: 13.31, date: "2026-06-27", merchant: "Amatista Cookhouse" },
      expected: "duplicate",
    },
    {
      name: "receipt-then-Plaid: same account/amount/date, merchant subset match → duplicate",
      a: { accountId: "checking", amount: 54.12, date: "2026-06-10", merchant: "Target" },
      b: { accountId: "checking", amount: 54.12, date: "2026-06-11", merchant: "Target Store T-1234" },
      expected: "duplicate",
    },
    {
      name: "$0-stub-then-Plaid: stub amount is a wildcard, merchant similar, same account → duplicate",
      a: { accountId: "credit", amount: 0, needsAmount: true, date: "2026-06-15", merchant: "Loews Sapphire Falls Fb" },
      b: { accountId: "credit", amount: 87.2, date: "2026-06-15", merchant: "Loews Sapphire Falls" },
      expected: "duplicate",
    },
    {
      name: "$0-stub-then-Plaid: stub with dissimilar merchant (cross-system descriptors) → possible, not duplicate",
      a: { accountId: "credit", amount: 0, needsAmount: true, date: "2026-06-15", merchant: "Loews Sapphire Falls Fb" },
      b: { accountId: "credit", amount: 13.31, date: "2026-06-15", merchant: "Amatista Cookhouse" },
      expected: "possible",
    },
    {
      name: "same-amount-different-merchant same day → possible (not duplicate)",
      a: { accountId: "checking", amount: 20, date: "2026-06-27", merchant: "Shell Gas" },
      b: { accountId: "checking", amount: 20, date: "2026-06-27", merchant: "Chipotle" },
      expected: "possible",
    },
    {
      name: "same amount+merchant+window but account unknown on one side → possible",
      a: { accountId: "checking", amount: 9.99, date: "2026-06-01", merchant: "Netflix" },
      b: { accountId: undefined, amount: 9.99, date: "2026-06-02", merchant: "Netflix" },
      expected: "possible",
    },
    {
      name: "recurring identical subscription charges outside the window → distinct",
      // Two genuinely separate $9.99 Netflix charges a month apart: the date
      // window (±3 days) correctly rules this out as the SAME purchase. This
      // is the documented hard case from the plan — amount+merchant alone can
      // never safely distinguish "same charge, delayed" from "next month's
      // charge", so the date window is the deciding factor and callers must
      // not widen it to "catch" recurring merchants.
      a: { accountId: "checking", amount: 9.99, date: "2026-06-01", merchant: "Netflix" },
      b: { accountId: "checking", amount: 9.99, date: "2026-07-01", merchant: "Netflix" },
      expected: "distinct",
    },
    {
      name: "recurring identical subscription two days apart → possible, never auto-merged",
      // The plan's known hard case: a genuine second charge from a recurring
      // merchant 2 days apart is indistinguishable from a lagged post by
      // amount+merchant+date alone. Auto-merging would silently swallow a real
      // transaction, so beyond AUTO_DUPLICATE_WINDOW_DAYS (±1) the verdict
      // downgrades to 'possible' and the review UI asks the user.
      a: { accountId: "checking", amount: 9.99, date: "2026-06-01", merchant: "Netflix" },
      b: { accountId: "checking", amount: 9.99, date: "2026-06-03", merchant: "Netflix" },
      expected: "possible",
    },
    {
      name: "both rows verified → never match, regardless of similarity",
      a: { accountId: "checking", amount: 13.31, date: "2026-06-27", merchant: "Amatista", status: "verified" },
      b: { accountId: "checking", amount: 13.31, date: "2026-06-27", merchant: "Amatista", status: "verified" },
      expected: "distinct",
    },
    {
      name: "income vs expense → never match even with identical amount/date/merchant",
      a: { accountId: "checking", amount: 500, date: "2026-06-27", merchant: "Payroll", category: INCOME_CATEGORY },
      b: { accountId: "checking", amount: 500, date: "2026-06-27", merchant: "Payroll", category: "Uncategorized" },
      expected: "distinct",
    },
    {
      name: "different accounts (both known) → distinct even if everything else matches",
      a: { accountId: "checking", amount: 40, date: "2026-06-27", merchant: "Gas" },
      b: { accountId: "credit", amount: 40, date: "2026-06-27", merchant: "Gas" },
      expected: "distinct",
    },
    {
      name: "different amounts → distinct",
      a: { accountId: "checking", amount: 40, date: "2026-06-27", merchant: "Gas" },
      b: { accountId: "checking", amount: 45, date: "2026-06-27", merchant: "Gas" },
      expected: "distinct",
    },
    {
      name: "at the outer window boundary (3 days) → possible (inside DUPLICATE_WINDOW_DAYS, outside auto-merge)",
      a: { accountId: "checking", amount: 40, date: "2026-06-24", merchant: "Gas" },
      b: { accountId: "checking", amount: 40, date: "2026-06-27", merchant: "Gas" },
      expected: "possible",
    },
    {
      name: "one day past the window boundary (4 days) → distinct",
      a: { accountId: "checking", amount: 40, date: "2026-06-23", merchant: "Gas" },
      b: { accountId: "checking", amount: 40, date: "2026-06-27", merchant: "Gas" },
      expected: "distinct",
    },
    {
      // FIX 1 regression: two genuinely DIFFERENT merchants that only share
      // generic/geographic tokens via a raw bank descriptor must never
      // auto-merge. `merchantSimilar('Chipotle', 'Edina Grill')` is false, but
      // `namesSimilar` (which also pairs the bankDescriptor) would call them
      // similar — "SQ *CHIPOTLE MEXICAN GRILL EDINA MN" token-subsumes "Edina
      // Grill" via the shared "edina"/"grill" tokens. If `isLikelyDuplicate`
      // consulted `namesSimilar` here it would return 'duplicate', and
      // quickAddExpense (functions/src/quickAdd/index.ts) would silently
      // discard the second purchase as an "already recorded" merge instead of
      // writing it. It must stay 'possible' so a human reviews the pair.
      name: "different merchants sharing only geographic tokens via bankDescriptor → possible, never duplicate",
      a: {
        accountId: "checking",
        amount: 15,
        date: "2026-06-15",
        merchant: "Chipotle",
        bankDescriptor: "SQ *CHIPOTLE MEXICAN GRILL EDINA MN",
      },
      b: { accountId: "checking", amount: 15, date: "2026-06-15", merchant: "Edina Grill" },
      expected: "possible",
    },
  ];

  it.each(cases)("$name", ({ a, b, expected }) => {
    expect(isLikelyDuplicate(txn(a), txn(b))).toBe(expected);
    // Symmetric under swap (order should never change the verdict).
    expect(isLikelyDuplicate(txn(b), txn(a))).toBe(expected);
  });

  it("exposes the window constant used by the policy", () => {
    expect(DUPLICATE_WINDOW_DAYS).toBe(3);
  });
});
