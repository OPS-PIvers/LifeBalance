/**
 * Pure client-side pre-parser for the shopping-list "Paste import" flow
 * (F-MEALS-09). Turns a freeform pasted block (e.g. an ingredient list
 * copied from a recipe website) into a deduplicated list of raw item
 * names. This is intentionally dumb — it just splits/cleans the text into
 * candidate lines; the actual name normalization + category assignment is
 * done afterwards by `optimizeGroceryList()` (Gemini).
 */

// Hard cap so a huge paste can't trigger an oversized Gemini prompt or a
// runaway batch write.
export const MAX_PASTE_IMPORT_ITEMS = 60;

// Leading bullet markers, list numbering ("1.", "1)"), and checkbox
// markdown ("- [ ]") that recipe sites / notes apps commonly prefix lines
// with.
const LEADING_MARKER_RE = /^[\s]*(?:[-*•‣▪·]+|\d+[.)]|\[\s?[xX]?\s?\])\s*/;

/**
 * Parses a pasted text block into a deduplicated array of raw item names.
 *
 * - Splits on newlines; a single-line paste additionally splits on commas
 *   (covers "milk, eggs, bread" style pastes).
 * - Strips bullet/numbering/checkbox markers and surrounding whitespace.
 * - Drops empty lines.
 * - Deduplicates case-insensitively, keeping the first-seen casing.
 * - Truncates to `MAX_PASTE_IMPORT_ITEMS`.
 */
export const parsePastedIngredientList = (text: string): string[] => {
  const trimmedInput = text.trim();
  if (!trimmedInput) return [];

  const lines = trimmedInput.includes('\n')
    ? trimmedInput.split('\n')
    : trimmedInput.split(',');

  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawLine of lines) {
    const cleaned = rawLine.replace(LEADING_MARKER_RE, '').trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);

    if (result.length >= MAX_PASTE_IMPORT_ITEMS) break;
  }

  return result;
};
