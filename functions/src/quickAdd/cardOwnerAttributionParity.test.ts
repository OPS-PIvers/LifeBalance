import { describe, expect, it, vi } from "vitest";

/**
 * ATTR-1 — the SERVER half of card-owner attribution.
 *
 * "Two paths that should agree and silently don't" has been the root cause of
 * every serious defect in this effort, so this file pins the server's side of
 * the contract explicitly rather than leaving it to a comment.
 *
 * THE FACT BEING PINNED: `functions/` has NO transaction-keyword habit fire.
 * Every transaction-fired habit completion is written CLIENT-side by
 * `fireHabitsIntoBatch` in `contexts/household/mutations/transactionMutations.ts`
 * (reached from `updateTransactionCategory`'s review/approve path and from
 * `addTransaction`'s manual-entry path). `bankEmailSync` creates transactions
 * with `cardLast4` but fires nothing off their merchant text — the rows land as
 * `needsCategory` and the human review is what fires the habits.
 *
 * The one server path that DOES write habit completions is the NO-SPEND-DAY
 * fire (`noSpendFire.applyNoSpendDay`). It is unattributable BY CONSTRUCTION:
 * a no-spend day is the ABSENCE of transactions, so there is no card and no
 * purchaser — it is a household-wide fact. It therefore writes no
 * `completedBy` node and no `attributedTo`, and the tests below fail loudly if
 * a future change starts attributing it to somebody.
 *
 * `functions/` SOURCE cannot import `@/...` (rootDir: "src" in
 * functions/tsconfig), but functions TESTS run under the root vitest config, so
 * the alias resolves here — the same pattern as `cardDigitsParity.test.ts` and
 * `backdatedHabitFire.test.ts`'s parity block. That lets this file assert the
 * server behaviour against the CLIENT's own rule module, so a future
 * server-side fire has one resolver to adopt rather than a second to invent.
 */

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("firebase-admin", () => {
  const firestore = Object.assign(() => ({}), {
    FieldValue: {
      serverTimestamp: () => "TS",
      increment: (n: number) => ({ __inc: n }),
      arrayUnion: (...items: unknown[]) => ({ __union: items }),
      arrayRemove: (...items: unknown[]) => ({ __remove: items }),
    },
  });
  return { firestore };
});

import { applyNoSpendDay, type ApplyNoSpendDayDeps } from "./noSpendFire";
import {
  currentMemberPredicate,
  resolveCardFireAttribution,
} from "@/utils/habitCardAttribution";

const HOUSEHOLD_ID = "hh1";
const TARGET_DATE = "2026-07-25";
const TODAY = "2026-07-26";
const MEMBER = "uid-alice";

type FakeDocData = Record<string, unknown>;

/** Minimal fake covering exactly what `applyNoSpendDay` calls (see noSpendFire.test.ts). */
function makeFakeDb(habits: { id: string; data: FakeDocData }[]): ApplyNoSpendDayDeps["db"] {
  const collection = (path: string) => {
    if (path.endsWith("/transactions")) {
      return { where: () => ({ get: async () => ({ docs: [] }) }) };
    }
    if (path.endsWith("/habits")) {
      return {
        get: async () => ({ docs: habits.map((h) => ({ id: h.id, data: () => h.data })) }),
      };
    }
    if (/\/habits\/[^/]+\/submissions$/.test(path)) {
      return {
        where: (field: string) =>
          field === "sourceNoSpendDate"
            ? { limit: () => ({ get: async () => ({ empty: true }) }) }
            : { where: () => ({ get: async () => ({ docs: [] }) }) },
        doc: () => ({ path: `${path}/new` }),
      };
    }
    throw new Error(`makeFakeDb: unexpected collection path ${path}`);
  };
  const doc = (path: string) => ({
    path,
    get: async () => ({ exists: false }),
  });
  return { collection, doc } as unknown as ApplyNoSpendDayDeps["db"];
}

const noSpendHabit = {
  id: "habit-nospend",
  data: {
    title: "No-spend day",
    type: "positive",
    basePoints: 10,
    scoringType: "incremental",
    period: "daily",
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: "2026-07-20T00:00:00.000Z",
    triggers: { noSpend: "day" },
  } satisfies FakeDocData,
};

describe("the server's no-spend fire never attributes a completion", () => {
  async function runFire(habitData: FakeDocData) {
    const set = vi.fn();
    const update = vi.fn();
    const outcome = await applyNoSpendDay({
      db: makeFakeDb([{ id: noSpendHabit.id, data: habitData }]),
      householdId: HOUSEHOLD_ID,
      batch: { set, update } as unknown as ApplyNoSpendDayDeps["batch"],
      targetDate: TARGET_DATE,
      today: TODAY,
      extraSpend: [],
    });
    return { outcome, set, update };
  }

  it("fires the habit but writes no completedBy node of any kind", async () => {
    const { outcome, update } = await runFire(noSpendHabit.data);

    expect(outcome.isNoSpendDay).toBe(true);
    expect(outcome.fired.map((f) => f.habitId)).toEqual([noSpendHabit.id]);

    const habitPatches = update.mock.calls
      .map(([, data]) => data as Record<string, unknown>)
      .filter((data) => "totalCount" in data);
    expect(habitPatches.length).toBeGreaterThan(0);
    for (const patch of habitPatches) {
      expect(Object.keys(patch).filter((k) => k.startsWith("completedBy"))).toEqual([]);
    }
  });

  it("writes no attributedTo on the submission it stages", async () => {
    const { set } = await runFire(noSpendHabit.data);

    const submissions = set.mock.calls
      .map(([, data]) => data as Record<string, unknown>)
      .filter((data) => "habitId" in data);
    expect(submissions.length).toBeGreaterThan(0);
    for (const submission of submissions) {
      expect(submission).not.toHaveProperty("attributedTo");
      expect(submission).not.toHaveProperty("creditsHousehold");
    }
  });

  // A no-spend habit deliberately set to household credit must stay that way —
  // there is no card here that could ever override it.
  it("stays unattributed even for a creditMode: 'household' no-spend habit", async () => {
    const { update } = await runFire({ ...noSpendHabit.data, creditMode: "household" });
    for (const [, data] of update.mock.calls) {
      expect(
        Object.keys(data as Record<string, unknown>).filter((k) => k.startsWith("completedBy")),
      ).toEqual([]);
    }
  });
});

describe("the client's resolver is the rule a server fire would have to adopt", () => {
  const roster = currentMemberPredicate([{ uid: MEMBER }]);
  const account = { cardOwners: { "8899": MEMBER } };

  // A no-spend day has NO transaction and therefore no card digits at all —
  // feeding the shared resolver what that path could ever know yields `null`,
  // which is exactly what `applyNoSpendDay` writes above.
  it("declines with no card digits, matching what the no-spend path writes", () => {
    expect(
      resolveCardFireAttribution({
        habit: { creditMode: "members" },
        account,
        cardLast4: undefined,
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it("declines for household credit even when a card owner IS resolvable", () => {
    expect(
      resolveCardFireAttribution({
        habit: { creditMode: "household" },
        account,
        cardLast4: "8899",
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it("declines for a uid that is not on the roster", () => {
    expect(
      resolveCardFireAttribution({
        habit: { creditMode: "members" },
        account: { cardOwners: { "8899": "uid-departed" } },
        cardLast4: "8899",
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it("credits the card owner when — and only when — every gate passes", () => {
    expect(
      resolveCardFireAttribution({
        habit: { creditMode: "members" },
        account,
        cardLast4: "8899",
        isCurrentMember: roster,
      }),
    ).toBe(MEMBER);
  });
});
