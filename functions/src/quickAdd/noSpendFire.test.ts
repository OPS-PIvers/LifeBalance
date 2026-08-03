/**
 * Unit tests for `applyNoSpendDay`'s multi-day catch-up behavior.
 *
 * Two regressions this suite guards specifically:
 *
 * 1. In-batch weekend visibility (`stagedCleanDates`): when one email judges
 *    both Saturday and Sunday, Saturday's verdict doc is only STAGED on the
 *    batch, not committed, so a plain Firestore read for it would come back
 *    empty. `applyNoSpendDay` must trust the caller-threaded
 *    `stagedCleanDates` set instead of hitting Firestore in that case — this
 *    is the deepest, easiest-to-silently-break part of the whole catch-up
 *    fix (delete the `stagedCleanDates?.has(saturday)` branch and everything
 *    still compiles and most other tests still pass, but "Clean weekend"
 *    silently stops firing again — the exact bug the catch-up window exists
 *    to remove).
 *
 * 2. Freeze-refund reporting: `applyNoSpendDay` must NEVER write to the
 *    household doc itself (points or `freezeBank`) — it only REPORTS what it
 *    would refund via the returned `NoSpendOutcome`, so the caller
 *    (`bankEmailSync.ts`) can accumulate across every day judged in one
 *    batch and stage exactly ONE combined household update. Two per-call
 *    household writes, each built from the same stale pre-batch snapshot, is
 *    exactly the clobber bug this suite guards against re-introducing.
 *
 * Firestore is a small hand-built fake, not a real emulator (this repo's
 * Firestore emulator can't run locally on Windows) — just enough surface
 * (`collection().where().get()`, `doc().get()`, `batch.set/update`) for
 * `applyNoSpendDay`'s actual call shape, mirroring the minimal-mock style
 * already used in `bankEmailSync.test.ts`/`index.test.ts` for
 * `firebase-admin`/`firebase-functions`.
 */

import { describe, it, expect, vi } from "vitest";

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

const HOUSEHOLD_ID = "hh1";

type FakeDocData = Record<string, unknown>;

/**
 * A minimal fake `admin.firestore.Firestore` covering exactly what
 * `applyNoSpendDay` calls: a transactions date-equality query, an optional
 * `noSpendDays/{date}` doc read (the weekend-partner check), a full habits
 * collection read, and a per-habit submissions idempotency/prior-period
 * query. Everything else throws, so an unexpected call fails loudly rather
 * than silently returning something misleading.
 */
function makeFakeDb(config: {
  transactionsByDate: Record<string, FakeDocData[]>;
  noSpendDayExists: Record<string, boolean>;
  habits: { id: string; data: FakeDocData }[];
  creditedSubmissions?: Set<string>;
}): { db: ApplyNoSpendDayDeps["db"]; noSpendDayGetSpy: ReturnType<typeof vi.fn> } {
  const noSpendDayGetSpy = vi.fn();
  const creditedSubmissions = config.creditedSubmissions ?? new Set<string>();

  const collection = (path: string) => {
    if (path.endsWith("/transactions")) {
      return {
        where: (_field: string, _op: string, value: string) => ({
          get: async () => ({
            docs: (config.transactionsByDate[value] ?? []).map((data, i) => ({
              id: `tx${i}`,
              data: () => data,
            })),
          }),
        }),
      };
    }
    if (path.endsWith("/habits")) {
      return {
        get: async () => ({
          docs: config.habits.map((h) => ({ id: h.id, data: () => h.data })),
        }),
      };
    }
    const submissionsMatch = path.match(/\/habits\/([^/]+)\/submissions$/);
    if (submissionsMatch) {
      const habitId = submissionsMatch[1];
      return {
        where: (field: string, _op: string, value: string) => {
          if (field === "sourceNoSpendDate") {
            return {
              limit: () => ({
                get: async () => ({
                  empty: !creditedSubmissions.has(`${habitId}|${value}`),
                }),
              }),
            };
          }
          // Prior-period range query (threshold habits fired into a past
          // period) — unused by these fixtures, which are all incremental.
          return { where: () => ({ get: async () => ({ docs: [] }) }) };
        },
        doc: () => ({ path: `${path}/new` }),
      };
    }
    throw new Error(`makeFakeDb: unexpected collection path ${path}`);
  };

  const doc = (path: string) => {
    const noSpendDayMatch = path.match(/\/noSpendDays\/([^/]+)$/);
    if (noSpendDayMatch) {
      const date = noSpendDayMatch[1]!;
      return {
        path,
        get: async () => {
          noSpendDayGetSpy(date);
          return { exists: config.noSpendDayExists[date] === true };
        },
      };
    }
    return { path };
  };

  return {
    db: { collection, doc } as unknown as ApplyNoSpendDayDeps["db"],
    noSpendDayGetSpy,
  };
}

