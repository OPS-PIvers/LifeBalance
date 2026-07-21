/**
 * Pure helpers for routing an incoming Shortcut expense to the right account and
 * normalizing the fields a bank email/notification carries.
 *
 * The Wells Fargo purchase email ("You made a purchase of $6.02 with credit card
 * ...8899 … Date: 07/01/2026") is parsed on-device by an iOS Shortcut, which
 * POSTs the raw captured strings to `quickAddExpense`. Those strings are messy —
 * the card comes through as "...8899", "8899", or "credit card ...8899"; the date
 * is US-format MM/DD/YYYY, not the YYYY-MM-DD the API stores. This module is the
 * dependency-light decision layer (mirrors reconcile.ts): messy input in, clean
 * value out, no Firestore, trivially unit-testable.
 */

/**
 * The minimal account shape the matcher needs (id + tagged card last-4s).
 * `cardLast4` is the legacy single-card field; `cardLast4s` is the newer
 * multi-card list (Wells Fargo nightly sync groundwork — an account can have
 * several debit cards attached). Both are considered when matching.
 */
export interface AccountLike {
  id: string;
  cardLast4?: string;
  cardLast4s?: string[];
}

/**
 * Extract the last 4 card digits from whatever the Shortcut captured. Tolerates
 * "...8899", "…8899" (single-char ellipsis), "8899", "credit card ...8899", or a
 * value with surrounding whitespace. Returns the 4-digit string, or null when no
 * clean 4-digit group is present (so the caller can skip account matching).
 *
 * We take the LAST run of exactly-4 digits: the card mask is the only 4-digit
 * token in Wells Fargo's "with credit card ...8899" phrasing, and taking the
 * last one avoids grabbing a stray year/amount if the Shortcut over-captures.
 */
export function normalizeCardLast4(input: unknown): string | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    input = String(Math.trunc(input));
  }
  if (typeof input !== "string") return null;
  // All standalone 4-digit runs (not part of a longer digit string).
  const matches = input.match(/(?<!\d)\d{4}(?!\d)/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

/**
 * Find the account whose tagged card last-4 matches the incoming card digits.
 * Returns the matching account's id, or null when the digits are unusable or no
 * account carries them. A tie (two accounts sharing the same last 4 — rare but
 * possible) is treated as ambiguous and returns null so we never guess the wrong
 * account; the transaction then falls back to the untagged/checking path.
 */
export function matchAccountByLast4(
  cardInput: unknown,
  accounts: readonly AccountLike[],
): string | null {
  const last4 = normalizeCardLast4(cardInput);
  if (!last4) return null;
  const matches = accounts.filter((a) => {
    const candidates = [a.cardLast4, ...(a.cardLast4s ?? [])];
    return candidates.some((c) => normalizeCardLast4(c) === last4);
  });
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

/**
 * Normalize a captured date string to the API's `YYYY-MM-DD`. Accepts:
 *   - already-canonical "2026-07-01" → returned as-is
 *   - US "MM/DD/YYYY" or "M/D/YYYY" (Wells Fargo's format) → "2026-07-01"
 *   - the same with '-' separators ("07-01-2026")
 * Returns null for anything it can't confidently interpret (the caller then
 * falls back to the caller-local `today` / server date).
 */
export function normalizeUsDate(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  // Already ISO — validate the calendar so "2026-13-40" is rejected.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return isValidYmd(+iso[1]!, +iso[2]!, +iso[3]!) ? raw : null;
  }
  // US M/D/Y with '/' or '-' separators.
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) {
    const month = +us[1]!;
    const day = +us[2]!;
    const year = +us[3]!;
    if (!isValidYmd(year, month, day)) return null;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }
  return null;
}

/** Calendar-validate a year/month/day (guards against 13/40 etc.). */
function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Reconstruct in UTC and confirm the components survived (rejects 02/30 etc.).
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}
