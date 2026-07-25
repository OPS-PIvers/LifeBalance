import { describe, expect, it } from "vitest";
import { parseBankEmail, type BankEmailParseSuccess } from "./bankEmailParser";

const TODAY = "2026-07-21";

const PLAIN_BODY = `
WELLS FARGO
Here's the rundown
for account ...5581
Go to accounts
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
Withdrawals
PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115 $18.86
PURCHASE AUTHORIZED ON 07/19 Prime Video *J31V5 888-802-3080 WA S586201045503252 CARD 2115 $4.33
PURCHASE AUTHORIZED ON 07/19 TARGET T-0260 St Louis Park MN P000000853534827 CARD 7752 $11.40
AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
PURCHASE AUTHORIZED ON 07/17 LIFE CAFE #238 868-284-0048 IA S586199011025054 CARD 2115 $43.92
COMCAST-XFINITY CABLE SVCS 260718 0078881 JENNIFER *KING $153.95
PURCHASE AUTHORIZED ON 07/18 Amazon Digit*GU3AS 888-802-3080 WA S466199693062593 CARD 2115 $7.59
PURCHASE AUTHORIZED ON 07/18 AMAZON RETA* 845X5 WWW.AMAZON.CO WA S306200073738566 CARD 2115 $16.17
PURCHASE AUTHORIZED ON 07/17 LIFE CAFE #238 868-284-0048 IA S346198753939041 CARD 2115 $24.35
PURCHASE AUTHORIZED ON 07/19 MAVERIK #5267 URBANDALE IA P356200544262554 CARD 2115 $42.94
PURCHASE AUTHORIZED ON 07/16 AMAZON MKTPL*4S5DE Amzn.com/bill WA S356197815097359 CARD 2115 $13.47
PURCHASE AUTHORIZED ON 07/17 LIFE CAFE #238 868-284-0048 IA S386198749871884 CARD 2115 $41.21
As of 07/21/2026 at 01:50 a.m., Central Time
`;

// A plausible HTML rendering: table-layout cells put the amount in a
// separate <td>, on its own line once tags are stripped.
const HTML_BODY = `
<html><body>
<div>WELLS FARGO</div>
<div>Here's the rundown</div>
<div>for account ...5581</div>
<a href="#">Go to accounts</a>
<h2>Balance summary</h2>
<table>
<tr><td>Ending balance:</td><td>$1,277.90</td></tr>
<tr><td>Available balance<sup>1</sup>:</td><td>$1,165.82</td></tr>
</table>
<h2>Withdrawals</h2>
<table>
<tr><td>PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115</td><td>$18.86</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/19 Prime Video *J31V5 888-802-3080 WA S586201045503252 CARD 2115</td><td>$4.33</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/19 TARGET T-0260 St Louis Park MN P000000853534827 CARD 7752</td><td>$11.40</td></tr>
<tr><td>AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS</td><td>$372.00</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/17 LIFE CAFE #238 868-284-0048 IA S586199011025054 CARD 2115</td><td>$43.92</td></tr>
<tr><td>COMCAST-XFINITY CABLE SVCS 260718 0078881 JENNIFER *KING</td><td>$153.95</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/18 Amazon Digit*GU3AS 888-802-3080 WA S466199693062593 CARD 2115</td><td>$7.59</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/18 AMAZON RETA* 845X5 WWW.AMAZON.CO WA S306200073738566 CARD 2115</td><td>$16.17</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/17 LIFE CAFE #238 868-284-0048 IA S346198753939041 CARD 2115</td><td>$24.35</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/19 MAVERIK #5267 URBANDALE IA P356200544262554 CARD 2115</td><td>$42.94</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/16 AMAZON MKTPL*4S5DE Amzn.com/bill WA S356197815097359 CARD 2115</td><td>$13.47</td></tr>
<tr><td>PURCHASE AUTHORIZED ON 07/17 LIFE CAFE #238 868-284-0048 IA S386198749871884 CARD 2115</td><td>$41.21</td></tr>
</table>
<div>As of 07/21/2026 at 01:50 a.m., Central Time</div>
</body></html>
`;

