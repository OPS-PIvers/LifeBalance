# 10 — Daily points can recalc to 0 after a midnight auto-reset

## Problem
The midnight auto-reset (`checkHabitResets`) sets a habit's `count` to `0` but does
**not** remove today's date from `completedDates`. Separately,
`calculatePointsForDate` skips any habit whose `count === 0`. So if the auto-reset
fires after the user already completed a habit today, a subsequent points
recalculation (`checkPointsReset` / `syncHouseholdPoints` calling
`calculatePointsForDate`) can compute `daily = 0` even though points were earned —
the day's earned points disappear from the daily total.

Note `resetHabit` (the manual reset in `useHabitActions`) *does* remove today from
`completedDates`, so it is correct; only the automatic `checkHabitResets` path is
inconsistent.

## Current state
- `contexts/FirebaseHouseholdContext.tsx` `checkHabitResets` (~L1372–1383 pre-Wave 2;
  re-grep): sets `count: 0`, leaves `completedDates` intact.
- `utils/habitLogic.ts` `calculatePointsForDate` (~L292–306): `if (habit.count === 0) continue;`
  — the guard meant "habit not started today" but also matches "reset after completion."
- `hooks/useHabitActions.tsx` `resetHabit` (~L240–256): correctly removes today.

## Proposed approach
Pick ONE consistent rule and apply it everywhere:
- **Option A (preferred):** make `checkHabitResets` mirror `resetHabit` — remove
  today's date from `completedDates` when it zeroes `count`. Keeps the
  `count === 0` guard meaningful.
- **Option B:** change `calculatePointsForDate` to not gate on `count === 0` for
  **historical** dates (only treat `count === 0` as "skip" for *today*), deriving
  the day's contribution from `completedDates` + stored per-day data.

Option A is the smaller, lower-risk change and keeps the invariant
"`completedDates` contains today ⟺ count reflects today" that `resetHabit` already
upholds.

## Risks
- Points logic is correctness-critical; a wrong fix corrupts user point totals.
- Must verify interplay with `streakEndingOn` historical recalculation so past-day
  multipliers don't drift.
- Needs a regression test that reproduces the bug before fixing.

## Acceptance criteria
- A unit test that completes a daily habit, simulates the auto-reset, then runs the
  points recalculation and asserts the earned daily points are preserved.
- Existing habit/points tests stay green.
- `pnpm lint && pnpm test` green.
