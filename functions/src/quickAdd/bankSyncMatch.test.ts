import { describe, it, expect } from "vitest";

import type { BankEmailWithdrawal } from "./bankEmailParser";
import type { ReconcileCandidate } from "./reconcile";
import {
  dayGap,
  significantTokens,
  shareSignificantToken,
  matchesAlias,
  pickPendingToConfirm,
  billAmountWithinTolerance,
  pickBillToPay,
  decideWithdrawal,
  matchAccountByAccountLast4,
  isMessageAlreadyProcessed,
  buildEndingBalanceUpdate,
  CONFIRM_DATE_TOLERANCE_DAYS,
  type PendingConfirmCandidate,
  type BillPayCandidate,
} from "./bankSyncMatch";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function withdrawal(over: Partial<BankEmailWithdrawal> = {}): BankEmailWithdrawal {
  return {
    descriptor: "TARGET T-2189 MINNEAPOLIS MN",
    amount: 18.86,
    date: "2026-07-20",
    bankRef: "P000000551051569",
    ...over,
  };
}

function stub(over: Partial<ReconcileCandidate & { date?: string }> = {}): ReconcileCandidate & {
  date?: string;
} {
  return {
    id: "stub1",
    amount: 0,
    merchant: "Apple Pay hold",
    needsAmount: true,
    date: "2026-07-20",
    ...over,
  };
}

function pending(over: Partial<PendingConfirmCandidate> = {}): PendingConfirmCandidate {
  return {
    id: "txn1",
    amount: 18.86,
    date: "2026-07-20",
    merchant: "Target",
    ...over,
  };
}

