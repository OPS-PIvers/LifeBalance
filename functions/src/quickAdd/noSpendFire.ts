/**
 * F-HABITS-14 — turn the nightly bank sync's no-spend verdict into habit fires.
 *
 * Called from `bankEmailSync` once per processed email. It answers "was the day
 * that just ended a no-spend day?" (see noSpendDay.ts for what that means and
 * what it deliberately ignores), records the verdict, and fires any habit wired
 * to it — all staged onto the caller's existing batch so the whole email remains
 * one atomic commit.
 *
 * Firing SERVER-side rather than on next app open is the point: the email lands
 * around 3am, and the push it triggers is the reward. The cost is a duplicated
 * scoring path (`backdatedHabitFire.ts`), which must stay in lockstep with the
 * client's `computeBackdatedHabitFire`.
 *
 * Reads happen freely alongside staging because the caller uses a WriteBatch,
 * not a transaction — nothing here needs to be read-consistent with the batch.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { computeBackdatedHabitFire, type BackdatableHabit } from "./backdatedHabitFire";
import { habitPeriodStart } from "./streakLogic";
import {
  spendExemption,
  weekendPartnerDate,
  type SpendCandidate,
} from "./noSpendDay";
import type { MerchantRule } from "./merchantRules";
import { addDays, format, parseISO } from "date-fns";

/** The no-spend scope stored on a habit (mirrors `NoSpendScope` in types/schema.ts). */
export type NoSpendScope = "day" | "weekend";

/**
 * Cap on habits fired from one email. Keeps `bankEmailSync`'s Firestore
 * batch-size proof intact: this stages 1 (the verdict doc) + 2 per fired habit
 * (habit doc + submission doc) + 1 (the merged household update), so the worst
 * case adds 1 + 2*10 + 1 = 22 writes on top of the withdrawal budget.
 *
 * A household with more than ten habits wired to the same trigger is
 * pathological; the excess is logged rather than silently dropped.
 */
export const MAX_NO_SPEND_HABITS = 10;

/** One habit that actually fired. */
export interface NoSpendHabitFire {
  habitId: string;
  title: string;
  scope: NoSpendScope;
  pointsEarned: number;
  /** Streak ending on the credited date, after this fire. */
  streak: number;
}

/** One entry the freeze bank's `history` array gets, per refunded token. */
export interface NoSpendFreezeRefundNote {
  habitId: string;
  habitDate: string;
  title: string;
}

/**
 * One habit fire STAGED (not yet committed) by THIS call, reported back so
 * the caller can fold it into a LATER same-batch day's scoring — see
 * `ApplyNoSpendDayDeps.stagedCompletionsByHabit`'s doc for the two problems
 * this exists to solve.
 */
export interface StagedNoSpendFire {
  habitId: string;
  /** The date this fire was credited to (== the day judged). */
  date: string;
  /**
   * Units this fire contributed toward its scoring PERIOD — always 1
   * (mirrors the submission doc's hardcoded `count: 1`).
   */
  count: number;
  /**
   * True when this fire's own computation newly completed `date` (mirrors
   * `BackdatedHabitFireDelta.addedDate !== undefined`) — i.e. whether
   * `date` would land in `completedDates` once this batch commits. For an
   * INCREMENTAL habit this is true on essentially every fire; for a
   * THRESHOLD habit only on the fire that actually crosses its target that
   * period (a non-crossing threshold fire still banks a unit — see `count`
   * — but does NOT complete the date).
   */
  completedDate: boolean;
}

