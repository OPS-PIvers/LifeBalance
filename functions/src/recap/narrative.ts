import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";
import { WeeklyRecap } from "./types";

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
>;

/**
 * Deterministic, no-AI 2-sentence narrative built purely from the assembled
 * numbers. Used as the free-tier narrative and as the fallback when the
 * Gemini call fails for any reason.
 */
export function buildTemplateNarrative(recap: RecapNumericFields): string {
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
 */
export async function generateNarrative(
  recapData: RecapNumericFields,
  apiKey: string,
  timeoutMs: number = NARRATIVE_TIMEOUT_MS
): Promise<NarrativeResult> {
  // Held so the pending timeout can be cleared on ANY exit path — otherwise a
  // fast success/failure would leave a live 30s timer holding the event loop
  // open (slow test teardown; wasted Cloud Functions wall time).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = buildPrompt(recapData);

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
    return { text: buildTemplateNarrative(recapData), source: "template" };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function buildPrompt(recap: RecapNumericFields): string {
  return [
    "You are writing a warm, encouraging 2-3 sentence weekly recap summary",
    "for a household finance + habit tracking app. Use ONLY the numbers",
    "below (never invent merchants, names, or details not given). End with",
    "one short actionable suggestion.",
    "",
    `Total spend this week: $${recap.totalSpend.toFixed(2)}`,
    `Total spend last week: $${recap.priorWeekSpend.toFixed(2)}`,
    `Top category changes: ${JSON.stringify(recap.topCategoryDeltas)}`,
    `Habit completions this week: ${recap.habitCompletions}`,
    `Streaks at risk: ${JSON.stringify(recap.streaksAtRisk)}`,
    `Points earned by member this week: ${JSON.stringify(recap.pointsByMember)}`,
    `Upcoming bills next week: ${JSON.stringify(recap.upcomingBills)}`,
  ].join("\n");
}
