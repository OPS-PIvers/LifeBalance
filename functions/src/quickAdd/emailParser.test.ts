import { describe, it, expect } from "vitest";
import { parseTransactionEmail } from "./emailParser";

// A realistic Wells Fargo CREDIT card alert (the format the old on-device
// regexes were written for), including the alert-threshold sentence that must
// NOT be mistaken for the charge.
const CREDIT_EMAIL = `Your credit card was used for a purchase over $1.00.

You made a purchase of $6.02 with credit card ...8899.

Merchant: Google CLOUD
Date: 07/01/2026

If you don't recognize this transaction, call us.`;

// A debit-style alert where the merchant is embedded in the sentence rather
// than labeled.
const DEBIT_EMAIL =
  "Your Wells Fargo Debit Card ending in 1234 was used for a purchase of " +
  "$45.67 at COSTCO WHSE #0712 on 07/01/2026. If you do not recognize this " +
  "purchase, please call 1-800-869-3557.";

// The table-layout rendering of the same alert: label and value live in
// separate cells, so tag-stripping (or copying a text selection from the
// rendered email) puts them on separate LINES with no colon.
const TABLE_LAYOUT_EMAIL = `WELLS FARGO
We have your most recent transaction here
Credit card
...8899
Amount
$24.10
Merchant
TST* ANNA MARIA GENERAL S in ANNA MARIA, FL, USA
Date
07/03/2026`;

// The Wells Fargo debit "exceeded preset amount" alert (observed 2026-07-15):
// no dollar sign on the amount ("3.20 USD"), and the merchant labeled as
// "Merchant details at X in CITY COUNTRY". The threshold sentence uses "$1".
const PRESET_AMOUNT_EMAIL = `A card purchase exceeded your preset amount

You asked us to let you know whenever your Wells Fargo Debit Card was used to make a purchase that exceeds $1.

Card ending in 2115
Purchase amount 3.20 USD
Merchant details at CPI*THEISEN VENDING INC in GOLDEN VALLEY UNITED STATES
Date 07/15/2026 03:22 PM US/Pacific

For transaction details and your current balance, sign on and select this account.`;

