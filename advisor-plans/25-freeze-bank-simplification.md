# Plan 25: Freeze Bank → auto-applied simplicity (owner-decided 2026-07-09)

> **Executor instructions**: Step 1 is a mandatory design spike appended to this
> file; Steps 2+ implement the decided design below. This touches streak logic on
> BOTH client and Cloud Functions — the parity requirement is load-bearing. Run
> every verification; honor STOP conditions. Update the status row in
> `advisor-plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- utils/habitLogic.ts utils/freezeBankValidator.ts functions/src/quickAdd/streakLogic.ts types/schema.ts contexts/household/mutations/gamificationMutations.ts`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2 (the owner's #1 overwhelm fix, with Plan 17's YearlyGoal parking)
- **Effort**: M–L
- **Risk**: MED-HIGH — streak semantics change on two codebases (client + functions quickAdd); points must NOT be granted for frozen days
- **Depends on**: none (but do NOT run concurrently with other habit-logic changes)
- **Category**: direction / simplification
- **Planned at**: commit `fce26e4`, 2026-07-09

## Owner decision (recorded — implement, don't re-litigate)

Replace the token **economy** (monthly 2-new+1-carryover rollover, expiry, manual patching UI) with **auto-applied** protection, Duolingo-style: when a daily habit's streak would break, a freeze is consumed automatically if available. Small fixed stock (max 2). The freeze *concept* stays; the bookkeeping goes.

## Decided v1 design

1. **New field** `Habit.frozenDates?: string[]` (yyyy-MM-dd). A frozen date preserves streak continuity but **earns zero points** — this is the central invariant. (The current manual patch credits points via the batch in `useFreezeBankToken`; auto-apply must NOT.)
2. **Streak semantics**: the day/week streak primitives treat a date in `frozenDates` as "kept the chain alive" without being a completion. This must change in BOTH `utils/habitLogic.ts` (client: `calculateStreak`/`streakEndingOn` and the weekly analogues) and `functions/src/quickAdd/streakLogic.ts` (server twin) — CLAUDE.md documents these as deliberately identical; keep them identical.
3. **Auto-apply trigger**: client-side midnight/first-login path — the same place the monthly rollover check runs today (`FirebaseHouseholdContext.tsx:1859-1872`, `useMidnightScheduler(checkFreezeBankRollover, …)`). New logic: for each positive DAILY habit with `streakDays >= 3` that was NOT completed (and not already frozen) yesterday, and `freezeBank.tokens > 0`: one `writeBatch` per application — append yesterday to `frozenDates` + decrement `tokens`. Deterministic order (highest streak first) so two devices racing at midnight converge; the batch write is idempotent-guarded by checking `frozenDates` doesn't already contain the date.
4. **Stock rule v1**: refill to `maxTokens = 2` on the 1st of each month (replace the 2-new+1-carryover math in `makeRolloverFreezeBankTokens`); drop expiry/carryover concepts. "Earned by consistency" refill is a recorded v2, not v1.
5. **Manual patch UI**: REMOVED (auto-protection supersedes it). `canUseFreezeBankToken`'s 6-check validator, the HabitCard patch affordance, and the `useFreezeBankToken` points-crediting batch go away. Points history stays honest: frozen days never earned points.
6. **Schema migration**: `FreezeBank` keeps `tokens` (clamped to new max 2 on first rollover) — no data migration required; `maxTokens`/`lastRolloverMonth` fields stay, reinterpreted.

## Current state (verified 2026-07-09)

