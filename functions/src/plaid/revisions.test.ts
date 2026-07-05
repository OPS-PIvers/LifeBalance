import { describe, it, expect } from "vitest";
import { decideModifiedWrite, decideRemovedWrite, type RevisableRow } from "./revisions";

const incoming = {
  amount: 60.0,
  merchant: "Target",
  category: "Shopping",
  date: "2026-06-21",
};

const currentFields = {
  amount: 52.4,
  merchant: "Target",
  category: "Shopping",
  date: "2026-06-20",
};

describe("decideModifiedWrite", () => {
  it("overwrites an untouched (pending_review) row directly", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "pending_review" };
    const decision = decideModifiedWrite(existing, incoming, currentFields);
    expect(decision).toEqual({ action: "overwrite", fields: incoming });
  });

  it("flags a revision instead of overwriting a verified row", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "verified" };
    const decision = decideModifiedWrite(existing, incoming, currentFields);
    expect(decision.action).toBe("flag-revision");
    if (decision.action === "flag-revision") {
      expect(decision.revision).toEqual({ amount: 60.0, date: "2026-06-21" });
    }
  });

  it("only includes fields that actually changed in the revision delta", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "verified" };
    const sameDateDifferentAmount = { ...incoming, date: currentFields.date };
    const decision = decideModifiedWrite(existing, sameDateDifferentAmount, currentFields);
    expect(decision).toEqual({ action: "flag-revision", revision: { amount: 60.0 } });
  });

  it("produces an empty revision object when nothing tracked actually changed", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "verified" };
    const decision = decideModifiedWrite(existing, currentFields, currentFields);
    expect(decision).toEqual({ action: "flag-revision", revision: {} });
  });

  it("includes a changed merchant in the revision delta", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "verified" };
    const merchantChanged = { ...currentFields, merchant: "Target Corp" };
    const decision = decideModifiedWrite(existing, merchantChanged, currentFields);
    expect(decision).toEqual({ action: "flag-revision", revision: { merchant: "Target Corp" } });
  });
});

describe("decideRemovedWrite", () => {
  it("deletes an untouched (pending_review) row", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "pending_review" };
    expect(decideRemovedWrite(existing)).toBe("delete");
  });

  it("flags (does not delete) a verified row", () => {
    const existing: RevisableRow = { id: "plaid_1", status: "verified" };
    expect(decideRemovedWrite(existing)).toBe("flag-removed");
  });
});
