import { describe, expect, it } from "vitest";
import {
  displayMerchant,
  normalizeForRuleMatch,
  pickMerchantRule,
  ruleMatches,
  ruleSpecificity,
  type MerchantRule as ServerMerchantRule,
} from "./merchantRules";
// The CLIENT implementation this file is a twin of. Importing it here turns
// "these must stay in lockstep" from a comment into a test: functions/tsconfig
// excludes *.test.ts, and the suite runs under the root vitest config, so the
// `@/` alias resolves (same trick as backdatedHabitFire.test.ts). Two hand-kept
// tables would drift silently; one table run through both implementations
// cannot.
import {
  displayMerchant as clientDisplayMerchant,
  normalizeForRuleMatch as clientNormalize,
  pickMerchantRule as clientPick,
  ruleMatches as clientRuleMatches,
  ruleSpecificity as clientSpecificity,
} from "@/utils/merchantRules";
import type { MerchantRule } from "@/types/schema";

/**
 * Assignability in BOTH directions is itself part of the parity contract: the
 * server declares its own `MerchantRule` (Cloud Functions cannot import client
 * types at runtime), so a field added to one shape and not the other would go
 * unnoticed without this. Widening either interface breaks these lines.
 *
 * They are `satisfies`-style compile-time checks; the runtime `expect` below
 * just keeps the linter from calling them unused.
 */
const clientToServer: ServerMerchantRule = {
  id: "x",
  pattern: "P",
  createdAt: "2026-01-01T00:00:00.000Z",
} satisfies MerchantRule;
const serverToClient: MerchantRule = clientToServer;

