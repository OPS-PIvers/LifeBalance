import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";
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
  Partial<Pick<WeeklyRecap, "memberFacts" | "totalPoints" | "priorWeekPoints">>;

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
 */
export const RUNAWAY_MARGIN_RATIO = 0.25;
export const RUNAWAY_MIN_MARGIN = 50;

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

/** Members sorted by weekly points, highest first (names break ties stably). */
function standings(recap: RecapNumericFields): Array<{ name: string; points: number }> {
  const source: Array<{ name: string; points: number }> =
    recap.memberFacts && recap.memberFacts.length > 0
      ? recap.memberFacts.map((f) => ({ name: f.name, points: f.points }))
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

/** The single most quotable per-member fact, or null when there is none. */
function highlightFact(recap: RecapNumericFields): string | null {
  const facts = recap.memberFacts ?? [];
  const perfect = facts.find((f) => f.perfectHabits.length > 0);
  if (perfect) {
    return `${perfect.name} completed ${perfect.perfectHabits[0]} every day of the week`;
  }
  const streak = facts.reduce<RecapMemberFacts | null>(
    (best, f) => (f.topStreak && (!best?.topStreak || f.topStreak.days > best.topStreak.days) ? f : best),
    null
  );
  if (streak?.topStreak) {
    const unit = streak.topStreak.period === "weekly" ? "week" : "day";
    const plural = streak.topStreak.days === 1 ? "" : "s";
    return `${streak.name} is on a ${streak.topStreak.days}-${unit}${plural} streak with ${streak.topStreak.habitTitle}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template (free tier + AI fallback)
// ---------------------------------------------------------------------------

/**
 * Deterministic, no-AI 2-sentence narrative built purely from the assembled
 * numbers. Used as the free-tier narrative and as the fallback when the
 * Gemini call fails for any reason.
 *
 * The habit sentence is TONE-AWARE: the same facts, framed either as the
 * household's week or as the head-to-head, exactly as `selectNarrativeFraming`
 * decides. The spend sentence never changes — money is not a competition.
 */
export function buildTemplateNarrative(
  recap: RecapNumericFields,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE
): string {
  const spendDelta = recap.totalSpend - recap.priorWeekSpend;
  const spendComparison =
    spendDelta > 0
      ? "more than"
      : spendDelta < 0
        ? "less than"
        : "the same as";
  const spendSentence =
    recap.totalSpend === 0 && recap.priorWeekSpend === 0
      ? "No verified spending was logged this week."
      : `You spent $${recap.totalSpend.toFixed(2)} this week, ${spendComparison} last week's $${recap.priorWeekSpend.toFixed(2)}.`;

  const framing = selectNarrativeFraming(recap, tone);

  if (framing.framing === "podium" && framing.leader && framing.runnerUp) {
    const verb = framing.runaway ? "ran away with the week" : "edged out the week";
    return `${spendSentence} ${framing.leader.name} ${verb} with ${framing.leader.points} points to ${framing.runnerUp.name}'s ${framing.runnerUp.points} — ${framing.margin} apart.`;
  }

  const habitParts: string[] = [];
  if (recap.habitCompletions > 0) {
    habitParts.push(
      `${recap.habitCompletions} habit completion${recap.habitCompletions === 1 ? "" : "s"}`
    );
  }
  if (recap.streaksAtRisk.length > 0) {
    habitParts.push(
      `${recap.streaksAtRisk.length} streak${recap.streaksAtRisk.length === 1 ? "" : "s"} at risk`
    );
  }

  const habitSentence =
    habitParts.length > 0
      ? `You logged ${habitParts.join(" with ")} this week — keep it up!`
      : "No habit activity was logged this week — a fresh week is a fresh start.";

  return `${spendSentence} ${habitSentence}`;
}

interface NarrativeResult {
  text: string;
  source: "ai" | "template";
}

/**
 * Attempts exactly one Gemini call to produce a warm 2-3 sentence recap
 * summary from the pre-aggregated numeric fields ONLY (never raw merchant
 * lists or transaction-level data). On any failure — timeout, API error, or a
 * malformed/empty response — falls back to the deterministic template with
 * source 'template'.
 *
 * The RULES pick the facts (`selectNarrativeFraming` / `highlightFact`); Gemini
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

export function buildPrompt(
  recap: RecapNumericFields,
  tone: CeremonyTone = DEFAULT_CEREMONY_TONE
): string {
  const framing = selectNarrativeFraming(recap, tone);
  const trend = pointsTrendPct(recap);
  const highlight = highlightFact(recap);

  const framingLine =
    framing.framing === "podium" && framing.leader && framing.runnerUp
      ? `Lead with the head-to-head: ${framing.leader.name} finished ahead of ${framing.runnerUp.name} by ${framing.margin} points. Name the winner warmly, never mock the runner-up.`
      : "Lead with what the household did TOGETHER. You may mention individuals, but the week belongs to the household — do not crown a winner.";

  return [
    "You are writing a warm, encouraging 2-3 sentence weekly recap summary",
    "for a household finance + habit tracking app. Use ONLY the numbers",
    "below (never invent merchants, names, or details not given). End with",
    "one short actionable suggestion.",
    framingLine,
    "",
    `Total spend this week: $${recap.totalSpend.toFixed(2)}`,
    `Total spend last week: $${recap.priorWeekSpend.toFixed(2)}`,
    `Top category changes: ${JSON.stringify(recap.topCategoryDeltas)}`,
    `Habit completions this week: ${recap.habitCompletions}`,
    `Streaks at risk: ${JSON.stringify(recap.streaksAtRisk)}`,
    `Points earned by member this week: ${JSON.stringify(recap.pointsByMember)}`,
    `Household points this week: ${recap.totalPoints ?? "unknown"}`,
    `Household points last week: ${recap.priorWeekPoints ?? "unknown"}`,
    `Household points change vs last week: ${trend === null ? "unknown" : `${trend}%`}`,
    `Standout fact: ${highlight ?? "none"}`,
    `Upcoming bills next week: ${JSON.stringify(recap.upcomingBills)}`,
  ].join("\n");
}
