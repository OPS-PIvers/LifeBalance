import { Habit, Household, HouseholdMember } from '@/types/schema';
import {
  calculateHouseholdPointsForDateRange,
  calculateMemberPointsForDateRange,
} from '@/utils/habitAttribution';
import { getLocalDateString } from '@/utils/dateHelpers';
import { REDEMPTION_HISTORY_LIMIT } from '@/utils/redemption';

/**
 * Points-drift REPORT + APPLY-PLAN — a two-phase, read-then-guarded-write
 * repair for the specific `points.total` corruption documented in the
 * Developer Console:
 *
 *   1. a cross-member period award (a weekly threshold habit two members
 *      complete on different days) paid the household pool BOTH awards but
 *      wrote only one member's own `points.total` — the other member's award
 *      was silently dropped;
 *   2. `resetHabit`/`resetHabitDay`/a stale down-toggle over-debited the
 *      household pool on a mixed period.
 *
 * Both bugs are fixed going forward (see `habitAttribution.ts`'s reversal /
 * move helpers). `points.total` is a LIFETIME counter with no self-healing
 * downward path (`computeMemberPointsReset` deliberately omits `total`, and
 * `computeHouseholdPointsSync` only ever `Math.max()`s it upward) — so
 * whatever drift these bugs already banked stays banked forever unless
 * something explicitly corrects it. This module is that something.
 *
 * 🛡️ THE HARD CONSTRAINT this module is built around: `Habit.completedBy`
 * (per-member attribution) only exists from the day the per-member points
 * feature shipped. Every completion recorded before that has NO per-member
 * record at all — there is no way to know, from data alone, which member (if
 * any) a pre-attribution point belongs to. A naive "recompute every member's
 * total from habit data and diff against storage" would therefore score every
 * pre-attribution member at 0 and report them as wildly over-credited —
 * destroying legitimate history, which is categorically worse than leaving
 * drift unrepaired. So this module NEVER recomputes a member figure from data
 * that predates attribution; see `attributionStartDate` below.
 *
 * A second, quieter hazard: `points.total` is not exclusively a habit-scoring
 * value. To-do completion credits (managed kids only — `utils/todoPoints.ts`),
 * assigned-chore habit points (scored by the LEGACY per-habit scorer, which
 * `calculateMemberPointsForDateRange` deliberately excludes — see
 * `habitFeedsMemberAttribution`), reward redemptions (`redeemReward` debits
 * the household pool; `approveRedemption` debits a kid's own doc with NO
 * persistent audit trail once resolved), and submission-adjusted historical
 * days (`hasSubmissionTracking`, which `calculateMemberPointsForDateRange`
 * does not model at all) are all real, LEGITIMATE contributors to a stored
 * total that the two named scorers cannot see. Comparing a habit-only
 * recompute against a stored total that also reflects one of these would
 * manufacture phantom "drift" — and, worse, Phase 2 would then "fix" a
 * legitimate reward redemption by silently handing the spent points back.
 * `householdConfound()`/`memberConfound()` below are the DATA-DRIVEN gate for
 * every one of these cases: each is something we can actually detect from the
 * `household`/`members`/`habits` we're given, and any of them present makes
 * that row `cannot_determine` rather than a guess.
 *
 * ⚠️ KNOWN GAP, MITIGATED BY EXCLUSION: `PointsBreakdownModal`'s past-date
 * toggle deliberately skips the `points.total` adjustment for a THRESHOLD
 * habit ("we cannot accurately know if points were earned/lost... without
 * knowing the count for that day" — see that file), while still mutating
 * `completedDates`/`completedBy`. `periodCompleted()` in habitAttribution.ts
 * treats any `completedDates` entry in a PAST period as a completed period
 * regardless of `count`, so a manually restored past date on a threshold
 * habit can make this module's recompute see a "completed" period the stored
 * total never credited — a false positive this tool cannot distinguish from
 * a genuine bug-1 cross-member drop, because both look identical in
 * `completedBy`, and `PointsBreakdownModal` writes NO audit trail (it never
 * calls `appendActivityLog`) for this tool to cross-reference against. A
 * "the operator should manually check" mitigation asks a human to verify
 * something un-auditable, which is not a real control — so
 * `hasAnySharedThresholdHabit()` below makes ANY row touching a
 * threshold-scoring, non-assigned habit `cannot_determine`, full stop. This
 * is a deliberate, blunt trade: it also excludes the tool's own PRIMARY
 * target bug (bug 1 is specifically about a weekly THRESHOLD habit) until a
 * real data-level audit trail for `PointsBreakdownModal` edits exists —
 * reduced recall in exchange for never guessing at a lifetime counter's
 * one-way-downward correction. Do not remove this exclusion without first
 * building that audit trail.
 *
 * Do not write new habit-scoring logic here — every point figure is produced
 * by the existing, already-tested `calculateHouseholdPointsForDateRange` /
 * `calculateMemberPointsForDateRange` in `utils/habitAttribution.ts`.
 */

