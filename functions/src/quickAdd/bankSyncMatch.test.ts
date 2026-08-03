import { describe, it, expect } from "vitest";

import type { BankEmailWithdrawal } from "./bankEmailParser";
import type { ReconcileCandidate } from "./reconcile";
import {
  dayGap,
  significantTokens,
  shareSignificantToken,
  matchesAlias,
  isVerifiedConfirmCandidate,
  pickPendingToConfirm,
  billAmountWithinTolerance,
  pickBillToPay,
  decideWithdrawal,
  matchAccountByAccountLast4,
  isMessageAlreadyProcessed,
  buildBalanceUpdate,
  getBillPayPeriodId,
  computeBalanceAsOf,
  shouldSkipBalanceOverwrite,
  emailAddsNothingNew,
  CONFIRM_DATE_TOLERANCE_DAYS,
  type PendingConfirmCandidate,
  type BillPayCandidate,
  type PaidIncomeLike,
  type WithdrawalDecision,
} from "./bankSyncMatch";
import type { MerchantRule } from "./merchantRules";

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

describe("isVerifiedConfirmCandidate", () => {
  const verified = {
    status: "verified",
    amount: 18.86,
    merchant: "TARGET T-2189",
    category: "Groceries",
  };

  it("accepts a reviewed row that carries no bank reference", () => {
    // The regression this whole predicate exists for: reviewing an Apple Pay /
    // Shortcut capture flips it to `verified`, and before this it dropped out
    // of the confirm pool entirely, so the nightly email filed a duplicate.
    expect(isVerifiedConfirmCandidate(verified)).toBe(true);
  });

  it("rejects a row that already carries a bankRef", () => {
    // Already a bank line: covered by the 4a skip, and re-matching it could
    // steal the target from a genuinely new purchase of the same amount.
    expect(isVerifiedConfirmCandidate({ ...verified, bankRef: "P000000551051569" })).toBe(false);
    expect(isVerifiedConfirmCandidate({ ...verified, bankRef: "synth:9f3a" })).toBe(false);
  });

  it("treats an empty-string bankRef as absent", () => {
    // Mirrors isBankSyncTransaction's truthy check — a malformed empty string
    // must not lock a row out of matching.
    expect(isVerifiedConfirmCandidate({ ...verified, bankRef: "" })).toBe(true);
  });

  it("rejects income", () => {
    // Deposits are stored positive exactly like withdrawals, so without this a
    // $372.00 debit could "confirm" a $372.00 paycheck.
    expect(isVerifiedConfirmCandidate({ ...verified, category: "Income" })).toBe(false);
  });

  it("rejects a credit-card payment", () => {
    expect(isVerifiedConfirmCandidate({ ...verified, creditPayment: true })).toBe(false);
  });

  it("rejects a $0 Apple Pay stub, which belongs to the FILL step", () => {
    expect(isVerifiedConfirmCandidate({ ...verified, amount: 0 })).toBe(false);
    expect(isVerifiedConfirmCandidate({ ...verified, amount: -5 })).toBe(false);
  });

  it("rejects anything not verified", () => {
    // pending_review rows reach the pool through the endpoint's own status
    // query; this predicate only widens it to settled rows.
    expect(isVerifiedConfirmCandidate({ ...verified, status: "pending_review" })).toBe(false);
    expect(isVerifiedConfirmCandidate({ ...verified, status: undefined })).toBe(false);
  });

  it("rejects a malformed amount", () => {
    expect(isVerifiedConfirmCandidate({ ...verified, amount: "18.86" })).toBe(false);
    expect(isVerifiedConfirmCandidate({ ...verified, amount: NaN })).toBe(false);
  });
});

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

  // The capture flow's statement scan cleans bank noise out of the merchant
  // before storing it ("PURCHASE JIMMY JOHNS MINNEAPOLIS MN CARD7752" →
  // "Jimmy Johns"), which raises the obvious worry that the nightly email will
  // no longer recognize its own row and CREATE a duplicate. It doesn't — and the
  // tie-break is actually MORE reliable on the clean name, because
  // `merchantSimilar` wants one token set to be a SUBSET of the other and the
  // raw pending descriptor carries tokens ("card7752") the later posted
  // descriptor does not.
  it("breaks a tie on a merchant cleaned of bank noise (raw descriptors would MISS)", () => {
    const posted = "PURCHASE AUTHORIZED ON 07/19 JIMMY JOHNS 1234 MINNEAPOLIS MN S12345 CARD 7752";
    const cleaned = pending({ id: "cleaned", merchant: "Jimmy Johns", date: "2026-07-20" });
    const other = pending({ id: "other", merchant: "Pure Hockey", date: "2026-07-20" });
    expect(pickPendingToConfirm(withdrawal({ descriptor: posted }), [cleaned, other])?.id)
      .toBe("cleaned");

    // Same tie, but the row kept the bank's raw pending text: no subset either
    // way, so the tie cannot be broken and the withdrawal falls through to
    // CREATE — i.e. a duplicate. Cleaning the merchant PREVENTS that.
    const raw = pending({ id: "raw", merchant: "PURCHASE JIMMY JOHNS MINNEAPOLIS MN CARD7752", date: "2026-07-20" });
    expect(pickPendingToConfirm(withdrawal({ descriptor: posted }), [raw, other])).toBeNull();
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
  it("pays via title token-overlap (matchedBy 'token')", () => {
    const w = withdrawal({ descriptor: "COMCAST-XFINITY CABLE SVCS 260718", amount: 153.95 });
    const got = pickBillToPay(w, [bill()]);
    expect(got?.bill.id).toBe("bill1");
    expect(got?.matchedBy).toBe("token");
  });

  it("pays via a learned alias (matchedBy 'alias'), preferred over token-overlap", () => {
    const w = withdrawal({ descriptor: "XCEL ENERGY WEB PYMT 260718", amount: 90 });
    const aliasBill = bill({
      id: "electric",
      title: "Electric",
      amount: 90,
      bankDescriptorAliases: ["XCEL ENERGY WEB PYMT 260718"],
    });
    const got = pickBillToPay(w, [aliasBill]);
    expect(got?.bill.id).toBe("electric");
    expect(got?.matchedBy).toBe("alias");
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

  it("is unchanged by an empty or absent rule list", () => {
    const w = withdrawal({ descriptor: "COMCAST-XFINITY CABLE SVCS", amount: 153.95 });
    expect(pickBillToPay(w, [bill()], [])?.matchedBy).toBe("token");
    expect(pickBillToPay(w, [bill()], undefined)?.matchedBy).toBe("token");
  });
});

// A rule's `billId` is an explicit household declaration, so it is the strongest
// signal available — stronger than a learned alias, and strong enough to ignore
// the amount window that exists only to keep a GUESS from mis-paying a bill.
describe("pickBillToPay — merchant-rule billId tier", () => {
  const amexRule = (over: Partial<MerchantRule> = {}): MerchantRule => ({
    id: "r-amex",
    pattern: "AMERICAN EXPRESS ACH PMT",
    billId: "amex",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  const amexBill = (over: Partial<BillPayCandidate> = {}): BillPayCandidate =>
    bill({ id: "amex", title: "AmEx Payment", amount: 200, ...over });

  // The motivating case: token-overlap provably cannot match
  // "AMERICAN EXPRESS ACH PMT" to a bill titled "AmEx Payment" (no shared
  // significant token — "PMT"/"PAYMENT" are noise), and a statement balance
  // never lands inside ±10%/±$25 of last month's.
  it("pays a variable-amount bill token-overlap could never reach", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT 260720", amount: 1417.03 });
    expect(shareSignificantToken(w.descriptor, "AmEx Payment")).toBe(false);
    expect(billAmountWithinTolerance(200, 1417.03)).toBe(false);

    const got = pickBillToPay(w, [amexBill()], [amexRule()]);
    expect(got?.bill.id).toBe("amex");
    expect(got?.matchedBy).toBe("rule");
  });

  it("outranks a learned alias on a different bill", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 200 });
    const decoy = bill({
      id: "decoy",
      title: "Something Else",
      amount: 200,
      bankDescriptorAliases: ["AMERICAN EXPRESS ACH PMT"],
    });
    const got = pickBillToPay(w, [decoy, amexBill()], [amexRule()]);
    expect(got?.bill.id).toBe("amex");
    expect(got?.matchedBy).toBe("rule");
  });

  it("matches a recurring occurrence through its template id", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 999 });
    const occurrence = bill({
      id: "amex::2026-07-20",
      templateId: "amex",
      title: "AmEx Payment",
      amount: 200,
      isRecurringInstance: true,
    });
    const got = pickBillToPay(w, [occurrence], [amexRule()]);
    expect(got?.bill.id).toBe("amex::2026-07-20");
    expect(got?.matchedBy).toBe("rule");
  });

  // Two unpaid occurrences of the same template (an overdue one plus this
  // month's) cannot be told apart, and the strongest signal being ambiguous is
  // no licence for a weaker one to decide.
  it("returns null when the rule names two payable occurrences", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 200 });
    const june = bill({
      id: "amex::2026-06-20",
      templateId: "amex",
      title: "AmEx Payment",
      amount: 200,
      isRecurringInstance: true,
    });
    const july = bill({
      id: "amex::2026-07-20",
      templateId: "amex",
      title: "AmEx Payment",
      amount: 200,
      isRecurringInstance: true,
    });
    expect(pickBillToPay(w, [june, july], [amexRule()])).toBeNull();
  });

  // "This descriptor IS that bill", not "pay something regardless".
  it("falls through to alias/token when the named bill isn't payable", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 153.95 });
    const comcast = bill({ title: "Comcast Internet", amount: 153.95 });
    // The AmEx bill is absent from the pool (already paid, or out of window).
    const got = pickBillToPay(w, [comcast], [
      amexRule({ pattern: "AMERICAN", billId: "amex" }),
    ]);
    expect(got).toBeNull(); // no token overlap with Comcast either

    const withOverlap = withdrawal({ descriptor: "AMERICAN EXPRESS COMCAST", amount: 153.95 });
    expect(pickBillToPay(withOverlap, [comcast], [amexRule({ pattern: "AMERICAN" })])?.matchedBy)
      .toBe("token");
  });

  it("ignores a matching rule that carries no billId", () => {
    const w = withdrawal({ descriptor: "COMCAST-XFINITY CABLE SVCS", amount: 153.95 });
    const renameOnly: MerchantRule = {
      id: "r-comcast",
      pattern: "COMCAST",
      name: "Comcast",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(pickBillToPay(w, [bill()], [renameOnly])?.matchedBy).toBe("token");
  });

  // The rule engine's own precedence still applies: an amount-qualified rule
  // wins, so one descriptor can route two different amounts to two bills.
  it("honours the rule engine's specificity when two rules match", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 45 });
    const pinned = amexRule({
      id: "r-pinned",
      pattern: "AMERICAN EXPRESS",
      amount: 45,
      billId: "amex-fee",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    const fee = bill({ id: "amex-fee", title: "AmEx annual fee", amount: 45 });
    const got = pickBillToPay(w, [amexBill(), fee], [amexRule(), pinned]);
    expect(got?.bill.id).toBe("amex-fee");
    expect(got?.matchedBy).toBe("rule");
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
      expect(decision.match.matchedBy).toBe("token");
    }
  });

  // Rules reach step (d) only. Steps a-c ask an IDENTITY question, and identity
  // is answered from the raw bank descriptor alone — a user-editable label must
  // never decide whether two rows are the same purchase.
  it("d. a rule's billId does not pre-empt dedup, stub-fill or confirm", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 18.86 });
    const rules: MerchantRule[] = [
      { id: "r", pattern: "AMERICAN EXPRESS", billId: "bill1", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const billCandidates = [bill({ amount: 18.86 })];

    expect(
      decideWithdrawal({
        ...emptyDecideBase,
        withdrawal: w,
        existingBankRefs: new Set([w.bankRef]),
        billCandidates,
        merchantRules: rules,
      })
    ).toEqual({ kind: "skip_bankref" });

    expect(
      decideWithdrawal({
        ...emptyDecideBase,
        withdrawal: w,
        stubs: [stub()],
        billCandidates,
        merchantRules: rules,
      })
    ).toEqual({ kind: "fill_stub", stubId: "stub1" });

    expect(
      decideWithdrawal({
        ...emptyDecideBase,
        withdrawal: w,
        pendingCandidates: [pending()],
        billCandidates,
        merchantRules: rules,
      })
    ).toEqual({ kind: "confirm_pending", transactionId: "txn1" });
  });

  it("d. pays the rule's bill when nothing earlier claims the withdrawal", () => {
    const w = withdrawal({ descriptor: "AMERICAN EXPRESS ACH PMT", amount: 1417.03 });
    const decision = decideWithdrawal({
      ...emptyDecideBase,
      withdrawal: w,
      billCandidates: [bill({ id: "amex", title: "AmEx Payment", amount: 200 })],
      merchantRules: [
        { id: "r", pattern: "AMERICAN EXPRESS", billId: "amex", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    expect(decision.kind).toBe("pay_bill");
    if (decision.kind === "pay_bill") {
      expect(decision.match.bill.id).toBe("amex");
      expect(decision.match.matchedBy).toBe("rule");
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

describe("buildBalanceUpdate", () => {
  it("returns an absolute balance overwrite (never an increment)", () => {
    expect(buildBalanceUpdate(1165.82)).toEqual({ balance: 1165.82 });
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

describe("emailAddsNothingNew", () => {
  it("returns true for zero withdrawals + cent-exact matching balances (the production regression)", () => {
    // Real evidence: Fri available=949.51 ending=949.51 applied; Sun email had 0
    // withdrawals and the identical figures — should be recognized as a no-op.
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: 949.51,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(true);
  });

  it("does NOT skip when zero withdrawals but the available balance differs", () => {
    // A quiet day can still see the available balance move (a deposit lands, a
    // card hold drops off) — that movement must still be applied.
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 975.0,
        incomingEnding: 949.51,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("does NOT skip when zero withdrawals but the ending balance differs", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: 900.0,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("does NOT skip when withdrawals are present, even with identical balances", () => {
    // Zero withdrawals is a required condition, not just a common case — a real
    // day with matching net balances but actual withdrawal activity must apply.
    expect(
      emailAddsNothingNew({
        withdrawalCount: 3,
        incomingAvailable: 949.51,
        incomingEnding: 949.51,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("does NOT skip when storedAvailable is undefined (never synced under this scheme)", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: 949.51,
        storedAvailable: undefined,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("does NOT skip when storedEnding is undefined (never synced under this scheme)", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: 949.51,
        storedAvailable: 949.51,
        storedEnding: undefined,
      })
    ).toBe(false);
  });

  it("does NOT skip when both stored figures are undefined (first sync ever)", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: 949.51,
        storedAvailable: undefined,
        storedEnding: undefined,
      })
    ).toBe(false);
  });

  it("treats float-reconstructed amounts as equal (cent comparison, not ===)", () => {
    const reconstructed = 0.1 + 0.2 + 949.21; // classic float-drift construction
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: reconstructed,
        incomingEnding: 949.51,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(true);
  });

  // Regression: cents() (used elsewhere in this file) is sign-insensitive
  // (Math.abs), which is harmless for its existing amount-only callers but
  // would be a real bug here — a balance can genuinely be negative
  // (toSignedDollars in bankEmailParser.ts parses "($50.00)" / "-$50.00" for
  // an overdrawn account), so +X must never compare equal to -X.
  it("does NOT skip when the stored available balance is positive but the incoming one is the same magnitude negative", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: -949.51,
        incomingEnding: 949.51,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("does NOT skip on the mirrored sign-flip (stored negative, incoming positive)", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: 949.51,
        storedAvailable: -949.51,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("does NOT skip on a sign-flip of the ENDING balance alone (available equal)", () => {
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: 949.51,
        incomingEnding: -949.51,
        storedAvailable: 949.51,
        storedEnding: 949.51,
      })
    ).toBe(false);
  });

  it("DOES skip when both figures are genuinely negative and equal (a real overdrawn repeat)", () => {
    // The guard must still work for an overdrawn account whose balance
    // genuinely hasn't moved — the fix must not make it never fire on
    // negatives, only stop it from treating +X and -X as equal.
    expect(
      emailAddsNothingNew({
        withdrawalCount: 0,
        incomingAvailable: -50.0,
        incomingEnding: -50.0,
        storedAvailable: -50.0,
        storedEnding: -50.0,
      })
    ).toBe(true);
  });
});
