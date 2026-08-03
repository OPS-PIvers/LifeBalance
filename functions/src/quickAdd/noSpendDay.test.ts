import { describe, expect, it } from "vitest";
import {
  BUDGETED_IN_CALENDAR,
  CREDIT_CARD_CATEGORY,
  INCOME_CATEGORY,
  MAX_NO_SPEND_CATCHUP_DAYS,
  datesToJudge,
  isoDayOfWeek,
  noSpendCatchupWindow,
  shouldDeclareToNoSpend,
  spendExemption,
  unplannedSpend,
  wasNoSpendDay,
  weekendPartnerDate,
  type SpendCandidate,
} from "./noSpendDay";
import type { MerchantRule } from "./merchantRules";

const tx = (over: Partial<SpendCandidate> = {}): SpendCandidate => ({
  amount: 12.34,
  merchant: "TARGET T-2189",
  category: "Groceries",
  ...over,
});

describe("spendExemption", () => {
  it("counts an ordinary purchase as unplanned spend", () => {
    expect(spendExemption(tx())).toBeNull();
  });

  it("exempts income", () => {
    expect(spendExemption(tx({ category: INCOME_CATEGORY }))).toBe("income");
  });

  // The settled rule: autopay you set up months ago isn't a decision you made
  // today, so it must not disqualify the day.
  it("exempts a bill the sync matched to a calendar item", () => {
    expect(spendExemption(tx({ category: BUDGETED_IN_CALENDAR }))).toBe("bill");
  });

  it("exempts a credit-card payment, by flag or by category", () => {
    expect(spendExemption(tx({ creditPayment: true }))).toBe("card-payment");
    expect(spendExemption(tx({ category: CREDIT_CARD_CATEGORY }))).toBe("card-payment");
  });

  it("exempts a transfer between the user's own accounts", () => {
    expect(
      spendExemption(tx({ merchant: "ONLINE TRANSFER TO IVERS,PAUL SAVINGS REF #IB0123" }))
    ).toBe("transfer");
    expect(spendExemption(tx({ merchant: "Transfer to savings" }))).toBe("transfer");
  });

  // The word boundary would otherwise reject the plural outright — a silent miss.
  it("exempts a plural transfer descriptor too", () => {
    expect(spendExemption(tx({ merchant: "ONLINE TRANSFERS TO SAVINGS" }))).toBe("transfer");
  });

  // Word-bounded, so a merchant that merely CONTAINS the letters doesn't slip
  // through as a transfer.
  it("does not treat a merchant with 'transferred' inside it as a transfer", () => {
    expect(spendExemption(tx({ merchant: "TRANSFERRED GOODS CO" }))).toBeNull();
  });

  it("exempts a zero-amount row that isn't a pending stub", () => {
    expect(spendExemption(tx({ amount: 0 }))).toBe("zero-amount");
    expect(spendExemption(tx({ amount: Number.NaN }))).toBe("zero-amount");
  });

  // An Apple Pay pre-authorization stub is a real purchase whose amount just
  // isn't known yet — it MUST break the day, or every Apple Pay day would read
  // as no-spend until the bank notification lands.
  it("counts a $0 Apple Pay stub as spend", () => {
    expect(spendExemption(tx({ amount: 0, needsAmount: true }))).toBeNull();
  });

  // A credit-card CHARGE is ordinary spend — only a payment is exempt. This is
  // what stops the habit being satisfiable by reaching for a different card.
  it("counts a credit-card charge as spend", () => {
    expect(spendExemption(tx({ merchant: "AMAZON MKTPL", creditPayment: false }))).toBeNull();
  });
});