/** A fixed "beginning of time" bound for a full-history household recompute.
 *  Safe to use verbatim: both scorers only ever look at dates that actually
 *  appear in `completedDates`/`completedBy`, so an epoch far earlier than any
 *  real household costs nothing extra — it just never matches anything. */
const EPOCH_DATE = '2000-01-01';

export type DriftVerdict =
  | { kind: 'looks_correct' }
  /** Recomputed > stored: the household pool was debited more than the
   *  correct reversal amount (bug 2's household-level over-debit). */
  | { kind: 'over_debited'; amount: number }
  /** Recomputed > stored: this member's own award was never written
   *  (bug 1's cross-member under-credit). */
  | { kind: 'under_credited'; amount: number }
  | { kind: 'cannot_determine'; reason: string };

/** The signed correction `verdict` implies, in points — 0 for anything that
 *  isn't a determinable, positive-direction drift. */
export const proposedDeltaFor = (verdict: DriftVerdict): number => {
  if (verdict.kind === 'over_debited' || verdict.kind === 'under_credited') {
    return verdict.amount;
  }
  return 0;
};

export interface DriftRow {
  scope: 'household' | 'member';
  /** The household id for the household row; the member uid for a member row. */
  id: string;
  /** Display label for the report table. */
  label: string;
  storedTotal: number;
  /** Null exactly when `verdict.kind === 'cannot_determine'` and the row was
   *  blocked BEFORE a comparable figure could be computed at all. */
  recomputedTotal: number | null;
  verdict: DriftVerdict;
}

export interface PointsDriftReport {
  householdId: string;
  householdName: string;
  /** Earliest date any habit carries attribution (`completedBy` with a
   *  positive count), or null when the household has none at all. */
  attributionStartDate: string | null;
  rows: DriftRow[];
}

/** The narrow household shape this module needs. */
type DriftHousehold = Pick<Household, 'id' | 'name' | 'points' | 'redemptionHistory'>;
/** The narrow member shape this module needs. */
type DriftMember = Pick<HouseholdMember, 'uid' | 'displayName' | 'points' | 'isManaged'>;

/** Every date carrying at least one positive attributed unit, across every
 *  habit — the earliest of which is `attributionStartDate`. */
const earliestAttributedDate = (habits: Habit[]): string | null => {
  let earliest: string | null = null;
  for (const habit of habits) {
    for (const [date, day] of Object.entries(habit.completedBy ?? {})) {
      if (!Object.values(day).some(count => count > 0)) continue;
      if (earliest === null || date < earliest) earliest = date;
    }
  }
  return earliest;
};

/** Sum of every recorded redemption's cost — only meaningful when the caller
 *  has already established the array is complete (see `redemptionCostKnown`). */
const sumRedemptionCost = (household: DriftHousehold): number =>
  (household.redemptionHistory ?? []).reduce((sum, r) => sum + r.cost, 0);

