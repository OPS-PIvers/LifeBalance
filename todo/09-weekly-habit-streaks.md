# 09 — Weekly-habit streaks are measured in days, not weeks

## Problem
`calculateStreak` (and `streakEndingOn`) walk **consecutive calendar days**. Weekly
habits (`period === 'weekly'`) record roughly one completion per week, so their
`completedDates` entries are ~7 days apart and never count as consecutive. As a
result weekly habits effectively always have a streak of 0–1 and can **never reach
the 1.5× (3-day) or 2.0× (7-day) multipliers**. Users with weekly habits silently
never get streak bonuses.

## Current state
- `utils/habitLogic.ts`
  - `calculateStreak(dates)` (~L71–90): subtracts one day per step (`subDays`),
    assumes daily continuity.
  - `streakEndingOn(dates, date)` (~L109–120): same day-by-day assumption.
  - `processToggleHabit` (~L196) calls `calculateStreak` regardless of `habit.period`.
- Many preset weekly habits exist in `data/presetHabits.ts` (meal prep, cleaning,
  budget review, etc.).
- Tests in `utils/habitLogic.test.ts` only cover `period: 'daily'` — there is no
  failing test today, which is why this went unnoticed.

## Proposed approach
1. Add `calculateWeeklyStreak(dates: string[]): number` that counts **consecutive
   ISO weeks** containing at least one completion (use `getISOWeek` / `isSameISOWeek`
   from `date-fns`, anchored on the user's local week).
2. Add a `streakEndingOnWeek` analogue for historical recalculation.
3. Dispatch on `habit.period` in `processToggleHabit`, `calculatePointsForDate`,
   `calculatePointsForDateRange`, and anywhere else `calculateStreak` is used for
   scoring, so weekly habits use the week-based variant.
4. Keep the multiplier thresholds the same (3 → 1.5×, 7 → 2.0×) but now in **weeks**
   for weekly habits — confirm with product whether the thresholds should differ
   for weekly cadence (a 7-week streak is a much bigger ask than 7 days).

## Risks
- Behavior change: weekly-habit point totals will change once multipliers apply.
- Historical recalculation (`calculatePointsForDateRange`) must use the week-based
  streak so past days don't drift.
- Thresholds-in-weeks is a **product decision** (hence deferred).

## Acceptance criteria
- New pure unit tests in `utils/habitLogic.test.ts` covering weekly streaks:
  consecutive weeks accrue, a skipped week resets, multiplier applies at the
  agreed thresholds.
- Daily-habit behavior is byte-for-byte unchanged (existing tests still pass).
- `pnpm lint && pnpm test` green.
