import { describe, expect, it } from "vitest";
import {
  BUDGETED_IN_CALENDAR,
  CREDIT_CARD_CATEGORY,
  INCOME_CATEGORY,
  isoDayOfWeek,
  shouldDeclareToNoSpend,
  spendExemption,
  unplannedSpend,
  wasNoSpendDay,
  weekendPartnerDate,
  type SpendCandidate,
} from "./noSpendDay";

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