function byRef(result: BankEmailParseSuccess, ref: string) {
  const w = result.withdrawals.find((x) => x.bankRef === ref);
  if (!w) throw new Error(`No withdrawal with bankRef ${ref}`);
  return w;
}

describe("parseBankEmail", () => {
  it.each([
    ["plain text", PLAIN_BODY],
    ["HTML", HTML_BODY],
  ])("parses the real Wells Fargo fixture (%s)", (_label, rawBody) => {
    const result = parseBankEmail({
      subject: "Your account update is here",
      rawBody,
      today: TODAY,
    });
    if ("error" in result) {
      throw new Error(`Expected success, got error: ${result.error}`);
    }

    expect(result.accountLast4).toBe("5581");
    expect(result.endingBalance).toBeCloseTo(1277.9, 2);
    expect(result.availableBalance).toBeCloseTo(1165.82, 2);
    expect(result.asOf).toBe("2026-07-21");
    expect(result.withdrawals).toHaveLength(12);

    // All cards seen.
    const cards = new Set(result.withdrawals.map((w) => w.cardLast4).filter(Boolean));
    expect(cards).toEqual(new Set(["2115", "7752"]));

    // Card purchases: exact amount/date/card/ref for each.
    expect(byRef(result, "P000000551051569")).toMatchObject({
      descriptor: expect.stringContaining("TARGET T-2189"),
      amount: 18.86,
      date: "2026-07-20",
      cardLast4: "2115",
    });
    expect(byRef(result, "S586201045503252")).toMatchObject({
      descriptor: expect.stringContaining("Prime Video"),
      amount: 4.33,
      date: "2026-07-19",
      cardLast4: "2115",
    });
    expect(byRef(result, "P000000853534827")).toMatchObject({
      descriptor: expect.stringContaining("TARGET T-0260"),
      amount: 11.4,
      date: "2026-07-19",
      cardLast4: "7752",
    });
    expect(byRef(result, "S586199011025054")).toMatchObject({
      descriptor: expect.stringContaining("LIFE CAFE #238"),
      amount: 43.92,
      date: "2026-07-17",
      cardLast4: "2115",
    });
    expect(byRef(result, "S466199693062593")).toMatchObject({
      amount: 7.59,
      date: "2026-07-18",
      cardLast4: "2115",
    });
    expect(byRef(result, "S306200073738566")).toMatchObject({
      amount: 16.17,
      date: "2026-07-18",
      cardLast4: "2115",
    });
    expect(byRef(result, "S346198753939041")).toMatchObject({
      amount: 24.35,
      date: "2026-07-17",
      cardLast4: "2115",
    });
    expect(byRef(result, "P356200544262554")).toMatchObject({
      amount: 42.94,
      date: "2026-07-19",
      cardLast4: "2115",
    });
    expect(byRef(result, "S356197815097359")).toMatchObject({
      amount: 13.47,
      date: "2026-07-16",
      cardLast4: "2115",
    });
    expect(byRef(result, "S386198749871884")).toMatchObject({
      amount: 41.21,
      date: "2026-07-17",
      cardLast4: "2115",
    });

    // ACH/biller lines: synthetic bankRef, no cardLast4, date from YYMMDD token.
    const amex = result.withdrawals.find((w) => w.descriptor.includes("AMERICAN EXPRESS"));
    if (!amex) throw new Error("expected an AMERICAN EXPRESS withdrawal");
    expect(amex).toMatchObject({
      amount: 372.0,
      date: "2026-07-20",
    });
    expect(amex.cardLast4).toBeUndefined();
    expect(amex.bankRef).toMatch(/^synth:[0-9a-f]{8}$/);

    const comcast = result.withdrawals.find((w) => w.descriptor.includes("COMCAST"));
    if (!comcast) throw new Error("expected a COMCAST withdrawal");
    expect(comcast).toMatchObject({
      amount: 153.95,
      date: "2026-07-18",
    });
    expect(comcast.cardLast4).toBeUndefined();
    expect(comcast.bankRef).toMatch(/^synth:[0-9a-f]{8}$/);
    expect(comcast.bankRef).not.toBe(amex.bankRef);
  });

  it("produces a stable, deterministic synth: ref for the same ACH line across parses", () => {
    const result1 = parseBankEmail({ subject: "x", rawBody: PLAIN_BODY, today: TODAY });
    const result2 = parseBankEmail({ subject: "x", rawBody: PLAIN_BODY, today: TODAY });
    if ("error" in result1 || "error" in result2) throw new Error("expected success");
    const amex1 = result1.withdrawals.find((w) => w.descriptor.includes("AMERICAN EXPRESS"));
    const amex2 = result2.withdrawals.find((w) => w.descriptor.includes("AMERICAN EXPRESS"));
    expect(amex1!.bankRef).toBe(amex2!.bankRef);
  });

  it("resolves a future-looking MM/DD to the PREVIOUS year (statement year-boundary)", () => {
    // "today" is early January; a withdrawal dated 12/30 must resolve to
    // December of the PRIOR year, not a future December this year.
    const body = `
for account ...1234
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
PURCHASE AUTHORIZED ON 12/30 SOME MERCHANT P000000000000001 CARD 1111 $9.99
As of 01/02/2027 at 09:00 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: "2027-01-02" });
    if ("error" in result) throw new Error(result.error);
    expect(result.withdrawals[0]?.date).toBe("2026-12-30");
  });

  it("boundary: an MM/DD only 1 day 'in the future' of today is NOT rolled back a year (±skew tolerance)", () => {
    // A caller-supplied or UTC-fallback "today" can be off by roughly a day
    // relative to the withdrawal's true local date (the fallbackToday
    // footgun the reviewer flagged). Without tolerance, a strict "> today"
    // future check would treat this 1-day-out MM/DD as "in the future" and
    // wrongly roll it back a full year to 2025-07-21. With the ±2-day
    // tolerance it correctly stays in the current year.
    const body = `
for account ...1234
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
PURCHASE AUTHORIZED ON 07/21 SOME MERCHANT P000000000000001 CARD 1111 $9.99
As of 07/20/2026 at 09:00 p.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: "2026-07-20" });
    if ("error" in result) throw new Error(result.error);
    expect(result.withdrawals[0]?.date).toBe("2026-07-21");
  });

  it("boundary: an MM/DD more than 2 days in the future still rolls back a year", () => {
    // Beyond the ±2-day skew tolerance, this is unambiguously the statement
    // year-boundary case (or bad data), not clock skew — must still roll
    // back to the previous year rather than reporting an impossible future
    // withdrawal date.
    const body = `
for account ...1234
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
PURCHASE AUTHORIZED ON 07/23 SOME MERCHANT P000000000000001 CARD 1111 $9.99
As of 07/20/2026 at 09:00 p.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: "2026-07-20" });
    if ("error" in result) throw new Error(result.error);
    expect(result.withdrawals[0]?.date).toBe("2025-07-23");
  });

  it("returns a structured error (never throws) on garbage input", () => {
    expect(() =>
      parseBankEmail({ subject: "junk", rawBody: "<div>not a bank email at all</div>" })
    ).not.toThrow();
    const result = parseBankEmail({ subject: "junk", rawBody: "<div>not a bank email at all</div>" });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("returns a structured error when balances are missing", () => {
    const result = parseBankEmail({
      subject: "x",
      rawBody: "for account ...5581\nWithdrawals\nno amounts here",
    });
    expect("error" in result).toBe(true);
  });

  it("errors on an empty Withdrawals section with no \"As of\" footer (truncated body)", () => {
    // No footer ⇒ we cannot prove we saw the whole email, so an absent
    // withdrawal list might be content that was clipped rather than a
    // no-spend night. See the truncation rule in parseBankEmail.
    const result = parseBankEmail({
      subject: "x",
      rawBody: "for account ...5581\nEnding balance: $1.00\nAvailable balance1: $1.00\nWithdrawals\n",
    });
    expect("error" in result).toBe(true);
  });

  it("reviewer repro: a missing Withdrawals section never fabricates withdrawals from the balance lines", () => {
    // With no "Withdrawals" header, the ORIGINAL code fell back to scanning the
    // ENTIRE email body as the withdrawals section — so ACH_LINE_RE (any line
    // starting with a capital letter and ending in $amount) could match the
    // Balance-summary lines themselves and fabricate withdrawals out of
    // "Ending balance: $1,277.90" / "Available balance: $1,165.82".
    //
    // This body is now recognized as a NO-SPEND night (see the test below), so
    // the outcome flipped from error to success — but the fabrication this test
    // exists to catch must still never happen, whichever way the parse goes.
    const body = `
for account ...5581
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    if ("error" in result) throw new Error(`expected a parse, got: ${result.error}`);
    expect(result.withdrawals).toEqual([]);
    const fabricated = result.withdrawals.find((w) =>
      w.descriptor.toLowerCase().includes("balance")
    );
    expect(fabricated).toBeUndefined();
  });

  describe("a no-spend night (no Withdrawals section at all)", () => {
    // The real thing, transcribed from the 2026-07-25 email that produced a
    // spurious "Bank sync failed" push: balance summary, footer, nothing else.
    const NO_SPEND_BODY = `
WELLS FARGO
Here's the rundown
for account ...5581
Go to accounts
Balance summary
Ending balance: $949.51
Available balance1: $949.51
As of 07/25/2026 at 03:19 a.m., Central Time
WellsFargo.com
Note about balances: Ending daily balance reflects transactions that have posted to your account and does not reflect pending deposits or withdrawals. The available balance is an indication of funds that are available to you today; however, it may not reflect all transactions that you may have initiated or authorized.
`;

    it("parses as a success with zero withdrawals", () => {
      const result = parseBankEmail({
        subject: "Your account update",
        rawBody: NO_SPEND_BODY,
        today: "2026-07-25",
      });
      if ("error" in result) throw new Error(`expected a parse, got: ${result.error}`);
      expect(result.withdrawals).toEqual([]);
      expect(result.accountLast4).toBe("5581");
      expect(result.endingBalance).toBe(949.51);
      expect(result.availableBalance).toBe(949.51);
      expect(result.asOf).toBe("2026-07-25");
    });

    // The disclaimer paragraph contains the words "deposits or withdrawals" —
    // it must not be mistaken for the section header (which is matched
    // line-anchored) nor for a withdrawal line.
    it("is not confused by the word \"withdrawals\" in the balance disclaimer", () => {
      const result = parseBankEmail({
        subject: "x",
        rawBody: NO_SPEND_BODY,
        today: "2026-07-25",
      });
      if ("error" in result) throw new Error(`expected a parse, got: ${result.error}`);
      expect(result.withdrawals).toEqual([]);
    });

    it("parses the HTML rendering the same way", () => {
      const html = `
<html><body>
<div>WELLS FARGO</div>
<div>for account ...5581</div>
<h2>Balance summary</h2>
<table>
<tr><td>Ending balance:</td><td>$949.51</td></tr>
<tr><td>Available balance<sup>1</sup>:</td><td>$949.51</td></tr>
</table>
<div>As of 07/25/2026 at 03:19 a.m., Central Time</div>
</body></html>
`;
      const result = parseBankEmail({ subject: "x", rawBody: html, today: "2026-07-25" });
      if ("error" in result) throw new Error(`expected a parse, got: ${result.error}`);
      expect(result.withdrawals).toEqual([]);
      expect(result.availableBalance).toBe(949.51);
    });

    // The two guards that keep "zero withdrawals" from swallowing a real
    // failure. Both of these must stay LOUD: reporting a no-spend day for an
    // email we actually failed to read would lose money data and credit a
    // habit that was never earned.
    it("still errors when the body is truncated before the withdrawals (no footer)", () => {
      const truncated = `
for account ...5581
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
`;
      const result = parseBankEmail({ subject: "x", rawBody: truncated, today: TODAY });
      expect("error" in result).toBe(true);
    });

    it("still errors when withdrawal lines are present under a renamed section", () => {
      const renamed = `
for account ...5581
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
Withdrawals/Debits
PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115 $18.86
As of 07/21/2026 at 01:50 a.m., Central Time
`;
      const result = parseBankEmail({ subject: "x", rawBody: renamed, today: TODAY });
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error.toLowerCase()).toContain("format");
      }
    });

    it("still errors when a recurring-payment line hides under a renamed section", () => {
      const renamed = `
for account ...5581
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
Debits
RECURRING PAYMENT AUTHORIZED ON 07/01 NETFLIX.COM P000000551051570 CARD 2115 $15.99
As of 07/21/2026 at 01:50 a.m., Central Time
`;
      const result = parseBankEmail({ subject: "x", rawBody: renamed, today: TODAY });
      expect("error" in result).toBe(true);
    });

    // Review catch: an ACH/biller line carries no "PURCHASE AUTHORIZED ON" lead
    // verb, so probing for the card shape alone would let a renamed section on an
    // ACH-ONLY night pass as a no-spend day — silently dropping real spend AND
    // crediting a habit that was never earned. The guard tests for amounts the
    // Balance summary doesn't account for, which covers both line shapes.
    it("still errors when ONLY ACH lines hide under a renamed section", () => {
      const renamed = `
for account ...5581
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
Debits
COMCAST-XFINITY CABLE SVCS 260718 0078881 JENNIFER *KING $153.95
AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
As of 07/21/2026 at 01:50 a.m., Central Time
`;
      const result = parseBankEmail({ subject: "x", rawBody: renamed, today: TODAY });
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error.toLowerCase()).toContain("format");
      }
    });

    it("still errors when a lone ACH line follows no section header at all", () => {
      const body = `
for account ...5581
Balance summary
Ending balance: $1,277.90
Available balance1: $1,165.82
COMCAST-XFINITY CABLE SVCS 260718 0078881 JENNIFER *KING $153.95
As of 07/21/2026 at 01:50 a.m., Central Time
`;
      expect("error" in parseBankEmail({ subject: "x", rawBody: body, today: TODAY })).toBe(true);
    });

    // The documented cost of that guard: it errs toward a loud failure. If Wells
    // Fargo ever adds an unrelated dollar figure to the layout, a genuine
    // no-spend night reports a parse failure rather than fabricating a clean day.
    // Pinned so the trade-off is a decision on record, not a surprise.
    it("errs toward failing loudly on an unrelated dollar amount in the body", () => {
      const promo = `
for account ...5581
Balance summary
Ending balance: $949.51
Available balance1: $949.51
Earn a $200 bonus when you open a new account
As of 07/25/2026 at 03:19 a.m., Central Time
`;
      // Note: "$200 bonus" does not END the line, so it is not amount-shaped and
      // is correctly ignored — only a TRAILING amount reads as a money line.
      const ignored = parseBankEmail({ subject: "x", rawBody: promo, today: "2026-07-25" });
      if ("error" in ignored) throw new Error(`expected a parse, got: ${ignored.error}`);
      expect(ignored.withdrawals).toEqual([]);

      // But a trailing one does trip the guard.
      const trailing = promo.replace(
        "Earn a $200 bonus when you open a new account",
        "New account bonus $200.00"
      );
      expect(
        "error" in parseBankEmail({ subject: "x", rawBody: trailing, today: "2026-07-25" })
      ).toBe(true);
    });
  });

  it("parses a RECURRING PAYMENT AUTHORIZED ON line like a PURCHASE line", () => {
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
RECURRING PAYMENT AUTHORIZED ON 07/01 NETFLIX.COM 800-123-4567 CA P000000551051570 CARD 2115 $15.99
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    if ("error" in result) throw new Error(result.error);
    expect(result.withdrawals).toHaveLength(1);
    expect(result.withdrawals[0]).toMatchObject({
      amount: 15.99,
      date: "2026-07-01",
      cardLast4: "2115",
      bankRef: "P000000551051570",
    });
    expect(result.withdrawals[0]?.descriptor).toContain("NETFLIX.COM");
  });

  it("reviewer repro: a malformed card line never swallows the following line into itself", () => {
    // The ref token here ("X000000551051569") doesn't match the [PS] prefix
    // shape, so this line can't classify as a card purchase — with the old
    // [\s\S]+? descriptor group it would extend across the newline and
    // merge with (and consume) the next line's $18.86 entirely. Both lines
    // must now be reported (as an error, since the first is unclassifiable)
    // without the second amount disappearing.
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN X000000551051569 CARD 2115 $9.00
PURCHASE AUTHORIZED ON 07/19 TARGET T-0260 St Louis Park MN P000000853534827 CARD 7752 $18.86
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    // Strict mode: the first line is unclassifiable, so the whole parse
    // fails loudly rather than silently dropping the $18.86 second line.
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("X000000551051569");
    }
  });

  it("reviewer repro: a stray dollar-less line never glues onto the front of the next card line", () => {
    // "Some stray disclaimer text with no dollar amount" has no trailing
    // $amount, so the old unconditional buffering would glue it onto the
    // FRONT of the next PURCHASE line. The merged blob no longer starts with
    // PURCHASE/RECURRING PAYMENT, so the item-level card guard never fires,
    // CARD_LINE_RE fails, and ACH_LINE_RE would greedily accept the whole
    // merged blob as a fake ACH withdrawal (fabricating a transaction from
    // the swallowed amount) instead of the intended strict-mode error.
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
Some stray disclaimer text with no dollar amount
PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN X000000551051569 CARD 2115 $9.00
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    expect("error" in result).toBe(true);
  });

  it("reviewer repro variant: a stray dollar-less line before an ACH line also errors instead of fabricating a withdrawal", () => {
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
Some stray disclaimer text with no dollar amount
AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    expect("error" in result).toBe(true);
  });

  it("returns a structured error for an unrecognized withdrawal line among good ones", () => {
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115 $18.86
AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
THIS LINE IS TOTAL GARBAGE WITH NO AMOUNT AT ALL
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    expect("error" in result).toBe(true);
  });

  it.each([
    ["-$45.23", -45.23],
    ["$-45.23", -45.23],
    ["($45.23)", -45.23],
  ])("parses negative/overdrawn balance form %s", (form, expected) => {
    const body = `
for account ...5581
Balance summary
Ending balance: ${form}
Available balance1: ${form}
Withdrawals
PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115 $18.86
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    if ("error" in result) throw new Error(result.error);
    expect(result.endingBalance).toBeCloseTo(expected, 2);
    expect(result.availableBalance).toBeCloseTo(expected, 2);
  });

  it("gives two identical same-day ACH charges distinct synth: refs within one email, deterministically across parses", () => {
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result1 = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    const result2 = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    if ("error" in result1 || "error" in result2) throw new Error("expected success");
    expect(result1.withdrawals).toHaveLength(2);
    // Distinct within one email.
    expect(result1.withdrawals[0]?.bankRef).not.toBe(result1.withdrawals[1]?.bankRef);
    // Stable across re-parses of the same email.
    expect(result1.withdrawals[0]?.bankRef).toBe(result2.withdrawals[0]?.bankRef);
    expect(result1.withdrawals[1]?.bankRef).toBe(result2.withdrawals[1]?.bankRef);
  });

  it("reviewer repro: scans all isolated 6-digit runs, using the first one that's a valid YYMMDD", () => {
    const body = `
for account ...5581
Balance summary
Ending balance: $500.00
Available balance1: $500.00
Withdrawals
ACME INVOICE 123456 REF 260718 JENNIFER IVERS $50.00
As of 07/21/2026 at 01:50 a.m., Central Time
`;
    const result = parseBankEmail({ subject: "x", rawBody: body, today: TODAY });
    if ("error" in result) throw new Error(result.error);
    expect(result.withdrawals).toHaveLength(1);
    // "123456" is not a valid YYMMDD (month 34), so the first valid token
    // ("260718") must be the one used.
    expect(result.withdrawals[0]?.date).toBe("2026-07-18");
  });
});
