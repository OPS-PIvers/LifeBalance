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

  const wordBoundary = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'i');
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
