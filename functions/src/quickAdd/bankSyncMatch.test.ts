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
  getBillPayPeriodId,
  computeBalanceAsOf,
  shouldSkipBalanceOverwrite,
  CONFIRM_DATE_TOLERANCE_DAYS,
  type PendingConfirmCandidate,
  type BillPayCandidate,
  type PaidIncomeLike,
  type WithdrawalDecision,
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

  // Item 3 — account gating.
  it("does NOT confirm a row tagged to a DIFFERENT account", () => {
    const other = pending({ accountId: "savings" });
    expect(pickPendingToConfirm(withdrawal(), [other], "checking")).toBeNull();
  });

  it("confirms an UNTAGGED row (voice/shortcut entries land on checking)", () => {
    const untagged = pending({ accountId: undefined });
    expect(pickPendingToConfirm(withdrawal(), [untagged], "checking")?.id).toBe("txn1");
  });

  it("never confirms a CREDIT-tagged row with a checking email", () => {
    const credit = pending({ id: "cc", accountId: "credit-card" });
    expect(pickPendingToConfirm(withdrawal(), [credit], "checking")).toBeNull();
  });

  it("confirms a row tagged to the SAME resolved account", () => {
    const same = pending({ accountId: "checking" });
    expect(pickPendingToConfirm(withdrawal(), [same], "checking")?.id).toBe("txn1");
  });
});

// ---------------------------------------------------------------------------
// Bill pay-period retro-filing (item 4)
// ---------------------------------------------------------------------------

