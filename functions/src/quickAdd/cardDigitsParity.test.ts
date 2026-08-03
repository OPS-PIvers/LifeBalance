import { describe, expect, it } from "vitest";

// CARD-1 (finding 3): `normalizeCardLast4` (server, this package) and
// `normalizeCardDigits` (client, `@/utils/cardOwnership.ts`) are byte-identical
// in logic but nothing keeps them in sync — if one drifts, a card routes to
// the right ACCOUNT (server-side matching) while the owner lookup MISSES
// (client-side `getCardOwnerUid`), a silent misattribution. functions/
// SOURCE cannot import `@/...` (rootDir: "src" in functions/tsconfig), but
// functions TESTS run under the root vitest config, so the alias resolves
// here — turning "these must stay in lockstep" from a comment into a test
// (mirrors backdatedHabitFire.test.ts's client/server parity block).
import { normalizeCardLast4 } from "./accountMatch";
import { normalizeCardDigits } from "@/utils/cardOwnership";

/** Real bank-email formats plus edge cases both normalizers must agree on. */
const FIXTURES: Array<{ label: string; input: string | number | null | undefined }> = [
  { label: "ellipsis mask (three dots)", input: "...8899" },
  { label: "ellipsis mask (single-char ellipsis)", input: "…8899" },
  { label: "asterisk mask", input: "*8899" },
  { label: "letter mask", input: "x8899" },
  { label: "bare 4 digits", input: "8899" },
  { label: "full sentence", input: "with credit card ...8899" },
  { label: "surrounding whitespace", input: "  8899  " },
  { label: "empty string", input: "" },
  { label: "whitespace only", input: "   " },
  { label: "non-digits only", input: "no digits here" },
  { label: "more than 4 digits (takes the last run)", input: "123456" },
  { label: "two separate 4-digit runs (takes the last)", input: "acct 1111 card 8899" },
  { label: "5-digit run is not a match", input: "12345" },
  { label: "numeric input", input: 8899 },
  { label: "null", input: null },
  { label: "undefined", input: undefined },
];

describe("normalizeCardLast4 / normalizeCardDigits parity", () => {
  it.each(FIXTURES)("agree on: $label ($input)", ({ input }) => {
    expect(normalizeCardLast4(input)).toBe(normalizeCardDigits(input));
  });
});
