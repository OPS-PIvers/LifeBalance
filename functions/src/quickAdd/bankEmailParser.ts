/**
 * Deterministic parser for the nightly Wells Fargo "account update" email
 * (the summary alert, distinct from the per-purchase alert emailParser.ts
 * handles). No Gemini, no network, no Firestore — pure text in, structured
 * withdrawals out. The caller is responsible for turning a returned
 * `{ error }` result into a parse-failure push notification.
 *
 * The email always follows the same visible-text layout:
 *   for account ...5581
 *   Balance summary
 *   Ending balance: $1,277.90
 *   Available balance1: $1,165.82        (superscript footnote "1" glued on)
 *   Withdrawals
 *   PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115 $18.86
 *   AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00
 *   ...
 *   As of 07/21/2026 at 01:50 a.m., Central Time
 *
 * HTML renderings put the amount in its own table cell, so tag-stripping can
 * land it on a following line rather than trailing the descriptor text — the
 * line-shape regexes below tolerate an optional newline before the amount.
 */

/** One parsed withdrawal line. Amount is decimal dollars. */
export interface BankEmailWithdrawal {
  /** Merchant/description text, kept faithful to the source line. */
  descriptor: string;
  /** Decimal dollars, e.g. 18.86. */
  amount: number;
  /** yyyy-MM-dd, resolved against the caller-local `today`. */
  date: string;
  /** Last 4 card digits, when the line carries a CARD token. */
  cardLast4?: string;
  /**
   * Wells Fargo reference token (e.g. "P000000551051569") for card
   * purchases, or a deterministic "synth:<hash>" id for ACH/biller lines
   * that carry no reference token — stable across repeated parses of the
   * same email so it can be used as an idempotency key.
   */
  bankRef: string;
}

export interface BankEmailParseSuccess {
  accountLast4: string;
  /** Decimal dollars. */
  endingBalance: number;
  /** Decimal dollars. */
  availableBalance: number;
  /** yyyy-MM-dd, when the "As of" footer is present. */
  asOf?: string;
  withdrawals: BankEmailWithdrawal[];
}

export interface BankEmailParseFailure {
  error: string;
}

export type BankEmailParseResult = BankEmailParseSuccess | BankEmailParseFailure;

export interface BankEmailParseInput {
  subject: string;
  rawBody: string;
  /** Caller-local yyyy-MM-dd; falls back to the UTC date when omitted. */
  today?: string;
}

/**
 * Reduce raw HTML (or already-plain text) to searchable plain text, mirroring
 * emailParser.ts's toPlainText — tag-shaped tokens signal HTML, block-level
 * closers become line breaks, everything else becomes a space.
 */
