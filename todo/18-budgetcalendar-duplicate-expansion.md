# 18 — BudgetCalendar duplicate `expandCalendarItems` work

## Problem
`components/budget/BudgetCalendar.tsx` calls `expandCalendarItems(calendarItems, start, end)`
inside its own `useMemo`, independent of the shared `useExpandedCalendarItems(start, end)`
hook used by `UpcomingBillsWidget`, `useActionQueue`, and `SafeToSpendModal` (and the
context-level `expandedCalendarItemsForSafeToSpend` memo). Because the calendar uses a
*different* window (the visible month) than the Safe-to-Spend window, the shared hook is a
no-op here — so on every `calendarItems` snapshot, recurring-item expansion runs twice
(once for Safe-to-Spend, once for the month grid).

This is a perf-hygiene item, not a correctness bug; the numbers are identical either way.

## Current state
- `components/budget/BudgetCalendar.tsx` — local `useMemo` around `expandCalendarItems`.
- `hooks/useExpandedCalendarItems.ts` — memoized on `[calendarItems, start, end]`; only
  dedupes callers sharing the *same* window.
- `utils/calendarRecurrence.ts` — `expandCalendarItems` (pure).

## Proposed approach
Introduce a small window-keyed cache so any caller's `(start, end)` pair reuses a prior
expansion for the same inputs:
- Option A: a `Map`-backed memoizer keyed on `calendarItems` identity + `start`/`end`
  ISO strings, living next to `useExpandedCalendarItems`, with the calendar adopting it.
- Option B: hoist a provider that pre-expands a superset window (e.g. current month ∪
  Safe-to-Spend window) once and lets consumers slice it.

Prefer Option A — it's local and low-risk.

## Risks
- Cache invalidation on `calendarItems` change must be exact (stale months would show wrong
  bills). Key on the array reference plus window bounds.
- Memory: bound the cache (e.g. keep the last N windows) so month-scrubbing doesn't grow it.

## Acceptance criteria
- A single `calendarItems` snapshot expands each distinct window at most once across all
  consumers in a render pass.
- BudgetCalendar shows identical items/totals to before.
- `pnpm lint` + `pnpm test` green; add a test asserting expansion is reused for a repeated
  `(start, end)`.
