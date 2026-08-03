/**
 * Weekly ceremony — the deck model (per-member points, stage 5).
 *
 * Pure selectors that turn one server-written `WeeklyRecap` into everything the
 * story deck renders: card order, the member-stacked 7-day chart geometry, the
 * head-to-head, the trend and the "best week this month" verdict. Kept free of
 * React so the shape of the ceremony is unit-testable without a DOM.
 *
 * 🛡️ ONE ARTIFACT, NOT TWO. The ceremony EVOLVES the existing Weekly Recap —
 * same document, same card entry point, same `/?recap=<isoWeek>` deep link,
 * same `recap.premium` gate on the narrative. Everything here reads fields that
 * are OPTIONAL on the recap: `hasCeremonyData` is the single gate, and a recap
 * without them renders the drawer's pre-deck layout unchanged. Never make the
 * deck the only way to read a recap.
 *
 * 🛡️ ORDER IS PERSONAL. The viewing member's own personal card always precedes
 * any other member's, so two people opening the same recap see themselves in
 * the same slot. The tone (`Household.ceremonyTone`) chooses the FRAMING —
 * whether the head-to-head is PROMOTED ahead of the household week and crowned,
 * or demoted behind the personal card and reported flat.
 *
 * 🛡️ ONE JOB PER CARD (DECK-1). The first ceremony shipped four cards carrying
 * about three ideas: the household total was the hero of card 2 AND of card 4,
 * the head-to-head was a footnote under a figure that had already been read,
 * and MONEY — in a household finance app — was not in the ceremony at all. The
 * deck is now cover → money → household week → personal → head-to-head →
 * finish, each answering exactly one question, and no figure is the hero twice.
 */
import type {
  CeremonyTone,
  RecapDayPoints,
  RecapMemberFacts,
  RecapUnattributedSplit,
  WeeklyRecap,
} from '@/types/schema';
import { buildMemberColorMap, memberColorFor, type ColorableMember } from '@/utils/memberColors';
import { findLeaderId } from '@/utils/pointsLeader';
import { isoWeekStartDate } from '@/utils/dateHelpers';
import { roundMoney } from '@/utils/money';
import { resolveCeremonyTone } from '@/utils/freezeSettings';

// ---------------------------------------------------------------------------
// Framing (the client twin of functions/src/recap/narrative.ts)
// ---------------------------------------------------------------------------

/**
 * How big a lead makes a week a "runaway" for the ADAPTIVE tone. Kept in
 * lockstep with `RUNAWAY_MARGIN_RATIO` / `RUNAWAY_MIN_MARGIN` in
 * `functions/src/recap/narrative.ts` — the server phrases the narrative with
 * one verdict and the client must not lay the deck out with a different one.
 */
export const RUNAWAY_MARGIN_RATIO = 0.25;
export const RUNAWAY_MIN_MARGIN = 50;

export type RecapFraming = 'podium' | 'together';

export interface RecapStanding {
  memberId: string;
  name: string;
  points: number;
  color: string;
  /** The member's live Google/Firebase profile photo, resolved from the
   *  household roster (the recap document itself carries no photoURL — it's
   *  a server-written snapshot). Null/undefined falls back to the initial. */
  photoURL?: string | null;
}

export interface RecapHeadToHead {
  framing: RecapFraming;
  /** Standings, highest points first — every member with a fact entry. */
  standings: RecapStanding[];
  leader: RecapStanding | null;
  runnerUp: RecapStanding | null;
  margin: number;
  runaway: boolean;
}

// ---------------------------------------------------------------------------
// Chart geometry
// ---------------------------------------------------------------------------

/** One stacked segment of a chart column. */
export interface RecapChartSegment {
  /** memberId, or `UNATTRIBUTED_SERIES` for the grandfathering series. */
  key: string;
  color: string;
  points: number;
  /** Share of the column's positive total, 0-100. */
  pct: number;
}

