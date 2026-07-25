/**
 * Pure helper for the `quickAddTodo` endpoint: resolves a caller-supplied
 * to-do category (F-TODO-16) against the household's `todoCategories`
 * vocabulary. Mirrors the dependency-light decision-layer style of
 * accountMatch.ts / todoMatch.ts — no Firestore, trivially unit-testable.
 *
 * A to-do's `category` is optional and free-text: absence means
 * "Uncategorized" (never an empty string — see `ToDo.category` in
 * types/schema.ts). Minting a brand-new category is a UI action; a Shortcut
 * that supplies an unrecognized category still gets to keep it (the value is
 * stored as-is), it just doesn't get folded into the household's existing
 * vocabulary.
 */

/**
 * Max stored length for a to-do category. Matches the 50-char cap this file
 * already uses for sibling category-like free-text fields (see the
 * `category` validation in quickAddExpense / grocery-item parsing in
 * quickAdd/index.ts).
 */
export const MAX_TODO_CATEGORY_LENGTH = 50;

/**
 * Resolve a Shortcut-supplied category against the household's vocabulary.
 *
 * - `undefined`/empty/whitespace-only → `undefined` (nothing to store; the
 *   to-do stays Uncategorized).
 * - Case-insensitive match against `householdCategories` → the household's
 *   canonical casing (so "home" resolves to the stored "Home").
 * - No match → the trimmed input, stored as-is (never silently dropped).
 * - Input longer than `MAX_TODO_CATEGORY_LENGTH` is truncated before
 *   matching/storing, same cap the file already applies to category fields.
 */
export function resolveTodoCategory(
  input: string | undefined,
  householdCategories: readonly string[] | undefined
): string | undefined {
  if (typeof input !== "string") return undefined;

  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const capped =
    trimmed.length > MAX_TODO_CATEGORY_LENGTH
      ? trimmed.slice(0, MAX_TODO_CATEGORY_LENGTH)
      : trimmed;

  const cappedLower = capped.toLowerCase();
  const canonical = (householdCategories ?? []).find(
    (c) => c.toLowerCase() === cappedLower
  );

  return canonical ?? capped;
}
