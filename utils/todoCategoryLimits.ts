/**
 * F-TODO-16 — the single client-side cap on a to-do category name.
 *
 * `firestore.rules` validates the stored value with
 * `isValidOptionalString(request.resource.data.get('category', null), 50)` on
 * the TO-DO document, but the household's `todoCategories` vocabulary array is
 * NOT validated. So an over-long name mints successfully into the vocabulary and
 * then makes every to-do it is applied to unwritable — a permanently broken
 * chip. Every surface that can mint a category (`CategoryChipPicker`'s inline
 * "+ Add", `TodoCategoryManagerDrawer`'s add/rename) enforces this cap BEFORE
 * writing, so the user gets a readable message instead of a rules rejection.
 *
 * The server has its own copy — `MAX_TODO_CATEGORY_LENGTH` in
 * functions/src/quickAdd/todoCategoryMatch.ts, where the quick-add path
 * truncates instead of refusing. `functions/` is a separate pnpm package, so the
 * value is duplicated rather than imported: change both together (and
 * firestore.rules) if the cap ever moves.
 */
export const MAX_TODO_CATEGORY_LENGTH = 50;
