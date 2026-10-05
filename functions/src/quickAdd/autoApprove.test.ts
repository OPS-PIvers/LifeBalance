import { describe, it, expect } from "vitest";
import { decideAutoApprove, HISTORY_DEPTH, type AutoApproveInput } from "./autoApprove";
import type { MerchantRule } from "./merchantRules";

const base = (over: Partial<AutoApproveInput> = {}): AutoApproveInput => ({
  amount: 6.45,
  merchant: "Starbucks",
  possibleDuplicate: false,
  history: [
    { category: "Coffee", accountId: "chk", date: "2026-09-30" },
    { category: "Coffee", accountId: "chk", date: "2026-09-20" },
  ],
  bucketNames: ["Coffee", "Groceries"],
  accounts: [
    { id: "chk", type: "checking" },
    { id: "visa", type: "credit" },
  ],
  ...over,
});

describe("decideAutoApprove", () => {
  it("approves a purchase whose bucket and account history agree", () => {
    expect(decideAutoApprove(base())).toEqual({
      category: "Coffee",
      accountId: "chk",
      balanceDelta: -6.45,
      learnedFrom: "history",
    });
  });

  it("raises a credit card's balance owed instead of debiting", () => {
    const got = decideAutoApprove(base({ resolvedAccountId: "visa" }));
    expect(got?.accountId).toBe("visa");
    expect(got?.balanceDelta).toBe(6.45);
  });

  it("prefers the account the capture resolved itself (card last-4) over history", () => {
    expect(decideAutoApprove(base({ resolvedAccountId: "visa" }))?.accountId).toBe("visa");
  });

  it("leaves a never-seen merchant for review", () => {
    expect(decideAutoApprove(base({ history: [] }))).toBeNull();
  });

  it("treats disagreeing history as doubt", () => {
    const history = [
      { category: "Coffee", accountId: "chk", date: "2026-09-30" },
      { category: "Groceries", accountId: "chk", date: "2026-09-20" },
    ];
    expect(decideAutoApprove(base({ history }))).toBeNull();
  });

  it("only looks at the most recent rows, so an old habit can change", () => {
    const history = [
      ...Array.from({ length: HISTORY_DEPTH }, (_, i) => ({
        category: "Groceries",
        accountId: "chk",
        date: `2026-09-${String(20 + i).padStart(2, "0")}`,
      })),
      { category: "Coffee", accountId: "chk", date: "2026-01-01" },
    ];
    expect(decideAutoApprove(base({ history }))?.category).toBe("Groceries");
  });

  it("needs a known account — category alone is not enough", () => {
    const history = [{ category: "Coffee", date: "2026-09-30" }];
    expect(decideAutoApprove(base({ history }))).toBeNull();
  });

  it("treats disagreeing accounts as doubt", () => {
    const history = [
      { category: "Coffee", accountId: "chk", date: "2026-09-30" },
      { category: "Coffee", accountId: "visa", date: "2026-09-20" },
    ];
    expect(decideAutoApprove(base({ history }))).toBeNull();
  });

  it("never files into a bucket that no longer exists", () => {
    expect(decideAutoApprove(base({ bucketNames: ["Groceries"] }))).toBeNull();
  });

  it("ignores placeholder and sentinel categories in history", () => {
    for (const category of ["Uncategorized", "Credit Card", "Budgeted in Calendar", "Income"]) {
      const history = [{ category, accountId: "chk", date: "2026-09-30" }];
      expect(decideAutoApprove(base({ history, bucketNames: [category] }))).toBeNull();
    }
  });

  it("uses a merchant rule's category even with no history", () => {
    const rules: MerchantRule[] = [
      { id: "r", pattern: "STARBUCKS", category: "Coffee", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const got = decideAutoApprove(base({ history: [], merchantRules: rules, resolvedAccountId: "chk" }));
    expect(got).toMatchObject({ category: "Coffee", accountId: "chk", learnedFrom: "rule" });
  });

  it("never auto-approves a $0 stub or a possible duplicate", () => {
    expect(decideAutoApprove(base({ amount: 0 }))).toBeNull();
    expect(decideAutoApprove(base({ possibleDuplicate: true }))).toBeNull();
  });

  it("ignores an account id that no longer exists", () => {
    const history = [{ category: "Coffee", accountId: "gone", date: "2026-09-30" }];
    expect(decideAutoApprove(base({ history }))).toBeNull();
  });
});
