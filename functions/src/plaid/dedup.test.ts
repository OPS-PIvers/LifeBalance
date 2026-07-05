import { describe, it, expect } from "vitest";
import { decidePlaidWrite, type ExistingRow } from "./dedup";
import type { MappedPlaidDoc } from "./mapping";

const plaidTxn: MappedPlaidDoc = {
  amount: 52.4,
  merchant: "Target",
  category: "Shopping",
  date: "2026-06-20",
  status: "pending_review",
  isRecurring: false,
  source: "plaid",
  autoCategorized: true,
  plaidTransactionId: "txn_abc",
  payPeriodId: "2026-06-15",
};

const existingRow = (overrides: Partial<ExistingRow>): ExistingRow => ({
  id: "existing_1",
  amount: 52.4,
  merchant: "Target",
  date: "2026-06-20",
  category: "Shopping",
  status: "pending_review",
  ...overrides,
});

// `MappedPlaidDoc` never carries an accountId (Plaid sync doesn't resolve one
// yet — out of scope here), so a 'duplicate' verdict (which requires BOTH
// accounts known per isLikelyDuplicate's policy) is only reachable when we
// simulate a future/explicit accountId on the incoming side for test purposes.
const plaidTxnWithAccount: MappedPlaidDoc & { accountId: string } = {
  ...plaidTxn,
  accountId: "acct_checking",
};

describe("decidePlaidWrite", () => {
  it("skips insert and annotates the existing row on a same-day exact duplicate (both accounts known)", () => {
    const decision = decidePlaidWrite(plaidTxnWithAccount, [existingRow({ accountId: "acct_checking" })]);
    expect(decision).toEqual({ action: "skip-annotate-existing", existingId: "existing_1" });
  });

  it("without a resolvable account on either side, an exact amount/merchant/date match is only 'possible' (never auto-merged)", () => {
    const decision = decidePlaidWrite(plaidTxn, [existingRow({})]);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: "existing_1" });
  });

  it("inserts unflagged when there are no candidates", () => {
    const decision = decidePlaidWrite(plaidTxn, []);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: undefined });
  });

  it("inserts flagged with possibleDuplicateOf when the only signal is weaker (2-3 day lag)", () => {
    const decision = decidePlaidWrite(plaidTxn, [existingRow({ date: "2026-06-18" })]);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: "existing_1" });
  });

  it("inserts flagged when merchant is dissimilar but amount/date still match", () => {
    const decision = decidePlaidWrite(plaidTxn, [existingRow({ merchant: "Totally Different Store" })]);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: "existing_1" });
  });

  it("inserts unflagged (distinct) when the existing row is outside the 3-day window", () => {
    const decision = decidePlaidWrite(plaidTxn, [existingRow({ date: "2026-06-10" })]);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: undefined });
  });

  it("a verified existing row (with a known matching account) can still be a confident duplicate, since the incoming Plaid txn is always pending", () => {
    const decision = decidePlaidWrite(plaidTxnWithAccount, [
      existingRow({ status: "verified", accountId: "acct_checking" }),
    ]);
    expect(decision).toEqual({ action: "skip-annotate-existing", existingId: "existing_1" });
  });

  it("prefers a 'duplicate' verdict over an earlier 'possible' candidate in the list", () => {
    const possible = existingRow({ id: "possible_1", date: "2026-06-18", accountId: "acct_checking" });
    const duplicate = existingRow({ id: "duplicate_1", accountId: "acct_checking" });
    const decision = decidePlaidWrite(plaidTxnWithAccount, [possible, duplicate]);
    expect(decision).toEqual({ action: "skip-annotate-existing", existingId: "duplicate_1" });
  });

  it("returns the FIRST possible match when multiple 'possible' candidates exist (no duplicate)", () => {
    const first = existingRow({ id: "first", date: "2026-06-18" });
    const second = existingRow({ id: "second", merchant: "Different Store" });
    const decision = decidePlaidWrite(plaidTxn, [first, second]);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: "first" });
  });

  it("does not match against income vs expense category mismatch", () => {
    const decision = decidePlaidWrite(plaidTxn, [existingRow({ category: "Income" })]);
    expect(decision).toEqual({ action: "insert", possibleDuplicateOf: undefined });
  });
});