/**
 * How many points self-redemptions (`redeemReward`) have debited from the
 * household pool, or `null` when that figure cannot be trusted.
 *
 * `Household.redemptionHistory` is a bounded, most-recent-first array
 * (`REDEMPTION_HISTORY_LIMIT`, `utils/redemption.ts`). An array strictly
 * shorter than the cap is PROVABLY complete — nothing has ever been evicted,
 * so the sum is exact. An array sitting AT the cap might have older entries
 * already pushed off the end, so the true lifetime spend is unknowable from
 * this array alone.
 */
const redemptionCostKnown = (household: DriftHousehold): number | null => {
  const history = household.redemptionHistory ?? [];
  if (history.length === 0) return 0;
  if (history.length < REDEMPTION_HISTORY_LIMIT) return sumRedemptionCost(household);
  return null;
};

/** Any habit anywhere with stored-submission tracking — `hasSubmissionTracking`
 *  habits can carry a back-dated/overridden `pointsEarned` per day that neither
 *  scorer used here reconstructs without a full-history submission fetch
 *  (deliberately out of scope for both scorers — see `fetchSubmissionTotals`'s
 *  own bounded-window design). */
const hasAnySubmissionTracking = (habits: Habit[]): boolean =>
  habits.some(h => h.hasSubmissionTracking === true);

/** Any SHARED (non-assigned) THRESHOLD-scoring habit — see the module doc
 *  comment's "KNOWN GAP" section. `PointsBreakdownModal` can restore a past
 *  date on a threshold habit without a matching `points.total` credit, with
 *  no audit trail to distinguish that from genuine drift, so ANY threshold
 *  habit in the shared set makes this tool refuse to determine a fix. An
 *  ASSIGNED (chore) threshold habit is excluded here on purpose — it never
 *  feeds the household pool or a non-assignee's own total (see
 *  `habitFeedsMemberAttribution`), so it carries none of this risk for rows
 *  it doesn't touch. */
const hasAnySharedThresholdHabit = (habits: Habit[]): boolean =>
  habits.some(h => !h.assignedTo && h.scoringType === 'threshold');

const THRESHOLD_GAP_REASON =
  'household has threshold-scoring habit(s); PointsBreakdownModal can restore a past date on a threshold habit without a matching points.total credit (by design), and that edit leaves no audit trail this tool can cross-reference — see the "KNOWN GAP" note in this module\'s doc comment';

/**
 * Why the HOUSEHOLD row cannot be trusted, or null when it can.
 */
const householdConfound = (household: DriftHousehold, habits: Habit[]): string | null => {
  if (redemptionCostKnown(household) === null) {
    return `redemptionHistory is at the ${REDEMPTION_HISTORY_LIMIT}-entry cap — older redemptions may have been evicted, so lifetime redemption spend cannot be reconstructed exactly`;
  }
  if (hasAnySubmissionTracking(habits)) {
    return 'household has submission-tracked habit(s); a submission-adjusted historical day is not reconstructed by the full-history recompute used here';
  }
  if (hasAnySharedThresholdHabit(habits)) {
    return THRESHOLD_GAP_REASON;
  }
  return null;
};

/**
 * Why a MEMBER row cannot be trusted, or null when it can.
 */
const memberConfound = (
  member: DriftMember,
  habits: Habit[],
  attributionStartDate: string | null,
): string | null => {
  if (attributionStartDate === null) {
    return 'household has no attribution data yet (completedBy is empty everywhere) — pre-attribution history cannot be split per member';
  }
  if (member.isManaged === true) {
    return 'managed-kid members also earn points from assigned chores, to-do completion credits, and reward redemptions, none of which this tool models';
  }
  const assignedHabits = habits.filter(h => h.assignedTo === member.uid);
  if (assignedHabits.length > 0) {
    return 'member has assigned habit(s) (chores) scored by the legacy per-habit scorer, which calculateMemberPointsForDateRange does not include';
  }
  const sharedHabits = habits.filter(h => !h.assignedTo);
  if (hasAnySubmissionTracking(sharedHabits)) {
    return 'member has shared submission-tracked habit(s); calculateMemberPointsForDateRange does not model submission overrides';
  }
  if (hasAnySharedThresholdHabit(sharedHabits)) {
    return THRESHOLD_GAP_REASON;
  }
  return null;
};

