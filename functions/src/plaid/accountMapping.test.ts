import { describe, it, expect } from "vitest";
import { resolveAccountMap, type PlaidAccountInput, type LifeBalanceAccountInput } from "./accountMapping";

const lbAccounts: LifeBalanceAccountInput[] = [
  { id: "acc_checking", name: "Main Checking", cardLast4: "8899" },
  { id: "acc_savings", name: "Emergency Savings" },
];

describe("resolveAccountMap", () => {
  it("maps a Plaid account to a LifeBalance account by mask matching cardLast4", () => {
    const plaidAccounts: PlaidAccountInput[] = [
      { account_id: "plaid_1", name: "Totally Different Name", mask: "8899" },
    ];
    expect(resolveAccountMap(plaidAccounts, lbAccounts)).toEqual({ plaid_1: "acc_checking" });
  });

  it("falls back to a case-insensitive exact name match when no mask matches", () => {
    const plaidAccounts: PlaidAccountInput[] = [
      { account_id: "plaid_2", name: "emergency savings", mask: null },
    ];
    expect(resolveAccountMap(plaidAccounts, lbAccounts)).toEqual({ plaid_2: "acc_savings" });
  });

  it("prefers a mask match over a name match when both are present", () => {
    const plaidAccounts: PlaidAccountInput[] = [
      { account_id: "plaid_3", name: "Emergency Savings", mask: "8899" },
    ];
    expect(resolveAccountMap(plaidAccounts, lbAccounts)).toEqual({ plaid_3: "acc_checking" });
  });

  it("leaves a Plaid account unmapped when neither mask nor name confidently matches", () => {
    const plaidAccounts: PlaidAccountInput[] = [
      { account_id: "plaid_4", name: "Mystery Account", mask: "1234" },
    ];
    expect(resolveAccountMap(plaidAccounts, lbAccounts)).toEqual({});
  });

  it("maps multiple accounts independently in one call", () => {
    const plaidAccounts: PlaidAccountInput[] = [
      { account_id: "plaid_1", name: "x", mask: "8899" },
      { account_id: "plaid_2", name: "Emergency Savings", mask: null },
      { account_id: "plaid_4", name: "Mystery", mask: null },
    ];
    expect(resolveAccountMap(plaidAccounts, lbAccounts)).toEqual({
      plaid_1: "acc_checking",
      plaid_2: "acc_savings",
    });
  });
});
