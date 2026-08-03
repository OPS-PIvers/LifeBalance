import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";
import { formatCurrency } from "../utils/formatCurrency";
import { RecapMemberFacts, WeeklyRecap } from "./types";

/**
 * Mirrors the model constant approach in `services/geminiService.ts`
 * (`GEMINI_MODEL`, overridable via `VITE_GEMINI_MODEL`): defined once here so
 * changing the model happens in a single place. functions/ has no equivalent
 * Vite env, so this is a plain constant — geminiProxy.ts doesn't export a
 * model constant either (the client picks the model and forwards it), so
 * there is nothing to import; the recap engine picks its own model since it
 * calls Gemini directly rather than through the client-forwarding proxy.
 */
export const RECAP_GEMINI_MODEL = "gemini-3.1-flash-lite";

const NARRATIVE_TIMEOUT_MS = 30_000;

export type RecapNumericFields = Pick<
  WeeklyRecap,
  | "totalSpend"
  | "priorWeekSpend"
  | "topCategoryDeltas"
  | "habitCompletions"
  | "streaksAtRisk"
  | "pointsByMember"
  | "upcomingBills"
> &
  Partial<
    Pick<
      WeeklyRecap,
      | "memberFacts"
      | "totalPoints"
      | "priorWeekPoints"
      | "billsSpend"
      | "priorWeekBillsSpend"
      | "dayToDaySpend"
      | "priorWeekDayToDaySpend"
      | "unattributedSplit"
    >
  > & {
    /**
     * yyyy-MM-dd — the Sunday that closed the recap week.
     *
     * NOT a `WeeklyRecap` field and never written to the document: the recap is
     * READ on the following Monday, so this is the only way the narrative can
     * tell "due today" from "due later this week" when it names an upcoming
     * bill. OPTIONAL, because an old document (or any caller that doesn't have
     * it) must still produce prose — the bill is then named with a plain date
     * instead of a relative day.
     */
    weekEnd?: string;
  };

/** Mirrors `CeremonyTone` in `types/schema.ts` (separate pnpm package). */
export type CeremonyTone = "podium" | "household_first" | "adaptive";

/** Absent/unrecognised tone behaves as this — mirrors `resolveCeremonyTone`. */
export const DEFAULT_CEREMONY_TONE: CeremonyTone = "household_first";

const TONES: readonly CeremonyTone[] = ["podium", "household_first", "adaptive"];

export function resolveCeremonyTone(stored: string | undefined): CeremonyTone {
  return stored && (TONES as readonly string[]).includes(stored)
    ? (stored as CeremonyTone)
    : DEFAULT_CEREMONY_TONE;
}

// ---------------------------------------------------------------------------
// Money / date helpers
// ---------------------------------------------------------------------------

/** Decimal dollars → integer cents (house convention: never store cents). */
const cents = (dollars: number): number => Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);

/**
 * Formats decimal dollars for display, sharing the push headline's formatter so
 * the two surfaces render the same figure identically (grouped thousands, two
 * decimals).
 *
 * `formatCurrency` treats a non-finite amount as `0`, which is what keeps a
 * half-written or legacy document from putting a literal "NaN" into prose a
 * human reads. The household currency is deliberately not plumbed in here —
 * the narrative has never carried it, and doing so is a separate change.
 */
const money = (dollars: number): string => formatCurrency(dollars);

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-08-03" → "August 3". Returns the raw string if it isn't parseable. */
function formatMonthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const month = m === undefined ? undefined : MONTH_NAMES[m - 1];
  if (y === undefined || month === undefined || d === undefined || Number.isNaN(d)) return dateStr;
  return `${month} ${d}`;
}