describe("parseTransactionEmail", () => {
  it("parses the debit 'exceeded preset amount' format (no $, 'Merchant details at')", () => {
    expect(parseTransactionEmail(PRESET_AMOUNT_EMAIL)).toEqual({
      amount: 3.2,
      merchant: "CPI*THEISEN VENDING INC",
      cardLast4: "2115",
      date: "2026-07-15",
    });
  });

  it("parses the Wells Fargo credit alert format (labeled merchant)", () => {
    expect(parseTransactionEmail(CREDIT_EMAIL)).toEqual({
      amount: 6.02,
      merchant: "Google CLOUD",
      cardLast4: "8899",
      date: "2026-07-01",
    });
  });

  it("parses a debit-style alert (embedded merchant, 'ending in' card)", () => {
    expect(parseTransactionEmail(DEBIT_EMAIL)).toEqual({
      amount: 45.67,
      merchant: "COSTCO WHSE #0712",
      cardLast4: "1234",
      date: "2026-07-01",
    });
  });

  it("parses a table-layout alert (label and value on separate lines, no colons)", () => {
    expect(parseTransactionEmail(TABLE_LAYOUT_EMAIL)).toEqual({
      amount: 24.1,
      merchant: "TST* ANNA MARIA GENERAL S in ANNA MARIA",
      cardLast4: "8899",
      date: "2026-07-03",
    });
  });

  it("parses the table layout when delivered as HTML table cells", () => {
    const html =
      "<table><tr><td>Credit card</td><td>...8899</td></tr>" +
      "<tr><td>Amount</td><td>$24.10</td></tr>" +
      "<tr><td>Merchant</td><td>TST* ANNA MARIA GENERAL S</td></tr>" +
      "<tr><td>Date</td><td>07/03/2026</td></tr></table>";
    expect(parseTransactionEmail(html)).toEqual({
      amount: 24.1,
      merchant: "TST* ANNA MARIA GENERAL S",
      cardLast4: "8899",
      date: "2026-07-03",
    });
  });

  it("does not read prose 'merchant' wording as a colon-less label", () => {
    const parsed = parseTransactionEmail(
      "If you don't recognize this\nmerchant, please call the number on the back of your card."
    );
    expect(parsed.merchant).toBeNull();
  });

  it("ignores the alert-threshold figure when only unlabeled amounts exist", () => {
    const text =
      "Alert: purchases over $1.00.\nA charge of $23.45 at STARBUCKS.";
    const parsed = parseTransactionEmail(text);
    expect(parsed.amount).toBe(23.45);
    expect(parsed.merchant).toBe("STARBUCKS");
  });

  it("parses comma-grouped amounts", () => {
    expect(parseTransactionEmail("purchase of $1,234.56 at IKEA.").amount).toBe(
      1234.56
    );
  });

  it("strips HTML and decodes entities before matching", () => {
    const html = `<html><body><table><tr><td>You made a purchase of&nbsp;$6.02 with credit card ...8899.</td></tr>
<tr><td>Merchant: H &amp; M</td></tr><tr><td>Date: 07/01/2026</td></tr></table></body></html>`;
    expect(parseTransactionEmail(html)).toEqual({
      amount: 6.02,
      merchant: "H & M",
      cardLast4: "8899",
      date: "2026-07-01",
    });
  });

  it("keeps dots inside merchant names but stops at sentence end", () => {
    const parsed = parseTransactionEmail(
      "You made a purchase of $12.00 at Amazon.com. Thank you."
    );
    expect(parsed.merchant).toBe("Amazon.com");
  });

  it("parses 'card x9876' masks and textual dates", () => {
    const parsed = parseTransactionEmail(
      "A transaction at TARGET with your card x9876 on July 1, 2026 for $9.99."
    );
    expect(parsed.cardLast4).toBe("9876");
    expect(parsed.date).toBe("2026-07-01");
    expect(parsed.amount).toBe(9.99);
    expect(parsed.merchant).toBe("TARGET");
  });

  it("does not grab a phone number or year as the card last-4", () => {
    const parsed = parseTransactionEmail(
      "Questions about this 2026 statement? Call 1-800-869-3557."
    );
    expect(parsed.cardLast4).toBeNull();
  });

  it("does not grab a dollar amount near 'card' as the card last-4", () => {
    const parsed = parseTransactionEmail(
      "Your card was used for purchases over $1000. Merchant: IKEA"
    );
    expect(parsed.cardLast4).toBeNull();
  });

  it("skips an invalid date-shaped token and finds the real date after it", () => {
    const parsed = parseTransactionEmail(
      "Reference 13-40-2026. You made a purchase of $5.00 at IKEA on 07/01/2026."
    );
    expect(parsed.date).toBe("2026-07-01");
  });

  it("strips span-soup HTML without structural html/body tags", () => {
    const html =
      '<span style="color:#333">You made a purchase of $6.02 with credit card ...8899.</span>' +
      "<span>Merchant: Google CLOUD</span>";
    const parsed = parseTransactionEmail(html);
    expect(parsed.amount).toBe(6.02);
    expect(parsed.merchant).toBe("Google CLOUD");
    expect(parsed.cardLast4).toBe("8899");
  });

  it("decodes &apos; in merchant names from HTML emails", () => {
    const html =
      "<html><body><p>purchase of $8.50 with credit card ...8899</p>" +
      "<p>Merchant: McDonald&apos;s</p></body></html>";
    expect(parseTransactionEmail(html).merchant).toBe("McDonald's");
  });

  it("returns amount without merchant when only a labeled amount exists", () => {
    const parsed = parseTransactionEmail("Charge approved. Amount: $12.00.");
    expect(parsed.amount).toBe(12);
    expect(parsed.merchant).toBeNull();
  });

  it("returns merchant without amount when no dollar figure exists", () => {
    const parsed = parseTransactionEmail(
      "A transaction at STARBUCKS on 07/01/2026 requires your attention."
    );
    expect(parsed.amount).toBeNull();
    expect(parsed.merchant).toBe("STARBUCKS");
    expect(parsed.date).toBe("2026-07-01");
  });

  it("returns all nulls for unrelated text", () => {
    expect(parseTransactionEmail("Your statement is ready to view.")).toEqual({
      amount: null,
      merchant: null,
      cardLast4: null,
      date: null,
    });
  });

  it("rejects an invalid calendar date instead of passing it through", () => {
    // 13/40/2026 can't come from a real MM/DD/YYYY alert; the parser must
    // return null (endpoint then falls back to today) rather than a 400.
    expect(parseTransactionEmail("purchase of $5.00 on 13/40/2026").date).toBeNull();
  });

  it("caps merchant length at the endpoint's 100-char limit", () => {
    const parsed = parseTransactionEmail(
      `purchase of $5.00 at ${"A".repeat(150)} on 07/01/2026`
    );
    expect(parsed.merchant).toHaveLength(100);
  });
});