function bill(over: Partial<BillPayCandidate> = {}): BillPayCandidate {
  return {
    id: "bill1",
    title: "Comcast Internet",
    amount: 153.95,
    date: "2026-07-18",
    isRecurringInstance: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// dayGap / tokens
// ---------------------------------------------------------------------------

describe("dayGap", () => {
  it("counts whole days regardless of order", () => {
    expect(dayGap("2026-07-20", "2026-07-23")).toBe(3);
    expect(dayGap("2026-07-23", "2026-07-20")).toBe(3);
    expect(dayGap("2026-07-20", "2026-07-20")).toBe(0);
  });
  it("is Infinity for an unparseable date", () => {
    expect(dayGap("not-a-date", "2026-07-20")).toBe(Infinity);
  });
});

describe("significantTokens / shareSignificantToken", () => {
  it("drops noise words, short tokens and pure digits", () => {
    expect(significantTokens("AMERICAN EXPRESS ACH PMT 260720")).toEqual([
      "AMERICAN",
      "EXPRESS",
    ]);
  });
  it("finds a shared meaningful token", () => {
    expect(shareSignificantToken("COMCAST-XFINITY CABLE SVCS", "Comcast Internet")).toBe(true);
  });
  it("does not match on noise alone", () => {
    expect(shareSignificantToken("WATER BILL AUTOPAY", "Electric Bill AUTOPAY")).toBe(false);
  });
});

describe("matchesAlias", () => {
  it("matches on exact normalized equality", () => {
    expect(matchesAlias("XCEL ENERGY WEB PYMT", ["xcel  energy web pymt"])).toBe(true);
  });
  it("does not match a different descriptor", () => {
    expect(matchesAlias("XCEL ENERGY", ["COMCAST XFINITY"])).toBe(false);
  });
  it("is false for no aliases", () => {
    expect(matchesAlias("ANY", undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CONFIRM (4c)
// ---------------------------------------------------------------------------

describe("pickPendingToConfirm", () => {
  it("confirms a lone cent-exact candidate within ±3 days", () => {
    const got = pickPendingToConfirm(withdrawal(), [pending({ date: "2026-07-22" })]);
    expect(got?.id).toBe("txn1");
  });

  it("rejects a candidate outside the ±3-day window", () => {
    const outside = pending({ date: "2026-07-25" }); // 5 days
    expect(dayGap(outside.date, "2026-07-20")).toBeGreaterThan(CONFIRM_DATE_TOLERANCE_DAYS);
    expect(pickPendingToConfirm(withdrawal(), [outside])).toBeNull();
  });

  it("rejects a candidate off by a cent", () => {
    expect(pickPendingToConfirm(withdrawal({ amount: 18.86 }), [pending({ amount: 18.85 })])).toBeNull();
  });

  it("breaks an amount+date tie by merchant similarity (unique survivor wins)", () => {
    const a = pending({ id: "a", merchant: "Target", date: "2026-07-20" });
    const b = pending({ id: "b", merchant: "Costco", date: "2026-07-20" });
    const got = pickPendingToConfirm(withdrawal({ descriptor: "TARGET T-2189" }), [a, b]);
    expect(got?.id).toBe("a");
  });

  it("returns null when the tie cannot be broken (ambiguous → falls through to CREATE)", () => {
    const a = pending({ id: "a", merchant: "Mystery", date: "2026-07-20" });
    const b = pending({ id: "b", merchant: "Enigma", date: "2026-07-20" });
    expect(pickPendingToConfirm(withdrawal({ descriptor: "UNRELATED" }), [a, b])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PAY (4d)
// ---------------------------------------------------------------------------

describe("billAmountWithinTolerance", () => {
  it("accepts within 10% on a large bill (where 10% > $25)", () => {
    expect(billAmountWithinTolerance(1000, 1090)).toBe(true); // $90 diff < $100
    expect(billAmountWithinTolerance(1000, 1101)).toBe(false); // $101 diff > $100
  });
  it("accepts within $25 even when >10% (small bills)", () => {
    expect(billAmountWithinTolerance(50, 70)).toBe(true); // $20 diff < $25
    expect(billAmountWithinTolerance(50, 80)).toBe(false); // $30 diff
  });
});

describe("pickBillToPay", () => {
  it("pays via title token-overlap (matchedByAlias false)", () => {
    const w = withdrawal({ descriptor: "COMCAST-XFINITY CABLE SVCS 260718", amount: 153.95 });
    const got = pickBillToPay(w, [bill()]);
    expect(got?.bill.id).toBe("bill1");
    expect(got?.matchedByAlias).toBe(false);
  });

  it("pays via a learned alias (matchedByAlias true), preferred over token-overlap", () => {
    const w = withdrawal({ descriptor: "XCEL ENERGY WEB PYMT 260718", amount: 90 });
    const aliasBill = bill({
      id: "electric",
      title: "Electric",
      amount: 90,
      bankDescriptorAliases: ["XCEL ENERGY WEB PYMT 260718"],
    });
    const got = pickBillToPay(w, [aliasBill]);
    expect(got?.bill.id).toBe("electric");
    expect(got?.matchedByAlias).toBe(true);
  });

  it("returns null when amount is out of tolerance", () => {
    const w = withdrawal({ descriptor: "COMCAST CABLE", amount: 500 });
    expect(pickBillToPay(w, [bill()])).toBeNull();
  });

  it("returns null when two token-overlap candidates are ambiguous", () => {
    const w = withdrawal({ descriptor: "COMCAST CABLE", amount: 153.95 });
    const a = bill({ id: "a", title: "Comcast Internet", amount: 153.95 });
    const b = bill({ id: "b", title: "Comcast TV", amount: 153.95 });
    expect(pickBillToPay(w, [a, b])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Order of operations (a→e)
// ---------------------------------------------------------------------------

const emptyDecideBase = {
  existingBankRefs: new Set<string>(),
  stubs: [] as ReconcileCandidate[],
  pendingCandidates: [] as PendingConfirmCandidate[],
  billCandidates: [] as BillPayCandidate[],
  resolvedAccountId: "acct1",
};

describe("decideWithdrawal order of operations", () => {
  it("a. skips when the bankRef already exists (highest precedence)", () => {
    const w = withdrawal();
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: w,
      existingBankRefs: new Set([w.bankRef]),
      // even with a perfect stub + pending + bill present, dedup wins
      stubs: [stub()],
      pendingCandidates: [pending()],
    });
    expect(decision).toEqual({ kind: "skip_bankref" });
  });

  it("b. fills an Apple Pay stub before confirming/paying", () => {
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: withdrawal(),
      stubs: [stub()],
      pendingCandidates: [pending()], // would also confirm, but stub-fill wins
    });
    expect(decision).toEqual({ kind: "fill_stub", stubId: "stub1" });
  });

  it("b. does NOT fill a stub that is too far from the withdrawal date", () => {
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: withdrawal({ date: "2026-07-20" }),
      stubs: [stub({ date: "2026-07-10" })], // 10 days away
    });
    expect(decision.kind).toBe("create");
  });

  it("c. confirms a pending transaction when no stub matches", () => {
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: withdrawal(),
      pendingCandidates: [pending()],
      billCandidates: [bill({ title: "Target", amount: 18.86 })], // confirm wins over pay
    });
    expect(decision).toEqual({ kind: "confirm_pending", transactionId: "txn1" });
  });

  it("d. pays a bill when nothing else matches", () => {
    const w = withdrawal({ descriptor: "COMCAST-XFINITY CABLE SVCS", amount: 153.95 });
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: w,
      billCandidates: [bill()],
    });
    expect(decision.kind).toBe("pay_bill");
    if (decision.kind === "pay_bill") {
      expect(decision.match.bill.id).toBe("bill1");
      expect(decision.match.matchedByAlias).toBe(false);
    }
  });

  it("e. creates a new row when no candidate matches", () => {
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: withdrawal(),
    });
    expect(decision).toEqual({ kind: "create" });
  });

  it("e. falls through to create when a pending confirm is ambiguous", () => {
    const a = pending({ id: "a", merchant: "Mystery" });
    const b = pending({ id: "b", merchant: "Enigma" });
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: withdrawal({ descriptor: "UNRELATED", amount: 18.86, date: "2026-07-20" }),
      pendingCandidates: [a, b],
    });
    expect(decision.kind).toBe("create");
  });
});

// ---------------------------------------------------------------------------
// Account resolution (2), idempotency (3), ending balance (5)
// ---------------------------------------------------------------------------

describe("matchAccountByAccountLast4", () => {
  it("resolves a unique account", () => {
    expect(
      matchAccountByAccountLast4("5581", [
        { id: "chk", accountLast4: "5581" },
        { id: "sav", accountLast4: "9999" },
      ])
    ).toBe("chk");
  });
  it("returns null for an unknown last-4 (no-op)", () => {
    expect(matchAccountByAccountLast4("0000", [{ id: "chk", accountLast4: "5581" }])).toBeNull();
  });
  it("returns null on an ambiguous tie", () => {
    expect(
      matchAccountByAccountLast4("5581", [
        { id: "a", accountLast4: "5581" },
        { id: "b", accountLast4: "5581" },
      ])
    ).toBeNull();
  });
});

describe("isMessageAlreadyProcessed", () => {
  it("is true only for a seen messageId", () => {
    const seen = new Set(["<abc@wf.com>"]);
    expect(isMessageAlreadyProcessed("<abc@wf.com>", seen)).toBe(true);
    expect(isMessageAlreadyProcessed("<new@wf.com>", seen)).toBe(false);
  });
});

describe("buildEndingBalanceUpdate", () => {
  it("returns an absolute balance overwrite (never an increment)", () => {
    expect(buildEndingBalanceUpdate(1277.9)).toEqual({ balance: 1277.9 });
  });
});