export interface RecapChartDay {
  date: string;
  /** Single-letter weekday label, Monday first. */
  label: string;
  total: number;
  /** Column height as a share of the week's best day, 0-100. */
  heightPct: number;
  /** A day well below the week's best — drawn as a ghost/tinted column. */
  quiet: boolean;
  /** The week's single best day (never set when nothing was scored). */
  best: boolean;
  segments: RecapChartSegment[];
  /**
   * The day's household total finished BELOW zero (DECK-1).
   *
   * The stacked column stays positive-only — that is the standing product
   * decision, and it is the right one: a stacked bar cannot honestly show a
   * negative slice, and a negative CSS length is dropped by the browser, which
   * paints a FULL column rather than an empty one. But "positive-only" was
   * being rendered as "invisible": on the real 2026-W31 deck, Monday netted −5
   * and drew literally nothing — no bar, no number, no acknowledgement — so the
   * week looked like it had six days in it.
   *
   * The fix is a second, dedicated register rather than a compromised bar: the
   * column area keeps its positive-only stack, and the deficit is drawn BELOW a
   * real baseline as its own solid stub (`deficitPct`). Above the line is what
   * was gained; below the line is what was lost. Nothing has to lie, and no day
   * is missing.
   */
  negative: boolean;
  /**
   * Depth of the below-baseline deficit stub as a share of the week's DEEPEST
   * deficit, 0-100 — scaled against the deficits alone, never against
   * `heightPct`'s positive maximum, so a small loss in a high-scoring week is
   * still a legible mark instead of a sub-pixel smear. Always 0 when `negative`
   * is false. The component floors the rendered height so the shallowest
   * deficit of a week is still drawn.
   */
  deficitPct: number;
}

/** The chart series key for points nobody holds attribution for. */
export const UNATTRIBUTED_SERIES = '__household__';

/** Below this share of the best day, a column reads as a quiet day. */
const QUIET_THRESHOLD = 0.3;

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

export type RecapCardKind = 'cover' | 'money' | 'week' | 'personal' | 'standings' | 'finish';

export interface RecapDeckCard {
  kind: RecapCardKind;
  /** Stable key for React + the progress dots. */
  id: string;
  /** Set on a `personal` card: whose week it describes. */
  memberId?: string;
}

// ---------------------------------------------------------------------------
// Money (DECK-1)
// ---------------------------------------------------------------------------

/** One spend figure and its own week-over-week base. Decimal dollars. */
export interface RecapSpendLine {
  amount: number;
  /** The same figure a week earlier, or null when the recap carries no base. */
  prior: number | null;
  /** `amount - prior`, or null without a base. */
  delta: number | null;
  /** Rounded percent change, or null when `prior` is absent or <= 0. */
  changePct: number | null;
}

/**
 * The week's money, decomposed the way `WeeklyRecap` now carries it
 * (RECAP-MATH, PR #1207) — and the reason money is IN the ceremony at all.
 *
 * 🛡️ NEVER LEAD WITH `totalSpend`. `billsSpend + dayToDaySpend === totalSpend`
 * by construction, and the two halves behave nothing alike: bills are lumpy and
 * already budgeted (rent lands in one week and not the next), day-to-day is the
 * part a household actually steers. Reporting the sum made a normal week look
 * like a catastrophe — real 2026-W31 was $2,429 total against a $803 prior
 * week, a "3.3× blowout", when day-to-day was $1,122 vs $803: a 1.4× rise.
 * `dayToDay` is the hero; `bills` gets its own comparison beside it; `total` is
 * a closing line, not a headline.
 *
 * 🛡️ `hasSplit` is FALSE-SAFE. `billsSpend`/`dayToDaySpend` are OPTIONAL fields
 * (absent on every recap written before the split), so a missing one degrades to
 * the `total`-only story rather than rendering a confident `$0` of day-to-day
 * spending for a week nobody measured that way.
 */
export interface RecapMoney {
  /** True only when BOTH halves of the split are present and finite. */
  hasSplit: boolean;
  /** Discretionary spend — the card's hero. Null without the split. */
  dayToDay: RecapSpendLine | null;
  /** Spend the calendar already budgeted. Null without the split. */
  bills: RecapSpendLine | null;
  /** All counted spend — always available (a required recap field). */
  total: RecapSpendLine;
}

// ---------------------------------------------------------------------------
// The personal card's stat tiles (DECK-1)
// ---------------------------------------------------------------------------

/** One stat tile on the viewer's personal card. */
export interface RecapPersonalTile {
  id: 'streak' | 'perfect' | 'completions' | 'bestDay';
  /** Pre-formatted display value — never a bare zero (see `buildPersonalTiles`). */
  value: string;
  label: string;
  detail: string;
}

