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

function synthRef(date: string, amount: number, descriptor: string): string {
  const normalized = descriptor.trim().toUpperCase().replace(/\s+/g, " ");
  return `synth:${fnv1a(`${date}|${amount.toFixed(2)}|${normalized}`)}`;
}

const ACCOUNT_LAST4_RE = /for account\s*\.{2,3}\s*(\d{4})/i;

// "Available balance1: $1,165.82" — a superscript footnote digit (1) can be
// glued onto the label by HTML-stripping, so the label match tolerates a
// trailing digit before the colon.
const ENDING_BALANCE_RE = /ending balance\s*\d*\s*:\s*\$\s*([\d,]+\.\d{2})/i;
const AVAILABLE_BALANCE_RE = /available balance\s*\d*\s*:\s*\$\s*([\d,]+\.\d{2})/i;

// "As of 07/21/2026 at 01:50 a.m., Central Time"
const AS_OF_RE = /as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

// Card-purchase line, e.g.
// "PURCHASE AUTHORIZED ON 07/20 TARGET T-2189 Minneapolis MN
//  P000000551051569 CARD 2115" then (possibly on the next line) "$18.86".
// The WF reference token is P or S followed by 9-18 digits.
const CARD_PURCHASE_RE =
  /PURCHASE AUTHORIZED ON\s+(\d{1,2}\/\d{1,2})\s+([\s\S]+?)\s+([PS]\d{9,18})\s+CARD\s+(\d{4})\s*\n?\s*\$\s*([\d,]+\.\d{2})/gi;

// ACH/biller line with no CARD/ref token, e.g.
// "AMERICAN EXPRESS ACH PMT 260720 M6486 JENNIFER IVERS $372.00"
// "COMCAST-XFINITY CABLE SVCS 260718 0078881 JENNIFER *KING $153.95"
// Anchored to line start so it never re-matches a card-purchase line (those
// are consumed first and stripped — see parseBankEmail below).
const ACH_LINE_RE = /^\s*([A-Z][^\n$]*?)\s*\n?\s*\$\s*([\d,]+\.\d{2})\s*$/gim;

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
  if (!endingMatch?.[1] || !availableMatch?.[1]) {
    return { error: "Could not find the Balance summary (Ending balance / Available balance)." };
  }
  const endingBalance = toDollars(endingMatch[1]);
  const availableBalance = toDollars(availableMatch[1]);

  let asOf: string | undefined;
  const asOfMatch = text.match(AS_OF_RE);
  if (asOfMatch?.[1] && asOfMatch[2] && asOfMatch[3]) {
    const month = String(+asOfMatch[1]).padStart(2, "0");
    const day = String(+asOfMatch[2]).padStart(2, "0");
    asOf = `${asOfMatch[3]}-${month}-${day}`;
  }

  // Restrict withdrawal scanning to the Withdrawals section (stop at the
  // "As of" footer / a Deposits section, if present) so nothing outside it
  // is mistaken for a withdrawal line.
  const withdrawalsStart = text.search(/^withdrawals\s*$/im);
  const sectionText = withdrawalsStart >= 0 ? text.slice(withdrawalsStart) : text;
  const sectionEnd = sectionText.search(/^(deposits|as of\s)/im);
  const withdrawalsSection = sectionEnd >= 0 ? sectionText.slice(0, sectionEnd) : sectionText;

  const withdrawals: BankEmailWithdrawal[] = [];
  const remaining = withdrawalsSection;

  // Pass 1: card purchases — consume matched spans so pass 2 (ACH) can't
  // re-match the descriptor/reference/card portion of the same line.
  let cardMatch: RegExpExecArray | null;
  CARD_PURCHASE_RE.lastIndex = 0;
  const consumedSpans: Array<[number, number]> = [];
  while ((cardMatch = CARD_PURCHASE_RE.exec(remaining)) !== null) {
    const [full, monthDay, descriptorRaw, ref, cardLast4, amountRaw] = cardMatch;
    if (!monthDay || !descriptorRaw || !ref || !cardLast4 || !amountRaw) continue;
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
    consumedSpans.push([cardMatch.index, cardMatch.index + full.length]);
  }

  // Remove consumed card-purchase spans before running the ACH pass.
  let achSource = remaining;
  for (const [start, end] of [...consumedSpans].sort((a, b) => b[0] - a[0])) {
    achSource = achSource.slice(0, start) + "\n" + achSource.slice(end);
  }

  let achMatch: RegExpExecArray | null;
  ACH_LINE_RE.lastIndex = 0;
  while ((achMatch = ACH_LINE_RE.exec(achSource)) !== null) {
    const [, descriptorRaw, amountRaw] = achMatch;
    if (!descriptorRaw || !amountRaw) continue;
    const normalizedDescriptor = descriptorRaw.replace(/\s+/g, " ").trim();
    // Skip section labels / headers / footer text that happen to sit on
    // their own line with no trailing amount elsewhere ("Withdrawals",
    // "Balance summary" etc. never reach here since they lack a $ amount,
    // but guard against an empty or purely-punctuation descriptor anyway).
    if (!normalizedDescriptor || !/[A-Za-z]/.test(normalizedDescriptor)) continue;
    const yyMmDdToken = normalizedDescriptor.match(/(?<!\d)(\d{6})(?!\d)/);
    const date = (yyMmDdToken?.[1] && resolveYyMmDd(yyMmDdToken[1])) || today;
    const amount = toDollars(amountRaw);
    withdrawals.push({
      descriptor: normalizedDescriptor,
      amount,
      date,
      bankRef: synthRef(date, amount, normalizedDescriptor),
    });
  }

  if (withdrawals.length === 0) {
    return { error: "No withdrawal lines were found in the email body." };
  }

  return { accountLast4, endingBalance, availableBalance, asOf, withdrawals };
}