function makeFakeBatch(): {
  batch: ApplyNoSpendDayDeps["batch"];
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const update = vi.fn();
  return { batch: { set, update } as unknown as ApplyNoSpendDayDeps["batch"], set, update };
}

/** Ref paths a spy recorded a set()/update() call against. */
function refPaths(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.map(([ref]) => (ref as { path: string }).path);
}

const dayHabit = (id: string, over: FakeDocData = {}): { id: string; data: FakeDocData } => ({
  id,
  data: {
    title: `Habit ${id}`,
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
    ...over,
  },
});

describe("applyNoSpendDay — in-batch weekend visibility (stagedCleanDates)", () => {
  const SATURDAY = "2026-07-25";
  const SUNDAY = "2026-07-26";
  const TODAY = "2026-07-27"; // Monday's catch-up email

  const weekendHabit = {
    id: "habit-weekend",
    data: {
      title: "Clean weekend",
      type: "positive",
      basePoints: 15,
      scoringType: "incremental",
      period: "weekly",
      targetCount: 1,
      count: 0,
      totalCount: 0,
      completedDates: [],
      streakDays: 0,
      lastUpdated: "2026-07-20T00:00:00.000Z",
      triggers: { noSpend: "weekend" },
    },
  };

  it("credits Sunday's weekend rule from Saturday's STAGED (not yet committed) verdict", async () => {
    const { db, noSpendDayGetSpy } = makeFakeDb({
      transactionsByDate: { [SATURDAY]: [], [SUNDAY]: [] },
      // Deliberately FALSE: if the code fell through to a real Firestore
      // read for Saturday instead of trusting `stagedCleanDates`, the
      // weekend rule would wrongly fail to fire and this test would catch it.
      noSpendDayExists: { [SATURDAY]: false },
      habits: [weekendHabit],
    });
    const { batch } = makeFakeBatch();

    // Call 1: Saturday, exactly like the caller's first loop iteration — no
    // stagedCleanDates yet.
    const saturdayOutcome = await applyNoSpendDay({
      db,
      householdId: HOUSEHOLD_ID,
      batch,
      targetDate: SATURDAY,
      today: TODAY,
      extraSpend: [],
    });
    expect(saturdayOutcome.isNoSpendDay).toBe(true);

    // The caller (bankEmailSync.ts) adds a clean day to the set right after
    // each call returns, before judging the next one.
    const stagedCleanDates = new Set<string>();
    if (saturdayOutcome.isNoSpendDay) stagedCleanDates.add(SATURDAY);

    // Call 2: Sunday, in the SAME batch, with Saturday's clean verdict staged.
    const sundayOutcome = await applyNoSpendDay({
      db,
      householdId: HOUSEHOLD_ID,
      batch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
      stagedCleanDates,
    });

    expect(sundayOutcome.isNoSpendDay).toBe(true);
    expect(sundayOutcome.weekendCompleted).toBe(true);
    expect(sundayOutcome.fired).toHaveLength(1);
    expect(sundayOutcome.fired[0]?.scope).toBe("weekend");

    // The weekend check must never have hit Firestore for Saturday's doc —
    // proof the staged-set branch, not the read fallback, was actually taken.
    expect(noSpendDayGetSpy).not.toHaveBeenCalled();
  });

  it("falls back to a real Firestore read (and correctly fails the weekend rule) without stagedCleanDates", async () => {
    // Sunday judged in ISOLATION (no stagedCleanDates) — the pre-catch-up,
    // single-day-per-email shape. Saturday's doc genuinely doesn't exist, so
    // the weekend rule correctly does not fire — this is the control case
    // proving the fake db's read path works at all.
    const { db, noSpendDayGetSpy } = makeFakeDb({
      transactionsByDate: { [SUNDAY]: [] },
      noSpendDayExists: {},
      habits: [weekendHabit],
    });
    const { batch } = makeFakeBatch();

    const sundayOutcome = await applyNoSpendDay({
      db,
      householdId: HOUSEHOLD_ID,
      batch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
    });

    expect(sundayOutcome.weekendCompleted).toBe(false);
    expect(sundayOutcome.fired).toHaveLength(0);
    expect(noSpendDayGetSpy).toHaveBeenCalledWith(SATURDAY);
  });
});

