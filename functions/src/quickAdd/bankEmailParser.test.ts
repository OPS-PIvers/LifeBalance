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
    expect(amex).toBeDefined();
    expect(amex).toMatchObject({
      amount: 372.0,
      date: "2026-07-20",
    });
    expect(amex!.cardLast4).toBeUndefined();
    expect(amex!.bankRef).toMatch(/^synth:[0-9a-f]{8}$/);

    const comcast = result.withdrawals.find((w) => w.descriptor.includes("COMCAST"));
    expect(comcast).toBeDefined();
    expect(comcast).toMatchObject({
      amount: 153.95,
      date: "2026-07-18",
    });
    expect(comcast!.cardLast4).toBeUndefined();
    expect(comcast!.bankRef).toMatch(/^synth:[0-9a-f]{8}$/);
    expect(comcast!.bankRef).not.toBe(amex!.bankRef);
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

  it("returns a structured error when no withdrawal lines are found", () => {
    const result = parseBankEmail({
      subject: "x",
      rawBody: "for account ...5581\nEnding balance: $1.00\nAvailable balance1: $1.00\nWithdrawals\n",
    });
    expect("error" in result).toBe(true);
  });
});