export interface RecapDeck {
  cards: RecapDeckCard[];
  framing: RecapFraming;
  tone: CeremonyTone;
  headToHead: RecapHeadToHead;
  chart: RecapChartDay[];
  /** The viewing member's own facts, when they have any. */
  viewer: RecapMemberFacts | null;
  /**
   * The viewer's own resolved standing (color + photo), independent of the
   * ADULTS-ONLY head-to-head — a managed kid viewer never appears in
   * `headToHead.standings`, so this is computed for whoever `viewer` is, not
   * looked up from that filtered list. Null exactly when `viewer` is null.
   */
  viewerStanding: RecapStanding | null;
  /** Signed household points for the week. */
  totalPoints: number;
  /** The week's money, split bills vs day-to-day (DECK-1). */
  money: RecapMoney;
  /**
   * The household's OWN share of `totalPoints` — points earned together that
   * belong to no individual member (pre-attribution legacy history today, and
   * once shipped, Household-credit habits). Summed straight from
   * `dailyPoints[].unattributed`, the same series `buildRecapChart` already
   * draws as the chart's "Household" segment, so the figure and the chart can
   * never disagree. Zero when every day's `unattributed` is zero/absent.
   */
  householdSharePoints: number;
  /**
   * WHY that share belongs to nobody (RECAP-MATH), or null when the recap
   * predates the split and genuinely cannot say.
   *
   * 🛡️ This is what let `householdShareCopy` be DELETED rather than extended.
   * That helper was four branches of apology reconciling a signed figure with a
   * positive-only chart, and it existed because "unattributed" was a residual —
   * a leftover with no name. It isn't one: `householdCredit` is points from
   * habits with `creditMode: 'household'`, which belong to nobody ON PURPOSE
   * (this household runs 15 of them — groceries, dinners out, leftovers). Once
   * the series has a name, the card states it; there is nothing to apologise
   * for. `unclaimed` — legacy history or a real attribution gap — stays its own
   * quiet line, never a caveat attached to the first.
   *
   * 🛡️ NULL MEANS UNKNOWN, NOT ZERO. A recap without the split must never be
   * rendered as "0 household credit" — it simply never measured the question.
   */
  householdSplit: RecapUnattributedSplit | null;
  /**
   * Does the chart actually DRAW a Household bar?
   *
   * Segment EXISTENCE is not the same question: a segment exists when
   * `day.unattributed > 0`, while the column has height only when
   * `day.total > 0` — two independent figures. A day where the members net
   * deeply negative while a household-credit habit scores puts a household
   * segment on a ZERO-HEIGHT column, so gating a legend swatch on existence
   * alone paints a colour beside zero drawn pixels. Both conditions, always —
   * and computed here, in the model, so it is testable without a DOM.
   */
  chartHasHouseholdBar: boolean;
  /** Percent change vs the prior week, or null when there is no base. */
  trendPct: number | null;
  /** True when this week beat every other recap week in its calendar month. */
  isBestWeekThisMonth: boolean;
  /** ISO week number, e.g. 31 (null when `isoWeek` is malformed). */
  weekNumber: number | null;
  /** Human date range, e.g. "Jul 27 – Aug 2" (empty when unresolvable). */
  weekRange: string;
  /** The week's best day, for the chart's one-line highlight. */
  bestDay: RecapChartDay | null;
  /**
   * The week's DEEPEST net-negative day, or null when no day finished below
   * zero. Names the day the chart's deficit gutter draws, so a loss gets a
   * sentence rather than only a stub (DECK-1).
   */
  worstDay: RecapChartDay | null;
  /**
   * Does this recap carry prose to show?
   *
   * 🛡️ THREE STATES, NOT TWO (ARCH-1). The finish card used to branch only on
   * `recap.premium`, so a recap with NO narrative fell into the not-premium
   * branch and showed a paywall for content that does not exist. Client-derived
   * recaps (ARCH-1) have real numbers and no narrative — the narrative is only
   * ever written server-side — so "absent" is now a first-class state that
   * renders NEITHER the prose NOR the upsell. `recap.premium` remains the gate
   * for the upsell, and is only ever consulted when this is true.
   */
  hasNarrative: boolean;
}

/**
 * Does this recap carry the per-member facts the deck needs?
 *
 * The single graceful-degrade gate. `dailyPoints` alone isn't enough (the deck
 * has a personal card) and neither is `memberFacts` (the chart needs a series),
 * so BOTH must be present and non-empty — a half-written document renders the
 * pre-deck layout rather than a deck with a blank card in it.
 */