export interface NoSpendOutcome {
  /** The day judged (yyyy-MM-dd) — the day that had ENDED when the email arrived. */
  targetDate: string;
  /** True when nothing unplanned was spent that day. */
  isNoSpendDay: boolean;
  /** Merchants that disqualified the day (empty when `isNoSpendDay`). */
  blockedBy: string[];
  /** Habits credited. Empty when nothing is wired up, or already credited. */
  fired: NoSpendHabitFire[];
  /**
   * True when the Saturday+Sunday weekend rule HELD — i.e. `targetDate` is a
   * Sunday and its Saturday also has a no-spend verdict. Independent of whether
   * this run credited a weekend habit (see the note at the return site).
   */
  weekendCompleted: boolean;
  /**
   * Points delta THIS DAY's fires contributed (daily/weekly/total, matching
   * `Household.points`'s shape) — NOT staged onto the household doc here.
   * `applyNoSpendDay` deliberately never writes to the household doc: the
   * caller accumulates this across every day judged in a multi-day catch-up
   * run and applies ONE combined update after its judging loop (see
   * `bankEmailSync.ts`). See `freezeTokensRefunded`'s doc for why this
   * matters even though points, unlike freezeBank, use a transform.
   */
  pointsDelta: { daily: number; weekly: number; total: number };
  /**
   * Freeze tokens earned back by an unfreeze fire ON THIS DAY. Also NOT
   * staged here — the caller accumulates this (and `freezeRefundNotes`)
   * across every judged day and writes `Household.freezeBank` ONCE, computed
   * from the single pre-batch household snapshot plus the total.
   *
   * This is the field that made the original design unsafe: `freezeBank` is
   * a whole-object, non-transform write built from `householdData` — a
   * snapshot loaded ONCE, before the batch, by the caller. When
   * `applyNoSpendDay` ran once per email that was fine. Once the catch-up
   * window could call it several times on the SAME batch, every call still
   * read from that SAME stale snapshot, so two days that each refund a token
   * would BOTH compute `tokens: original + 1` — Firestore applies same-batch
   * writes to one document in order, so the LAST one staged wins and an
   * earlier day's refund (and its history entry) is silently lost. Points
   * are technically safe as bare `FieldValue.increment` calls even across
   * multiple same-batch writes to the same doc (Firestore transforms are
   * relative and apply in order), but are accumulated here too, for one
   * simple, auditable household write per email rather than leaning on that
   * guarantee.
   */
  freezeTokensRefunded: number;
  /** One entry per refunded token this day contributed. */
  freezeRefundNotes: NoSpendFreezeRefundNote[];
  /**
   * One entry per habit THIS DAY fired, for the CALLER to fold into a LATER
   * same-batch day's `stagedCompletionsByHabit` (see that field's doc on
   * `ApplyNoSpendDayDeps`). Distinct from `fired` (the user-facing summary
   * used for the push/ledger): this carries the bookkeeping a later day's
   * scoring needs, not what a notification says.
   */
  stagedFires: StagedNoSpendFire[];
}

/** Read the `triggers.noSpend` scope off a raw habit doc, or null. */
function readNoSpendScope(data: Record<string, unknown>): NoSpendScope | null {
  const triggers = data.triggers;
  if (!triggers || typeof triggers !== "object") return null;
  const scope = (triggers as { noSpend?: unknown }).noSpend;
  return scope === "day" || scope === "weekend" ? scope : null;
}

/** Coerce a raw habit doc into the shape the back-dated fire reads. */
function toBackdatableHabit(id: string, data: Record<string, unknown>): BackdatableHabit | null {
  const period = data.period === "weekly" ? "weekly" : "daily";
  const scoringType = data.scoringType === "incremental" ? "incremental" : "threshold";
  const basePoints = typeof data.basePoints === "number" ? data.basePoints : NaN;
  if (!Number.isFinite(basePoints)) return null;
  const completedDates = Array.isArray(data.completedDates)
    ? data.completedDates.filter((d): d is string => typeof d === "string")
    : [];
  return {
    id,
    type: data.type === "negative" ? "negative" : "positive",
    basePoints,
    scoringType,
    period,
    targetCount: typeof data.targetCount === "number" ? data.targetCount : 1,
    count: typeof data.count === "number" ? data.count : 0,
    totalCount: typeof data.totalCount === "number" ? data.totalCount : 0,
    completedDates,
    streakDays: typeof data.streakDays === "number" ? data.streakDays : 0,
    lastUpdated: typeof data.lastUpdated === "string" ? data.lastUpdated : "",
    ...(Array.isArray(data.frozenDates)
      ? { frozenDates: data.frozenDates.filter((d): d is string => typeof d === "string") }
      : {}),
    ...(typeof data.pausedUntil === "string" ? { pausedUntil: data.pausedUntil } : {}),
    ...(typeof data.archivedAt === "string" && data.archivedAt
      ? { archivedAt: data.archivedAt }
      : {}),
  };
}

