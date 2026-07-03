/**
 * Server-side parser for bank purchase-alert emails.
 *
 * The Wells Fargo email Shortcut used to run four on-device regexes (amount,
 * merchant, card last-4, date) and POST the captured strings — a ~15-action
 * setup that silently broke whenever one Match Text action pointed at the
 * wrong input or the bank reworded an alert. Instead, the Shortcut now sends
 * the WHOLE email body as `emailText` and this module extracts the fields
 * where we control the code, can layer fallback patterns per format (credit
 * vs. debit wording, plain-text vs. HTML), and can unit-test every variant.
 *
 * Like accountMatch.ts / reconcile.ts this is a dependency-light pure layer:
 * messy text in, clean values out, no Firestore. Every extractor returns null
 * rather than guessing when nothing credible matches — the endpoint decides
 * what "missing" means (stub, fallback merchant, or 400).
 */

import { normalizeUsDate } from "./accountMatch";

export interface ParsedTransactionEmail {
  /** Dollars, e.g. 6.02. Null when no credible amount was found. */
  amount: number | null;
  /** Merchant/store name, trimmed, ≤100 chars (the endpoint's limit). */
  merchant: string | null;
  /** Last 4 card digits as a plain string (e.g. "8899"). */
  cardLast4: string | null;
  /** Transaction date normalized to YYYY-MM-DD. */
  date: string | null;
}

/**
 * Reduce an email body to searchable plain text. iOS "Get Text from Input"
 * usually delivers plain text already, but a Share-Sheet or forwarded email
 * can arrive as raw HTML — strip tags (keeping block boundaries as newlines
 * so "Merchant: X" stays on its own line) and decode the common entities.
 */
function toPlainText(input: string): string {
  let text = input;
  if (/<\s*(html|body|div|td|table|br|p)[\s>/]/i.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
      // Block-level closers and <br> become line breaks…
      .replace(/<\s*(?:br|\/p|\/div|\/td|\/tr|\/li|\/h[1-6])\s*\/?\s*>/gi, "\n")
      // …every other tag becomes a space.
      .replace(/<[^>]+>/g, " ");
  }
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n");
}

/** "1,234.56" → 1234.56 */
function toDollars(captured: string): number {
  return parseFloat(captured.replace(/,/g, ""));
}

/**
 * Labeled amount phrasings, most specific first. The generic any-"$x.xx"
 * fallback below is a last resort because alert emails also contain the
 * user's ALERT THRESHOLD ("purchases over $1.00") — a labeled phrase is the
 * only reliable signal for the actual charge.
 */
const LABELED_AMOUNT_PATTERNS: readonly RegExp[] = [
  /purchase of\s*\$\s*([\d,]+\.\d{2})(?!\d)/i,
  /\b(?:amount|total|charged?)\s*:?\s*\$\s*([\d,]+\.\d{2})(?!\d)/i,
  /\b(?:for|of)\s+\$\s*([\d,]+\.\d{2})(?!\d)/i,
];

/** Preceding context that marks a dollar figure as a threshold, not a charge. */
const THRESHOLD_CONTEXT =
  /(?:over|exceed(?:s|ed)?|more than|at least|above|greater than|threshold(?: of)?|limit(?: of)?|up to)\s*$/i;

function extractAmount(text: string): number | null {
  for (const pattern of LABELED_AMOUNT_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) return toDollars(m[1]);
  }
  // Generic fallback: first "$x.xx" not preceded by threshold wording.
  const generic = /\$\s*([\d,]+\.\d{2})(?!\d)/g;
  let g: RegExpExecArray | null;
  while ((g = generic.exec(text)) !== null) {
    const before = text.slice(Math.max(0, g.index - 30), g.index);
    if (!THRESHOLD_CONTEXT.test(before)) {
      const captured = g[1];
      if (captured) return toDollars(captured);
    }
  }
  return null;
}

/**
 * Merchant phrasings, most specific first:
 *  - credit alerts label it:      "Merchant: Google CLOUD"
 *  - debit alerts embed it:       "…purchase of $45.67 at COSTCO WHSE #0712 on 07/01/2026"
 *  - text-alert style:            "transaction at STARBUCKS"
 * Each capture stops (lookahead below) at " on <date>", ", ", " with/using …",
 * a sentence-ending period, or a newline. A bare "." inside a name like
 * "Amazon.com" is kept — only ". " / "." at end-of-text terminates.
 */
const MERCHANT_STOP =
  "(?=\\s+on\\s+(?:\\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)" +
  "|\\s+with\\s|\\s+using\\s|,\\s|\\.\\s|\\.$|\\n|$)";

const MERCHANT_PATTERNS: readonly RegExp[] = [
  new RegExp(`merchant\\s*:\\s*([^\\n]+?)${MERCHANT_STOP}`, "i"),
  new RegExp(
    `\\$\\s*[\\d,]+\\.\\d{2}\\s+(?:purchase\\s+)?(?:at|from)\\s+([^\\n]+?)${MERCHANT_STOP}`,
    "i"
  ),
  new RegExp(
    `\\b(?:purchase|transaction|used)\\s+(?:at|from)\\s+([^\\n]+?)${MERCHANT_STOP}`,
    "i"
  ),
];

function extractMerchant(text: string): string | null {
  for (const pattern of MERCHANT_PATTERNS) {
    const m = text.match(pattern);
    const raw = m?.[1]?.replace(/\s+/g, " ").replace(/[,;:]+$/, "").trim();
    if (raw) return raw.slice(0, 100);
  }
  return null;
}

/**
 * Last 4 card digits: "credit card ...8899", "Debit Card ending in 1234",
 * "card x9876", "account ending in 4321". Requires the word card/account
 * within 30 non-digit chars so a stray year or amount is never grabbed.
 */
function extractCardLast4(text: string): string | null {
  const m = text.match(/\b(?:card|account)[^0-9\n]{0,30}?(?<!\d)(\d{4})(?!\d)/i);
  return m?.[1] ?? null;
}

const MONTH_NUMBERS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function extractDate(text: string): string | null {
  // Numeric first — Wells Fargo uses MM/DD/YYYY; also accept ISO.
  const numeric = text.match(
    /(?<!\d)(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})(?!\d)/
  );
  if (numeric?.[1]) {
    const normalized = normalizeUsDate(numeric[1]);
    if (normalized) return normalized;
  }
  // Textual: "July 1, 2026" / "Jul 1 2026".
  const textual = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (textual?.[1] && textual[2] && textual[3]) {
    const month = MONTH_NUMBERS[textual[1].toLowerCase()];
    if (month) {
      return normalizeUsDate(`${month}/${textual[2]}/${textual[3]}`);
    }
  }
  return null;
}

/**
 * Parse a bank purchase-alert email into transaction fields. Never throws;
 * each field is null when nothing credible matched.
 */
export function parseTransactionEmail(input: string): ParsedTransactionEmail {
  const text = toPlainText(input);
  return {
    amount: extractAmount(text),
    merchant: extractMerchant(text),
    cardLast4: extractCardLast4(text),
    date: extractDate(text),
  };
}
