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
 * `determineConfound()` below is the exhaustive, DATA-DRIVEN gate for every
 * one of these cases: each is something we can actually detect from the
 * `household`/`members`/`habits` we're given, and any of them present makes
 * that row `cannot_determine` rather than a guess.
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
 */
const verdictForDelta = (scope: 'household' | 'member', delta: number): DriftVerdict => {
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
 */
export const planPointsDriftApply = (reports: PointsDriftReport[]): PointsDriftWrite[] => {
  const writes: PointsDriftWrite[] = [];
  for (const report of reports) {
    for (const row of report.rows) {
      const delta = proposedDeltaFor(row.verdict);
      if (delta <= 0) continue;
      const newTotal = Math.max(0, row.storedTotal + delta);
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