- `types/schema.ts:425-429` — `FreezeBank { tokens (0-3), maxTokens (always 3), lastRolloverDate, lastRolloverMonth }` (+ `history` per the mock seed at `MockHouseholdContext.tsx:1116`).
- `utils/freezeBankValidator.ts` (193 lines) — `getMissedHabitDates`, `canUseFreezeBankToken` (6 checks incl. 30-day window), `wouldBenefitFromFreezeToken`, `suggestFreezeBankDate`. Most of this file is deleted by this plan; `getMissedHabitDates` survives (the auto-apply needs "was yesterday missed").
- Rollover: `makeRolloverFreezeBankTokens` factory in `contexts/household/mutations/gamificationMutations.ts`, wrapped at `FirebaseHouseholdContext.tsx:1595-1596`, triggered monthly at `:1859-1872`.
- Manual patch: `useFreezeBankToken` (CLAUDE.md Atomicity: habit + token balance + patched day's points in one batch, period-aware multiplier) — in `gamificationMutations.ts`; UI in `components/habits/HabitCard.tsx` (grep `freeze` there) and possibly `HabitsChallengesTab`.
- Server streak twin: `functions/src/quickAdd/streakLogic.ts` (`calculateStreak`/`calculateWeeklyStreak`/`streakForPeriod`), tested in `habitProcessor.test.ts`.
- `getHabitResetUpdate` (midnight auto-reset patch) recomputes `streakDays` via `streakForHabit` — it must see frozen continuity or streaks still visually collapse.
- `functions/src/index.ts:280-285` — the streak-rescue proactive insight reads `freezeBank.tokens` and suggests "use a freeze bank token"; its copy must change to reflect auto-protection.
- Migration precedent: `utils/migrations/freezeBankMigration.ts` exists from the original feature.

## Steps

### Step 1: Design spike (append "## Spike notes" before coding)

1. Enumerate every read-site of `completedDates` that computes streaks or points (client + functions) and classify: needs-frozen-awareness (streak) vs must-ignore-frozen (points). Evidence per site.
2. Confirm where HabitCard/PointsBreakdownModal display streaks and whether a "frozen" day needs a visual (recommend: the habit-history calendar shows a distinct frozen marker — find `HabitHistoryCalendar`).
3. Confirm the multi-device idempotency story for the auto-apply batch (the `frozenDates`-contains guard + Firestore last-write semantics) and record the residual race (two devices both decrement → tokens floor at 0 via `Math.max`).
4. Decide the exact signature change: recommend `streakForHabit(habit)` treating `frozenDates` internally (no call-site changes) — verify all call sites go through the period-dispatching helpers as CLAUDE.md claims.

**Verify**: Spike notes appended with file:line evidence.

### Step 2: Streak logic, both sides, in lockstep

Add frozen-date awareness to `utils/habitLogic.ts` primitives and mirror EXACTLY in `functions/src/quickAdd/streakLogic.ts`. Points paths (`calculatePointsForDate*`, quickAdd `processToggleHabit` multiplier) must count frozen days for streak-multiplier continuity but never as completions. Extend BOTH test suites with the same table of cases: frozen day mid-streak (streak survives), frozen day earns no points, weekly-cadence habit with a frozen week-day, frozen date absent (streak breaks as today).

**Verify**: `pnpm test` + functions tests → all pass with the new parity cases.

### Step 3: Auto-apply + simplified refill

Rewrite `makeRolloverFreezeBankTokens` → refill-to-2 monthly; add `makeAutoApplyFreezes` (per the decided design, one batch per application) invoked from the same midnight/first-login callback that does the rollover check today. Remove the manual-patch mutation `useFreezeBankToken` + its UI + the now-dead validator functions (keep `getMissedHabitDates`). Update the streak-rescue insight copy in `functions/src/index.ts` ("a freeze will protect it automatically" when tokens>0). Mock parity in `MockHouseholdContext`.

**Verify**: `pnpm lint:all && pnpm test && pnpm run build` + functions tests → green; `grep -n "canUseFreezeBankToken" -r . --include="*.ts*" | grep -v node_modules` → no app-code matches.

### Step 4: UI + Test-Mode walkthrough

HabitCard/history show the frozen marker per spike note 2; freeze-bank status display (wherever tokens render) shows "2/2 freezes" with the new copy. Walkthrough: seed a habit with a missed yesterday in Test Mode (mock supports it), trigger the scheduler callback, confirm auto-apply + streak preserved + no points granted. Dark + mobile check.

**Verify**: walkthrough recorded in the PR description.

## Done criteria

- [ ] Client and functions streak suites both carry the identical frozen-date case table
- [ ] `useFreezeBankToken` manual-patch path fully removed; no points ever granted for a frozen day (test-asserted)
- [ ] Rollover = refill-to-2; no carryover/expiry code remains
- [ ] All gates green; spike notes appended; `advisor-plans/README.md` row updated

## STOP conditions

- Spike finds streak call sites that bypass the period-dispatching helpers (parity risk explodes) — report the list first.
- Any design pressure to credit points for frozen days — refuse; zero-points is the owner-decided invariant.
- The quickAdd server path turns out to need `frozenDates` in its request/response contract (would change the iOS Shortcut API) — report.

## Maintenance notes

- v2 (recorded, not built): earn-by-consistency refill (+1 freeze per 14-day all-habit streak, cap 2) replacing the monthly refill.
- The old manual-patch code (incl. `freezeBankPatchPoints.test.ts`) documents the points-crediting behavior being retired — delete its tests WITH the code, don't leave them skipped.
- Reviewer scrutiny: client/functions parity diff-by-eye; the idempotency guard on auto-apply.

## Spike notes (executor, 2026-07-09)

### 1. `completedDates` read-sites — streak vs points classification

**Needs frozen-awareness (streak chain-walkers):**
- `utils/habitLogic.ts` — `calculateStreak` (:87), `streakEndingOn` (:124), `calculateWeeklyStreak` (:152), `streakEndingOnWeek` (:201): the four primitives; gain an optional trailing `frozenDates` param. Dispatchers `streakForHabit` (:241) / `streakEndingOnForHabit` (:255): Pick widened to include optional `frozenDates`, passed through. `processToggleHabit`'s inner `streakFor` (:368), `calculateResetPoints` (:454/:470), `getHabitResetUpdate` (:521): pass `habit.frozenDates`.
- `hooks/useHabitActions.tsx` :320 (resetHabit), :406 (addHabitSubmission prospective streak), :460, :573 (deleteHabitSubmission) — all construct `{ period, completedDates }` literals; each now carries `frozenDates`.
- `contexts/MockHouseholdContext.tsx` :738 (mock toggle) — same.
- `functions/src/quickAdd/streakLogic.ts` (`calculateStreak`/`calculateWeeklyStreak`/`streakForPeriod`) + `habitProcessor.ts` :208/:281/:318 — mirrored identically; server `Habit` interface gains `frozenDates?: string[]` (read from the Firestore doc, NOT the request body — the iOS Shortcut API contract is unchanged, so that STOP condition does not fire).
- `scripts/migrateHabitSubmissions.ts` :107 — historical backfill tool predating frozenDates; dates it scores predate the feature, left as-is (omitted param = no frozen dates).

**Must ignore frozen (points / completion semantics) — all already correct because frozen dates never enter `completedDates`:**
- `calculatePointsForDate` (:551 `completedDates.includes(targetDate)` guard) and `calculatePointsForDateRange` (:644 range filter) — a frozen day is filtered out before any scoring, so it earns 0; test-asserted. Later days' multipliers get frozen continuity via `streakEndingOnForHabit` (full habit passed).
- `utils/challengeCalculator.ts`, recap `dataAssembly`, `analyticsHelper`, gemini prompts, dashboard widgets (`PulseStripWidget`, `DailyHabitsWidget`, `KidDashboard`), `isHabitCompletedInCurrentPeriod` — completions only; frozen days correctly do not count.

**Streak-count semantics chosen:** a frozen date BRIDGES the chain without incrementing the count ("preserves the streak" — Duolingo semantics; a frozen day is not a completion, so it also isn't a streak unit). Both codebases implement the same walk: completed → count+1, frozen → bridge, gap → break. With `frozenDates` empty/omitted, behavior is byte-identical to before.

### 2. Streak displays / frozen visual
- `HabitCard` streak badge reads `habit.streakDays` (now written frozen-aware) — no change needed; a quiet "❄ Protected" badge is added when yesterday is in `frozenDates`. The manual "Repair Streak" affordances are removed.
- `HabitHistoryCalendar` gets a distinct frozen marker (habit-blue ring + snowflake-tinted cell) for days present in any habit's `frozenDates` (they never appear as completions).
- `PointsBreakdownModal` — points-edit surface, no streak reconstruction; untouched.

### 3. Auto-apply idempotency / multi-device story
- One `writeBatch` per application: habit doc (`frozenDates` + recomputed `streakDays`) + household doc (`freezeBank` with decremented `tokens` and appended history entry).
- Idempotency guard: a habit is only a candidate when `!frozenDates.includes(yesterday)` — a second run (same device or another device seeing the committed write) is a no-op.
- Deterministic order: candidates sorted by protected streak DESC, then habit id ASC, so racing devices pick the same habits.
- Residual race (accepted per plan): two devices whose snapshots both predate each other's commits can each apply a freeze computed from the same starting `tokens`; the absolute `tokens` write converges last-writer-wins and is floored at 0 via `Math.max(0, tokens - 1)` — never negative.
- Eligibility (`streakDays >= 3` in the plan) is computed from data — the PROSPECTIVE streak if yesterday were frozen (`calculateStreak(completedDates, today, [...frozenDates, yesterday]) >= 3`) — not the stored `streakDays` field, because the midnight habit-reset may have already recomputed `streakDays` to 0 before this callback runs (ordering between the two schedulers is not guaranteed). This also makes consecutive-night freezes work (night 2 bridges night 1's frozen day). `getMissedHabitDates(habit, 1)` supplies the "yesterday was missed" check (the surviving validator helper, per plan).

### 4. Signature decision
Primitives gain an optional trailing `frozenDates: string[] = []`; the period-dispatching helpers pass `habit.frozenDates` internally. Verified every streak computation site goes through the dispatchers or has the habit in scope — **no bypassing call sites found; the parity STOP condition does not fire.** The four `{ period, completedDates }` literal sites (useHabitActions ×4, MockHouseholdContext ×1, habitLogic internal ×3) are updated to carry `frozenDates` in the same change.

### Other spike findings
- `firestore.rules` habits create/update has NO `hasOnly` allowlist (title/category string checks only) — `frozenDates` is writable without a rules change. Household-doc update is field-permissive — `freezeBank` writes unchanged.
- `habitConverter` spreads the doc — optional `frozenDates` passes through untouched.
- `useMidnightScheduler` is ref-backed (`callbackRef`), so extending `checkFreezeBankRollover` to also auto-apply needs no scheduler change.
- `functions/src/index.ts` :282-284 streak-rescue insight copy updated ("a freeze will protect it automatically"); `index.test.ts` :819-830 asserts the old copy and is updated in lockstep.
- The 6 `useFreezeBankToken` describe blocks in `FirebaseHouseholdContext.test.tsx` document the retired points-crediting patch; they are DELETED with the code (per Maintenance notes) and replaced by auto-apply atomicity/idempotency/zero-points tests through the same harness. `contexts/freezeBankPatchPoints.test.ts` is deleted.