/**
 * Turn a determinable delta into a verdict for the given row scope. Only ever
 * called once BOTH structural confounds are ruled out.
 *
 * 🛡️ Deltas that would LOWER a stored total are always `cannot_determine`,
 * never applied. This mirrors `computeHouseholdPointsSync`'s own policy of
 * never lowering `points.total` — a stored figure higher than the recompute
 * may reflect a legitimate credit this tool doesn't model (a manual award, an
 * admin edit), and guessing it away is exactly the destructive mistake this
 * tool exists to avoid.
 *
 * 🛡️ NON-FINITE DELTAS ARE ALWAYS `cannot_determine`, NEVER A GUESS. A
 * malformed habit doc (e.g. `basePoints: undefined`, which `d.data() as
 * Habit` happily produces with no runtime validation) can make the shared
 * scorer return `NaN`. Every other guard in this function is a numeric
 * comparison that is FALSE for NaN (`NaN === 0`, `NaN < 0` are both false),
 * so without this explicit check a NaN delta falls through to
 * `under_credited`/`over_debited` with `amount: NaN` — and Firestore accepts
 * NaN as a valid double, making the corruption permanent and, unlike the
 * drift this tool exists to fix, un-recoverable by ANY future recompute
 * (`Math.max(current, recompute)` stays NaN forever once written).
 */
const verdictForDelta = (scope: 'household' | 'member', delta: number): DriftVerdict => {
  if (!Number.isFinite(delta)) {
    return {
      kind: 'cannot_determine',
      reason:
        'the recomputed total was not a finite number (likely a malformed habit doc — e.g. a missing/non-numeric basePoints) — refusing to write a NaN/Infinity',
    };
  }
  if (delta === 0) return { kind: 'looks_correct' };
  if (delta < 0) {
    return {
      kind: 'cannot_determine',
      reason:
        'stored total exceeds the recompute; this tool never proposes a downward correction, since the surplus may be a legitimate credit it does not model',
    };
  }
  return scope === 'household'
    ? { kind: 'over_debited', amount: delta }
    : { kind: 'under_credited', amount: delta };
};

/**
 * Build the Phase 1 REPORT for one household — read-only, no writes. Every
 * figure comes from `calculateHouseholdPointsForDateRange` /
 * `calculateMemberPointsForDateRange`; nothing here invents new scoring.
 */
