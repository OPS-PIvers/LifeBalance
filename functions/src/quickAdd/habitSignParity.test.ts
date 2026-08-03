import { describe, expect, it } from "vitest";

// HABIT-SIGN-1: `habitSign`/`signedHabitPoints` (server, this package) and
// the client's `habitSign`/`signedHabitPoints` (`@/utils/habitLogic.ts`) must
// canonicalize a habit's points identically — the sign comes ONLY from
// `habit.type`, the magnitude ONLY from `Math.abs(basePoints)`. Two client
// habit-creation paths historically stored a negative habit's `basePoints`
// with opposite signs (HabitFormModal: positive basePoints + type
// 'negative'; HabitCreatorWizard: negative basePoints + type 'negative' —
// now fixed to always store a positive magnitude, but existing Firestore
// docs still carry the old negative-basePoints shape, including a real
// production habit: "Lights out after 10:30pm", type: 'negative',
// basePoints: -1). Both conventions must score identically on both the
// client and the server, or a habit's points silently disagree depending on
// which surface completed it. functions/ SOURCE cannot import `@/...`
// (rootDir: "src" in functions/tsconfig), but functions TESTS run under the
// root vitest config, so the alias resolves here — mirrors
// cardDigitsParity.test.ts / cardOwnerAttributionParity.test.ts.
//
// A THIRD copy of this canonicalization lives in `habitProcessor.ts`
// (`canonicalizeHabitPoints`, used by `processToggleHabit` — the real
// production quickAdd/iOS-Shortcut toggle path). It does NOT call
// `streakLogic.ts`'s `habitSign`/`signedHabitPoints`, so comparing only
// `streakLogic.ts` against the client leaves this site completely
// uncovered — a PR review caught this: mutating `habitProcessor.ts` alone
// (stripping its `Math.abs`) left every test in this file green. The
// `habitProcessor canonicalization` describe block below closes that hole.
import { habitSign as serverHabitSign, signedHabitPoints as serverSignedHabitPoints } from "./streakLogic";
import { canonicalizeHabitPoints } from "./habitProcessor";
import {
  habitSign as clientHabitSign,
  habitPointsMagnitude as clientHabitPointsMagnitude,
  signedHabitPoints as clientSignedHabitPoints,
} from "@/utils/habitLogic";

type SignFixtureHabit = { type: "positive" | "negative"; basePoints: number };

const SIGN_FIXTURES: Array<{ label: string; habit: SignFixtureHabit }> = [
  { label: "positive habit, positive basePoints", habit: { type: "positive", basePoints: 10 } },
  {
    label: "negative habit, POSITIVE basePoints (HabitFormModal convention)",
    habit: { type: "negative", basePoints: 2 },
  },
  {
    label: "negative habit, NEGATIVE basePoints (legacy HabitCreatorWizard convention)",
    habit: { type: "negative", basePoints: -2 },
  },
  {
    label: "negative habit, basePoints: -1 — the exact production shape ('Lights out after 10:30pm')",
    habit: { type: "negative", basePoints: -1 },
  },
  { label: "positive habit, basePoints: 0", habit: { type: "positive", basePoints: 0 } },
];

describe("habitSign parity (server streakLogic vs client habitLogic)", () => {
  it.each(SIGN_FIXTURES)("agree on sign for: $label", ({ habit }) => {
    expect(serverHabitSign(habit)).toBe(clientHabitSign(habit));
  });

  it.each(SIGN_FIXTURES)("agree on signedHabitPoints (multiplier 1) for: $label", ({ habit }) => {
    expect(serverSignedHabitPoints(habit)).toBe(clientSignedHabitPoints(habit));
  });

  it.each(SIGN_FIXTURES)("agree on signedHabitPoints (multiplier 1.5) for: $label", ({ habit }) => {
    expect(serverSignedHabitPoints(habit, 1.5)).toBe(clientSignedHabitPoints(habit, 1.5));
  });

  it("never awards points for a negative habit regardless of storage convention (basePoints: -1)", () => {
    const habit: SignFixtureHabit = { type: "negative", basePoints: -1 };
    // The double-negative this test guards against: reading `basePoints` raw
    // instead of deriving sign from `type` would double-negate this shape and
    // return +1 (an AWARD for performing the undesirable action) instead of -1.
    expect(serverSignedHabitPoints(habit)).toBe(-1);
    expect(clientSignedHabitPoints(habit)).toBe(-1);
  });
});

// The real production quickAdd/iOS-Shortcut toggle path: `processToggleHabit`
// calls `canonicalizeHabitPoints`, NOT `streakLogic.ts`'s `habitSign`. This
// block pins that site independently of the two above — see the file
// docblock for why the parity above alone doesn't cover it.
describe("habitProcessor canonicalization (processToggleHabit's actual site) vs client habitLogic", () => {
  it.each(SIGN_FIXTURES)("agrees on sign for: $label", ({ habit }) => {
    expect(canonicalizeHabitPoints(habit).sign).toBe(clientHabitSign(habit));
  });

  it.each(SIGN_FIXTURES)("agrees on magnitude for: $label", ({ habit }) => {
    expect(canonicalizeHabitPoints(habit).magnitude).toBe(clientHabitPointsMagnitude(habit));
  });

  it("never awards points for a negative habit regardless of storage convention (basePoints: -1)", () => {
    const habit: SignFixtureHabit = { type: "negative", basePoints: -1 };
    const { sign, magnitude } = canonicalizeHabitPoints(habit);
    // Same double-negative guard as above, pinned at habitProcessor.ts's own
    // copy of the computation: reading basePoints raw would flip this to +1.
    expect(sign * Math.floor(magnitude * 1)).toBe(-1);
    expect(sign * Math.floor(magnitude * 1)).toBe(clientSignedHabitPoints(habit));
  });
});
