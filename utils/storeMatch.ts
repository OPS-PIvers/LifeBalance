/**
 * Store-name matching used to dedupe AI-returned store names against the
 * household's existing stores, so we only ever create a NEW store when it is
 * "certainly not a duplicate" of one that already exists.
 */

import type { Store } from '@/types/schema';

/**
 * Normalize a store name for duplicate detection. More aggressive than the
 * shared `normalizeToKey` (which only lower-cases + trims): it also drops
 * apostrophes/periods and collapses any remaining punctuation/whitespace, so
 * common variants resolve to the same key:
 *   "Trader Joe's" == "trader joes" == "Trader  Joe's."  -> "trader joes"
 *   "Sam's Club"   == "sams club"                         -> "sams club"
 *   "B.J.'s"       == "bjs"                               -> "bjs"
 */
export const normalizeStoreName = (name: string | undefined | null): string =>
  (name ?? '')
    .toLowerCase()
    .replace(/['’.]/g, '')          // drop apostrophes & periods (intra-word)
    // Replace runs of non-letter/non-number with a single space. Unicode-aware
    // (\p{L}\p{N}) so accented/CJK/etc. store names are preserved, not stripped.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Find an existing store that matches `name` after store-name normalization.
 * Returns the matched store (so callers reuse its CANONICAL name/casing) or
 * `undefined` when the name is empty or genuinely new.
 */
export function findExistingStore(
  name: string | undefined | null,
  stores: readonly Pick<Store, 'id' | 'name'>[],
): Pick<Store, 'id' | 'name'> | undefined {
  const key = normalizeStoreName(name);
  if (!key) return undefined;
  return stores.find((s) => normalizeStoreName(s.name) === key);
}
