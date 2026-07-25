// F-TODO-16 — the To-Dos page category filter (multi-select, persisted).
//
// The filter is a LIST of entries rather than a single value, and one of those
// entries is the "no category at all" bucket. That bucket is represented as
// `null`, never as a magic string: category names are free text minted by the
// household, so any sentinel string ('', 'Uncategorized', '__none__') could
// collide with a real category. `null` cannot, and it survives JSON round-trips
// as a first-class value — see {@link serializeCategoryFilter}.
//
// An EMPTY filter means "everything" (the All state), so the default costs no
// storage and no predicate work.

import type { ToDo } from '@/types/schema';

/** One filter entry: a category name, or `null` for the Uncategorized bucket. */
export type TodoCategoryFilterEntry = string | null;

/** The whole filter. Empty = no filtering (All). */
export type TodoCategoryFilter = readonly TodoCategoryFilterEntry[];

/**
 * The comparison key for a category name. Absent / empty / whitespace-only all
 * collapse to `null` — the "absent means Uncategorized" invariant that
 * `ToDo.category`, `utils/todoSort.ts` and `utils/todoCategoryColor.ts` share.
 *
 * Accepts `null` because a cleared category is written through the Firestore
 * sanitizer as `null` (like `linkedHabitId`), even though the schema types the
 * field as `string | undefined`.
 */
export function categoryFilterKey(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed.toLowerCase();
}

/**
 * Does this to-do pass the category filter?
 * - an empty filter matches EVERYTHING;
 * - `null` in the filter matches a to-do with an absent/blank/whitespace-only
 *   category;
 * - name entries match case-insensitively (and ignoring surrounding space), so
 *   "Home" and " home " are one category.
 */
export function matchesCategoryFilter(todo: ToDo, filter: TodoCategoryFilter): boolean {
  if (filter.length === 0) return true;
  const key = categoryFilterKey(todo.category);
  return filter.some(entry => categoryFilterKey(entry) === key);
}

/** Is this entry currently selected? (case-insensitive for names). */
export function isCategoryFilterEntrySelected(
  filter: TodoCategoryFilter,
  entry: TodoCategoryFilterEntry,
): boolean {
  const key = categoryFilterKey(entry);
  return filter.some(existing => categoryFilterKey(existing) === key);
}

/**
 * Add or remove one entry, returning a NEW array. Adding keeps the caller's
 * spelling (so the pill shows the vocabulary's casing); removing matches
 * case-insensitively.
 */
export function toggleCategoryFilterEntry(
  filter: TodoCategoryFilter,
  entry: TodoCategoryFilterEntry,
): TodoCategoryFilterEntry[] {
  const key = categoryFilterKey(entry);
  if (isCategoryFilterEntrySelected(filter, entry)) {
    return filter.filter(existing => categoryFilterKey(existing) !== key);
  }
  return [...filter, entry];
}

/**
 * Drop name entries that are no longer in the household's vocabulary (a
 * renamed/deleted category must not keep scoping the list) while ALWAYS keeping
 * the `null` Uncategorized bucket, which exists independently of the
 * vocabulary. Returns the SAME array reference when nothing changed, so callers
 * can feed the result straight back into `setState` without re-rendering.
 */
export function pruneCategoryFilter(
  filter: TodoCategoryFilterEntry[],
  categories: readonly string[],
): TodoCategoryFilterEntry[] {
  const known = new Set(categories.map(categoryFilterKey));
  const next = filter.filter(entry => entry === null || known.has(categoryFilterKey(entry)));
  return next.length === filter.length ? filter : next;
}

/**
 * Parse the persisted value. Defensive by contract — localStorage is
 * user-writable and may hold anything (or an older shape): anything that isn't
 * a JSON array of strings/nulls yields an empty (All) filter rather than
 * throwing. Blank strings collapse into the `null` bucket, and duplicates are
 * dropped case-insensitively.
 */
export function parseStoredCategoryFilter(raw: string | null): TodoCategoryFilterEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: TodoCategoryFilterEntry[] = [];
  const seen = new Set<string | null>();
  for (const value of parsed) {
    if (value !== null && typeof value !== 'string') continue;
    const key = categoryFilterKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    // A blank string is the Uncategorized bucket, so normalize it to the
    // canonical `null` rather than storing two spellings of one thing.
    result.push(key === null ? null : value);
  }
  return result;
}

/** Serialize for localStorage. `null` round-trips as JSON null (no sentinel). */
export function serializeCategoryFilter(filter: TodoCategoryFilter): string {
  return JSON.stringify(filter);
}

/**
 * Short label for the active-filter pill: the single selected category's name
 * (or the Uncategorized label) when exactly one is picked, otherwise the count.
 * Returns null when nothing is filtered.
 */
export function describeCategoryFilter(
  filter: TodoCategoryFilter,
  uncategorizedLabel: string,
): string | null {
  if (filter.length === 0) return null;
  if (filter.length === 1) {
    const only = filter[0];
    return only === null || only === undefined ? uncategorizedLabel : only;
  }
  return String(filter.length);
}
