/**
 * Unit tests for `applyNoSpendDay`'s multi-day catch-up behavior.
 *
 * Four regressions this suite guards specifically — all UNREACHABLE before
 * the catch-up window, since `applyNoSpendDay` used to run at most once per
 * batch:
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
 * 3. Cross-day STREAK staleness (`stagedCompletionsByHabit`): if the SAME
 *    habit fires on two different days judged in one batch (e.g. a
 *    "day"-scope habit clean on both Saturday and Sunday — the headline case
 *    the catch-up window exists to enable), a later day's read of the habits
 *    collection can't see an earlier day's in-flight (staged, uncommitted)
 *    completion, so its streak would be computed as if that day never
 *    happened — and since `streakDays` is a plain-value write, not a
 *    transform, the wrong value is the one that survives.
 *
 * 4. Cross-day THRESHOLD accumulation: the same staleness for a threshold
 *    habit's `priorPeriodCount` (queried from Firestore, which can't see a
 *    same-batch staged submission either) — a targetCount=1 habit would
 *    double-credit two days in the same period, and a targetCount>1 habit
 *    would never accumulate enough units to cross at all.
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

describe("applyNoSpendDay — cross-day streak staleness (stagedCompletionsByHabit)", () => {
  const SATURDAY = "2026-07-25";
  const SUNDAY = "2026-07-26";
  const TODAY = "2026-07-27"; // Monday's catch-up email

  it("computes Sunday's streak as 2 (both days) when Saturday's completion was only STAGED, not committed", async () => {
    const habit = dayHabit("habit-daily-streak");

    // Call 1: Saturday, exactly like the caller's first loop iteration.
    const { db: satDb } = makeFakeDb({
      transactionsByDate: { [SATURDAY]: [] },
      noSpendDayExists: {},
      habits: [habit],
    });
    const { batch: satBatch } = makeFakeBatch();
    const saturdayOutcome = await applyNoSpendDay({
      db: satDb,
      householdId: HOUSEHOLD_ID,
      batch: satBatch,
      targetDate: SATURDAY,
      today: TODAY,
      extraSpend: [],
    });
    expect(saturdayOutcome.fired).toHaveLength(1);
    expect(saturdayOutcome.stagedFires).toEqual([
      { habitId: "habit-daily-streak", date: SATURDAY, count: 1, completedDate: true },
    ]);

    // The caller (bankEmailSync.ts) folds every returned `stagedFires` entry
    // into an accumulator, keyed by habitId, right after each call returns.
    const stagedCompletionsByHabit = new Map<string, typeof saturdayOutcome.stagedFires>();
    for (const sf of saturdayOutcome.stagedFires) {
      const list = stagedCompletionsByHabit.get(sf.habitId) ?? [];
      list.push(sf);
      stagedCompletionsByHabit.set(sf.habitId, list);
    }

    // Call 2: Sunday, SAME habit id, in the SAME batch — the habit fixture
    // fed to the fake db is UNCHANGED (still the pre-batch committed state,
    // exactly what a real Firestore read would return), so anything correct
    // about Sunday's streak has to come from `stagedCompletionsByHabit`.
    const { db: sunDb } = makeFakeDb({
      transactionsByDate: { [SUNDAY]: [] },
      noSpendDayExists: {},
      habits: [habit],
    });
    const { batch: sunBatch, update: sunUpdateSpy } = makeFakeBatch();
    const sundayOutcome = await applyNoSpendDay({
      db: sunDb,
      householdId: HOUSEHOLD_ID,
      batch: sunBatch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
      stagedCompletionsByHabit,
    });

    expect(sundayOutcome.fired).toHaveLength(1);
    // The streak reported for the submission (and used for the multiplier)
    // must reflect BOTH days, not just Sunday in isolation.
    expect(sundayOutcome.fired[0]?.streak).toBe(2);

    // And the actual habit-doc write staged on the batch must carry the same
    // correct value — this is the exact field (`streakDays`, written as a
    // plain value, not a transform) the review flagged as the one that
    // clobbers when two same-batch writes disagree.
    const habitUpdateCall = sunUpdateSpy.mock.calls.find(([ref]) =>
      (ref as { path: string }).path.endsWith("/habits/habit-daily-streak")
    );
    expect(habitUpdateCall).toBeDefined();
    expect((habitUpdateCall?.[1] as { streakDays: number }).streakDays).toBe(2);
  });

  // Control case proving the bug is real: same fixtures, but Sunday judged
  // with no knowledge of Saturday's same-batch fire (the shape this whole
  // fix replaces). Sunday's streak is wrongly computed as 1, as if Saturday
  // never happened.
  it("regression control: without stagedCompletionsByHabit, Sunday's streak wrongly ignores Saturday", async () => {
    const habit = dayHabit("habit-daily-streak-control");
    const { db: sunDb } = makeFakeDb({
      transactionsByDate: { [SUNDAY]: [] },
      noSpendDayExists: {},
      habits: [habit],
    });
    const { batch: sunBatch } = makeFakeBatch();
    const sundayOutcome = await applyNoSpendDay({
      db: sunDb,
      householdId: HOUSEHOLD_ID,
      batch: sunBatch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
      // No stagedCompletionsByHabit — Saturday's fire is invisible.
    });
    expect(sundayOutcome.fired[0]?.streak).toBe(1);
  });
});

describe("applyNoSpendDay — cross-day threshold accumulation (stagedCompletionsByHabit)", () => {
  const SATURDAY = "2026-07-25";
  const SUNDAY = "2026-07-26"; // same ISO week as Saturday (week of 2026-07-20)
  const TODAY = "2026-07-27";

  const weeklyThresholdHabit = (id: string): { id: string; data: FakeDocData } => ({
    id,
    data: {
      title: "Once a week is enough",
      type: "positive",
      basePoints: 20,
      scoringType: "threshold",
      period: "weekly",
      targetCount: 1,
      count: 0,
      totalCount: 0,
      completedDates: [],
      streakDays: 0,
      lastUpdated: "2026-07-01T00:00:00.000Z",
      triggers: { noSpend: "day" },
    },
  });

  it("does not double-credit a targetCount=1 weekly habit across two judged days in the same ISO week", async () => {
    const habit = weeklyThresholdHabit("habit-weekly-threshold");

    const { db: satDb } = makeFakeDb({
      transactionsByDate: { [SATURDAY]: [] },
      noSpendDayExists: {},
      habits: [habit],
    });
    const { batch: satBatch } = makeFakeBatch();
    const saturdayOutcome = await applyNoSpendDay({
      db: satDb,
      householdId: HOUSEHOLD_ID,
      batch: satBatch,
      targetDate: SATURDAY,
      today: TODAY,
      extraSpend: [],
    });
    // Saturday is the first day in the week, so it crosses the target itself.
    expect(saturdayOutcome.fired[0]?.pointsEarned).toBeGreaterThan(0);

    const stagedCompletionsByHabit = new Map<string, typeof saturdayOutcome.stagedFires>();
    for (const sf of saturdayOutcome.stagedFires) {
      const list = stagedCompletionsByHabit.get(sf.habitId) ?? [];
      list.push(sf);
      stagedCompletionsByHabit.set(sf.habitId, list);
    }

    const { db: sunDb } = makeFakeDb({
      transactionsByDate: { [SUNDAY]: [] },
      noSpendDayExists: {},
      habits: [habit],
    });
    const { batch: sunBatch } = makeFakeBatch();
    const sundayOutcome = await applyNoSpendDay({
      db: sunDb,
      householdId: HOUSEHOLD_ID,
      batch: sunBatch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
      stagedCompletionsByHabit,
    });

    // Sunday still gets a submission (a unit banked toward the period), but
    // must NOT earn points a second time — WITHOUT the fold, Sunday's own
    // `priorPeriodCount` read comes back 0 (the Firestore query can't see
    // Saturday's staged submission either), so it would wrongly cross the
    // target a second time and double the household's points for one week.
    expect(sundayOutcome.fired).toHaveLength(1);
    expect(sundayOutcome.fired[0]?.pointsEarned).toBe(0);
  });

  // Control case proving the double-credit is real absent the fold.
  it("regression control: without stagedCompletionsByHabit, Sunday double-credits the same week", async () => {
    const habit = weeklyThresholdHabit("habit-weekly-threshold-control");
    const { db: satDb } = makeFakeDb({
      transactionsByDate: { [SATURDAY]: [] },
      noSpendDayExists: {},
      habits: [habit],
    });
    const { batch: satBatch } = makeFakeBatch();
    await applyNoSpendDay({
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
      habits: [habit],
    });
    const { batch: sunBatch } = makeFakeBatch();
    const sundayOutcome = await applyNoSpendDay({
      db: sunDb,
      householdId: HOUSEHOLD_ID,
      batch: sunBatch,
      targetDate: SUNDAY,
      today: TODAY,
      extraSpend: [],
      // No stagedCompletionsByHabit — Saturday's crossing is invisible, so
      // Sunday's own (stale) priorPeriodCount read is 0 and it crosses again.
    });
    expect(sundayOutcome.fired[0]?.pointsEarned).toBeGreaterThan(0);
  });
});