export interface ApplyNoSpendDayDeps {
  db: admin.firestore.Firestore;
  householdId: string;
  batch: admin.firestore.WriteBatch;
  /** The day being judged (yyyy-MM-dd, household-local). */
  targetDate: string;
  /** The household's local "today" (yyyy-MM-dd) — NOT the function's UTC date. */
  today: string;
  /**
   * Spend this email is about to CREATE that the transactions query can't see
   * yet, already filtered to `targetDate`. Rows the email confirms/fills already
   * exist in the query; rows it files as bills are exempt anyway.
   */
  extraSpend: SpendCandidate[];
  /**
   * The household's merchant rules, so an `exempt` rule stops a charge breaking
   * the day. Applied to EVERY row the query loads, not just this email's new
   * ones — an exempted subscription must stay exempt on every later sync too.
   * Omit for the pre-rules behaviour.
   */
  merchantRules?: readonly MerchantRule[];
  /**
   * Dates already judged CLEAN earlier in this SAME batch (ascending order,
   * caller-maintained across a multi-day catch-up run — see
   * `bankEmailSync.ts`). These days' verdict docs are only STAGED on the
   * batch, not yet committed, so a plain Firestore `.get()` for them would
   * come back empty.
   *
   * Exists so a Saturday+Sunday pair settled by ONE catch-up email lets
   * Sunday's weekend check see Saturday's in-flight verdict — without this,
   * a single email judging both days of a weekend would silently miss the
   * weekend rule every time, reintroducing the exact bug the catch-up window
   * exists to fix. Omit when judging a single day (the pre-catch-up
   * behaviour): a plain Firestore read is then always correct, since
   * Saturday, if judged at all, was judged and committed by an EARLIER email.
   */
  stagedCleanDates?: ReadonlySet<string>;
  /**
   * Every habit fire STAGED (not yet committed) earlier in THIS SAME BATCH,
   * keyed by habitId — caller-maintained across a multi-day catch-up run
   * exactly like `stagedCleanDates` above (see `bankEmailSync.ts`).
   *
   * Fixes two staleness problems the catch-up window introduced. Both were
   * UNREACHABLE when `applyNoSpendDay` ran once per email, since the same
   * habit could never fire twice in one batch — this function's own reads
   * only ever see the last COMMITTED Firestore state, never a write staged
   * by an earlier day's call in this same batch:
   *
   * 1. STREAK. If the same "day"-scope habit fires on both Saturday and
   *    Sunday in one run, Sunday's streak computation would not know
   *    Saturday was ALSO completed this run — and since `streakDays` is
   *    written as a plain value, not a transform, the wrong, too-low
   *    streak/multiplier computed from that stale view is the one that
   *    survives (Firestore applies same-batch writes to one doc in order, so
   *    the LAST staged `streakDays` wins). Fixed below by folding each
   *    entry's `date` (only when `completedDate` is true) into the habit's
   *    `completedDates` before scoring THIS day's fire.
   *
   * 2. THRESHOLD ACCUMULATION. A threshold habit fired into a past period
   *    needs that period's already-recorded units (`priorPeriodCount`,
   *    read by querying committed submissions) to know whether THIS fire
   *    crosses the target. That query can't see a submission staged by an
   *    earlier day in this same batch either — so two days in the SAME
   *    scoring period (e.g. a weekly-period habit judged for both Saturday
   *    and Sunday) would each independently compute the target as not yet
   *    crossed and BOTH award full points, double-crediting the period.
   *    Fixed below by folding each entry's `count` (every entry, completed
   *    or not — a non-crossing fire still banks a unit toward the period)
   *    into `priorPeriodCount` when its `date` falls in the period being
   *    scored.
   *
   * `frozenDates` is deliberately NOT folded the same way `completedDates`
   * is: the streak walk treats a date that is in BOTH `completedDates` and
   * `frozenDates` identically to one in `completedDates` alone (it only
   * ever counts once), so leaving a same-batch unfreeze un-merged here is
   * harmless — simpler than threading a second accumulator for no behavior
   * change.
   */
  stagedCompletionsByHabit?: ReadonlyMap<string, readonly StagedNoSpendFire[]>;
}

