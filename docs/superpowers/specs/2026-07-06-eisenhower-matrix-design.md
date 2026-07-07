# Eisenhower Matrix view for To-Dos — Design

Date: 2026-07-06
Status: Approved by owner

## Purpose

Add a second arrangement of the Active to-do list: an Eisenhower prioritization
matrix (urgent × important). Goal: make the household's judgment of *importance*
explicit and visible, so time pressure (due dates) and value (family priorities)
stop being conflated. The list view stays the default.

## Data model

- Add `isImportant?: boolean` to `ToDo` in `types/schema.ts`.
  - Absent or `false` = not important. No migration needed; all existing todos
    are valid.
  - The existing `priority` field is untouched (still used by NL/voice capture).
- `todoConverter` in `utils/firestoreConverters.ts` passes the field through
  (extend its unit test with a doc that has/lacks the field).
- No Firestore rules or index changes.

## Quadrant logic — `utils/eisenhower.ts` (pure, unit-tested)

- `isUrgent(todo, today)`: `completeByDate` is overdue, today, or tomorrow —
  the SAME predicate as the list view's "Immediate" section, so the two views
  always agree on urgency.
- `quadrantForTodo(todo, today)` returns one of:
  - `do` — urgent && important
  - `schedule` — important && !urgent
  - `delegate` — urgent && !important
  - `later` — !urgent && !important
- Boundary tests: due yesterday/today/tomorrow/day-after; missing `isImportant`.

## Setting importance

- **Add/edit drawer**: a star toggle field, labeled "Important" with helper
  text "Matters to the family — big consequences if skipped."
- **Every TodoRow** (both arrangements): a tappable star icon that toggles
  `isImportant` via `updateToDo(id, { isImportant })` — one-tap triage so the
  list can be walked quickly with a partner. Filled star = important
  (warm/amber token family, matching the gamification accent), outline = not.
  Min 44px touch target per app convention.

## Matrix arrangement (Active view only)

Stacked quadrant sections on all breakpoints, reusing the existing
`Section`/`TodoRow` components and their complete/edit/delete/duplicate/swipe/
selection behavior:

1. **Do First** — Urgent & Important (rose, matching Immediate)
2. **Schedule** — Important, Not Urgent (accent/evergreen)
3. **Delegate** — Urgent, Not Important (amber)
4. **Later** — Not Urgent, Not Important (neutral brand)

- Section header pattern identical to the list view (colored dot + display-font
  title + uppercase subtitle). Colors come from existing tokens only
  (`money-neg`, `accent-*`, `warm-*`, `brand-*`) — no new palette entries,
  per DESIGN.md.
- Tasks with importance never set fall into Delegate/Later honestly; the row
  star makes correcting that one tap.
- The quick-add bar remains row one of the FIRST section in both arrangements.
- Empty quadrants render nothing (same rule as empty list sections), except
  the first section, which always renders to host the add row.

## View switch

- A list⇄grid icon toggle (lucide `List` / `LayoutGrid`) beside the
  Active/Completed tabs. It only changes how ACTIVE tasks are arranged;
  Completed is unaffected.
- Persisted per-device in `localStorage` key `lifebalance:todos-view`
  (`'list' | 'matrix'`, default `'list'`).
- Hidden in selection mode (like the tabs today).

## Styling alignment

- All colors/typography/spacing from existing `index.css` `@theme` tokens and
  DESIGN.md; reuse `Section`, `SurfaceList`, `Row`, `Tabs`, `Button` primitives.
- Entrance animations use existing `animate-in` utilities (reduced-motion safe).
- No new dependencies.

## Testing

- `utils/eisenhower.test.ts` — quadrant + urgency boundaries.
- `utils/firestoreConverters` todo test — `isImportant` round-trip.
- `MockHouseholdContext` seeds: at least one important todo so the matrix is
  walkable in Test Mode.
- Suite must stay green (`pnpm lint`, `pnpm test`).

## Out of scope

- No drag-between-quadrants (star + due date already move tasks).
- No changes to Completed view, batch mode semantics, or quickAdd endpoints
  (the NL parser may set `isImportant` later as a follow-up).