/** Whole days from `from` to `to`, both yyyy-MM-dd. Null if either is unparseable. */
function daysBetween(from: string, to: string): number | null {
  const parse = (s: string): number | null => {
    const [y, m, d] = s.split("-").map(Number);
    if (y === undefined || m === undefined || d === undefined) return null;
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
    return Date.UTC(y, m - 1, d);
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Rules pick the facts
// ---------------------------------------------------------------------------

/**
 * How big a lead makes a week a "runaway" for the ADAPTIVE tone.
 *
 * Both gates must clear: a proportional one (so 410 vs 385 stays a close week
 * no matter how large the numbers get) and an absolute floor (so 12 vs 4 isn't
 * crowned as a blowout just because the ratio happens to be large on a quiet
 * week). Tuned to the household the feature was designed around, where a
 * typical week lands in the low hundreds of points.
 *
 * 🛡️ DUPLICATED in `utils/recapDeck.ts` on the client — the deck lays out the
 * verdict this file phrases, so the two must move together or they disagree.
 */
export const RUNAWAY_MARGIN_RATIO = 0.25;
export const RUNAWAY_MIN_MARGIN = 50;

/**
 * Materiality gates for the SPEND verdict.
 *
 * Both must clear, for the same reason the runaway gates above both do: a
 * proportional test alone calls $6 → $14 a doubling, and an absolute test alone
 * calls a $60 move on a $4,000 week a change. Deliberately NOT the runaway
 * constants — these are a different question and a different scale.
 */
export const SPEND_MATERIAL_RATIO = 0.15;
export const SPEND_MATERIAL_DOLLARS = 50;

/**
 * When a bill week is "heavy": the bills line moved by at least this much AND
 * accounts for at least this share of the week's whole spend swing.
 *
 * This is the gate that stops the narrative calling a rent week "overspending".
 * Bills are lumpy and already budgeted by the calendar; when they are what
 * moved, the honest sentence names them as the cause instead of implying the
 * household lost control of its spending.
 */
export const BILLS_HEAVY_DOLLARS = 200;
export const BILLS_HEAVY_SHARE = 0.5;

/** A points swing under this percent is noise, not a trend. */
export const POINTS_MATERIAL_PCT = 10;

/** A category has to move this much, AND by this ratio, to be called a spike. */
export const CATEGORY_SPIKE_DOLLARS = 50;
export const CATEGORY_SPIKE_RATIO = 1.5;

/** A streak has to reach this length (in its own cadence) to be a NOTABLE fact. */
export const NOTABLE_STREAK_DAYS = 7;
export const NOTABLE_STREAK_WEEKS = 3;

export interface NarrativeFraming {
  /** Which story the narrative leads with. */
  framing: "podium" | "together";
  /** The week's leader, when there is a strict one. */
  leader: { name: string; points: number } | null;
  /** The runner-up, when at least two members scored. */
  runnerUp: { name: string; points: number } | null;
  /** `leader.points - runnerUp.points` (0 when either is absent). */
  margin: number;
  /** True when the margin cleared BOTH runaway gates. */
  runaway: boolean;
}

/**
 * Decide the framing the narrative (and the client's deck order) should use.
 *
 * - `household_first` — always the together story (the Ivers default).
 * - `podium` — always the head-to-head, when there is one to tell.
 * - `adaptive` — crown a runaway week, keep a close one about the household.
 *
 * A household with fewer than two SCORING members can never be framed as a
 * podium: there is no contest to narrate, so every tone falls back to the
 * together story rather than crowning someone for showing up alone.
 */
export function selectNarrativeFraming(
  recap: RecapNumericFields,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE
): NarrativeFraming {
  const scorers = standings(recap).filter((m) => m.points > 0);
  const leader = scorers[0] ?? null;
  const runnerUp = scorers[1] ?? null;

  // A tie for first is not a podium — nobody won.
  const contested = leader !== null && runnerUp !== null && leader.points > runnerUp.points;
  const margin = contested && leader && runnerUp ? leader.points - runnerUp.points : 0;
  const runaway =
    contested &&
    margin >= RUNAWAY_MIN_MARGIN &&
    margin >= (runnerUp?.points ?? 0) * RUNAWAY_MARGIN_RATIO;

  let framing: NarrativeFraming["framing"] = "together";
  if (contested && (tone === "podium" || (tone === "adaptive" && runaway))) {
    framing = "podium";
  }

  return {
    framing,
    leader: contested ? leader : null,
    runnerUp: contested ? runnerUp : null,
    margin,
    runaway,
  };
}

/**
 * ADULT members sorted by weekly points, highest first (names break ties
 * stably).
 *
 * 🛡️ ADULTS ONLY, matching `selectAdultStandings` / `getAdultStandings` on the
 * client. A managed kid's points come from chores that credit the kid's own
 * member doc — they are an allowance ledger, not a competitive score — so a
 * chore-heavy kid week must never crown the kid the household's winner. The
 * `pointsByMember` branch carries no `isManaged`, but it is only ever reached
 * when `memberFacts` is empty, which now also means `pointsByMember` is empty.
 */
function standings(recap: RecapNumericFields): Array<{ name: string; points: number }> {
  const source: Array<{ name: string; points: number }> =
    recap.memberFacts && recap.memberFacts.length > 0
      ? recap.memberFacts.filter((f) => !f.isManaged).map((f) => ({ name: f.name, points: f.points }))
      : recap.pointsByMember.map((p) => ({ name: p.name, points: p.points }));
  return [...source].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/** Percent change of the week's household points vs the prior week, or null. */
export function pointsTrendPct(recap: RecapNumericFields): number | null {
  const current = recap.totalPoints;
  const prior = recap.priorWeekPoints;
  if (current === undefined || prior === undefined || prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

// ---------------------------------------------------------------------------
// VERDICTS — the honest scorekeeper's inputs
// ---------------------------------------------------------------------------
//
// 🛡️ WHY THIS LAYER EXISTS. The generator used to receive raw numbers and be
// left to interpret them, so it defaulted to praise: a week where day-to-day
// spending rose 40% on a heavy bill week came back as "fantastic momentum". A
// language model has nothing in a list of figures that tells it what a BAD week
// looks like, so it picks the friendly reading every time.
//
// Every judgement is therefore made HERE, deterministically, and both narrative
// paths consume the same struct: the template phrases it, and the prompt hands
// it to Gemini as settled fact with an explicit instruction not to re-derive it.
// That is what makes the two paths agree, and what makes "this week went
// backwards" sayable at all.

/** Which spend figure the week-over-week comparison was made against. */
export type SpendBasis = "dayToDay" | "total";

export interface SpendVerdict {
  /**
   * `dayToDay` whenever the split fields are present — comparing TOTALS is what
   * produced "spending tripled" on a week that simply carried more bills. Falls
   * back to `total` on a document written before the split shipped.
   */
  basis: SpendBasis;
  current: number;
  prior: number;
  /** `current - prior`, decimal dollars. */
  delta: number;
  /** `current / prior`, or null when there is no usable prior week. */
  ratio: number | null;
  direction: "up" | "down" | "flat";
  /** Cleared BOTH `SPEND_MATERIAL_RATIO` and `SPEND_MATERIAL_DOLLARS`. */
  material: boolean;
}

export interface BillsVerdict {
  current: number;
  prior: number;
  delta: number;
  /** False when the document predates the bills/day-to-day split. */
  known: boolean;
  /** Bills are what moved the week's total — lumpy, not overspending. */
  heavy: boolean;
}

export interface PointsVerdict {
  current: number | null;
  prior: number | null;
  /** Rounded percent change, or null without a usable prior week. */
  pct: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  material: boolean;
}

export interface StreakVerdict {
  atRisk: number;
  /** The longest at-risk streak, or null when none are. */
  top: { habitTitle: string; streakDays: number } | null;
}

export interface CategoryVerdict {
  category: string;
  current: number;
  prior: number;
  /** `current - prior`, always positive (only INCREASES are called spikes). */
  delta: number;
}

export interface HighlightVerdict {
  text: string;
  kind: "perfect_week" | "long_streak" | "short_streak";
  /**
   * False for a fact that is trivially true (a 5-day streak on a daily habit).
   * The narrative may mention it when nothing else happened, but must never
   * LEAD with it — citing a short shower streak as the week's evidence is
   * exactly the failure this flag exists to prevent.
   */
  notable: boolean;
}

export interface ActionVerdict {
  text: string;
  kind: "category" | "streak" | "bill";
}

/**
 * The week in one word.
 *
 * - `better` / `worse` — the comparables moved together, one way.
 * - `mixed` — they moved in opposite directions; the numbers carry the story.
 * - `flat` — nothing moved materially. NOT a licence to invent a win.
 * - `quiet` — nothing was logged at all.
 */
export type WeekVerdict = "better" | "worse" | "mixed" | "flat" | "quiet";

export interface RecapVerdicts {
  week: WeekVerdict;
  spend: SpendVerdict;
  bills: BillsVerdict;
  points: PointsVerdict;
  streaks: StreakVerdict;
  /** The biggest MATERIAL day-to-day category increase, or null. */
  categorySpike: CategoryVerdict | null;
  highlight: HighlightVerdict | null;
  /** The one thing worth attention, or null — never a filler suggestion. */
  action: ActionVerdict | null;
  framing: NarrativeFraming;
  /**
   * Points the household earned TOGETHER on purpose (`creditMode: 'household'`).
   *
   * 🛡️ Present so the prompt can forbid describing them as missing. These
   * belong to nobody BY DESIGN — 15 of this household's habits are shared —
   * and calling them unattributed reads as a data problem when it is a setting.
   * Null when the document predates the split (unknown, not zero).
   */
  householdCreditPoints: number | null;
}

function deriveSpend(recap: RecapNumericFields): SpendVerdict {
  const dayToDay = recap.dayToDaySpend;
  const priorDayToDay = recap.priorWeekDayToDaySpend;
  const base =
    typeof dayToDay === "number" && typeof priorDayToDay === "number"
      ? { basis: "dayToDay" as const, current: dayToDay, prior: priorDayToDay }
      : { basis: "total" as const, current: recap.totalSpend, prior: recap.priorWeekSpend };

  const deltaCents = cents(base.current) - cents(base.prior);
  const direction = deltaCents > 0 ? "up" : deltaCents < 0 ? "down" : "flat";
  const ratio = base.prior > 0 ? base.current / base.prior : null;
  const clearsAbsolute = Math.abs(deltaCents) >= cents(SPEND_MATERIAL_DOLLARS);
  const clearsRatio =
    base.prior > 0 ? Math.abs(deltaCents) >= cents(base.prior) * SPEND_MATERIAL_RATIO : true;

  return {
    basis: base.basis,
    current: base.current,
    prior: base.prior,
    delta: deltaCents / 100,
    ratio,
    direction,
    material: clearsAbsolute && clearsRatio,
  };
}

function deriveBills(recap: RecapNumericFields): BillsVerdict {
  const current = recap.billsSpend;
  const prior = recap.priorWeekBillsSpend;
  const known = typeof current === "number" && typeof prior === "number";
  const currentValue = typeof current === "number" ? current : 0;
  const priorValue = typeof prior === "number" ? prior : 0;

  const billsDeltaCents = cents(currentValue) - cents(priorValue);
  const totalDeltaCents = cents(recap.totalSpend) - cents(recap.priorWeekSpend);
  const heavy =
    known &&
    billsDeltaCents >= cents(BILLS_HEAVY_DOLLARS) &&
    totalDeltaCents > 0 &&
    billsDeltaCents >= totalDeltaCents * BILLS_HEAVY_SHARE;

  return {
    current: currentValue,
    prior: priorValue,
    delta: billsDeltaCents / 100,
    known,
    heavy,
  };
}

function derivePoints(recap: RecapNumericFields): PointsVerdict {
  const current = recap.totalPoints;
  const prior = recap.priorWeekPoints;
  if (current === undefined || prior === undefined) {
    return {
      current: current ?? null,
      prior: prior ?? null,
      pct: null,
      direction: "unknown",
      material: false,
    };
  }
  const pct = pointsTrendPct(recap);
  const delta = current - prior;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  // A household going from nothing to something has no usable percent, but the
  // move is unmistakably real — the percent gate would silently call it noise.
  const material = pct === null ? prior <= 0 && current > 0 : Math.abs(pct) >= POINTS_MATERIAL_PCT;
  return { current, prior, pct, direction, material };
}

function deriveStreaks(recap: RecapNumericFields): StreakVerdict {
  const top = recap.streaksAtRisk.reduce<StreakVerdict["top"]>(
    (best, s) => (best === null || s.streakDays > best.streakDays ? s : best),
    null
  );
  return { atRisk: recap.streaksAtRisk.length, top };
}

function deriveCategorySpike(recap: RecapNumericFields): CategoryVerdict | null {
  let best: CategoryVerdict | null = null;
  for (const d of recap.topCategoryDeltas) {
    const deltaCents = cents(d.current) - cents(d.prior);
    if (deltaCents < cents(CATEGORY_SPIKE_DOLLARS)) continue;
    if (d.prior > 0 && cents(d.current) < cents(d.prior) * CATEGORY_SPIKE_RATIO) continue;
    if (best === null || deltaCents > cents(best.delta)) {
      best = { category: d.category, current: d.current, prior: d.prior, delta: deltaCents / 100 };
    }
  }
  return best;
}

/**
 * The single most quotable per-member fact, ranked so a REAL one always beats a
 * trivial one: a perfect week beats a long streak beats a short streak.
 */
function selectHighlight(recap: RecapNumericFields): HighlightVerdict | null {
  const facts = recap.memberFacts ?? [];

  const perfect = facts.find((f) => f.perfectHabits.length > 0);
  const perfectHabit = perfect?.perfectHabits[0];
  if (perfect && perfectHabit) {
    return {
      text: `${perfect.name} completed ${perfectHabit} every day of the week`,
      kind: "perfect_week",
      notable: true,
    };
  }

  const best = facts.reduce<RecapMemberFacts | null>(
    (acc, f) => (f.topStreak && (!acc?.topStreak || f.topStreak.days > acc.topStreak.days) ? f : acc),
    null
  );
  const streak = best?.topStreak;
  if (!best || !streak) return null;

  // Singular inside the compound adjective ("a 5-day streak"), which is also a
  // grammar fix: this used to render "a 5-days streak".
  const unit = streak.period === "weekly" ? "week" : "day";
  const notable =
    streak.period === "weekly" ? streak.days >= NOTABLE_STREAK_WEEKS : streak.days >= NOTABLE_STREAK_DAYS;
  return {
    text: `${best.name} is on a ${streak.days}-${unit} streak with ${streak.habitTitle}`,
    kind: notable ? "long_streak" : "short_streak",
    notable,
  };
}

/**
 * The one thing worth attention, in priority order: the spend anomaly, then a
 * streak about to break, then the largest bill coming up.
 *
 * The bill comes LAST on purpose. It used to be the only closer the generator
 * ever reached for, which produced "review your upcoming bill due August 3rd"
 * in a recap read ON August 3rd — advice about something already happening.
 * When it does surface it is now dated relative to the day the recap is read.
 */
function deriveAction(
  recap: RecapNumericFields,
  categorySpike: CategoryVerdict | null,
  streaks: StreakVerdict
): ActionVerdict | null {
  if (categorySpike) {
    return {
      kind: "category",
      text: `${categorySpike.category} is where the increase came from — ${money(categorySpike.current)} against ${money(categorySpike.prior)} last week.`,
    };
  }

  if (streaks.top) {
    return {
      kind: "streak",
      text: `${streaks.top.habitTitle} carries a ${streaks.top.streakDays}-day streak that missed the week's last day.`,
    };
  }

  const biggestBill = recap.upcomingBills.reduce<WeeklyRecap["upcomingBills"][number] | null>(
    (best, b) => (best === null || cents(b.amount) > cents(best.amount) ? b : best),
    null
  );
  if (!biggestBill) return null;

  // The recap is READ on the Monday after `weekEnd`, so a bill dated weekEnd+1
  // is due the same day the reader sees this sentence.
  const offset = recap.weekEnd === undefined ? null : daysBetween(recap.weekEnd, biggestBill.date);
  const daysAway = offset === null ? null : offset - 1;
  const when =
    daysAway === 0
      ? "is due today"
      : daysAway === 1
        ? "is due tomorrow"
        : `is due ${formatMonthDay(biggestBill.date)}`;
  return { kind: "bill", text: `${biggestBill.title}, ${money(biggestBill.amount)}, ${when}.` };
}

/**
 * The whole point of this module: turn the week's figures into settled
 * judgements so neither narrative path has to guess what a bad week looks like.
 */
export function deriveVerdicts(
  recap: RecapNumericFields,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE
): RecapVerdicts {
  const spend = deriveSpend(recap);
  const bills = deriveBills(recap);
  const points = derivePoints(recap);
  const streaks = deriveStreaks(recap);
  const categorySpike = deriveCategorySpike(recap);
  const highlight = selectHighlight(recap);
  const action = deriveAction(recap, categorySpike, streaks);
  const framing = selectNarrativeFraming(recap, tone);

  // Spending less is a better week; earning more points is a better week. Each
  // comparable votes only when it moved MATERIALLY, so noise never tips the
  // verdict either way.
  //
  // Note the basis: on a document carrying the split, `spend` is the DAY-TO-DAY
  // figure, so a heavy bill week cannot vote "worse" on its own. On a pre-split
  // document there is no way to tell the two apart, and the total is all there
  // is — which is why the prose on those weeks names the total explicitly
  // instead of characterising it.
  const spendVote = spend.material ? (spend.direction === "down" ? 1 : -1) : 0;
  const pointsVote = points.material ? (points.direction === "up" ? 1 : -1) : 0;
  const score = spendVote + pointsVote;

  const nothingLogged =
    cents(recap.totalSpend) === 0 &&
    cents(recap.priorWeekSpend) === 0 &&
    recap.habitCompletions === 0 &&
    (points.current ?? 0) === 0;

  let week: WeekVerdict;
  if (nothingLogged) {
    week = "quiet";
  } else if (score > 0) {
    week = "better";
  } else if (score < 0) {
    week = "worse";
  } else if (spendVote !== 0 || pointsVote !== 0) {
    week = "mixed";
  } else {
    week = "flat";
  }

  const householdCredit = recap.unattributedSplit?.householdCredit;

  return {
    week,
    spend,
    bills,
    points,
    streaks,
    categorySpike,
    highlight,
    action,
    framing,
    householdCreditPoints: typeof householdCredit === "number" ? householdCredit : null,
  };
}

// ---------------------------------------------------------------------------
// Template (free tier + AI fallback)
// ---------------------------------------------------------------------------

/** The verdict clause the summary opens with, or null when the week doesn't earn one. */
function openingClause(week: WeekVerdict): string | null {
  switch (week) {
    case "better":
      return "This week came out ahead of last week.";
    case "worse":
      return "This week came out behind last week.";
    case "quiet":
      return "A quiet week — almost nothing was logged.";
    // A mixed or flat week gets NO verdict clause. Manufacturing one is how a
    // week that simply happened turns into a week that "showed momentum".
    case "mixed":
    case "flat":
      return null;
  }
}

/** The money sentence(s): what moved, what it was measured against, and why. */
function spendSentences(verdicts: RecapVerdicts, recap: RecapNumericFields): string[] {
  const { spend, bills } = verdicts;
  const noun = spend.basis === "dayToDay" ? "Day-to-day spending" : "Spending";

  if (cents(spend.current) === 0 && cents(spend.prior) === 0 && cents(recap.totalSpend) === 0) {
    return ["No verified spending was logged this week."];
  }

  const sentences: string[] = [];
  if (spend.basis === "dayToDay" && cents(spend.current) === 0 && cents(spend.prior) === 0) {
    // An all-bills week: "Day-to-day spending was $0.00 this week against $0.00
    // last week" is true but says nothing. The bills sentence below carries it.
    sentences.push("No day-to-day spending was logged this week.");
  } else if (spend.material && spend.direction === "up") {
    sentences.push(`${noun} rose to ${money(spend.current)}, up from ${money(spend.prior)} last week.`);
  } else if (spend.material && spend.direction === "down") {
    sentences.push(`${noun} fell to ${money(spend.current)}, down from ${money(spend.prior)} last week.`);
  } else {
    // Not material: state both figures and characterise NEITHER.
    sentences.push(`${noun} was ${money(spend.current)} this week against ${money(spend.prior)} last week.`);
  }

  if (bills.heavy) {
    sentences.push(
      `Bills took another ${money(bills.current)} — most of the week's ${money(recap.totalSpend)} total, and already budgeted.`
    );
  } else if (bills.known && cents(bills.current) > 0 && spend.basis === "dayToDay") {
    sentences.push(`Bills accounted for ${money(bills.current)} of the week's ${money(recap.totalSpend)} total.`);
  }

  return sentences;
}

/** The habits/points sentence for the TOGETHER framing. */
function habitSentence(verdicts: RecapVerdicts, recap: RecapNumericFields): string {
  const { points } = verdicts;
  const completions = recap.habitCompletions;
  const completionNoun = `${completions} habit completion${completions === 1 ? "" : "s"}`;

  if (points.current !== null && points.direction !== "unknown" && points.prior !== null) {
    if (points.material && points.pct !== null) {
      const word = points.direction === "up" ? "up" : "down";
      return `${completionNoun} earned ${points.current} points, ${word} ${Math.abs(points.pct)}% on last week's ${points.prior}.`;
    }
    return `${completionNoun} earned ${points.current} points, about level with last week's ${points.prior}.`;
  }

  if (points.current !== null) {
    return `${completionNoun} earned ${points.current} points.`;
  }

  if (completions > 0) {
    return `You logged ${completionNoun} this week.`;
  }

  return "No habit activity was logged this week.";
}

/**
 * Deterministic, no-AI narrative built purely from the derived VERDICTS. Used
 * as the free-tier narrative and as the fallback when the Gemini call fails for
 * any reason — which makes it the copy that actually ships whenever the AI path
 * is unavailable, so it is written to stand on its own.
 *
 * It is an HONEST SCOREKEEPER: it states what happened, in order, and a week
 * that went backwards says so. It never congratulates by default, carries no
 * exclamation marks, and leads with a trivial fact only when nothing better
 * happened.
 *
 * The habit sentence is TONE-AWARE: the same facts, framed either as the
 * household's week or as the head-to-head, exactly as `selectNarrativeFraming`
 * decides. The spend sentence never changes — money is not a competition.
 */
export function buildTemplateNarrative(
  recap: RecapNumericFields,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE
): string {
  const verdicts = deriveVerdicts(recap, tone);
  const { framing, highlight, action } = verdicts;

  const parts: string[] = [];

  const opening = openingClause(verdicts.week);
  if (opening) parts.push(opening);

  parts.push(...spendSentences(verdicts, recap));

  if (framing.framing === "podium" && framing.leader && framing.runnerUp) {
    const verb = framing.runaway ? "ran away with the week" : "edged out the week";
    parts.push(
      `${framing.leader.name} ${verb} with ${framing.leader.points} points to ${framing.runnerUp.name}'s ${framing.runnerUp.points} — ${framing.margin} apart.`
    );
  } else {
    parts.push(habitSentence(verdicts, recap));
    // A trivial streak is mentioned only when the week produced nothing else to
    // say about habits — never as the week's evidence.
    if (highlight && (highlight.notable || recap.habitCompletions === 0)) {
      parts.push(`${highlight.text}.`);
    }
  }

  if (action) parts.push(action.text);

  return parts.join(" ");
}

interface NarrativeResult {
  text: string;
  source: "ai" | "template";
}

/**
 * Attempts exactly one Gemini call to produce a plain 2-3 sentence recap
 * summary from the pre-aggregated numeric fields ONLY (never raw merchant
 * lists or transaction-level data). On any failure — timeout, API error, or a
 * malformed/empty response — falls back to the deterministic template with
 * source 'template'.
 *
 * The RULES pick the facts AND make the JUDGEMENTS (`deriveVerdicts`); Gemini
 * only phrases them, and the template covers every failure — the house pattern
 * for AI-assisted copy.
 */
export async function generateNarrative(
  recapData: RecapNumericFields,
  apiKey: string,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE,
  timeoutMs: number = NARRATIVE_TIMEOUT_MS
): Promise<NarrativeResult> {
  // Held so the pending timeout can be cleared on ANY exit path — otherwise a
  // fast success/failure would leave a live 30s timer holding the event loop
  // open (slow test teardown; wasted Cloud Functions wall time).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = buildPrompt(recapData, tone);

    const callPromise = ai.models.generateContent({
      model: RECAP_GEMINI_MODEL,
      contents: prompt,
    });
    // If the timeout wins the race below, this promise is abandoned but still
    // live — without its own handler, a late rejection becomes an
    // unhandledRejection that can crash the Functions runtime.
    callPromise.catch((error) => {
      logger.warn("generateNarrative: abandoned Gemini call settled with an error", error);
    });

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Gemini recap narrative call timed out")), timeoutMs);
    });

    const response = await Promise.race([callPromise, timeoutPromise]);
    const text = response.text?.trim();

    if (!text) {
      throw new Error("Gemini returned an empty narrative");
    }

    return { text, source: "ai" };
  } catch (error) {
    logger.error("generateNarrative: Gemini call failed, falling back to template", error);
    return { text: buildTemplateNarrative(recapData, tone), source: "template" };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** One-line, human-readable rendering of the spend verdict for the prompt. */
function spendVerdictLine(spend: SpendVerdict): string {
  const label = spend.basis === "dayToDay" ? "Day-to-day spending" : "Spending (bills NOT separable on this week)";
  const movement =
    spend.direction === "flat"
      ? "unchanged"
      : spend.material
        ? `${spend.direction === "up" ? "rose" : "fell"}, materially`
        : `${spend.direction === "up" ? "rose" : "fell"} slightly — NOT a material change, do not dramatise it`;
  return `${label}: ${movement} — ${money(spend.current)} this week against ${money(spend.prior)} last week`;
}

/** One-line, human-readable rendering of the points verdict for the prompt. */
function pointsVerdictLine(points: PointsVerdict): string {
  if (points.direction === "unknown" || points.prior === null) {
    return `Habit points: ${points.current ?? "unknown"} this week; last week's total is unknown, so do NOT claim a trend`;
  }
  if (!points.material) {
    return `Habit points: ${points.current} this week against ${points.prior} last week — level, not a change`;
  }
  const pct = points.pct === null ? "" : ` (${Math.abs(points.pct)}%)`;
  return `Habit points: ${points.direction === "up" ? "up" : "down"}${pct} — ${points.current} this week against ${points.prior} last week`;
}

export function buildPrompt(
  recap: RecapNumericFields,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE
): string {
  const verdicts = deriveVerdicts(recap, tone);
  const { framing, spend, bills, points, streaks, categorySpike, highlight, action } = verdicts;

  const framingLine =
    framing.framing === "podium" && framing.leader && framing.runnerUp
      ? `Lead with the head-to-head: ${framing.leader.name} finished ahead of ${framing.runnerUp.name} by ${framing.margin} points. Name the winner warmly, never mock the runner-up.`
      : "Lead with what the household did TOGETHER. You may mention individuals, but the week belongs to the household — do not crown a winner.";

  const billsLine = !bills.known
    ? "Bills: not separable on this week's data — do not guess how much of the total was bills"
    : bills.heavy
      ? `Bills: ${money(bills.current)} this week against ${money(bills.prior)} last week — a HEAVY BILL WEEK. Bills are lumpy and already budgeted; this is NOT overspending and must not be described as such`
      : `Bills: ${money(bills.current)} this week against ${money(bills.prior)} last week`;

  const lines: string[] = [
    "You are writing the weekly summary for a household finance and habit tracking app.",
    "Write 2-3 plain sentences. You are a scorekeeper, not a cheerleader.",
    "",
    "VOICE",
    "- State what happened. A week that went backwards says so, plainly and without scolding.",
    "- Do NOT congratulate by default. Be positive only when the week verdict below is \"better\".",
    "- No exclamation marks. Never write \"fantastic\", \"amazing\", \"great job\", \"keep it up\", \"you're doing great\", or \"momentum\".",
    "- Use ONLY the figures below, exactly as written. Do not compute, re-derive, combine, or re-round them.",
    "- Do not lead with a fact marked \"(minor)\" — mention it only if there is nothing else to say.",
    "- Close with the \"Worth attention\" line if there is one. If there is none, simply stop; do not invent advice.",
    "",
    "VERDICTS (already computed — phrase these, do not second-guess or recompute them)",
    `Week verdict: ${verdicts.week}`,
    `Comparison basis: ${spend.basis === "dayToDay" ? "day-to-day spending, because bills are lumpy and already budgeted" : "total spending, because this week's data cannot separate bills"}`,
    spendVerdictLine(spend),
    billsLine,
    `Total spend (bills plus day-to-day): ${money(recap.totalSpend)} this week against ${money(recap.priorWeekSpend)} last week`,
    pointsVerdictLine(points),
    `Habit completions: ${recap.habitCompletions}`,
    `Streaks at risk: ${
      streaks.top === null
        ? "none"
        : `${streaks.atRisk} — the longest is ${streaks.top.habitTitle} at ${streaks.top.streakDays} days`
    }`,
    `Biggest category change: ${
      categorySpike === null
        ? "none material"
        : `${categorySpike.category}, ${money(categorySpike.current)} this week against ${money(categorySpike.prior)} last week`
    }`,
    `Standout fact: ${highlight === null ? "none" : `${highlight.text}${highlight.notable ? "" : " (minor)"}`}`,
    `Worth attention: ${action === null ? "nothing — do not invent a suggestion" : action.text}`,
    framingLine,
  ];

  if (verdicts.householdCreditPoints !== null && verdicts.householdCreditPoints !== 0) {
    lines.push(
      `Household-credit points: ${verdicts.householdCreditPoints} of this week's points come from shared habits the household earns TOGETHER by design. Never describe them as missing, unattributed, unclaimed, or a problem.`
    );
  }

  return lines.join("\n");
}
