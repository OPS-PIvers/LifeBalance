import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";
import { DailyBriefingSummary } from "./dataAssembly";

/**
 * Model constant for the daily briefing narrative. Mirrors
 * `recap/narrative.ts` / `moneyRecap/narrative.ts` — defined once here so
 * changing the model happens in a single place. functions/ has no Vite env, so
 * this is a plain constant.
 */
export const DAILY_BRIEFING_GEMINI_MODEL = "gemini-3.1-flash-lite";

const NARRATIVE_TIMEOUT_MS = 20_000;

export interface BriefingNarrativeResult {
  text: string;
  source: "ai" | "template";
}

/**
 * Deterministic, no-AI one/two-sentence morning briefing built purely from the
 * aggregated numbers. Used as the free/AI-off narrative and as the fallback
 * when the Gemini call fails for any reason. Callers only invoke this when
 * `summary.hasContent` is true, so at least one clause is always produced.
 */
export function buildTemplateNarrative(summary: DailyBriefingSummary): string {
  const clauses: string[] = [];

  if (summary.billsDueCount > 0) {
    const noun = summary.billsDueCount === 1 ? "bill" : "bills";
    clauses.push(
      `${summary.billsDueCount} ${noun} due today ($${summary.billsDueTotal.toFixed(2)})`
    );
  }

  if (summary.pendingReviewCount > 0) {
    const noun =
      summary.pendingReviewCount === 1 ? "transaction" : "transactions";
    clauses.push(`${summary.pendingReviewCount} ${noun} to review`);
  }

  if (summary.habitsRemaining > 0) {
    const noun = summary.habitsRemaining === 1 ? "habit" : "habits";
    clauses.push(`${summary.habitsRemaining} ${noun} left to check off`);
  }

  const lead =
    clauses.length > 0
      ? `Good morning! Today you have ${joinClauses(clauses)}.`
      : "Good morning! You're all caught up for today.";

  const streakSentence =
    summary.streaksAtRisk > 0
      ? ` ${summary.streaksAtRisk} ${summary.streaksAtRisk === 1 ? "streak is" : "streaks are"} at risk — don't let ${summary.streaksAtRisk === 1 ? "it" : "them"} slip.`
      : "";

  return `${lead}${streakSentence}`;
}

/** Joins clauses as "a", "a and b", or "a, b, and c". */
function joinClauses(clauses: string[]): string {
  if (clauses.length === 1) return clauses[0] ?? "";
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  const head = clauses.slice(0, -1).join(", ");
  return `${head}, and ${clauses[clauses.length - 1]}`;
}

/**
 * Attempts exactly one Gemini call to produce a warm, single-sentence morning
 * briefing from the pre-aggregated numeric fields ONLY (never raw
 * transaction-level data). On any failure — timeout, API error, or a
 * malformed/empty response — falls back to the deterministic template with
 * source 'template'. Mirrors `moneyRecap/narrative.ts`.
 */
export async function generateBriefingText(
  summary: DailyBriefingSummary,
  apiKey: string,
  timeoutMs: number = NARRATIVE_TIMEOUT_MS
): Promise<BriefingNarrativeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildPrompt(summary);

    const callPromise = ai.models.generateContent({
      model: DAILY_BRIEFING_GEMINI_MODEL,
      contents: prompt,
    });
    callPromise.catch((error) => {
      logger.warn(
        "dailyBriefing generateBriefingText: abandoned Gemini call settled with an error",
        error
      );
    });

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Gemini daily briefing call timed out")),
        timeoutMs
      );
    });

    const response = await Promise.race([callPromise, timeoutPromise]);
    const text = response.text?.trim();

    if (!text) {
      throw new Error("Gemini returned an empty briefing");
    }

    return { text, source: "ai" };
  } catch (error) {
    logger.error(
      "dailyBriefing generateBriefingText: Gemini call failed, falling back to template",
      error
    );
    return { text: buildTemplateNarrative(summary), source: "template" };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function buildPrompt(summary: DailyBriefingSummary): string {
  return [
    "You are writing a warm, encouraging ONE-sentence (max two) morning briefing",
    "for a household finance-and-habits app, delivered as a push notification.",
    "Use ONLY the numbers below (never invent bills, merchants, names, or",
    "details not given). Keep it under 180 characters, upbeat and actionable.",
    "Do not use markdown or emoji.",
    "",
    `Bills due today: ${summary.billsDueCount} (total $${summary.billsDueTotal.toFixed(2)})`,
    `Transactions awaiting review: ${summary.pendingReviewCount}`,
    `Habits left to complete today: ${summary.habitsRemaining} of ${summary.habitsTotal}`,
    `Habit streaks at risk of breaking today: ${summary.streaksAtRisk}`,
  ].join("\n");
}
