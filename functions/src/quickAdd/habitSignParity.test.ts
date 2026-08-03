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
import { habitSign as serverHabitSign, signedHabitPoints as serverSignedHabitPoints } from "./streakLogic";
import { habitSign as clientHabitSign, signedHabitPoints as clientSignedHabitPoints } from "@/utils/habitLogic";

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
