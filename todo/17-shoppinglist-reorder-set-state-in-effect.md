# 17 — ShoppingListTab drag-reorder: remove the `set-state-in-effect` suppression

## Problem
`components/meals/ShoppingListTab.tsx` keeps a local `items` state that mirrors the
context `shoppingList`, synced via a `useEffect` that calls `setItems(sorted)` whenever
`shoppingList`/`filterStore` change. That effect carries the project's only remaining
`react-hooks/set-state-in-effect` eslint-disable. The local copy exists so Framer Motion's
`Reorder.Group` can drive an optimistic drag before the reorder is persisted.

This is the pragmatic exception called out in [LINT_SUPPRESSIONS.md](../LINT_SUPPRESSIONS.md):
eliminating it cleanly requires restructuring the reorder flow, not just deleting the line.

## Current state
- `components/meals/ShoppingListTab.tsx` — the `items` `useState`, the syncing `useEffect`
  (the suppressed line), the `Reorder.Group onReorder={setItems}`, and the
  `reorderShoppingItems` context call on drag end.
- `reorderShoppingItems` lives in the shopping slice of
  `contexts/FirebaseHouseholdContext.tsx`.

## Proposed approach
Make the rendered order a pure function of `shoppingList` + `filterStore` (no mirrored state):
1. Derive the sorted/filtered list with `useMemo` instead of `useState`+effect.
2. Drive `Reorder.Group` from the derived array; on `onReorder`, immediately call
   `reorderShoppingItems(newOrder)` (optimistic via the context's local write + Firestore
   sync) rather than holding a separate local copy.
3. If a transient drag-in-progress order is still needed for smoothness, hold only the
   *drag delta* in a ref during an active gesture and clear it on drop — never a full
   shadow copy synced from props.

## Risks
- Reorder visual smoothness could regress if the context round-trip is laggy; verify the
  optimistic path updates the slice synchronously.
- Store-filter interactions (reordering within a filtered view) must still persist a sane
  global order.

## Acceptance criteria
- No `set-state-in-effect` suppression remains in the file.
- Dragging to reorder persists correctly, including under a store filter.
- `pnpm lint` + `pnpm test` green; add a test for the reorder→persist path.
