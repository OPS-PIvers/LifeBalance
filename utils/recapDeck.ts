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
 * whether the week's story leads with the household or with the head-to-head —
 * and the deck stays the four cards the mocks approved.
 */
import type { CeremonyTone, RecapDayPoints, RecapMemberFacts, WeeklyRecap } from '@/types/schema';
import { buildMemberColorMap, memberColorFor, type ColorableMember } from '@/utils/memberColors';
import { findLeaderId } from '@/utils/pointsLeader';
import { isoWeekStartDate } from '@/utils/dateHelpers';
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
}

/** The chart series key for points nobody holds attribution for. */
export const UNATTRIBUTED_SERIES = '__household__';

/** Below this share of the best day, a column reads as a quiet day. */
const QUIET_THRESHOLD = 0.3;

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

export type RecapCardKind = 'cover' | 'week' | 'personal' | 'finish';

export interface RecapDeckCard {
  kind: RecapCardKind;
  /** Stable key for React + the progress dots. */
  id: string;
  /** Set on a `personal` card: whose week it describes. */
  memberId?: string;
}

export interface RecapDeck {
  cards: RecapDeckCard[];
  framing: RecapFraming;
  tone: CeremonyTone;
  headToHead: RecapHeadToHead;
  chart: RecapChartDay[];
  /** The viewing member's own facts, when they have any. */
  viewer: RecapMemberFacts | null;
  /** Signed household points for the week. */
  totalPoints: number;
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
  colors: Record<string, string>
): RecapHeadToHead {
  const standings: RecapStanding[] = (recap.memberFacts ?? [])
    .filter(f => !f.isManaged)
    .map(f => ({
      memberId: f.memberId,
      name: f.name,
      points: f.points,
      color: memberColorFor(colors, f.memberId),
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
 * for). Such a day still gets its label and its number; it just has no bar.
 */
export function buildRecapChart(
  days: readonly RecapDayPoints[],
  colors: Record<string, string>,
  unattributedColor: string
): RecapChartDay[] {
  const positives = days.map(d => Math.max(0, d.total));
  const max = Math.max(0, ...positives);
  const bestIndex = max > 0 ? positives.indexOf(max) : -1;

  return days.map((day, i) => {
    const positive = positives[i] ?? 0;
    const segmentSource: Array<[string, number]> = [
      ...Object.entries(day.byMember),
      [UNATTRIBUTED_SERIES, day.unattributed],
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
    };
  });
}

/** Options for `buildRecapDeck` — everything it can't read off the recap. */
export interface RecapDeckInput {
  recap: WeeklyRecap;
  /** The whole recaps slice (newest first) — used for "best week this month". */
  recaps: readonly WeeklyRecap[];
  /** The household roster, for member colors. */
  members: readonly ColorableMember[];
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
 * Card order is the four the mocks approved. The viewer's PERSONAL card sits
 * third whenever they have facts of their own; a viewer with no facts (a member
 * who joined after the week, or an unattributed week) drops that card entirely
 * rather than showing an empty one — the deck is then cover → week → finish.
 */
export function buildRecapDeck(input: RecapDeckInput): RecapDeck {
  const { recap, recaps, members, viewerId, unattributedColor } = input;
  const tone = input.tone ?? recap.ceremonyTone ?? resolveCeremonyTone(null);
  const colors = buildMemberColorMap(members);
  const headToHead = buildHeadToHead(recap, tone, colors);
  const chart = buildRecapChart(recap.dailyPoints ?? [], colors, unattributedColor);

  const facts = recap.memberFacts ?? [];
  const viewer = (viewerId ? facts.find(f => f.memberId === viewerId) : undefined) ?? null;

  const cards: RecapDeckCard[] = [
    { kind: 'cover', id: 'cover' },
    { kind: 'week', id: 'week' },
  ];
  if (viewer) cards.push({ kind: 'personal', id: `personal-${viewer.memberId}`, memberId: viewer.memberId });
  cards.push({ kind: 'finish', id: 'finish' });

  const best = chart.find(d => d.best && d.total > 0) ?? null;

  return {
    cards,
    framing: headToHead.framing,
    tone,
    headToHead,
    chart,
    viewer,
    totalPoints: recapTotalPoints(recap),
    trendPct: recapTrendPct(recap),
    isBestWeekThisMonth: isBestWeekOfMonth(recap, recaps),
    weekNumber: weekNumberOf(recap.isoWeek),
    weekRange: weekRangeOf(recap.isoWeek),
    bestDay: best,
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
