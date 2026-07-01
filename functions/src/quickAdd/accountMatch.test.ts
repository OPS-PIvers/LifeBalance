import { describe, it, expect } from "vitest";

import {
  normalizeCardLast4,
  matchAccountByLast4,
  normalizeUsDate,
  type AccountLike,
} from "./accountMatch";

describe("normalizeCardLast4", () => {
  it("extracts 4 digits from the Wells Fargo mask forms", () => {
    expect(normalizeCardLast4("...8899")).toBe("8899");
    expect(normalizeCardLast4("…8899")).toBe("8899"); // single-char ellipsis
    expect(normalizeCardLast4("8899")).toBe("8899");
    expect(normalizeCardLast4("with credit card ...8899")).toBe("8899");
    expect(normalizeCardLast4("  8899  ")).toBe("8899");
  });

  it("accepts a numeric input", () => {
    expect(normalizeCardLast4(8899)).toBe("8899");
  });

  it("takes the LAST standalone 4-digit run when several are present", () => {
    // e.g. an over-captured line containing a year and the card mask
    expect(normalizeCardLast4("Date 2026 card ...8899")).toBe("8899");
  });

  it("does not pull 4 digits out of a longer number (full PAN / phone)", () => {
    expect(normalizeCardLast4("6502530000")).toBeNull();
    expect(normalizeCardLast4("1234567890123456")).toBeNull();
  });

  it("returns null for empty / non-string / no-digit input", () => {
    expect(normalizeCardLast4("")).toBeNull();
    expect(normalizeCardLast4("no digits here")).toBeNull();
    expect(normalizeCardLast4(undefined)).toBeNull();
    expect(normalizeCardLast4(null)).toBeNull();
    expect(normalizeCardLast4("123")).toBeNull(); // only 3 digits
  });
});

describe("matchAccountByLast4", () => {
  const accounts: AccountLike[] = [
    { id: "chk", cardLast4: "1234" },
    { id: "cred", cardLast4: "8899" },
    { id: "sav" }, // no card
  ];

  it("routes the masked card to the matching account", () => {
    expect(matchAccountByLast4("...8899", accounts)).toBe("cred");
    expect(matchAccountByLast4("1234", accounts)).toBe("chk");
  });

  it("returns null when no account carries the digits", () => {
    expect(matchAccountByLast4("0000", accounts)).toBeNull();
  });

  it("returns null when the input has no usable 4-digit group", () => {
    expect(matchAccountByLast4("credit card", accounts)).toBeNull();
    expect(matchAccountByLast4(undefined, accounts)).toBeNull();
  });

  it("returns null on an ambiguous tie (two accounts share the last 4)", () => {
    const dupes: AccountLike[] = [
      { id: "a", cardLast4: "8899" },
      { id: "b", cardLast4: "8899" },
    ];
    expect(matchAccountByLast4("8899", dupes)).toBeNull();
  });

  it("ignores accounts whose stored card is itself unusable", () => {
    const messy: AccountLike[] = [
      { id: "a", cardLast4: "abcd" },
      { id: "b", cardLast4: "8899" },
    ];
    expect(matchAccountByLast4("8899", messy)).toBe("b");
  });
});

describe("normalizeUsDate", () => {
  it("passes through a valid ISO date", () => {
    expect(normalizeUsDate("2026-07-01")).toBe("2026-07-01");
  });

  it("converts US MM/DD/YYYY (Wells Fargo format) to ISO", () => {
    expect(normalizeUsDate("07/01/2026")).toBe("2026-07-01");
    expect(normalizeUsDate("12/31/2025")).toBe("2025-12-31");
  });

  it("accepts single-digit month/day and '-' separators", () => {
    expect(normalizeUsDate("7/1/2026")).toBe("2026-07-01");
    expect(normalizeUsDate("07-01-2026")).toBe("2026-07-01");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUsDate("  07/01/2026  ")).toBe("2026-07-01");
  });

  it("rejects impossible calendar dates", () => {
    expect(normalizeUsDate("13/01/2026")).toBeNull(); // month 13
    expect(normalizeUsDate("02/30/2026")).toBeNull(); // Feb 30
    expect(normalizeUsDate("2026-13-40")).toBeNull(); // bad ISO
  });

  it("returns null for unparseable / non-string input", () => {
    expect(normalizeUsDate("July 1, 2026")).toBeNull();
    expect(normalizeUsDate("")).toBeNull();
    expect(normalizeUsDate(undefined)).toBeNull();
    expect(normalizeUsDate(42)).toBeNull();
  });
});
