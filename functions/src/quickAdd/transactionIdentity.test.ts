import { describe, it, expect } from "vitest";

import {
  fingerprint,
  merchantSimilar,
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
      name: "recurring identical subscription two days apart, same account → duplicate (within window)",
      // This is the case the plan calls out as needing a comment: two days is
      // INSIDE the ±3-day window, so by the stated policy this reads as the
      // same purchase (e.g. a delayed post-date). A true two-days-apart
      // resubscription is indistinguishable from a lagged post without extra
      // signal (e.g. a recurrence id), which this pairwise policy does not have.
      a: { accountId: "checking", amount: 9.99, date: "2026-06-01", merchant: "Netflix" },
      b: { accountId: "checking", amount: 9.99, date: "2026-06-03", merchant: "Netflix" },
      expected: "duplicate",
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
      name: "exactly at the window boundary (3 days) with everything else matching → duplicate",
      a: { accountId: "checking", amount: 40, date: "2026-06-24", merchant: "Gas" },
      b: { accountId: "checking", amount: 40, date: "2026-06-27", merchant: "Gas" },
      expected: "duplicate",
    },
    {
      name: "one day past the window boundary (4 days) → distinct",
      a: { accountId: "checking", amount: 40, date: "2026-06-23", merchant: "Gas" },
      b: { accountId: "checking", amount: 40, date: "2026-06-27", merchant: "Gas" },
      expected: "distinct",
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