describe("spendExemption — merchant rules", () => {
  const rule = (over: Partial<MerchantRule> = {}): MerchantRule => ({
    id: "r1",
    pattern: "SPOTIFY",
    exempt: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  // The whole point: the caller passing no rules must behave EXACTLY as it did
  // before rules existed.
  it("changes nothing when no rules are passed", () => {
    expect(spendExemption(tx({ merchant: "SPOTIFY USA" }))).toBeNull();
    expect(spendExemption(tx({ merchant: "SPOTIFY USA" }), [])).toBeNull();
    expect(spendExemption(tx({ merchant: "SPOTIFY USA" }), undefined)).toBeNull();
  });

  it("exempts a charge an exempt rule claims", () => {
    expect(spendExemption(tx({ merchant: "SPOTIFY USA 8005851234" }), [rule()])).toBe(
      "merchant-rule"
    );
  });

  // A cleanup rule must not become a silent no-spend loophole.
  it("does not exempt for a rename- or category-only rule", () => {
    const rename = rule({ exempt: undefined, name: "Spotify", category: "Entertainment" });
    expect(spendExemption(tx({ merchant: "SPOTIFY USA" }), [rename])).toBeNull();
    const explicitlyFalse = rule({ exempt: false });
    expect(spendExemption(tx({ merchant: "SPOTIFY USA" }), [explicitlyFalse])).toBeNull();
  });

  // Only ONE rule ever wins (rules carry side-effects; merging them would
  // produce combinations nobody authored), so a more specific non-exempt rule
  // legitimately takes the exemption away.
  it("honours rule precedence: the winning rule alone decides", () => {
    const broad = rule({ id: "broad", pattern: "SPOTIFY", exempt: true });
    const pinned = rule({
      id: "pinned",
      pattern: "SPOTIFY",
      amount: 19.99,
      exempt: false,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    expect(spendExemption(tx({ merchant: "SPOTIFY USA", amount: 19.99 }), [broad, pinned])).toBeNull();
    expect(spendExemption(tx({ merchant: "SPOTIFY USA", amount: 11.99 }), [broad, pinned])).toBe(
      "merchant-rule"
    );
  });

  it("matches the RAW stored merchant, punctuation and all", () => {
    const apple = rule({ pattern: "APPLE.COM/BILL" });
    expect(spendExemption(tx({ merchant: "APPLE.COM/BILL 866-712-7753 CA" }), [apple])).toBe(
      "merchant-rule"
    );
    expect(spendExemption(tx({ merchant: "APPLECOM BILL" }), [apple])).toBeNull();
  });

  // A blank pattern is an unfinished draft, not a wildcard — otherwise one empty
  // rule would exempt the entire ledger and make every day a no-spend day.
  it("never exempts everything on a blank pattern", () => {
    expect(spendExemption(tx({ merchant: "LIFE CAFE #238" }), [rule({ pattern: "  " })])).toBeNull();
  });

  // A structural reason is more informative than "the user said so".
  it("reports a structural exemption ahead of the rule", () => {
    expect(spendExemption(tx({ merchant: "SPOTIFY", category: INCOME_CATEGORY }), [rule()])).toBe(
      "income"
    );
  });

  // An exempt rule applies to the row, whatever its amount — including a $0
  // Apple Pay stub, which would otherwise count as spend.
  it("exempts an Apple Pay stub the household has declared planned", () => {
    const stub = tx({ merchant: "SPOTIFY USA", amount: 0, needsAmount: true });
    expect(spendExemption(stub)).toBeNull();
    expect(spendExemption(stub, [rule()])).toBe("merchant-rule");
  });
});

describe("wasNoSpendDay", () => {
  it("is true for a day with nothing at all", () => {
    expect(wasNoSpendDay([])).toBe(true);
  });

  it("is true for a day whose only activity was a bill and a transfer", () => {
    expect(
      wasNoSpendDay([
        tx({ category: BUDGETED_IN_CALENDAR, merchant: "COMCAST-XFINITY" }),
        tx({ merchant: "ONLINE TRANSFER TO SAVINGS" }),
      ])
    ).toBe(true);
  });

  it("is false as soon as one unplanned purchase lands", () => {
    expect(
      wasNoSpendDay([tx({ category: BUDGETED_IN_CALENDAR }), tx({ merchant: "LIFE CAFE #238" })])
    ).toBe(false);
  });

  it("reports which rows disqualified the day", () => {
    const blocked = unplannedSpend([
      tx({ category: BUDGETED_IN_CALENDAR, merchant: "COMCAST" }),
      tx({ merchant: "LIFE CAFE #238" }),
      tx({ merchant: "MAVERIK #5267" }),
    ]);
    expect(blocked.map((b) => b.merchant)).toEqual(["LIFE CAFE #238", "MAVERIK #5267"]);
  });

  // The reason a rule exemption has to reach the loaded rows and not just the
  // in-flight withdrawal: an exempted subscription lands as an ordinary stored
  // transaction, and must stop breaking the day on every later sync too.
  it("lets an exempt rule rescue a day an already-stored charge would break", () => {
    const rules: MerchantRule[] = [
      { id: "r", pattern: "SPOTIFY", exempt: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const day = [tx({ merchant: "SPOTIFY USA 8005851234", amount: 11.99 })];
    expect(wasNoSpendDay(day)).toBe(false);
    expect(wasNoSpendDay(day, rules)).toBe(true);
    expect(unplannedSpend(day, rules)).toEqual([]);
  });

  it("still fails the day for an unexempted charge alongside an exempted one", () => {
    const rules: MerchantRule[] = [
      { id: "r", pattern: "SPOTIFY", exempt: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const blocked = unplannedSpend(
      [tx({ merchant: "SPOTIFY USA" }), tx({ merchant: "LIFE CAFE #238" })],
      rules
    );
    expect(blocked.map((b) => b.merchant)).toEqual(["LIFE CAFE #238"]);
  });
});

describe("shouldDeclareToNoSpend", () => {
  const TARGET = "2026-07-24";

  it("declares a brand-new row landing on the judged day", () => {
    expect(shouldDeclareToNoSpend("create", TARGET, TARGET)).toBe(true);
  });

  it("declares nothing dated to another day", () => {
    expect(shouldDeclareToNoSpend("create", "2026-07-23", TARGET)).toBe(false);
  });

  // Review catch (#1098): every non-create decision resolves to a row that
  // ALREADY carries its own category and `creditPayment` flag. A bare
  // re-declaration can only guess `Uncategorized`, so the un-exempt duplicate
  // would disqualify a day the real row is exempt from — a confirmed
  // credit-card payment being the concrete case. Duplication is only harmless
  // when both copies agree about exemption, which a re-declaration can't ensure.
  it.each(["skip_bankref", "fill_stub", "confirm_pending", "pay_bill"] as const)(
    "never re-declares a %s decision, whose existing row is authoritative",
    (kind) => {
      expect(shouldDeclareToNoSpend(kind, TARGET, TARGET)).toBe(false);
    }
  );
});

describe("weekend rule", () => {
  // 2026-07-25 is a Saturday, 2026-07-26 a Sunday.
  it("maps yyyy-MM-dd to an ISO day-of-week", () => {
    expect(isoDayOfWeek("2026-07-20")).toBe(1); // Monday
    expect(isoDayOfWeek("2026-07-25")).toBe(6); // Saturday
    expect(isoDayOfWeek("2026-07-26")).toBe(7); // Sunday
  });

  it("pairs a Sunday with the Saturday before it", () => {
    expect(weekendPartnerDate("2026-07-26")).toBe("2026-07-25");
  });

  // The weekend can only be settled once Sunday is over, so every other day of
  // the week has no partner and the weekend trigger simply doesn't apply.
  it("has no partner for any day that isn't a Sunday", () => {
    for (const notSunday of ["2026-07-20", "2026-07-21", "2026-07-24", "2026-07-25"]) {
      expect(weekendPartnerDate(notSunday)).toBeNull();
    }
  });

  it("crosses a month boundary correctly", () => {
    // 2026-08-02 is a Sunday; its Saturday is in July.
    expect(isoDayOfWeek("2026-08-02")).toBe(7);
    expect(weekendPartnerDate("2026-08-02")).toBe("2026-08-01");
  });
});

describe("multi-day catch-up window", () => {
  // Four, not three: a holiday Monday (no email at all that day) leaves
  // Saturday/Sunday/Monday/Tuesday all unjudged by the time the next email
  // arrives on Wednesday — a 3-day window would silently drop Saturday, which
  // is the exact bug this whole mechanism exists to remove (the "Clean
  // weekend" habit can never fire without a Saturday verdict).
  it("is 4", () => {
    expect(MAX_NO_SPEND_CATCHUP_DAYS).toBe(4);
  });

  describe("noSpendCatchupWindow", () => {
    it("returns asOf-4 through asOf-1, ascending", () => {
      // 2026-07-25 is a Saturday, 2026-07-26 a Sunday, 2026-07-27 a (holiday)
      // Monday, 2026-07-28 a Tuesday; 2026-07-29 is the Wednesday email.
      expect(noSpendCatchupWindow("2026-07-29")).toEqual([
        "2026-07-25",
        "2026-07-26",
        "2026-07-27",
        "2026-07-28",
      ]);
    });

    it("honours a caller-supplied maxDays", () => {
      expect(noSpendCatchupWindow("2026-07-29", 2)).toEqual(["2026-07-27", "2026-07-28"]);
      expect(noSpendCatchupWindow("2026-07-29", 1)).toEqual(["2026-07-28"]);
    });

    it("crosses a month boundary correctly", () => {
      expect(noSpendCatchupWindow("2026-08-02")).toEqual([
        "2026-07-29",
        "2026-07-30",
        "2026-07-31",
        "2026-08-01",
      ]);
    });
  });

  describe("datesToJudge", () => {
    const ASOF = "2026-07-29";
    const FULL_WINDOW = ["2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28"];

    it("judges the whole window when nothing has been judged yet", () => {
      expect(datesToJudge(ASOF, new Set())).toEqual(FULL_WINDOW);
    });

    // The Saturday+Sunday case the whole fix is for: Saturday already has a
    // verdict (an earlier email settled it), so only the remaining days are
    // judged — and Sunday is NOT silently dropped.
    it("skips only the days that already have a verdict, keeping the rest ascending", () => {
      expect(datesToJudge(ASOF, new Set(["2026-07-25"]))).toEqual([
        "2026-07-26",
        "2026-07-27",
        "2026-07-28",
      ]);
      expect(datesToJudge(ASOF, new Set(["2026-07-25", "2026-07-27"]))).toEqual([
        "2026-07-26",
        "2026-07-28",
      ]);
    });

    it("judges nothing when every candidate day is already settled", () => {
      expect(datesToJudge(ASOF, new Set(FULL_WINDOW))).toEqual([]);
    });

    // A day outside the window doesn't accidentally suppress anything inside it.
    it("ignores an already-judged date that isn't in the window", () => {
      expect(datesToJudge(ASOF, new Set(["2026-06-01"]))).toEqual(FULL_WINDOW);
    });

    it("honours a caller-supplied maxDays", () => {
      expect(datesToJudge(ASOF, new Set(), 2)).toEqual(["2026-07-27", "2026-07-28"]);
    });
  });
});
