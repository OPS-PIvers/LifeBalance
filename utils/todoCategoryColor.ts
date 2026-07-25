// F-TODO-15 — stable, deterministic chip colors for to-do categories.
//
// Categories are free-text (the household mints its own vocabulary), so there is
// nowhere to store a per-category color choice without a migration. Instead the
// color is DERIVED from the name: a tiny pure hash folds the normalized name into
// the shared STORE_COLORS palette, so the same category always looks the same on
// every device, in every session, with no persisted state.
//
// The gray entry (DEFAULT_STORE_COLOR) is reserved for the Uncategorized case and
// is excluded from the hashed key list, so a real category can never accidentally
// wear the "no category" look.

import { STORE_COLORS, DEFAULT_STORE_COLOR, type StoreColor } from '@/data/storeColors';

/** Display label for a to-do with no category (absent/blank `ToDo.category`). */
export const UNCATEGORIZED_LABEL = 'Uncategorized';

/**
 * Non-gray palette keys, derived from STORE_COLORS so adding a palette color
 * later automatically widens the rotation. Sorted for determinism: object key
 * order is insertion-ordered in practice, but sorting makes the mapping
 * independent of how the palette literal is authored/reordered.
 */
const CATEGORY_COLOR_KEYS: readonly string[] = Object.keys(STORE_COLORS)
  .filter(key => key !== DEFAULT_STORE_COLOR)
  .sort();

/** The Uncategorized look. STORE_COLORS is a Record<string, …> so the indexed
 *  read is `StoreColor | undefined` under noUncheckedIndexedAccess; fall back to
 *  a literal rather than asserting. */
const UNCATEGORIZED_COLOR: StoreColor =
  STORE_COLORS[DEFAULT_STORE_COLOR] ?? {
    id: 'gray',
    label: 'Gray',
    bg: 'bg-gray-100',
    text: 'text-gray-800',
    border: 'border-gray-200',
    iconBg: 'bg-gray-100 text-gray-600',
    hoverBg: 'hover:bg-gray-200',
  };

/**
 * djb2 string hash, kept non-negative. Small, pure, and stable across runs and
 * engines (no Math.random, no Date, no locale-dependent behavior).
 */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    // `hash * 33 + char`, folded to a 32-bit int so long names can't lose
    // precision. `>>> 0` keeps it unsigned for the modulo below.
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Stable per-name color for a to-do category chip. */
export function getTodoCategoryColor(category: string | undefined): StoreColor {
  const normalized = (category ?? '').trim().toLowerCase();
  if (!normalized) return UNCATEGORIZED_COLOR;
  if (CATEGORY_COLOR_KEYS.length === 0) return UNCATEGORIZED_COLOR;

  const key = CATEGORY_COLOR_KEYS[hashString(normalized) % CATEGORY_COLOR_KEYS.length];
  // Both reads are `| undefined` under noUncheckedIndexedAccess even though the
  // modulo guarantees an in-range index; default instead of asserting.
  return (key ? STORE_COLORS[key] : undefined) ?? UNCATEGORIZED_COLOR;
}
