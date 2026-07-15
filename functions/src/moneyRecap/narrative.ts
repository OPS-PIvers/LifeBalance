import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";
import { MonthlyMoneyRecap } from "./types";

/**
 * Model constant for the monthly money recap narrative. Mirrors
 * `recap/narrative.ts`'s `RECAP_GEMINI_MODEL` — defined once here so changing
 * the model happens in a single place. functions/ has no Vite env, so this is a
 * plain constant.
 */
export const MONEY_RECAP_GEMINI_MODEL = "gemini-3.1-flash-lite";

const NARRATIVE_TIMEOUT_MS = 30_000;

export type MoneyRecapNumericFields = Pick<
  MonthlyMoneyRecap,
  | "month"
  | "totalIncome"
  | "totalSpend"
  | "priorMonthSpend"
  | "bucketResults"
  | "topExpense"
  | "netWorthDelta"
>;

/**
 * Deterministic, no-AI 2-3 sentence narrative built purely from the assembled
 * numbers. Used as the free-tier narrative and as the fallback when the Gemini
 * call fails for any reason.
 */
export function buildTemplateNarrative(recap: MoneyRecapNumericFields): string {
  const spendDelta = recap.totalSpend - recap.priorMonthSpend;
  const spendComparison =
    spendDelta > 0 ? "more than" : spendDelta < 0 ? "less than" : "the same as";
  const spendSentence =
    recap.totalSpend === 0 && recap.priorMonthSpend === 0
      ? "No verified spending was logged this month."
      : `You spent $${recap.totalSpend.toFixed(2)} this month, ${spendComparison} last month's $${recap.priorMonthSpend.toFixed(2)}.`;

  const net = recap.totalIncome - recap.totalSpend;
  const netSentence =
    recap.totalIncome > 0
      ? net >= 0
        ? `That leaves $${net.toFixed(2)} of income unspent.`
        : `That's $${Math.abs(net).toFixed(2)} more than you took in.`
      : "";

  const overBucket = recap.bucketResults.find((b) => b.overUnder > 0);
  const bucketSentence = overBucket
    ? `${overBucket.bucketName} ran $${overBucket.overUnder.toFixed(2)} over budget — worth a look next month.`
    : recap.bucketResults.length > 0
      ? "Every budget category landed at or under its limit — nicely done."
      : "";

  return [spendSentence, netSentence, bucketSentence].filter(Boolean).join(" ");
}

interface NarrativeResult {
  text: string;
  source: "ai" | "template";
}

/**
 * Attempts exactly one Gemini call to produce a warm 2-3 sentence monthly money
 * recap from the pre-aggregated numeric fields ONLY (never raw transaction-level
 * data beyond the single biggest expense). On any failure — timeout, API error,
 * or a malformed/empty response — falls back to the deterministic template with
 * source 'template'. Mirrors `recap/narrative.ts`.
 */
export async function generateNarrative(
  recapData: MoneyRecapNumericFields,
  apiKey: string,
  timeoutMs: number = NARRATIVE_TIMEOUT_MS
): Promise<NarrativeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildPrompt(recapData);

    const callPromise = ai.models.generateContent({
      model: MONEY_RECAP_GEMINI_MODEL,
      contents: prompt,
    });
    callPromise.catch((error) => {
      logger.warn("moneyRecap generateNarrative: abandoned Gemini call settled with an error", error);
    });

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Gemini money recap narrative call timed out")), timeoutMs);
    });

    const response = await Promise.race([callPromise, timeoutPromise]);
    const text = response.text?.trim();

    if (!text) {
      throw new Error("Gemini returned an empty narrative");
    }

    return { text, source: "ai" };
  } catch (error) {
    logger.error("moneyRecap generateNarrative: Gemini call failed, falling back to template", error);
    return { text: buildTemplateNarrative(recapData), source: "template" };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function buildPrompt(recap: MoneyRecapNumericFields): string {
  return [
    "You are writing a warm, encouraging 2-3 sentence monthly money recap",
    "for a household finance app. Use ONLY the numbers below (never invent",
    "merchants, names, or details not given). End with one short actionable",
    "suggestion.",
    "",
    `Month: ${recap.month}`,
    `Total income this month: $${recap.totalIncome.toFixed(2)}`,
    `Total spend this month: $${recap.totalSpend.toFixed(2)}`,
    `Total spend last month: $${recap.priorMonthSpend.toFixed(2)}`,
    `Per-bucket results (spent vs limit): ${JSON.stringify(recap.bucketResults)}`,
    `Biggest single expense: ${JSON.stringify(recap.topExpense)}`,
    `Net worth change: ${recap.netWorthDelta === null ? "unknown" : `$${recap.netWorthDelta.toFixed(2)}`}`,
  ].join("\n");
}
