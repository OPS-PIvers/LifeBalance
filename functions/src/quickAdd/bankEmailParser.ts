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
 *
 * On a night with NO withdrawals the Withdrawals section is omitted entirely —
 * the body is just the account line, the Balance summary and the footer. That
 * is a successful parse with `withdrawals: []`, not a failure; see the
 * zero-withdrawal acceptance rules in `parseBankEmail`.
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
 *
 * NOTE (review nit): this is intentionally near-duplicated from
 * emailParser.ts's toPlainText rather than extracted to a shared helper —
 * this version adds a final `.trim()` that emailParser.ts's does not, so a
 * naive extraction would either change emailParser.ts's behavior or need an
 * options flag. Left as a documented duplication rather than risking that
 * divergence in an unrelated bugfix change.
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

/**
 * Today (yyyy-MM-dd) fallback when the caller doesn't supply one. The
 * quickAdd endpoint always forwards the caller's LOCAL date, so this only
 * runs for direct/test callers — but it's still worth being deliberate
 * about, because `new Date().toISOString()` is the UTC day: for a US-evening
 * parse, "today" here can be a full calendar day ahead of the user's actual
 * local date. `resolveMonthDay`'s ±2-day tolerance (rather than a strict
 * ">" future check) exists specifically so this UTC skew can't tip a
 * December 31 withdrawal line into being mis-resolved as next January 1 and
 * rolled back a whole year.
 */
function fallbackToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve an "MM/DD" token against `today` (yyyy-MM-dd): the withdrawal's
 * year is assumed to be the same as today's, UNLESS that would place the
 * date meaningfully in the future — nightly statements only ever describe
 * the recent past, so a future-looking MM/DD must actually belong to last
 * year (the classic December→January statement-boundary case).
 *
 * The threshold is "more than 2 days in the future," not "any amount in the
 * future": `today` can itself be off by up to a day (the UTC `fallbackToday`
 * skew above, or a caller-supplied local date one day ahead of UTC). A
 * strict `> today` rollback would then mis-year a legitimate same-day/
 * next-day withdrawal (e.g. 12/31 read as "tomorrow" under UTC) a full year
 * into the past. A small tolerance absorbs that ±1-day skew while still
 * catching the real multi-week/month statement-boundary case.
 */
const FUTURE_TOLERANCE_DAYS = 2;

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
  const toleranceMs = FUTURE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
  if (candidate.getTime() > todayDate.getTime() + toleranceMs) {
    candidate = new Date(Date.UTC(year - 1, month - 1, day));
  }
  return ymd(candidate);
}

/**
 * The calendar day before `date` (yyyy-MM-dd in, yyyy-MM-dd out), rolling
 * back across month/year boundaries via UTC `Date` arithmetic — the same
 * approach `ymd`/`resolveYyMmDd` already use in this file, so this stays a
 * small local helper rather than pulling in date-fns (unused elsewhere in
 * this module) for one subtraction.
 */