export const computePointsDriftReport = (
  household: DriftHousehold,
  members: DriftMember[],
  habits: Habit[],
  today: string = getLocalDateString(),
): PointsDriftReport => {
  const attributionStartDate = earliestAttributedDate(habits);

  const storedHouseholdTotal = household.points?.total ?? 0;
  const hhConfound = householdConfound(household, habits);
  const householdRow: DriftRow = hhConfound
    ? {
        scope: 'household',
        id: household.id,
        label: household.name || 'Household',
        storedTotal: storedHouseholdTotal,
        recomputedTotal: null,
        verdict: { kind: 'cannot_determine', reason: hhConfound },
      }
    : (() => {
        const recomputed = calculateHouseholdPointsForDateRange(habits, EPOCH_DATE, today, today);
        // redemptionCostKnown() is non-null here (hhConfound is null), so the
        // adjustment below is exact, not a guess.
        const knownRedemptionCost = redemptionCostKnown(household) ?? 0;
        const adjustedStored = storedHouseholdTotal + knownRedemptionCost;
        const delta = recomputed - adjustedStored;
        return {
          scope: 'household' as const,
          id: household.id,
          label: household.name || 'Household',
          storedTotal: storedHouseholdTotal,
          recomputedTotal: recomputed,
          verdict: verdictForDelta('household', delta),
        };
      })();

  const memberRows: DriftRow[] = members.map(member => {
    const storedTotal = member.points?.total ?? 0;
    const confound = memberConfound(member, habits, attributionStartDate);
    if (confound) {
      return {
        scope: 'member',
        id: member.uid,
        label: member.displayName || member.uid,
        storedTotal,
        recomputedTotal: null,
        verdict: { kind: 'cannot_determine', reason: confound },
      };
    }
    // attributionStartDate is non-null here (confound would have caught null).
    const recomputed = calculateMemberPointsForDateRange(
      habits,
      member.uid,
      attributionStartDate as string,
      today,
      today,
    );
    const delta = recomputed - storedTotal;
    return {
      scope: 'member',
      id: member.uid,
      label: member.displayName || member.uid,
      storedTotal,
      recomputedTotal: recomputed,
      verdict: verdictForDelta('member', delta),
    };
  });

  return {
    householdId: household.id,
    householdName: household.name,
    attributionStartDate,
    rows: [householdRow, ...memberRows],
  };
};

/**
 * One write the Phase 2 APPLY step will make: an absolute new `points.total`
 * for one row, already floored at zero.
 */
export interface PointsDriftWrite {
  householdId: string;
  scope: 'household' | 'member';
  /** Member uid; absent for the household-scope write. */
  memberUid?: string;
  label: string;
  previousTotal: number;
  newTotal: number;
  /** `newTotal - previousTotal` — always > 0 (see `planPointsDriftApply`). */
  delta: number;
}

/**
 * Turn a set of Phase 1 reports into the concrete writes Phase 2 should make —
 * pure, so both the UI and the write-batch orchestration (and this module's
 * own tests) can reuse it without touching Firestore.
 *
 * Only rows Phase 1 classified as determinable AND positive-direction
 * (`over_debited` / `under_credited`) produce a write; `cannot_determine` and
 * `looks_correct` rows are skipped outright — this is the enforcement point
 * for "Phase 2 applies ONLY the deltas Phase 1 classified as determinable."
 *
 * 🛡️ `newTotal` is floored at zero. Every proposed delta here is > 0 by
 * construction (see `verdictForDelta`), so a stored total that was already
 * non-negative can never end up negative — the floor exists purely as a
 * defense against a corrupted stored value that was ALREADY negative before
 * this tool ever ran.
 *
 * 🛡️ BELT-AND-BRACES: `delta <= 0` and `newTotal === row.storedTotal` are
 * both `false` for NaN, so a non-finite delta should never even reach this
 * function (`verdictForDelta` already converts it to `cannot_determine`,
 * which `proposedDeltaFor` reads as `0`) — but this is the LAST pure
 * function standing before a write, so it re-asserts finiteness on both the
 * delta and the resulting `newTotal` rather than trusting that upstream
 * conversion alone. Never emit a write Firestore would accept but no future
 * recompute could ever repair.
 */
export const planPointsDriftApply = (reports: PointsDriftReport[]): PointsDriftWrite[] => {
  const writes: PointsDriftWrite[] = [];
  for (const report of reports) {
    for (const row of report.rows) {
      const delta = proposedDeltaFor(row.verdict);
      if (!Number.isFinite(delta) || delta <= 0) continue;
      const newTotal = Math.max(0, row.storedTotal + delta);
      if (!Number.isFinite(newTotal)) continue;
      if (newTotal === row.storedTotal) continue; // clamped to a no-op — nothing to write
      writes.push({
        householdId: report.householdId,
        scope: row.scope,
        memberUid: row.scope === 'member' ? row.id : undefined,
        label: row.label,
        previousTotal: row.storedTotal,
        newTotal,
        delta: newTotal - row.storedTotal,
      });
    }
  }
  return writes;
};
