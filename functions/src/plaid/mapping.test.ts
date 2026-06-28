import { describe, it, expect } from "vitest";
import { plaidTransactionToDoc, INCOME_CATEGORY, type PlaidTxnInput } from "./mapping";

const base: PlaidTxnInput = {
  transaction_id: "txn_abc",
  name: "TARGET 00012345",
  merchant_name: "Target",
  amount: 52.4, // Plaid positive = outflow
  date: "2026-06-20",
  personal_finance_category: { primary: "GENERAL_MERCHANDISE" },
};

const ctx = { bucketNames: ["Groceries", "Shopping", "Gas"], lastPaycheckDate: "2026-06-15" };

describe("plaidTransactionToDoc", () => {
  it("maps an outflow to a positive pending_review plaid transaction", () => {
    const d = plaidTransactionToDoc(base, ctx);
    expect(d.amount).toBe(52.4);
    expect(d.merchant).toBe("Target");
    expect(d.category).toBe("Shopping"); // GENERAL_MERCHANDISE → Shopping, clamped to bucket
    expect(d.status).toBe("pending_review");
    expect(d.source).toBe("plaid");
    expect(d.autoCategorized).toBe(true);
    expect(d.plaidTransactionId).toBe("txn_abc");
    expect(d.payPeriodId).toBe("2026-06-15"); // on/after paycheck → current period
  });

  it("stores a Plaid inflow (negative amount) as positive Income so it is excluded from pending spend", () => {
    const refund = plaidTransactionToDoc({ ...base, amount: -30, personal_finance_category: { primary: "GENERAL_MERCHANDISE" } }, ctx);
    expect(refund.amount).toBe(30); // abs
    expect(refund.category).toBe(INCOME_CATEGORY); // inflow forced to Income
  });

  it("falls back to the merchant name, then 'Unknown', when merchant_name is absent", () => {
    expect(plaidTransactionToDoc({ ...base, merchant_name: null }, ctx).merchant).toBe("TARGET 00012345");
    expect(plaidTransactionToDoc({ ...base, merchant_name: null, name: null }, ctx).merchant).toBe("Unknown");
  });

  it("clamps an unmatched category to 'Uncategorized' (never an arbitrary bucket)", () => {
    const d = plaidTransactionToDoc({ ...base, personal_finance_category: { primary: "ENTERTAINMENT" } }, ctx);
    expect(d.category).toBe("Uncategorized"); // no 'Entertainment' bucket in ctx
  });

  it("derives '' payPeriodId for a pre-period transaction", () => {
    expect(plaidTransactionToDoc({ ...base, date: "2026-06-10" }, ctx).payPeriodId).toBe("");
  });

  it("never includes a balance/amount-delta field (sync must not debit checking)", () => {
    const d = plaidTransactionToDoc(base, ctx) as Record<string, unknown>;
    expect("balance" in d).toBe(false);
  });
});