/** A habit that survived the read phase and is ready to be scored + staged. */
interface ReadyFire {
  habit: BackdatableHabit;
  title: string;
  scope: NoSpendScope;
  priorPeriodCount: number;
}

/**
 * Judge `targetDate`, record the verdict, and stage any habit fires.
 *
 * Never throws: a failure here must not fail the money sync that already
 * succeeded, so problems are logged and reported as "not a no-spend day".
 *
 * Deliberately split into a READ phase and a STAGE phase with no awaits in the
 * latter. The caller's batch is shared with the money writes, so a throw partway
 * through staging would leave half a habit fire (say, a `completedDates`
 * arrayUnion with no matching submission or points) staged on a batch that then
 * commits anyway. Doing every read first means the staging phase cannot fail, so
 * the fire is all-or-nothing along with the rest of the email.
 */
export async function applyNoSpendDay(deps: ApplyNoSpendDayDeps): Promise<NoSpendOutcome> {
  const {
    db,
    householdId,
    batch,
    targetDate,
    today,
    extraSpend,
    merchantRules,
    stagedCleanDates,
    stagedCompletionsByHabit,
  } = deps;
  const notNoSpend: NoSpendOutcome = {
    targetDate,
    isNoSpendDay: false,
    blockedBy: [],
    fired: [],
    weekendCompleted: false,
    pointsDelta: { daily: 0, weekly: 0, total: 0 },
    freezeTokensRefunded: 0,
    freezeRefundNotes: [],
    stagedFires: [],
  };

  // ---- READ PHASE (may throw; nothing is staged yet) ----
  let candidateCount = 0;
  let weekendClean = false;
  const ready: ReadyFire[] = [];
  try {
    // 1. Every transaction dated to the target day, across every account —
    //    the definition is app-wide, not checking-only, so a credit-card charge
    //    breaks the day too (as long as LifeBalance can see it).
    const txSnap = await db
      .collection(`households/${householdId}/transactions`)
      .where("date", "==", targetDate)
      .get();
    const candidates: SpendCandidate[] = [
      ...txSnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          amount: typeof data.amount === "number" ? data.amount : 0,
          merchant: typeof data.merchant === "string" ? data.merchant : "",
          category: typeof data.category === "string" ? data.category : "",
          ...(data.creditPayment === true ? { creditPayment: true } : {}),
          ...(data.needsAmount === true ? { needsAmount: true } : {}),
        };
      }),
      ...extraSpend,
    ];
    candidateCount = candidates.length;

    const blocked = candidates.filter((c) => spendExemption(c, merchantRules) === null);
    if (blocked.length > 0) {
      logger.info(
        `noSpend: ${targetDate} is not a no-spend day — ${blocked.length} unplanned ` +
          `transaction(s): ${blocked.map((b) => b.merchant).join(", ")}`
      );
      return { ...notNoSpend, blockedBy: blocked.map((b) => b.merchant) };
    }

    // 2. A "no-spend weekend" needs BOTH Saturday and Sunday clean, so it can
    //    only be settled from Monday's email (targetDate = Sunday). Saturday's
    //    verdict is read from its own doc rather than recomputed: that avoids a
    //    second transactions query AND makes "we never synced that day"
    //    distinguishable from "that day was clean" — absence of the doc means we
    //    have no evidence, and no evidence must not win a weekend.
    const saturday = weekendPartnerDate(targetDate);
    if (saturday) {
      if (stagedCleanDates?.has(saturday)) {
        // Saturday was judged clean earlier in THIS SAME BATCH — its verdict
        // doc is staged but not yet committed, so skip the read that would
        // otherwise miss it. See `ApplyNoSpendDayDeps.stagedCleanDates`.
        weekendClean = true;
      } else {
        const satDoc = await db.doc(`households/${householdId}/noSpendDays/${saturday}`).get();
        weekendClean = satDoc.exists;
      }
      if (!weekendClean) {
        logger.info(
          `noSpend: ${targetDate} (Sunday) was clean but ${saturday} has no no-spend ` +
            `record, so the weekend rule does not fire.`
        );
      }
    }

    // 3. Which habits are wired up. The habits collection is small (tens), so a
    //    full read beats a nested-field query needing an index.
    const habitsSnap = await db.collection(`households/${householdId}/habits`).get();
    const wired: { habit: BackdatableHabit; title: string; scope: NoSpendScope }[] = [];
    for (const doc of habitsSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const scope = readNoSpendScope(data);
      if (!scope) continue;
      if (scope === "weekend" && !weekendClean) continue;
      const habit = toBackdatableHabit(doc.id, data);
      // An archived habit must never fire (matches the transaction-keyword path).
      // A PAUSED one still may: a pause suppresses the miss penalty, not a fact
      // that actually happened — same as a transaction firing during a pause.
      if (!habit || habit.archivedAt) continue;
      wired.push({
        habit,
        title: typeof data.title === "string" ? data.title : "",
        scope,
      });
    }
    if (wired.length > MAX_NO_SPEND_HABITS) {
      logger.warn(
        `noSpend: ${wired.length} habits are wired to the no-spend trigger; firing ` +
          `only the first ${MAX_NO_SPEND_HABITS} to stay inside the Firestore batch limit.`
      );
      wired.length = MAX_NO_SPEND_HABITS;
    }

    // 4. Per-habit reads: the idempotency check and, for a threshold habit fired
    //    into a past period, that period's already-recorded units.
    for (const { habit, title, scope } of wired) {
      const submissionsRef = db.collection(
        `households/${householdId}/habits/${habit.id}/submissions`
      );

      // Per-(habit, day) idempotency. The ledger claim already stops the SAME
      // email being processed twice, but a second email the same morning (a
      // second account, or a backfill) would otherwise re-credit the day.
      const already = await submissionsRef
        .where("sourceNoSpendDate", "==", targetDate)
        .limit(1)
        .get();
      if (!already.empty) {
        logger.info(`noSpend: habit ${habit.id} already credited for ${targetDate}; skipping.`);
        continue;
      }

      // A THRESHOLD habit fired into a PAST period needs that period's already-
      // recorded units to know whether this fire crosses the target — the live
      // counter describes a later period and says nothing about it. Mirrors
      // updateTransactionCategory's prior-period read.
      let priorPeriodCount = 0;
      const periodStart = habitPeriodStart(habit.period, targetDate);
      if (
        habit.scoringType === "threshold" &&
        periodStart !== habitPeriodStart(habit.period, today)
      ) {
        const periodEnd =
          habit.period === "weekly"
            ? format(addDays(parseISO(periodStart), 6), "yyyy-MM-dd")
            : targetDate;
        try {
          const periodSnap = await submissionsRef
            .where("date", ">=", periodStart)
            .where("date", "<=", periodEnd)
            .get();
          priorPeriodCount = periodSnap.docs.reduce((sum, d) => {
            const c = (d.data() as { count?: unknown }).count;
            return sum + (typeof c === "number" ? c : 0);
          }, 0);
        } catch (err) {
          // Fall back to 0 — the pre-submissions assumption (this fire is the
          // period's first unit). Worst case a threshold habit is credited a
          // period early; blocking the fire would be worse.
          logger.warn(`noSpend: prior-period submission read failed for ${habit.id}:`, err);
        }

        // Fold in units STAGED (not committed) by an EARLIER day judged in
        // this same batch — the Firestore query above can't see them. See
        // `ApplyNoSpendDayDeps.stagedCompletionsByHabit`'s doc for why: a
        // targetCount>1 threshold habit spanning two judged days in the same
        // period would otherwise double-credit it.
        for (const staged of stagedCompletionsByHabit?.get(habit.id) ?? []) {
          if (staged.date >= periodStart && staged.date <= periodEnd) {
            priorPeriodCount += staged.count;
          }
        }
      }

      ready.push({ habit, title, scope, priorPeriodCount });
    }
  } catch (err) {
    // The money sync already succeeded by the time this runs; a habit-side
    // failure must not take it down, and nothing has been staged yet.
    logger.error("noSpend: evaluation failed; skipping the habit fire:", err);
    return notNoSpend;
  }

  // ---- STAGE PHASE (pure; no awaits, so it cannot fail partway) ----

  // Record the verdict. Doc id = the date, so this is idempotent by construction
  // and the weekend rule above can ask about Saturday with a single get-by-id.
  // Server-owned (firestore.rules denies client writes), which is what stops a
  // forged doc from minting habit points.
  batch.set(db.doc(`households/${householdId}/noSpendDays/${targetDate}`), {
    date: targetDate,
    exemptCount: candidateCount,
    recordedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const fired: NoSpendHabitFire[] = [];
  const pointsDelta = { daily: 0, weekly: 0, total: 0 };
  let freezeTokensRefunded = 0;
  const freezeRefundNotes: { habitId: string; habitDate: string; title: string }[] = [];
  const stagedFires: StagedNoSpendFire[] = [];

  for (const { habit, title, scope, priorPeriodCount } of ready) {
    const submissionsRef = db.collection(
      `households/${householdId}/habits/${habit.id}/submissions`
    );

    // Fold in dates that became NEWLY COMPLETE earlier in this same batch
    // (see `ApplyNoSpendDayDeps.stagedCompletionsByHabit`'s doc — this is
    // the STREAK half of the fix). `habit.completedDates` alone is still the
    // pre-batch value, since Firestore reads never see uncommitted writes.
    const stagedCompletedDates = (stagedCompletionsByHabit?.get(habit.id) ?? [])
      .filter((s) => s.completedDate)
      .map((s) => s.date);
    const effectiveHabit: BackdatableHabit =
      stagedCompletedDates.length === 0
        ? habit
        : {
            ...habit,
            completedDates: Array.from(new Set([...habit.completedDates, ...stagedCompletedDates])),
          };

    const fire = computeBackdatedHabitFire(effectiveHabit, targetDate, today, priorPeriodCount);
    if (!fire) continue;

    // DELTA WRITES only — never a whole `completedDates` array (2026-07-15
    // habit-history clobber incident).
    batch.update(db.doc(`households/${householdId}/habits/${habit.id}`), {
      ...(fire.resetCount
        ? { count: fire.count }
        : fire.countDelta !== 0
          ? { count: admin.firestore.FieldValue.increment(fire.countDelta) }
          : {}),
      totalCount: admin.firestore.FieldValue.increment(fire.totalCountDelta),
      ...(fire.addedDate !== undefined
        ? { completedDates: admin.firestore.FieldValue.arrayUnion(fire.addedDate) }
        : {}),
      ...(fire.unfrozenDate !== undefined
        ? { frozenDates: admin.firestore.FieldValue.arrayRemove(fire.unfrozenDate) }
        : {}),
      streakDays: fire.streakDays,
      // The fire IS a submission, so the calendar/insight paths read this
      // habit's stored per-date units instead of inferring one per date.
      hasSubmissionTracking: true,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });

    // The submission doc is the back-dated record AND the idempotency key.
    batch.set(submissionsRef.doc(), {
      habitId: habit.id,
      habitTitle: title,
      // No true time of day exists for a whole-day verdict, so noon is the same
      // deliberate placeholder the transaction path uses: it renders as "time
      // unknown" rather than implying a moment. Unlike the client, which anchors
      // noon in the user's own timezone, this is noon UTC — the household's
      // offset isn't available here. That keeps the rendered calendar day equal
      // to `date` for every offset from UTC-12 to UTC+11, and `date` (not this)
      // is what every grouping path actually reads.
      timestamp: `${targetDate}T12:00:00.000Z`,
      date: targetDate,
      count: 1,
      pointsEarned: fire.pointsEarned,
      streakDaysAtTime: fire.streakAtFireDate,
      multiplierApplied: fire.multiplier,
      createdBy: "system",
      createdAt: new Date().toISOString(),
      sourceNoSpendDate: targetDate,
    });

    if (fire.unfrozenDate !== undefined) {
      freezeTokensRefunded++;
      freezeRefundNotes.push({ habitId: habit.id, habitDate: fire.unfrozenDate, title });
    }

    pointsDelta.daily += fire.pointsDelta.daily;
    pointsDelta.weekly += fire.pointsDelta.weekly;
    pointsDelta.total += fire.pointsDelta.total;
    fired.push({
      habitId: habit.id,
      title,
      scope,
      pointsEarned: fire.pointsEarned,
      streak: fire.streakAtFireDate,
    });
    stagedFires.push({
      habitId: habit.id,
      date: targetDate,
      count: 1,
      completedDate: fire.addedDate !== undefined,
    });
  }

  // Deliberately NO household-doc write here. Points and any owed-back
  // freeze token both live on `households/{id}`, and the OLD single-call
  // design merged them into one `batch.update` right at this point — safe
  // when `applyNoSpendDay` ran once per email. Now that the catch-up window
  // can call this function several times against the SAME batch, staging a
  // `freezeBank` write per call is unsafe: it is a whole-object (non-
  // transform) value built from a household snapshot the CALLER loaded once,
  // before the batch — so two days that each refund a token would both
  // compute `tokens: original + 1`, and Firestore applying same-batch writes
  // to one document in order means the LAST one staged wins, silently
  // dropping the earlier day's refund. So this function only REPORTS what it
  // would have written (`pointsDelta`, `freezeTokensRefunded`,
  // `freezeRefundNotes`, below) — the caller accumulates those across every
  // judged day and stages exactly ONE combined household update after its
  // loop. See `NoSpendOutcome.freezeTokensRefunded`'s doc for the full story.

  return {
    targetDate,
    isNoSpendDay: true,
    blockedBy: [],
    fired,
    // Reports whether the WEEKEND RULE held, not whether this particular run
    // fired a weekend habit. Those differ when a second email arrives the same
    // morning (another account, or a backfill): the habits were already credited
    // by the first run and skipped by the idempotency check, so `fired` is empty
    // — and keying off it would make the re-run announce "No spend day" and
    // record a non-weekend in the ledger for a weekend that was in fact settled.
    // `weekendClean` is only ever true when targetDate is a Sunday whose Saturday
    // also has a verdict, so it states a fact about the weekend that holds
    // regardless of which run observed it, or whether any habit is wired up.
    weekendCompleted: weekendClean,
    pointsDelta,
    freezeTokensRefunded,
    freezeRefundNotes,
    stagedFires,
  };
}