function dayBefore(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date; // callers only ever pass an already-validated yyyy-MM-dd
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
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

/**
 * Resolve one of the ENDING/AVAILABLE_BALANCE_RE matches to a signed
 * decimal-dollar amount. Callers only ever invoke this after already
 * checking `match[4]` is present (see parseBankEmail), so a missing `digits`
 * here means a caller stopped doing that — throw loudly rather than
 * returning NaN, which would silently poison a balance calculation instead
 * of surfacing the bug.
 */
function toSignedDollars(match: RegExpMatchArray): number {
  const [, openParen, sign1, sign2, digits] = match;
  if (!digits) {
    throw new Error("toSignedDollars called with a match missing its digits group (caller bug).");
  }
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

// The two lines that legitimately carry a dollar amount OUTSIDE the Withdrawals
// section, in both renderings: "Ending balance: $949.51" on one line (plain
// text), or the label alone followed by an amount-only line (HTML table cells).
// The optional trailing digit absorbs the superscript footnote marker.
const BALANCE_AMOUNT_LINE_RE = /^(?:ending|available)\s+balance\s*\d*\s*:\s*\$/i;
const BALANCE_LABEL_ONLY_RE = /^(?:ending|available)\s+balance\s*\d*\s*:?\s*$/i;
const TRAILING_AMOUNT_RE = /\$\s*[\d,]+\.\d{2}\s*$/;

/**
 * Does the body contain a money-shaped line that the Balance summary doesn't
 * account for?
 *
 * Used ONLY to decide whether a MISSING/EMPTY Withdrawals section is believable.
 * A withdrawal line — card or ACH — always ends in a dollar amount, so "every
 * amount in this email belongs to the Balance summary" is strong evidence that
 * there genuinely were no withdrawals, and any other amount is evidence that
 * there were (under a header we failed to recognize).
 *
 * This deliberately does NOT reuse `CARD_LINE_RE`/`ACH_LINE_RE`. Probing for the
 * card lead verb alone would miss an ACH-only night under a renamed section
 * (`COMCAST-XFINITY CABLE SVCS … $153.95` carries no lead verb), and probing
 * with `ACH_LINE_RE` body-wide would match the Balance-summary lines themselves —
 * the exact fabrication the section boundary exists to prevent. Matching on
 * "ends in an amount, and isn't the balance summary" covers both shapes without
 * needing to classify anything.
 *
 * Errs toward failing loudly: an unrelated dollar figure elsewhere in the email
 * (a promotional footer, a fee disclosure) makes a genuine no-spend night report
 * a parse failure. That is the recoverable direction — the alternative silently
 * drops real spend AND credits a no-spend day that was never earned.
 */
function hasUnexplainedAmountLine(text: string): boolean {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.some((line, i) => {
    if (!TRAILING_AMOUNT_RE.test(line)) return false;
    if (BALANCE_AMOUNT_LINE_RE.test(line)) return false;
    // HTML table-cell rendering: an amount on its own line is explained when the
    // line above it is a bare balance label.
    if (AMOUNT_ONLY_LINE_RE.test(line) && i > 0 && BALANCE_LABEL_ONLY_RE.test(lines[i - 1]!)) {
      return false;
    }
    return true;
  });
}

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
  //
  // Strict mode: falling back to scanning the WHOLE email would let
  // ACH_LINE_RE match the Balance-summary lines ("Ending balance: $1,277.90"
  // etc.) and fabricate withdrawals that were never withdrawals — so the
  // section boundary is never relaxed. What IS tolerated is the section being
  // genuinely absent; see `acceptZeroWithdrawals` below.
  const withdrawalsStart = text.search(/^withdrawals\s*$/im);
  const sectionMissing = withdrawalsStart < 0;

  let lineItems: string[] = [];
  if (!sectionMissing) {
    const afterHeaderNewline = text.indexOf("\n", withdrawalsStart);
    const sectionText = afterHeaderNewline >= 0 ? text.slice(afterHeaderNewline + 1) : "";
    const sectionEnd = sectionText.search(/^(deposits|as of\s)/im);
    const withdrawalsSection = sectionEnd >= 0 ? sectionText.slice(0, sectionEnd) : sectionText;
    lineItems = splitLogicalLineItems(withdrawalsSection);
  }

  // A NO-SPEND night. Wells Fargo omits the Withdrawals section outright when
  // nothing was withdrawn — the email is just the balance summary and the
  // footer — and that is a perfectly good sync result, not a failure. Reporting
  // it as one produced a "Bank sync failed" push on the user's best days.
  //
  // But "no Withdrawals section" has three possible causes and only one of them
  // is a no-spend night, so zero withdrawals is accepted only against positive
  // evidence of BOTH other causes being absent:
  //
  //  - TRUNCATION (Gmail clipping, a partial fetch): the "As of" footer is the
  //    last thing in the body, AFTER the withdrawals section, so its presence
  //    proves we are looking at a complete email rather than one cut off above
  //    the withdrawals. Require it.
  //  - A FORMAT CHANGE (the section renamed, e.g. "Withdrawals/Debits"): the
  //    withdrawal LINES would still be in the body even though the header no
  //    longer matches. Require that every dollar amount in the body is accounted
  //    for by the Balance summary — see `hasUnexplainedAmountLine` for why that
  //    test rather than a withdrawal-line-shape probe.
  //
  // Anything else keeps the original loud failure, because silently reporting a
  // no-spend day for an email we failed to read would lose real money data AND
  // credit a habit that wasn't earned.
  if (lineItems.length === 0) {
    if (!asOf) {
      return {
        error: sectionMissing
          ? "Could not find a \"Withdrawals\" section or an \"As of\" footer in the email."
          : "The \"Withdrawals\" section was empty and the email has no \"As of\" footer.",
      };
    }
    if (hasUnexplainedAmountLine(text)) {
      return {
        error: "Found amounts outside the Balance summary with no \"Withdrawals\" section — the email format may have changed.",
      };
    }
    return { accountLast4, endingBalance, availableBalance, asOf, withdrawals: [] };
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
      // ACH/biller lines carry no date token of their own (unlike card lines,
      // which always have their own AUTHORIZED ON MM/DD), so the fallback here
      // matters a lot more than the `|| today` shape suggests. Wells Fargo cuts
      // this email at ~1:50am and it COVERS THE PREVIOUS DAY, so `today` (the
      // day the sync runs) is one day late for every dateless ACH line. The
      // correct fallback is the email's own coverage day: `asOf` minus one —
      // the same reasoning bankEmailSync.ts already applies to derive its
      // no-spend-day `noSpendTargetDate` (`parsed.asOf ?? today` minus a day).
      // `today` survives only as the last resort for the rare email with no
      // "As of" footer at all, so that case's behavior is unchanged.
      //
      // Consequence: `synthRef` below hashes the date into an ACH line's
      // bankRef, so this changes the generated ref for every dateless ACH
      // line (previously hashed on the run date, now on the coverage day).
      // That's a net improvement — the ref becomes stable across re-processing
      // instead of drifting with whenever the sync happened to run — but it
      // does mean a line already stored under the old run-date-hashed ref
      // won't be recognised by its new coverage-date-hashed ref. That's fine:
      // each ACH line appears in exactly one nightly email, and the
      // per-messageId ledger (see bankEmailSync.ts) already stops that email
      // from being processed twice, so there's no double-file risk either way.
      const date = firstValidYyMmDdInDescriptor(normalizedDescriptor) || (asOf ? dayBefore(asOf) : today);
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

  // No `withdrawals.length === 0` guard here: `lineItems` is non-empty by this
  // point (the zero case returned above), and every item either pushes a
  // withdrawal or returns an error, so an empty result is unreachable. A guard
  // would also now contradict the semantics above, where zero withdrawals is a
  // legitimate success rather than a failure.
  return { accountLast4, endingBalance, availableBalance, asOf, withdrawals };
}
