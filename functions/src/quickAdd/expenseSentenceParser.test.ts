import { describe, it, expect } from "vitest";
import { parseExpenseSentence } from "./expenseSentenceParser";

// 2026-07-21 is the "today" used throughout — arbitrary but fixed for
// deterministic yesterday/today math (matches the todoParser test convention).
const TODAY = "2026-07-21";
const CATEGORIES = ["Groceries", "Dining", "Transportation", "Entertainment", "Health", "Shopping", "Bills"];

describe("parseExpenseSentence", () => {
  describe("amount", () => {
    it("parses a '$' figure with cents and thousands separator", () => {
      expect(parseExpenseSentence("spent $45.67 at Target").amount).toBe(45.67);
      expect(parseExpenseSentence("Paid $1,234.56 for rent").amount).toBe(1234.56);
    });

    it("parses a '$' figure with no cents", () => {
      expect(parseExpenseSentence("spent $50 at the store").amount).toBe(50);
    });

    it("parses word-form currency (dollars/bucks/USD)", () => {
      expect(parseExpenseSentence("spent 50 dollars at Target").amount).toBe(50);
      expect(parseExpenseSentence("paid 20 bucks for parking").amount).toBe(20);
      expect(parseExpenseSentence("cost 15 USD").amount).toBe(15);
    });

    it("parses a bare number adjacent to a spend keyword", () => {
      expect(parseExpenseSentence("spent 45 at Target").amount).toBe(45);
      expect(parseExpenseSentence("paid 20 for gas").amount).toBe(20);
      // The optional filler ("about"/"around"/"roughly") must sit directly
      // between the keyword and the number — "paid about 12.50" matches,
      // but a keyword separated from the number by other words (e.g. "bought
      // lunch for 12.50") does not, since nothing but that filler list is
      // skipped over.
      expect(parseExpenseSentence("paid about 12.50 for lunch").amount).toBe(12.5);
    });

    it("always normalizes to a positive number", () => {
      expect(parseExpenseSentence("spent -$20 at Target").amount).toBe(20);
    });

    it("returns null when no credible amount is found — spelled-out amounts are not recognized", () => {
      const result = parseExpenseSentence("spent twelve fifty at the diner");
      expect(result.amount).toBeNull();
    });

    it("returns null (and other fields still null/independent) when nothing at all is recognized", () => {
      expect(parseExpenseSentence("went to the park")).toEqual({
        amount: null,
        merchant: null,
        date: null,
        category: null,
        notes: "went to the park",
      });
    });
  });

  describe("merchant", () => {
    it("captures after 'at' up to a trailing clause", () => {
      expect(parseExpenseSentence("spent $45 at Target on household stuff").merchant).toBe("Target");
    });

    it("captures after 'from'", () => {
      expect(parseExpenseSentence("bought groceries from Trader Joe's for $60").merchant).toBe("Trader Joe's");
    });

    it("captures to end of string when no trailing clause follows", () => {
      expect(parseExpenseSentence("spent $45 at Target").merchant).toBe("Target");
    });

    it("strips a leading article", () => {
      expect(parseExpenseSentence("paid $20 at the store").merchant).toBe("store");
    });

    it("is null when there is no 'at'/'from' phrase", () => {
      expect(parseExpenseSentence("spent $45 on household stuff").merchant).toBeNull();
    });
  });

  describe("date", () => {
    it("parses an explicit MM/DD/YYYY date", () => {
      expect(parseExpenseSentence("paid $20 at the store on 07/15/2026").date).toBe("2026-07-15");
    });

    it("parses an explicit ISO date", () => {
      expect(parseExpenseSentence("spent $10 on 2026-07-15").date).toBe("2026-07-15");
    });

    it("resolves 'today' relative to opts.today", () => {
      expect(parseExpenseSentence("spent $10 at the cafe today", { today: TODAY }).date).toBe(TODAY);
    });

    it("resolves 'yesterday' relative to opts.today", () => {
      expect(parseExpenseSentence("spent $10 at the cafe yesterday", { today: TODAY }).date).toBe("2026-07-20");
    });

    it("leaves 'today'/'yesterday' unparsed when opts.today is not supplied", () => {
      expect(parseExpenseSentence("spent $10 at the cafe yesterday").date).toBeNull();
    });

    it("is null when no date is present", () => {
      expect(parseExpenseSentence("spent $10 at the cafe").date).toBeNull();
    });

    it("does not recognize a bare M/D date without a year", () => {
      expect(parseExpenseSentence("spent $10 on 7/15").date).toBeNull();
    });
  });

  describe("category", () => {
    it("maps a keyword to a category present in opts.categories", () => {
      expect(parseExpenseSentence("spent $60 on groceries", { categories: CATEGORIES }).category).toBe(
        "Groceries"
      );
      expect(parseExpenseSentence("paid $20 for gas", { categories: CATEGORIES }).category).toBe(
        "Transportation"
      );
    });

    it("is null when opts.categories is not supplied", () => {
      expect(parseExpenseSentence("spent $60 on groceries").category).toBeNull();
    });

    it("is null when the mapped category isn't in opts.categories", () => {
      expect(
        parseExpenseSentence("spent $60 on groceries", { categories: ["Dining", "Transportation"] }).category
      ).toBeNull();
    });

    it("is null when nothing matches", () => {
      expect(parseExpenseSentence("spent $60 on stuff", { categories: CATEGORIES }).category).toBeNull();
    });
  });

  describe("notes", () => {
    it("is the trailing descriptive remainder after removing amount/merchant/date", () => {
      expect(parseExpenseSentence("spent $45 at Target on household stuff").notes).toBe("household stuff");
    });

    it("strips a spend keyword and leading pronoun", () => {
      expect(parseExpenseSentence("I spent 45 dollars at Target").notes).toBeNull();
    });

    it("is null when nothing descriptive remains", () => {
      expect(parseExpenseSentence("paid $20 at the store on 07/15/2026").notes).toBeNull();
    });

    it("captures a trailing reason after 'for'", () => {
      expect(parseExpenseSentence("paid $20 for gas", { today: TODAY }).notes).toBe("gas");
    });
  });

  it("parses a fully-populated realistic sentence end to end", () => {
    expect(
      parseExpenseSentence("I spent $45.67 at Target on 07/15/2026 for household stuff", {
        categories: CATEGORIES,
        today: TODAY,
      })
    ).toEqual({
      amount: 45.67,
      merchant: "Target",
      date: "2026-07-15",
      category: null,
      notes: "household stuff",
    });
  });
});