export function hasCeremonyData(recap: WeeklyRecap | null | undefined): boolean {
  return (
    !!recap &&
    Array.isArray(recap.memberFacts) &&
    recap.memberFacts.length > 0 &&
    Array.isArray(recap.dailyPoints) &&
    recap.dailyPoints.length > 0
  );
}

/** Percent change of this week's household points vs the prior week, or null. */
export function recapTrendPct(recap: WeeklyRecap): number | null {
  const current = recap.totalPoints;
  const prior = recap.priorWeekPoints;
  if (current === undefined || prior === undefined || prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

/** A recap's household points, falling back to the sum of its member entries. */
export function recapTotalPoints(recap: WeeklyRecap): number {
  if (recap.totalPoints !== undefined) return recap.totalPoints;
  return recap.pointsByMember.reduce((sum, p) => sum + p.points, 0);
}

/**
 * Did this week beat every other recap week in its own calendar month?
 *
 * Derived client-side from the (bounded, newest-first) recaps slice rather than
 * written by the server — the client already holds roughly a month of recaps,
 * so no extra server read is needed to answer it, and the answer stays correct
 * if an older week is regenerated. A month with only this week in it counts:
 * it is, trivially, the best one so far.
 */
export function isBestWeekOfMonth(recap: WeeklyRecap, recaps: readonly WeeklyRecap[]): boolean {
  const own = monthOf(recap);
  if (!own) return false;
  const total = recapTotalPoints(recap);
  if (total <= 0) return false;
  return recaps.every(
    other => other.isoWeek === recap.isoWeek || monthOf(other) !== own || recapTotalPoints(other) <= total
  );
}

/** Calendar month (yyyy-MM) an ISO week's Monday falls in, or null. */
function monthOf(recap: WeeklyRecap): string | null {
  const start = isoWeekStartDate(recap.isoWeek);
  if (!start) return null;
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Standings + the head-to-head verdict for one recap under one tone.
 *
 * 🛡️ ADULTS ONLY — the same population `selectAdultStandings` (scoreboard) and
 * `getAdultStandings` (points drawer) show, and the same one the server's
 * narrative frames. A managed kid's points come from chores credited to the
 * kid's own member doc rather than the household pool, so they are an allowance
 * ledger and not a competitive score: a chore-heavy kid week must never crown
 * the kid. The kid's own personal card is unaffected — `buildRecapDeck` finds
 * the viewer in the unfiltered facts.
 *
 * 🛡️ CROWN RULE lives in `utils/pointsLeader.ts` and is shared verbatim with
 * the Scoreboard widget and the Points Breakdown drawer: a strict leader
 * still wins in a net-negative week (someone lost the least) — the gate is
 * "not a zero-zero non-competition, and not a tie," not "must be positive."
 * Filtering standings to `points > 0` before finding a leader (the old
 * behavior here) silently un-crowned exactly that net-negative week while the
 * other two surfaces still crowned it — don't reintroduce that filter.
 */
export function buildHeadToHead(
  recap: WeeklyRecap,
  tone: CeremonyTone,
  colors: Record<string, string>,
  photos: Readonly<Record<string, string | null | undefined>> = {}
): RecapHeadToHead {
  const standings: RecapStanding[] = (recap.memberFacts ?? [])
    .filter(f => !f.isManaged)
    .map(f => ({
      memberId: f.memberId,
      name: f.name,
      points: f.points,
      color: memberColorFor(colors, f.memberId),
      photoURL: photos[f.memberId] ?? null,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const leaderId = findLeaderId(standings);
  const leader = leaderId !== null ? standings[0] ?? null : null;
  const runnerUp = leaderId !== null ? standings[1] ?? null : null;
  const contested = leader !== null && runnerUp !== null;
  const margin = contested && leader && runnerUp ? leader.points - runnerUp.points : 0;
  const runaway =
    contested && margin >= RUNAWAY_MIN_MARGIN && margin >= (runnerUp?.points ?? 0) * RUNAWAY_MARGIN_RATIO;

  const framing: RecapFraming =
    contested && (tone === 'podium' || (tone === 'adaptive' && runaway)) ? 'podium' : 'together';

  return {
    framing,
    standings,
    leader: contested ? leader : null,
    runnerUp: contested ? runnerUp : null,
    margin,
    runaway,
  };
}

/**
 * Chart geometry for the week's 7 days.
 *
 * Heights and segment shares use only the POSITIVE part of each figure: a
 * net-negative day (all-negative habits) has no meaningful bar, and a negative
 * CSS height/width is an invalid length browsers drop — which renders a FULL
 * column instead of an empty one (the same trap `selectAdultStandings` clamps
 * for).
 *
 * 🛡️ POSITIVE-ONLY IS NOT INVISIBLE (DECK-1). Such a day used to get nothing at
 * all — no bar, no mark, no number — so a losing day simply vanished from the
 * week. It now gets `negative` + `deficitPct`, a SECOND register the component
 * draws below the chart's baseline. The stack above the line still shows only
 * what was gained (unchanged, and deliberately so); the stub below shows what
 * was lost. Scaled against the week's deepest deficit, not against the positive
 * maximum, so a small loss in a big week is still visible.
 */
export function buildRecapChart(
  days: readonly RecapDayPoints[],
  colors: Record<string, string>,
  unattributedColor: string
): RecapChartDay[] {
  const totals = days.map(d => d.total);
  const positives = totals.map(t => Math.max(0, t));
  const deficits = totals.map(t => Math.max(0, -t));
  const max = Math.max(0, ...positives);
  const maxDeficit = Math.max(0, ...deficits);
  const bestIndex = max > 0 ? positives.indexOf(max) : -1;

  return days.map((day, i) => {
    const positive = positives[i] ?? 0;
    const deficit = deficits[i] ?? 0;
    const segmentSource: Array<[string, number]> = [
      ...Object.entries(day.byMember),
      // DEFENSIVE `?? 0` — insurance, not a fix for an observed defect.
      // `unattributed` is REQUIRED on `RecapDayPoints` and landed in the same
      // commit as `byMember`/`total`, written unconditionally by its only
      // writer (`functions/src/recap/memberFacts.ts`); a recap old enough to
      // predate it has no `dailyPoints` at all (`hasCeremonyData` routes it to
      // the pre-deck layout) rather than days missing this one field. The guard
      // stays because `weeklyRecapConverter` spreads raw Firestore data through
      // an `as WeeklyRecap` cast, so nothing at runtime enforces the type, and
      // the failure mode would be quiet and wide: `Math.max(0, undefined)` is
      // NaN, which poisons `segmentTotal` below and zeroes out EVERY segment's
      // `pct` for that day — the real member segments included.
      //
      // It is NOT a complete legacy-shape defence and shouldn't be read as one:
      // `Object.entries(day.byMember)` one line above throws outright on a day
      // missing `byMember`, and `Math.max(0, d.total)` above carries the same
      // NaN exposure for a missing `total`.
      [UNATTRIBUTED_SERIES, day.unattributed ?? 0],
    ];
    const segmentTotal = segmentSource.reduce((sum, [, v]) => sum + Math.max(0, v), 0);

    const segments: RecapChartSegment[] = segmentSource
      .filter(([, points]) => points > 0)
      .map(([key, points]) => ({
        key,
        color: key === UNATTRIBUTED_SERIES ? unattributedColor : memberColorFor(colors, key),
        points,
        pct: segmentTotal > 0 ? (points / segmentTotal) * 100 : 0,
      }));

    return {
      date: day.date,
      label: WEEKDAY_LABELS[i] ?? '',
      total: day.total,
      heightPct: max > 0 ? (positive / max) * 100 : 0,
      quiet: positive > 0 && positive < max * QUIET_THRESHOLD,
      best: i === bestIndex,
      segments,
      negative: deficit > 0,
      deficitPct: maxDeficit > 0 ? (deficit / maxDeficit) * 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Money (DECK-1)
// ---------------------------------------------------------------------------

/** A finite number, or null — the one guard every optional recap field needs. */
function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One spend figure against its own prior-week base. Dollars in, dollars out. */
function spendLine(amount: number, prior: number | null): RecapSpendLine {
  const base = prior !== null && prior > 0 ? prior : null;
  return {
    amount: roundMoney(amount),
    prior: prior === null ? null : roundMoney(prior),
    delta: prior === null ? null : roundMoney(amount - prior),
    changePct: base === null ? null : Math.round(((amount - base) / base) * 100),
  };
}

/**
 * The week's money for the ceremony's money card.
 *
 * `totalSpend`/`priorWeekSpend` are REQUIRED recap fields, so the `total` line
 * always exists. The split is optional and must be treated as all-or-nothing:
 * one half without the other cannot be reported as a decomposition, and a
 * missing half must never render as `$0` (see `RecapMoney.hasSplit`).
 */
export function buildRecapMoney(recap: WeeklyRecap): RecapMoney {
  const total = spendLine(finiteOrNull(recap.totalSpend) ?? 0, finiteOrNull(recap.priorWeekSpend));
  const bills = finiteOrNull(recap.billsSpend);
  const dayToDay = finiteOrNull(recap.dayToDaySpend);
  if (bills === null || dayToDay === null) {
    return { hasSplit: false, dayToDay: null, bills: null, total };
  }
  return {
    hasSplit: true,
    dayToDay: spendLine(dayToDay, finiteOrNull(recap.priorWeekDayToDaySpend)),
    bills: spendLine(bills, finiteOrNull(recap.priorWeekBillsSpend)),
    total,
  };
}

// ---------------------------------------------------------------------------
// The household's own share, and why (DECK-1 / RECAP-MATH)
// ---------------------------------------------------------------------------

/**
 * The week's `unattributedSplit`, or null when the recap cannot say.
 *
 * Prefers the server-written week total; falls back to summing the per-day
 * splits. The fallback refuses to answer if ANY day carrying unattributed
 * points lacks a split — summing only the days that explain themselves would
 * silently under-report the household's credit and, worse, make
 * `householdCredit + unclaimed !== householdSharePoints`, which is the one
 * invariant this pair is supposed to hold.
 */
function resolveHouseholdSplit(recap: WeeklyRecap): RecapUnattributedSplit | null {
  const week = recap.unattributedSplit;
  const weekCredit = finiteOrNull(week?.householdCredit);
  const weekUnclaimed = finiteOrNull(week?.unclaimed);
  if (weekCredit !== null && weekUnclaimed !== null) {
    return { householdCredit: roundPoints(weekCredit), unclaimed: roundPoints(weekUnclaimed) };
  }

  const days = recap.dailyPoints ?? [];
  if (days.length === 0) return null;
  if (days.every(d => !d.unattributedSplit)) return null;
  if (days.some(d => (d.unattributed ?? 0) !== 0 && !d.unattributedSplit)) return null;

  let credit = 0;
  let unclaimed = 0;
  for (const day of days) {
    credit += finiteOrNull(day.unattributedSplit?.householdCredit) ?? 0;
    unclaimed += finiteOrNull(day.unattributedSplit?.unclaimed) ?? 0;
  }
  return { householdCredit: roundPoints(credit), unclaimed: roundPoints(unclaimed) };
}

// ---------------------------------------------------------------------------
// The personal card's stat tiles (DECK-1)
// ---------------------------------------------------------------------------

/**
 * Up to two TRUE stat tiles for one member's week.
 *
 * 🛡️ NEVER A ZERO TILE. The shipped ceremony hard-coded two tiles and filled
 * whichever had no data with a literal `0` — the real 2026-W31 deck showed Paul
 * a tile reading `0` / "Every day" / "Nothing perfect this week", which is a
 * scoreboard of an absence dressed up as a statistic. Tiles are now DRAWN from
 * what actually happened, in descending order of how much it says, and a
 * candidate that would render zero simply never becomes a tile. Fewer tiles is
 * a better card than a padded one; zero tiles is handled by the card itself
 * with a plain sentence.
 */
export function buildPersonalTiles(facts: RecapMemberFacts): RecapPersonalTile[] {
  const tiles: RecapPersonalTile[] = [];

  const streak = facts.topStreak;
  if (streak && streak.days > 0) {
    tiles.push({
      id: 'streak',
      value: String(streak.days),
      label: streak.period === 'weekly' ? 'Week streak' : 'Day streak',
      detail: streak.habitTitle,
    });
  }

  const perfect = facts.perfectHabits[0];
  if (perfect) {
    const more = facts.perfectHabits.length - 1;
    tiles.push({
      id: 'perfect',
      value: '7/7',
      label: 'Every day',
      detail: more > 0 ? `${perfect} +${more} more` : perfect,
    });
  }

  if (facts.completions > 0) {
    tiles.push({
      id: 'completions',
      value: String(facts.completions),
      label: 'Habits logged',
      detail: 'across the week',
    });
  }

  const best = facts.bestDay;
  if (best && best.points !== 0) {
    tiles.push({
      id: 'bestDay',
      value: String(best.points),
      label: 'Best day',
      detail: weekdayNameOf(best.date) || best.date,
    });
  }

  return tiles.slice(0, 2);
}

/**
 * DEFENSIVE 2dp rounding — insurance, not a fix for an observed defect, the
 * same standing as the `?? 0` guards on `unattributed`.
 *
 * Every value the only writer can emit is an INTEGER: a per-completion rate is
 * `sign × Math.floor(|basePoints| × multiplier)` (`signedHabitPoints` in
 * `utils/habitLogic.ts`, mirrored by `perUnitAt` in
 * `functions/src/recap/memberFacts.ts`), and `unattributedPointsOnDate`
 * multiplies that floored rate by an integer unit count. So a 1.5x streak
 * multiplier does NOT produce a `.5` — 5 × 1.5 floors to 7 — and on real data
 * this call is an identity. It stays because `weeklyRecapConverter` spreads raw
 * Firestore data through an `as WeeklyRecap` cast, so nothing at runtime
 * enforces that, and summing decimals in binary would land a truly-zero week on
 * 5.55e-17 — a value that renders verbatim AND slips past the card's `!== 0`
 * gate. 2dp rather than integer rounding so a fractional figure, if one ever
 * did reach here, degrades to a readable number instead of being flattened.
 */
function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A roster member as the deck builder needs it: colorable (the existing
 * contract) plus the live photo every other member-badge surface resolves
 * from the roster — see `RecapStanding.photoURL`.
 */
export interface RecapRosterMember extends ColorableMember {
  photoURL?: string | null;
}

/** Options for `buildRecapDeck` — everything it can't read off the recap. */
export interface RecapDeckInput {
  recap: WeeklyRecap;
  /** The whole recaps slice (newest first) — used for "best week this month". */
  recaps: readonly WeeklyRecap[];
  /** The household roster, for member colors + photos. */
  members: readonly RecapRosterMember[];
  /** The signed-in (or acting) member's uid. */
  viewerId: string | null | undefined;
  /** The household's ceremony tone. Falls back to the recap's own stored tone. */
  tone?: CeremonyTone | null;
  /** Color for the unattributed series (a neutral, from the caller's theme). */
  unattributedColor: string;
}

/**
 * Build the whole deck for one recap and one viewer.
 *
 * ONE JOB PER CARD (DECK-1) — the sequence and what each card exists to answer:
 *
 *   cover      which week is this?
 *   money      what did the week cost to live? (day-to-day vs bills)
 *   week       how did the household score, day by day?
 *   personal   how did YOU do?
 *   standings  how did it split between the adults?
 *   finish     what does it add up to?
 *
 * Two cards are CONDITIONAL, and both drop rather than render empty: the
 * personal card needs the viewer to have facts of their own (a member who
 * joined after the week, or a fully unattributed week, has none), and the
 * standings card needs at least two ADULT standings to compare.
 *
 * 🛡️ THE TONE MOVES THE HEAD-TO-HEAD; IT NO LONGER DUPLICATES A FIGURE. The
 * shipped deck expressed `podium` by making the household total the hero of
 * card 2 and again of card 4, with the head-to-head as a footnote on both.
 * Now the head-to-head is its OWN card, and the tone chooses where it sits and
 * whether it crowns: `podium` (and `adaptive` on a runaway week) promotes it
 * AHEAD of the household week, so the competition is the frame you read the
 * week through; `household_first` — the absent default — demotes it behind the
 * personal card and reports it flat. The household total is the hero exactly
 * once, on the week card.
 */
export function buildRecapDeck(input: RecapDeckInput): RecapDeck {
  const { recap, recaps, members, viewerId, unattributedColor } = input;
  const tone = input.tone ?? recap.ceremonyTone ?? resolveCeremonyTone(null);
  const colors = buildMemberColorMap(members);
  const photos: Record<string, string | null | undefined> = {};
  for (const member of members) photos[member.uid] = member.photoURL;
  const headToHead = buildHeadToHead(recap, tone, colors, photos);
  const chart = buildRecapChart(recap.dailyPoints ?? [], colors, unattributedColor);

  const facts = recap.memberFacts ?? [];
  const viewer = (viewerId ? facts.find(f => f.memberId === viewerId) : undefined) ?? null;

  // The viewer's own standing, resolved independent of the adults-only
  // head-to-head — a managed kid viewer isn't IN `headToHead.standings`
  // (filtered by `!isManaged`), so this can't be a lookup into that list
  // alone; it falls back to building the same shape directly from `viewer`.
  const viewerStanding: RecapStanding | null = viewer
    ? (headToHead.standings.find(s => s.memberId === viewer.memberId) ?? {
        memberId: viewer.memberId,
        name: viewer.name,
        points: viewer.points,
        color: memberColorFor(colors, viewer.memberId),
        photoURL: photos[viewer.memberId] ?? null,
      })
    : null;

  const podiumFirst = headToHead.framing === 'podium';
  const showStandings = headToHead.standings.length > 1;

  const cards: RecapDeckCard[] = [
    { kind: 'cover', id: 'cover' },
    { kind: 'money', id: 'money' },
  ];
  if (showStandings && podiumFirst) cards.push({ kind: 'standings', id: 'standings' });
  cards.push({ kind: 'week', id: 'week' });
  if (viewer) cards.push({ kind: 'personal', id: `personal-${viewer.memberId}`, memberId: viewer.memberId });
  if (showStandings && !podiumFirst) cards.push({ kind: 'standings', id: 'standings' });
  cards.push({ kind: 'finish', id: 'finish' });

  const best = chart.find(d => d.best && d.total > 0) ?? null;
  // The DEEPEST loss, not merely the first — `deficitPct` is 100 on exactly
  // that day, which is the one the gutter draws tallest and the one the card's
  // sentence must name.
  const worst = chart.find(d => d.negative && d.deficitPct === 100) ?? null;

  return {
    cards,
    framing: headToHead.framing,
    tone,
    headToHead,
    chart,
    viewer,
    viewerStanding,
    totalPoints: recapTotalPoints(recap),
    // The `?? 0` is the twin of the guard in `buildRecapChart` above and is
    // defensive for the same reason: `unattributed` is a REQUIRED field its
    // only writer has always written, so this insures against the
    // `as WeeklyRecap` cast in `weeklyRecapConverter` rather than against a
    // shape anyone has seen. Without it `sum + undefined` is NaN, and NaN !== 0
    // passes the card's render guard — it would print "NaN".
    //
    // `roundPoints` has the SAME standing (see its docblock): every value the
    // writer can emit is floored to an integer, so it is an identity on real
    // data and insures against the same untyped cast. Were a fractional value
    // to arrive, summing it in binary floats would land a truly-zero week on
    // 5.551115123125783e-17 — a value that renders verbatim on the card AND
    // slips past its `!== 0` gate. Round the model once so the figure and the
    // gate agree.
    householdSharePoints: roundPoints((recap.dailyPoints ?? []).reduce((sum, d) => sum + (d.unattributed ?? 0), 0)),
    money: buildRecapMoney(recap),
    householdSplit: resolveHouseholdSplit(recap),
    chartHasHouseholdBar: chart.some(d => d.heightPct > 0 && d.segments.some(s => s.key === UNATTRIBUTED_SERIES)),
    trendPct: recapTrendPct(recap),
    isBestWeekThisMonth: isBestWeekOfMonth(recap, recaps),
    weekNumber: weekNumberOf(recap.isoWeek),
    weekRange: weekRangeOf(recap.isoWeek),
    bestDay: best,
    worstDay: worst,
    hasNarrative: typeof recap.narrative === 'string' && recap.narrative.trim().length > 0,
  };
}

/** ISO week number from an isoWeek id, or null when malformed. */
export function weekNumberOf(isoWeek: string): number | null {
  const match = /^\d{4}-W(\d{2})$/.exec(isoWeek);
  if (!match?.[1]) return null;
  const week = Number(match[1]);
  return Number.isFinite(week) ? week : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 29 – Jul 5" for an ISO week id, or '' when it can't be resolved. */
export function weekRangeOf(isoWeek: string): string {
  const start = isoWeekStartDate(isoWeek);
  if (!start) return '';
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const fmt = (d: Date): string => `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Full weekday name for a `yyyy-MM-dd` date, for the chart's highlight line. */
export function weekdayNameOf(date: string): string {
  const parts = date.split('-').map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined) return '';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[new Date(y, m - 1, d).getDay()] ?? '';
}