describe("getBillPayPeriodId", () => {
  const paychecks: PaidIncomeLike[] = [
    { type: "income", isPaid: true, date: "2026-06-01" },
    { type: "income", isPaid: true, date: "2026-07-01" },
    { type: "income", isPaid: false, date: "2026-07-15" }, // unapproved — ignored
    { type: "expense", isPaid: true, date: "2026-06-20" }, // not income — ignored
  ];

  it("files a current-period bill under the last paycheck", () => {
    expect(getBillPayPeriodId("2026-07-05", "2026-07-01", paychecks)).toBe("2026-07-01");
  });

  it("retro-files an overdue June bill (paid by a July email) under the June period", () => {
    // Due 2026-06-15, current period 2026-07-01 → walk back to the June paycheck.
    expect(getBillPayPeriodId("2026-06-15", "2026-07-01", paychecks)).toBe("2026-06-01");
  });

  it("ignores unapproved (unpaid) and non-income items when walking back", () => {
    // A bill due 2026-06-25 must land on 2026-06-01, not the unpaid 07-15 income
    // nor the paid 06-20 expense.
    expect(getBillPayPeriodId("2026-06-25", "2026-07-01", paychecks)).toBe("2026-06-01");
  });

  it("returns '' (untracked) when no paycheck precedes the bill", () => {
    expect(getBillPayPeriodId("2026-05-01", "2026-07-01", paychecks)).toBe("");
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
// Per-email loop pruning (item 2): two withdrawals must never consume the same
// stub / pending / bill. This mirrors the endpoint's decide→prune→next loop
// exactly (bankEmailSync.ts step 9) so a displaced withdrawal falls through to
// CREATE instead of silently overwriting the first one's target.
// ---------------------------------------------------------------------------

interface LoopPools {
  stubs: (ReconcileCandidate & { date?: string })[];
  pendingCandidates: PendingConfirmCandidate[];
  billCandidates: BillPayCandidate[];
}

/** Replays the endpoint's decide-and-prune loop; returns the per-line decisions. */
function runLoop(
  withdrawals: BankEmailWithdrawal[],
  pools: LoopPools,
  resolvedAccountId = "acct1"
): WithdrawalDecision[] {
  const existingBankRefs = new Set<string>();
  let stubPool = pools.stubs;
  let pendingPool = pools.pendingCandidates;
  let billPool = pools.billCandidates;
  const out: WithdrawalDecision[] = [];
  for (const w of withdrawals) {
    const decision = decideWithdrawal({
      withdrawal: w,
      existingBankRefs,
      stubs: stubPool,
      pendingCandidates: pendingPool,
      billCandidates: billPool,
      resolvedAccountId,
    });
    existingBankRefs.add(w.bankRef);
    if (decision.kind === "fill_stub") {
      stubPool = stubPool.filter((s) => s.id !== decision.stubId);
      pendingPool = pendingPool.filter((p) => p.id !== decision.stubId);
    } else if (decision.kind === "confirm_pending") {
      pendingPool = pendingPool.filter((p) => p.id !== decision.transactionId);
      stubPool = stubPool.filter((s) => s.id !== decision.transactionId);
    } else if (decision.kind === "pay_bill") {
      billPool = billPool.filter((b) => b.id !== decision.match.bill.id);
    }
    out.push(decision);
  }
  return out;
}

describe("per-email loop pruning", () => {
  it("two withdrawals + one stub → one fill + one create", () => {
    // Both lines merchant-match the lone stub, but only the first may consume it.
    const w1 = withdrawal({ bankRef: "R1", descriptor: "TARGET", amount: 20, date: "2026-07-20" });
    const w2 = withdrawal({ bankRef: "R2", descriptor: "TARGET", amount: 30, date: "2026-07-20" });
    const decisions = runLoop([w1, w2], {
      stubs: [stub({ id: "s1", date: "2026-07-20" })],
      pendingCandidates: [],
      billCandidates: [],
    });
    expect(decisions[0]).toEqual({ kind: "fill_stub", stubId: "s1" });
    expect(decisions[1]?.kind).toBe("create");
  });

  it("two withdrawals cent-matching one pending row → one confirm + one create", () => {
    const w1 = withdrawal({ bankRef: "R1", amount: 18.86, date: "2026-07-20" });
    const w2 = withdrawal({ bankRef: "R2", amount: 18.86, date: "2026-07-20" });
    const decisions = runLoop([w1, w2], {
      stubs: [],
      pendingCandidates: [pending({ id: "p1", amount: 18.86, date: "2026-07-20" })],
      billCandidates: [],
    });
    expect(decisions[0]).toEqual({ kind: "confirm_pending", transactionId: "p1" });
    expect(decisions[1]?.kind).toBe("create");
  });

  it("two withdrawals matching one bill → one pay + one create", () => {
    const w1 = withdrawal({ bankRef: "R1", descriptor: "COMCAST-XFINITY CABLE", amount: 153.95 });
    const w2 = withdrawal({ bankRef: "R2", descriptor: "COMCAST-XFINITY CABLE", amount: 153.95 });
    const decisions = runLoop([w1, w2], {
      stubs: [],
      pendingCandidates: [],
      billCandidates: [bill({ id: "b1", title: "Comcast Internet", amount: 153.95 })],
    });
    expect(decisions[0]?.kind).toBe("pay_bill");
    if (decisions[0]?.kind === "pay_bill") expect(decisions[0].match.bill.id).toBe("b1");
    expect(decisions[1]?.kind).toBe("create");
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

describe("computeBalanceAsOf", () => {
  it("returns the latest withdrawal date when there are withdrawals", () => {
    expect(computeBalanceAsOf(["2026-07-05", "2026-07-20", "2026-07-12"], "2026-07-21")).toBe(
      "2026-07-20"
    );
  });

  it("handles a single withdrawal", () => {
    expect(computeBalanceAsOf(["2026-07-15"], "2026-07-21")).toBe("2026-07-15");
  });

  it("prefers the email's own asOf date over the max withdrawal date", () => {
    expect(
      computeBalanceAsOf(["2026-07-05", "2026-07-20", "2026-07-12"], "2026-07-21", "2026-07-18")
    ).toBe("2026-07-18");
  });

  it("falls back to the max withdrawal date when asOf is absent", () => {
    expect(computeBalanceAsOf(["2026-07-05", "2026-07-20", "2026-07-12"], "2026-07-21")).toBe(
      "2026-07-20"
    );
  });

  it("falls back to today when neither asOf nor withdrawals are present", () => {
    expect(computeBalanceAsOf([], "2026-07-21")).toBe("2026-07-21");
  });

  it("regression: a no-withdrawal email with an old asOf must not beat a newer stored balanceAsOf", () => {
    // Motivating scenario: a balance-only (no withdrawal lines) email whose own
    // "As of 07/05/2026" footer is OLD arrives in a backfill run TODAY
    // (2026-07-21), after a newer email (as-of 2026-07-20) has already been
    // applied. Using `today` as the as-of would wrongly compute 2026-07-21,
    // beat the stored 2026-07-20, and overwrite with a stale balance.
    const incomingAsOf = computeBalanceAsOf([], "2026-07-21", "2026-07-05");
    expect(incomingAsOf).toBe("2026-07-05");
    expect(shouldSkipBalanceOverwrite("2026-07-20", incomingAsOf)).toBe(true);
  });
});

describe("shouldSkipBalanceOverwrite", () => {
  it("skips when the stored as-of date is strictly newer than the incoming one", () => {
    expect(shouldSkipBalanceOverwrite("2026-07-20", "2026-07-05")).toBe(true);
  });

  it("does not skip when the incoming date is newer", () => {
    expect(shouldSkipBalanceOverwrite("2026-07-05", "2026-07-20")).toBe(false);
  });

  it("does not skip on an equal date (same-or-newer applies normally)", () => {
    expect(shouldSkipBalanceOverwrite("2026-07-20", "2026-07-20")).toBe(false);
  });

  it("does not skip when there is no stored as-of date yet (first sync)", () => {
    expect(shouldSkipBalanceOverwrite(undefined, "2026-07-05")).toBe(false);
  });
});