function toPlainText(input: string): string {
  let text = input;
  if (/<\/?[a-z][^>]*>/i.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<\s*(?:br|\/p|\/div|\/td|\/tr|\/li|\/h[1-6])\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
  }
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&(?:apos|#0?39);/gi, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/** "1,234.56" → 1234.56 */
function toDollars(captured: string): number {
  return parseFloat(captured.replace(/,/g, ""));
}

/** Today (yyyy-MM-dd) fallback when the caller doesn't supply one. */
function fallbackToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve an "MM/DD" token against `today` (yyyy-MM-dd): the withdrawal's
 * year is assumed to be the same as today's, UNLESS that would place the
 * date in the future — nightly statements only ever describe the recent
 * past, so a future-looking MM/DD must actually belong to last year (the
 * classic December→January statement-boundary case).
 */
function resolveMonthDay(monthDay: string, today: string): string | null {
  const m = monthDay.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const month = +m[1]!;
  const day = +m[2]!;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const todayMatch = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const todayDate = todayMatch
    ? new Date(Date.UTC(+todayMatch[1]!, +todayMatch[2]! - 1, +todayMatch[3]!))
    : new Date();
  const year = todayDate.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return null; // invalid calendar date (e.g. 02/30)
  }
  if (candidate.getTime() > todayDate.getTime()) {
    candidate = new Date(Date.UTC(year - 1, month - 1, day));
  }
  return ymd(candidate);
}

/** "260720" (YYMMDD) → "2026-07-20", or null if not a valid calendar date. */
function resolveYyMmDd(token: string): string | null {
  const m = token.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = 2000 + +m[1]!;
  const month = +m[2]!;
  const day = +m[3]!;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ymd(d);
}

/**
 * Scan an ACH descriptor for isolated 6-digit runs and return the yyyy-MM-dd
 * for the FIRST one that validates as a YYMMDD calendar date (e.g. an
 * invoice/reference number that happens to be 6 digits, like "123456", is
 * skipped in favor of a later valid one like "260718").
 */
function firstValidYyMmDdInDescriptor(descriptor: string): string | null {
  const tokens = descriptor.match(/(?<!\d)\d{6}(?!\d)/g);
  if (!tokens) return null;
  for (const token of tokens) {
    const resolved = resolveYyMmDd(token);
    if (resolved) return resolved;
  }
  return null;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Deterministic non-cryptographic hash (FNV-1a, 32-bit) over the synthetic
 * key's input string. Cheap, dependency-free, and stable across runs/nights
 * for the same date+amount+descriptor triple — that's all "synth:" ids need.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build a deterministic synth: ref for an ACH/biller line. Within a single
 * parse call, `counts` tracks how many withdrawals have already produced the
 * same date|amount|descriptor key: the first occurrence hashes the bare key
 * (so a normal re-parse of the same email is stable), and the second-and-
 *-later occurrences fold in an explicit occurrence index so two distinct
 * same-day, same-amount, same-descriptor charges in one email still get
 * distinct refs.
 */
function synthRef(
  date: string,
  amount: number,
  descriptor: string,
  counts: Map<string, number>
): string {
  const normalized = descriptor.trim().toUpperCase().replace(/\s+/g, " ");
  const baseKey = `${date}|${amount.toFixed(2)}|${normalized}`;
  const occurrence = (counts.get(baseKey) ?? 0) + 1;
  counts.set(baseKey, occurrence);
  const hashInput = occurrence === 1 ? baseKey : `${baseKey}|${occurrence}`;
  return `synth:${fnv1a(hashInput)}`;
}

const ACCOUNT_LAST4_RE = /for account\s*\.{2,3}\s*(\d{4})/i;

// "Available balance1: $1,165.82" — a superscript footnote digit (1) can be
// glued onto the label by HTML-stripping, so the label match tolerates a
// trailing digit before the colon. Also tolerates the three common negative
// forms a bank might render an overdrawn balance in: "-$45.23", "$-45.23",
// and "($45.23)" (parens imply negative with no explicit minus sign).
const ENDING_BALANCE_RE = /ending balance\s*\d*\s*:\s*(\()?(-)?\$\s*(-)?([\d,]+\.\d{2})\)?/i;
const AVAILABLE_BALANCE_RE = /available balance\s*\d*\s*:\s*(\()?(-)?\$\s*(-)?([\d,]+\.\d{2})\)?/i;

/** Resolve one of the ENDING/AVAILABLE_BALANCE_RE matches to a signed decimal-dollar amount. */
function toSignedDollars(match: RegExpMatchArray): number {
  const [, openParen, sign1, sign2, digits] = match;
  if (!digits) return NaN;
  const negative = openParen === "(" || sign1 === "-" || sign2 === "-";
  const value = toDollars(digits);
  return negative ? -value : value;
}

// "As of 07/21/2026 at 01:50 a.m., Central Time"
const AS_OF_RE = /as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

// Card-purchase line item, e.g. (after logical-line joining, see
// splitLogicalLineItems below):
// "PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN P000000551051569 CARD 2115 $18.86"
// Wells Fargo also renders recurring charges with a different lead verb:
// "RECURRING PAYMENT AUTHORIZED ON 07/01 NETFLIX.COM P000000551051570 CARD 2115 $15.99"
// The WF reference token is P or S followed by 9-18 digits. Anchored to the
// full (already-joined) line so it can never span two logical line items.
const CARD_LINE_RE =
  /^(?:PURCHASE|RECURRING PAYMENT) AUTHORIZED ON\s+(\d{1,2}\/\d{1,2})\s+(.+?)\s+([PS]\d{9,18})\s+CARD\s+(\d{4})\s*\$\s*([\d,]+\.\d{2})$/i;

// ACH/biller line item with no CARD/ref token, e.g.
// "AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00"
// "COMCAST-XFINITY CABLE SVCS 260718 0078881 JENNIFER *KING $153.95"
// Anchored to the full line so it never partially matches a card line (those
// are tried first — see classifyLineItem below).
const ACH_LINE_RE = /^([A-Z][^$]*?)\s*\$\s*([\d,]+\.\d{2})$/i;

// A line that is ONLY a dollar amount, nothing else — the shape the HTML
// table-cell rendering produces when the amount lands in its own <td> (see
// HTML_BODY in the test file). This is the ONLY legitimate reason a
// dollar-less buffered line should be glued onto what follows: a real
// wrapped descriptor is completed by an amount-only line immediately after
// it, never by a full line of unrelated text.
const AMOUNT_ONLY_LINE_RE = /^\$\s*[\d,]+\.\d{2}$/;

/**
 * Split the Withdrawals section into logical line items: each item is one
 * withdrawal's full text, joining a wrapped descriptor line with a following
 * amount-only line (the HTML table-cell rendering can put the amount on its
 * own line) but never merging two DIFFERENT withdrawals together. A line is
 * "complete" once it ends in a dollar amount; anything left over with no
 * trailing amount is still returned as its own (unclassifiable) item so the
 * caller can report it rather than silently dropping it.
 */
function splitLogicalLineItems(section: string): string[] {
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: string[] = [];
  let buffer = "";
  const trailingAmount = /\$\s*[\d,]+\.\d{2}\s*$/;
  for (const line of lines) {
    // A dollar-less buffered line (e.g. disclaimer text) may only be
    // completed by an amount-only continuation line — that's the sole shape
    // a legitimate wrapped descriptor takes. Any other next line (a full new
    // withdrawal line, whether card- or ACH-shaped) means the buffered text
    // was never a wrapped fragment of it; gluing them would hide the new
    // line's own leading shape from the item-level classifiers below and
    // risk it being misclassified as a fabricated ACH withdrawal instead of
    // reported as a parse failure. Flush the dangling buffer as its own
    // (unclassifiable) item first.
    if (buffer && !trailingAmount.test(buffer) && !AMOUNT_ONLY_LINE_RE.test(line)) {
      items.push(buffer);
      buffer = "";
    }
    buffer = buffer ? `${buffer} ${line}` : line;
    if (trailingAmount.test(buffer)) {
      items.push(buffer);
      buffer = "";
    }
  }
  if (buffer) items.push(buffer);
  return items;
}

/**
 * Parse a Wells Fargo nightly "account update" email into structured
 * withdrawals + balances. Never throws — returns `{ error }` on anything
 * that doesn't look like the expected layout.
 */
export function parseBankEmail(input: BankEmailParseInput): BankEmailParseResult {
  const today = input.today && /^\d{4}-\d{2}-\d{2}$/.test(input.today)
    ? input.today
    : fallbackToday();

  const text = toPlainText(input.rawBody);

  const accountMatch = text.match(ACCOUNT_LAST4_RE);
  if (!accountMatch?.[1]) {
    return { error: "Could not find an account number (\"for account ...NNNN\") in the email." };
  }
  const accountLast4 = accountMatch[1];

  const endingMatch = text.match(ENDING_BALANCE_RE);
  const availableMatch = text.match(AVAILABLE_BALANCE_RE);
  if (!endingMatch?.[4] || !availableMatch?.[4]) {
    return { error: "Could not find the Balance summary (Ending balance / Available balance)." };
  }
  const endingBalance = toSignedDollars(endingMatch);
  const availableBalance = toSignedDollars(availableMatch);

  let asOf: string | undefined;
  const asOfMatch = text.match(AS_OF_RE);
  if (asOfMatch?.[1] && asOfMatch[2] && asOfMatch[3]) {
    const month = String(+asOfMatch[1]).padStart(2, "0");
    const day = String(+asOfMatch[2]).padStart(2, "0");
    asOf = `${asOfMatch[3]}-${month}-${day}`;
  }

  // Restrict withdrawal scanning to the Withdrawals section (stop at the
  // "As of" footer / a Deposits section, if present) so nothing outside it
  // is mistaken for a withdrawal line. Drop the "Withdrawals" header line
  // itself so it isn't fed into the line-item splitter below.
  const withdrawalsStart = text.search(/^withdrawals\s*$/im);
  let sectionText: string;
  if (withdrawalsStart >= 0) {
    const afterHeaderNewline = text.indexOf("\n", withdrawalsStart);
    sectionText = afterHeaderNewline >= 0 ? text.slice(afterHeaderNewline + 1) : "";
  } else {
    sectionText = text;
  }
  const sectionEnd = sectionText.search(/^(deposits|as of\s)/im);
  const withdrawalsSection = sectionEnd >= 0 ? sectionText.slice(0, sectionEnd) : sectionText;

  const lineItems = splitLogicalLineItems(withdrawalsSection);
  if (lineItems.length === 0) {
    return { error: "No withdrawal lines were found in the email body." };
  }

  const withdrawals: BankEmailWithdrawal[] = [];
  const synthCounts = new Map<string, number>();

  for (const item of lineItems) {
    const cardMatch = item.match(CARD_LINE_RE);
    if (cardMatch) {
      const [, monthDay, descriptorRaw, ref, cardLast4, amountRaw] = cardMatch;
      if (!monthDay || !descriptorRaw || !ref || !cardLast4 || !amountRaw) {
        return { error: `Could not parse the withdrawal line: "${item}"` };
      }
      const date = resolveMonthDay(monthDay, today);
      if (!date) {
        return { error: `Could not resolve a valid date from "${monthDay}".` };
      }
      withdrawals.push({
        descriptor: descriptorRaw.replace(/\s+/g, " ").trim(),
        amount: toDollars(amountRaw),
        date,
        cardLast4,
        bankRef: ref,
      });
      continue;
    }

    // A line that starts like a card purchase/recurring payment but failed
    // CARD_LINE_RE's strict shape (e.g. an unexpected ref-token prefix) must
    // never fall through to the generic ACH pattern — that pattern matches
    // almost any "starts with a capital letter, ends with $amount" line, and
    // would silently misclassify it instead of reporting the failure.
    if (/^(?:PURCHASE|RECURRING PAYMENT) AUTHORIZED ON\b/i.test(item)) {
      return { error: `Could not parse the withdrawal line: "${item}"` };
    }

    const achMatch = item.match(ACH_LINE_RE);
    if (achMatch) {
      const [, descriptorRaw, amountRaw] = achMatch;
      if (!descriptorRaw || !amountRaw) {
        return { error: `Could not parse the withdrawal line: "${item}"` };
      }
      const normalizedDescriptor = descriptorRaw.replace(/\s+/g, " ").trim();
      if (!normalizedDescriptor) {
        return { error: `Could not parse the withdrawal line: "${item}"` };
      }
      const date = firstValidYyMmDdInDescriptor(normalizedDescriptor) || today;
      const amount = toDollars(amountRaw);
      withdrawals.push({
        descriptor: normalizedDescriptor,
        amount,
        date,
        bankRef: synthRef(date, amount, normalizedDescriptor, synthCounts),
      });
      continue;
    }

    // Strict mode: every non-empty logical line item in the Withdrawals
    // section must classify as a card or ACH withdrawal — an unrecognized
    // line is loudly reported rather than silently dropped, so the caller
    // sends a failure push instead of persisting partial money data.
    return { error: `Could not parse the withdrawal line: "${item}"` };
  }

  if (withdrawals.length === 0) {
    return { error: "No withdrawal lines were found in the email body." };
  }

  return { accountLast4, endingBalance, availableBalance, asOf, withdrawals };
}
