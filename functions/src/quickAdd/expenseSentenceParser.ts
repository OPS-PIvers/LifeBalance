/**
 * Deterministic natural-language parsing for free-text expense capture
 * (Phase 2a of the capture-review project) — e.g. "spent $45 at Target on
 * household stuff", "paid 20 for gas yesterday". Pure and dependency-light,
 * same philosophy as todoParser.ts/emailParser.ts: extract what a documented
 * heuristic confidently recognizes and leave everything else in `notes` for
 * the user to fix in the capture-review drawer (Phase 1) rather than guess.
 *
 * NOT wired into any endpoint yet — that's Phase 2b. This module is isolated
 * on purpose.
 *
 * Extraction order — amount, then merchant, then date — each match is removed
 * from a working copy of the text so the four fields never overlap; whatever
 * remains after removing spend-keyword filler and simple prepositions becomes
 * `notes`.
 *
 * Known limitations (documented so P2b/the review drawer know what to catch):
 *  - Amount: only `$1,234.56` / `50 dollars|bucks|USD` / a bare number
 *    directly adjacent to a spend keyword (spent/paid/cost/bought). Spelled-
 *    out amounts ("twelve fifty") are NOT recognized — `amount` comes back
 *    null and the user types it in during review. No European-style
 *    comma-decimal support (comma is always read as a thousands separator).
 *  - Merchant: only the "at X" / "from X" pattern; a sentence with neither
 *    preposition returns `merchant: null`. A leading article ("the store") is
 *    stripped, but no other cleanup is attempted.
 *  - Date: explicit dates require a 4-digit year (delegates to
 *    `normalizeUsDate`, so bare "7/15" without a year is NOT recognized) plus
 *    the relative words "today"/"yesterday", which require the caller to pass
 *    `opts.today` — without it, "yesterday"/"today" are left unparsed
 *    (`date: null`) rather than guessed from the server's UTC clock.
 *  - Category: a modest keyword table, only consulted when `opts.categories`
 *    is supplied; otherwise (or when nothing matches) `category` is null —
 *    unlike the shopping parser, there is no "Uncategorized" sentinel here.
 *  - Notes: only spend-keyword filler and a small set of prepositions/pronouns
 *    are stripped from the leftover text; unusual phrasing can leave stray
 *    connector words behind for the user to clean up.
 */

import { normalizeUsDate } from "./accountMatch";
import { format, parseISO, subDays } from "date-fns";

export interface ParsedExpenseSentence {
  /** Dollars, positive, rounded to 2dp. Null when no credible amount was found. */
  amount: number | null;
  /** Merchant/store name, trimmed. Null when not found. */
  merchant: string | null;
  /** Transaction date, normalized to YYYY-MM-DD. Null when not found. */
  date: string | null;
  /** Best-effort category from `opts.categories`. Null when not attempted or no match. */
  category: string | null;
  /** Trailing descriptive remainder after removing matched fragments. Null when empty. */
  notes: string | null;
}

export interface ParseExpenseSentenceOptions {
  categories?: string[];
  /** Caller-local "today" (yyyy-MM-dd), used to resolve "today"/"yesterday". */
  today?: string;
}

/** "1,234.56" → 1234.56, rounded to 2dp. NaN when unparsable. */
function toDollars(raw: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  return Math.round(n * 100) / 100;
}

interface Match<T> {
  value: T;
  matched: string;
}

/**
 * Amount patterns, most specific first: "$" figure, then a spelled-out
 * currency word, then a bare number adjacent to a spend keyword. The first
 * pattern to match wins — e.g. "spent 45 dollars" matches the currency-word
 * pattern (which captures "45 dollars"), not the keyword-adjacent one.
 */
function extractAmount(input: string): Match<number> | null {
  let m = input.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  if (m && m[0] && m[1]) {
    const value = toDollars(m[1]);
    if (Number.isFinite(value)) return { value: Math.abs(value), matched: m[0] };
  }

  m = input.match(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(dollars?|bucks|usd)\b/i);
  if (m && m[0] && m[1]) {
    const value = toDollars(m[1]);
    if (Number.isFinite(value)) return { value: Math.abs(value), matched: m[0] };
  }

  m = input.match(
    /\b(?:spent|paid|cost|costs|bought)\b\s+(?:about\s+|around\s+|roughly\s+)?(\d[\d,]*(?:\.\d{1,2})?)\b/i
  );
  if (m && m[0] && m[1]) {
    const value = toDollars(m[1]);
    if (Number.isFinite(value)) return { value: Math.abs(value), matched: m[0] };
  }

  return null;
}