describe("applyNoSpendDay — freeze-refund reporting (no household write)", () => {
  const SATURDAY = "2026-07-25";
  const SUNDAY = "2026-07-26";
  const TODAY = "2026-07-27";

  it("reports each day's own refund without ever writing the household doc, so the caller can sum them", async () => {
    const satHabit = dayHabit("habit-sat", { frozenDates: [SATURDAY] });
    const sunHabit = dayHabit("habit-sun", { frozenDates: [SUNDAY] });

    const { db: satDb } = makeFakeDb({
      transactionsByDate: { [SATURDAY]: [] },
      noSpendDayExists: {},
      habits: [satHabit],
    });
    const { batch: satBatch, update: satUpdateSpy, set: satSetSpy } = makeFakeBatch();

    const saturdayOutcome = await applyNoSpendDay({
      db: satDb,
      householdId: HOUSEHOLD_ID,
      batch: satBatch,
      targetDate: SATURDAY,
      today: TODAY,
      extraSpend: [],
    });

    const { db: sunDb } = makeFakeDb({
      transactionsByDate: { [SUNDAY]: [] },
      noSpendDayExists: {},
      habits: [sunHabit],
    });
    const { batch: sunBatch, update: sunUpdateSpy, set: sunSetSpy } = makeFakeBatch();

    const sundayOutcome = await applyNoSpendDay({
      db: sunDb,
      householdId: HOUSEHOLD_ID,
      batch: sunBatch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
    });

    // Each day correctly reports its OWN refund...
    expect(saturdayOutcome.freezeTokensRefunded).toBe(1);
    expect(saturdayOutcome.freezeRefundNotes).toEqual([
      { habitId: "habit-sat", habitDate: SATURDAY, title: "Habit habit-sat" },
    ]);
    expect(sundayOutcome.freezeTokensRefunded).toBe(1);
    expect(sundayOutcome.freezeRefundNotes).toEqual([
      { habitId: "habit-sun", habitDate: SUNDAY, title: "Habit habit-sun" },
    ]);

    // ...and a naive caller-side sum recovers the correct total of 2 — this
    // is exactly what the OLD per-call whole-object `freezeBank` write could
    // NOT do (the second write would have silently clobbered the first,
    // since both were computed from the same stale pre-batch snapshot).
    const totalRefunded =
      saturdayOutcome.freezeTokensRefunded + sundayOutcome.freezeTokensRefunded;
    expect(totalRefunded).toBe(2);
    const allNotes = [...saturdayOutcome.freezeRefundNotes, ...sundayOutcome.freezeRefundNotes];
    expect(allNotes).toHaveLength(2);

    // Neither call may EVER write the bare household doc — that
    // responsibility moved entirely to the caller (bankEmailSync.ts), which
    // combines both days' refunds into ONE write after its judging loop.
    const householdDocPath = `households/${HOUSEHOLD_ID}`;
    expect(refPaths(satUpdateSpy)).not.toContain(householdDocPath);
    expect(refPaths(satSetSpy)).not.toContain(householdDocPath);
    expect(refPaths(sunUpdateSpy)).not.toContain(householdDocPath);
    expect(refPaths(sunSetSpy)).not.toContain(householdDocPath);
  });
});
