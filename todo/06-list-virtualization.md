# Handoff: Virtualize large lists

**Status:** Not started · **Priority:** Medium (mobile render perf) · **Risk:** Medium (layout/UX changes for variable-height rows)

---

## Problem

Several list views render **every** item into the DOM at once. With hundreds of rows — and
`backdrop-blur-xl` GPU compositing on each card — this is expensive on mobile (long first paint,
janky scroll, memory pressure).

### Evidence / where to look

- `components/budget/TransactionMasterList.tsx` (~lines 575–589): plain `.map()` over
  `filteredTransactions` (unbounded; years of data). **Highest item-count risk — do this first.**
- `pages/ToDosPage.tsx` (the `Section` render, ~lines 947–1100): plain `.map()` per section.
- `components/meals/ShoppingListTab.tsx` (~lines 625–642): framer-motion `Reorder.Group` over all
  items.

> Per-item memoization (`TransactionItem` memo, `HabitCard` memo) and the `Section`/`viewModeOptions`
> render fixes already shipped; this doc is specifically about windowing the DOM.

## Proposed approach

1. Add `@tanstack/react-virtual` (headless, integrates with a flat scroll container).
2. **TransactionMasterList first:** wrap `filteredTransactions` in a virtualizer. Handle
   variable-height rows (split transactions, multi-line notes) via `measureElement`. Preserve the
   existing sticky group headers / summary and keyboard + selection behavior.
3. **ToDosPage:** sections naturally cap counts, so lower priority; virtualize only if a section can
   realistically exceed ~100 rows.
4. **ShoppingListTab:** drag-and-drop needs the dragged item in the DOM, so full virtualization is
   awkward. Cheaper win: only animate/Reorder the *unpurchased* subset and render purchased items as
   a plain (optionally collapsed) list.

## Risks

- Variable row heights with virtualization can cause scroll jumps if mis-measured.
- Sticky headers + virtualization interaction needs care.
- Drag-and-drop + virtualization conflict (hence the ShoppingListTab carve-out).

## Acceptance criteria

- TransactionMasterList renders only visible rows (+overscan); scroll stays smooth with 500+
  transactions; selection, search, group headers, and edit flows unchanged.
- No regression in tests; add a test that only a bounded number of rows mount for a large dataset.
