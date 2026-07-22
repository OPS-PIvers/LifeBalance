import { Habit } from '@/types/schema';

/**
 * Habit Automations (PRD #1065) — transaction keyword matching.
 *
 * A habit's `triggers.keywords` let an approved transaction log the habit. The
 * matching rules (owner-specified):
 *   - Case-insensitive.
 *   - Single tokens (no whitespace) match on a WHOLE-WORD boundary, so keyword
 *     "target" matches "TARGET T-1234" but NOT "targeted".
 *   - Keywords containing a space are matched as an EXACT (case-insensitive)
 *     SUBSTRING, e.g. "whole foods" matches "WHOLE FOODS MARKET #42".
 *   - Both the merchant/title AND the notes are searched.
 *   - EVERY matching habit is returned (one purchase can legitimately log
 *     several habits, e.g. "Went into Target" and "Impulse purchase").
 *
 * Pure functions only — no Firestore, no clock, no side effects.
 */

/** The text fields of a transaction a keyword is matched against. */
export interface KeywordMatchInput {
  /** Merchant name / transaction title. */
  merchant?: string;
  /** Free-text notes on the transaction. */
  notes?: string;
}

/**
 * Normalize a raw keyword entry from the habit-editor input: trim, collapse
 * internal whitespace to single spaces, and lowercase. Returns '' for a blank
 * entry (the caller drops it). Matching is already case-insensitive, so storing
 * normalized keywords keeps the persisted list clean and de-duplicatable.
 */
export function normalizeKeyword(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does a SINGLE keyword match the given text?
 *   - whitespace in the keyword → case-insensitive substring
 *   - otherwise → case-insensitive whole-word (word-boundary) match
 * Empty/whitespace-only keywords and empty text never match.
 */
export function keywordMatchesText(keyword: string, text: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed || !text) return false;

  if (/\s/.test(trimmed)) {
    return text.toLowerCase().includes(trimmed.toLowerCase());
  }

  // ASCII `\b` only understands [A-Za-z0-9_] as "word" characters, so a
  // keyword starting/ending in a non-ASCII letter (e.g. "café") never
  // matches. Use Unicode-aware lookaround boundaries instead: no
  // letter/number immediately before the match start, and none immediately
  // after the match end. This preserves the existing ASCII semantics
  // ("target" still doesn't match "targeted") while also handling
  // accented/non-Latin keywords.
  const escaped = escapeRegExp(trimmed);
  const wordBoundary = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
  return wordBoundary.test(text);
}

/**
 * Does any of the habit's trigger keywords match either field of the input?
 * A habit with no keywords never matches.
 */
export function habitMatchesInput(habit: Habit, input: KeywordMatchInput): boolean {
  const keywords = habit.triggers?.keywords;
  if (!keywords || keywords.length === 0) return false;

  const haystacks = [input.merchant ?? '', input.notes ?? ''];
  return keywords.some(keyword =>
    haystacks.some(text => keywordMatchesText(keyword, text)),
  );
}

/**
 * All habits whose keywords match the transaction's merchant/title or notes.
 * Order is preserved from the input `habits` array. Returns a new array.
 */
export function findMatchingHabits(habits: Habit[], input: KeywordMatchInput): Habit[] {
  return habits.filter(habit => habitMatchesInput(habit, input));
}