// Stop before a trailing preposition/clause word, a comma/period, or the end
// of the string — mirrors emailParser.ts's MERCHANT_STOP approach.
const MERCHANT_STOP_ALTS = "\\s+(?:on|for|because|yesterday|today|tomorrow)\\b|[,.]|$";

function extractMerchant(input: string): Match<string> | null {
  const m = input.match(new RegExp(`\\b(?:at|from)\\s+([^,.\\n]+?)(?=${MERCHANT_STOP_ALTS})`, "i"));
  if (m && m[0] && m[1]) {
    const value = m[1]
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:the|a|an)\s+/i, "");
    if (value) return { value, matched: m[0] };
  }
  return null;
}

/**
 * Explicit dates require a 4-digit year (delegated to `normalizeUsDate`);
 * otherwise "today"/"yesterday" resolve relative to `today` when supplied.
 */
function extractDate(input: string, today?: string): Match<string> | null {
  const explicit = input.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/);
  if (explicit && explicit[0] && explicit[1]) {
    const normalized = normalizeUsDate(explicit[1]);
    if (normalized) return { value: normalized, matched: explicit[0] };
  }

  if (today) {
    const yesterday = input.match(/\byesterday\b/i);
    if (yesterday && yesterday[0]) {
      const value = format(subDays(parseISO(today), 1), "yyyy-MM-dd");
      return { value, matched: yesterday[0] };
    }
    const todayWord = input.match(/\btoday\b/i);
    if (todayWord && todayWord[0]) {
      return { value: today, matched: todayWord[0] };
    }
  }

  return null;
}

const EXPENSE_CATEGORY_KEYWORDS: ReadonlyArray<{ category: string; keywords: readonly string[] }> = [
  { category: "Groceries", keywords: ["grocery", "groceries", "supermarket"] },
  { category: "Dining", keywords: ["restaurant", "dinner", "lunch", "breakfast", "coffee", "cafe", "takeout", "dining"] },
  { category: "Transportation", keywords: ["gas", "fuel", "uber", "lyft", "parking", "toll"] },
  { category: "Entertainment", keywords: ["movie", "movies", "concert", "tickets"] },
  { category: "Health", keywords: ["pharmacy", "doctor", "dentist", "prescription", "medicine"] },
  { category: "Shopping", keywords: ["clothes", "clothing", "shoes", "amazon", "mall"] },
  { category: "Bills", keywords: ["electric", "electricity", "internet", "utility", "utilities"] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word containment check — a plain `.includes()` would let a keyword
 * like "mall" false-positive inside an unrelated word ("small"). */
function containsKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(text);
}

function categorizeExpense(text: string, categories: readonly string[]): string | null {
  for (const { category, keywords } of EXPENSE_CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => containsKeyword(text, kw))) {
      return categories.includes(category) ? category : null;
    }
  }
  return null;
}

/** Strips spend-keyword filler, a leading subject pronoun, and simple
 * leading/trailing prepositions from whatever's left after amount/merchant/
 * date removal. Returns null when nothing descriptive remains. */
function tidyNotes(text: string): string | null {
  let s = text.replace(/\b(?:spent|paid|cost|costs|bought)\b/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:i|we|you)\b\s*/i, "").trim();

  for (let i = 0; i < 3; i++) {
    const next = s
      .replace(/^(?:on|at|from|for|and|,|\.)+\s*/i, "")
      .replace(/\s*(?:on|at|from|for|and|,|\.)+$/i, "")
      .trim();
    if (next === s) break;
    s = next;
  }

  return s.length > 0 ? s : null;
}

/**
 * Parses a free-text expense sentence into structured fields. Never throws;
 * any field the heuristics don't confidently recognize comes back null.
 */
export function parseExpenseSentence(
  text: string,
  opts?: ParseExpenseSentenceOptions
): ParsedExpenseSentence {
  let working = text;

  const amount = extractAmount(working);
  if (amount) working = working.replace(amount.matched, " ");

  const merchant = extractMerchant(working);
  if (merchant) working = working.replace(merchant.matched, " ");

  const date = extractDate(working, opts?.today);
  if (date) working = working.replace(date.matched, " ");

  const category = opts?.categories ? categorizeExpense(text, opts.categories) : null;

  return {
    amount: amount ? amount.value : null,
    merchant: merchant ? merchant.value : null,
    date: date ? date.value : null,
    category,
    notes: tidyNotes(working),
  };
}