/** Build a rule for BOTH implementations at once (the shapes are identical). */
function rule(over: Partial<MerchantRule> = {}): MerchantRule & ServerMerchantRule {
  return {
    id: "r1",
    pattern: "APPLE.COM/BILL",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * The shared parity table. Every case is run through the client and the server
 * copy and asserted EQUAL, then asserted against the expected value — so a
 * divergence and a shared regression are two different failures.
 */
interface PickCase {
  name: string;
  descriptor: string;
  amount?: number;
  rules: MerchantRule[];
  /** Expected winning rule id, or null. */
  expected: string | null;
}

const APPLE = rule({ id: "apple", pattern: "APPLE.COM/BILL", name: "Apple" });
const APPLE_BROAD = rule({
  id: "apple-broad",
  pattern: "APPLE",
  name: "Apple (broad)",
  createdAt: "2026-01-02T00:00:00.000Z",
});
const APPLE_299 = rule({
  id: "apple-299",
  pattern: "APPLE",
  amount: 2.99,
  name: "iCloud",
  createdAt: "2026-01-03T00:00:00.000Z",
});
const STUB_ZERO = rule({ id: "stub-zero", pattern: "SQ *COFFEE", amount: 0, name: "Coffee" });

const PICK_CASES: PickCase[] = [
  {
    name: "no rules at all",
    descriptor: "APPLE.COM/BILL 866-712-7753 CA",
    rules: [],
    expected: null,
  },
  {
    name: "a plain contains match, case- and whitespace-insensitive",
    descriptor: "  apple.com/bill   866-712-7753 CA ",
    rules: [APPLE],
    expected: "apple",
  },
  {
    name: "punctuation is significant, so APPLECOM does not match APPLE.COM",
    descriptor: "APPLECOM BILL",
    rules: [APPLE],
    expected: null,
  },
  {
    name: "the longer (more specific) pattern beats the broader one",
    descriptor: "APPLE.COM/BILL 866-712-7753 CA",
    rules: [APPLE_BROAD, APPLE],
    expected: "apple",
  },
  {
    name: "array order does not decide the winner",
    descriptor: "APPLE.COM/BILL 866-712-7753 CA",
    rules: [APPLE, APPLE_BROAD],
    expected: "apple",
  },
  {
    name: "an amount-qualified rule outranks a longer bare pattern",
    descriptor: "APPLE.COM/BILL 866-712-7753 CA",
    amount: 2.99,
    rules: [APPLE, APPLE_299],
    expected: "apple-299",
  },
  {
    name: "the amount qualifier must be cent-exact",
    descriptor: "APPLE.COM/BILL",
    amount: 3.0,
    rules: [APPLE, APPLE_299],
    expected: "apple",
  },
  {
    name: "an amount-qualified rule cannot match when the caller has no amount",
    descriptor: "APPLE.COM/BILL",
    rules: [APPLE_299],
    expected: null,
  },
  {
    name: "amount 0 is a real qualifier, not a falsy one (Apple Pay pre-auth stub)",
    descriptor: "SQ *COFFEE HOUSE",
    amount: 0,
    rules: [STUB_ZERO],
    expected: "stub-zero",
  },
  {
    name: "float amounts compare in cents, not by ===",
    descriptor: "SQ *COFFEE HOUSE",
    amount: 0.1 + 0.2,
    rules: [rule({ id: "cents", pattern: "SQ *COFFEE", amount: 0.3 })],
    expected: "cents",
  },
  {
    name: "an empty pattern is an unfinished draft, never a wildcard",
    descriptor: "ANYTHING AT ALL",
    rules: [rule({ id: "blank", pattern: "   " })],
    expected: null,
  },
  {
    name: "an exact specificity tie goes to the older rule",
    descriptor: "COSTCO WHSE #1120",
    rules: [
      rule({ id: "b", pattern: "COSTCO", createdAt: "2026-02-02T00:00:00.000Z" }),
      rule({ id: "a", pattern: "COSTCO", createdAt: "2026-01-01T00:00:00.000Z" }),
    ],
    expected: "a",
  },
  {
    name: "a createdAt tie falls back to the lower id, never to array order",
    descriptor: "COSTCO WHSE #1120",
    rules: [
      rule({ id: "zeta", pattern: "COSTCO" }),
      rule({ id: "alpha", pattern: "COSTCO" }),
    ],
    expected: "alpha",
  },
  {
    name: "an absurdly long bare pattern still loses to an amount qualifier",
    descriptor: `AMERICAN EXPRESS ACH PMT ${"X".repeat(1500)}`,
    amount: 412.18,
    rules: [
      rule({ id: "long", pattern: `AMERICAN EXPRESS ACH PMT ${"X".repeat(1500)}` }),
      rule({ id: "amt", pattern: "AMERICAN EXPRESS", amount: 412.18 }),
    ],
    expected: "amt",
  },
  {
    name: "a blank descriptor matches nothing",
    descriptor: "",
    rules: [APPLE_BROAD],
    expected: null,
  },
];

describe("merchantRules — client/server parity", () => {
  it("keeps the two MerchantRule shapes mutually assignable", () => {
    expect(serverToClient.id).toBe("x");
  });

  it.each(PICK_CASES)("pickMerchantRule: $name", ({ descriptor, amount, rules, expected }) => {
    const server = pickMerchantRule(descriptor, amount, rules);
    const client = clientPick(descriptor, amount, rules);
    // Parity first (they must agree)…
    expect(server?.id ?? null).toBe(client?.id ?? null);
    // …then correctness (they must both be right).
    expect(server?.id ?? null).toBe(expected);
  });

  it.each(PICK_CASES)("ruleMatches: $name", ({ descriptor, amount, rules }) => {
    for (const r of rules) {
      expect(ruleMatches(r, descriptor, amount)).toBe(clientRuleMatches(r, descriptor, amount));
    }
  });

  it.each(PICK_CASES)("displayMerchant: $name", ({ descriptor, amount, rules, expected }) => {
    const row = amount === undefined ? { merchant: descriptor } : { merchant: descriptor, amount };
    const server = displayMerchant(row, rules);
    expect(server).toBe(clientDisplayMerchant(row, rules));
    // A winning rule with no `name` classifies without relabelling.
    const winner = rules.find((r) => r.id === expected);
    expect(server).toBe(winner?.name ?? descriptor);
  });

  const NORMALIZE_CASES = [
    "",
    "   ",
    "APPLE.COM/BILL",
    "  apple.com/bill   866-712-7753   CA  ",
    "Sq *Coffee\tHouse\nSeattle",
    "7-ELEVEN 22371",
  ];

  it.each(NORMALIZE_CASES)("normalizeForRuleMatch: %j", (text) => {
    expect(normalizeForRuleMatch(text)).toBe(clientNormalize(text));
  });

  const SPECIFICITY_CASES: MerchantRule[] = [
    rule({ pattern: "" }),
    rule({ pattern: "APPLE" }),
    rule({ pattern: "APPLE.COM/BILL" }),
    rule({ pattern: "APPLE", amount: 2.99 }),
    rule({ pattern: "X".repeat(2000) }),
    rule({ pattern: "X".repeat(2000), amount: 1 }),
  ];

  it.each(SPECIFICITY_CASES)("ruleSpecificity: $pattern/$amount", (r) => {
    expect(ruleSpecificity(r)).toBe(clientSpecificity(r));
  });

  // The clamp is what makes "amount-qualified always wins" a guarantee rather
  // than a statement about typical pattern lengths.
  it("clamps pattern length below the amount weight in both copies", () => {
    const long = rule({ pattern: "X".repeat(5000) });
    const amt = rule({ pattern: "X", amount: 1 });
    expect(ruleSpecificity(long)).toBeLessThan(ruleSpecificity(amt));
    expect(clientSpecificity(long)).toBeLessThan(clientSpecificity(amt));
  });
});
