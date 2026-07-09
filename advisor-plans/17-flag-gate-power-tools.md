# Plan 17: Flag-gate the power-tool surfaces (`powerToolsEnabled`, fail-open)

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. When done, update this plan's status row in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- services/appConfig.ts pages/Habits.tsx components/budget/BudgetTrends.tsx components/budget/TransactionMasterList.tsx components/meals/ShoppingListTab.tsx`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2 (Phase 3)
- **Effort**: S–M
- **Risk**: LOW — flag defaults ON (fail-open), so merge day changes nothing
- **Depends on**: none
- **Category**: tech-debt / risk-containment
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The June-2026 bloat audit (`plans/audit/07`, §[4] Pause) recommended parking five power-user/fragile surfaces behind a flag; none were ever gated. Three of them are extra Gemini prompt surfaces (a fragility and cost multiplier for a solo maintainer), two are power-user finance UI. This plan adds ONE operator flag, `powerToolsEnabled`, **fail-open** (ON unless explicitly `false`) so shipping it is behavior-neutral — it simply gives the owner a kill-switch/simplification lever, togglable live from the Developer Console like the existing flags.

Gated surfaces:
1. `HabitCoach` (Gemini) — `pages/Habits.tsx:419`
2. `SmartHabitAdjustModal` + `SmartHabitReorderModal` (Gemini) — `pages/Habits.tsx:437-438` and whatever menu items open them
3. Grocery "Optimize with AI" (Gemini) — `components/meals/ShoppingListTab.tsx:187` (`useGroceryOptimizer`)
4. `BudgetHistory` — `components/budget/BudgetTrends.tsx:189`
5. `SavedViewChips` — `components/budget/TransactionMasterList.tsx:474`
6. **YearlyGoal UI (owner-decided 2026-07-09: park behind this flag, decide later with usage data).** Gate every yearly-goal SURFACE while leaving data + listeners intact: the yearly-goal sections and create/edit entry points in `components/habits/HabitsChallengesTab.tsx` and `components/modals/ChallengeHubModal.tsx`, and the `YearlyGoalFormModal` triggers (grep `YearlyGoal` in both files for the exact render/open sites). Do NOT touch `utils/yearlyGoal.ts`, the converter, `gamificationListeners`/`gamificationMutations`, or any stored goal docs — flag-off must be purely cosmetic and reversible.

## Current state (verified 2026-07-09)

- Flag system: `services/appConfig.ts` — per-flag cached async getters + `readAppConfigFlags()` (`:226-249`) returning effective booleans for the admin panel, and `setAppFlag` (merge-write + cache invalidation). Two semantics exist: fail-CLOSED (`=== true`: `openSignup`, `billingEnabled`, `kidModeEnabled`, `plaidEnabled`) and fail-OPEN (`!== false`: `aiEnabled`, key exported as `AI_ENABLED_FLAG_KEY` at `:209`). **This flag copies the fail-OPEN pattern.**
- Mount-time hook exemplar: `hooks/useKidModeEnabled.ts` — `useState(false)` + `getKidModeEnabled()` on mount. The new hook inverts the default: `useState(true)`, only flips to `false` on an explicit read of `false`.
- Admin UI: `components/modals/DeveloperConsole.tsx` has a Feature Flags tab driven by `readAppConfigFlags`/`setAppFlag` (~`:32-68` config list). Follow how `aiEnabled` (the other fail-open flag) is presented there.
- Mount sites as listed above; the Smart modals are opened by state setters (`isSmartAdjustOpen`/`isSmartReorderOpen`) — grep `setIsSmartAdjustOpen(true)` / `setIsSmartReorderOpen(true)` in `pages/Habits.tsx` to find the trigger menu items.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm run build` | exit 0 |
| Manual | Test Mode (`pnpm dev`, `/#/login?test=true`, needs `VITE_ENABLE_TEST_MODE=true`) | verify both flag states |

## Scope

**In scope**: `services/appConfig.ts`, new `hooks/usePowerToolsEnabled.ts` (+ test), `components/modals/DeveloperConsole.tsx`, the five mount-site files, `advisor-plans/README.md`.

**Out of scope**:
- Deleting or lazy-restructuring any gated component — gating render only; the code stays.
- `firestore.rules` (the `app_config/global` doc already has its write rules).
- `services/geminiService.ts` — the AI functions stay exported; only their UI entry points gate.

## Git workflow

- Branch: `advisor/17-flag-gate-power-tools`
- e.g. `feat(flags): powerToolsEnabled fail-open gate for AI/power-user surfaces`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the flag getter (fail-open)

In `services/appConfig.ts`, add `getPowerToolsEnabled()` mirroring the `aiEnabled` semantics (`data.powerToolsEnabled !== false`, fail-open on error, same 60s promise-cache pattern as the other getters) and add the key to `readAppConfigFlags()` (`:231-238` object and the `:241-247` error fallback, defaulting `true`). Export a `POWER_TOOLS_FLAG_KEY` constant like `AI_ENABLED_FLAG_KEY`.

**Verify**: `pnpm lint` → exit 0; extend the existing `appConfig` tests (find them next to the source) with fail-open cases: missing doc → true, explicit false → false.

### Step 2: Add `hooks/usePowerToolsEnabled.ts`

Copy `hooks/useKidModeEnabled.ts` structurally, but `useState(true)` and set from `getPowerToolsEnabled()`. Add a matching hook test if `useKidModeEnabled` has one (check).

**Verify**: `pnpm test` → pass.

### Step 3: Gate the six mount sites

In each file, call the hook and conditionally render:
- `pages/Habits.tsx`: hide `<HabitCoach />` (`:419`); hide the menu items that call `setIsSmartAdjustOpen(true)`/`setIsSmartReorderOpen(true)` (the modals at `:437-438` can stay mounted-but-unopenable, or be gated too — prefer gating both).
- `components/budget/BudgetTrends.tsx:189`: hide `<BudgetHistory />`.
- `components/budget/TransactionMasterList.tsx:474`: hide `<SavedViewChips …/>`.
- `components/meals/ShoppingListTab.tsx`: hide the "Optimize" action wired to `useGroceryOptimizer` (`:187`); keep the hook call unconditional if hooks-order rules require, gating only the button.
- YearlyGoal surfaces per the list in "Gated surfaces" #6 — render-gate the sections/triggers only; a flag-off household with existing yearly goals simply stops seeing them (data intact).

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0.

### Step 4: Developer Console toggle + manual check

Add `powerToolsEnabled` to the Feature Flags panel following the `aiEnabled` row's fail-open presentation. Then in Test Mode: default state shows all five surfaces; after toggling off (in dev, `app_config` may not be writable in Test Mode — if the mock path doesn't support the flag, verify by temporarily hard-coding the hook return and say so in the PR notes), the five surfaces disappear and nothing else changes.

**Verify**: manual walkthrough recorded (which method was used) in the PR description.

## Done criteria

- [ ] `grep -n "powerToolsEnabled" services/appConfig.ts components/modals/DeveloperConsole.tsx` → present in both
- [ ] Five mount sites gated; all gates green
- [ ] Fail-open semantics tested (missing/absent → enabled)
- [ ] `advisor-plans/README.md` row updated

## STOP conditions

- Gating a surface breaks a test that asserts it's always present in a way suggesting product intent (report, don't force the test green).
- The hooks-order constraint makes gating `useGroceryOptimizer` unsafe — gate the button only and note it.

## Maintenance notes

- This flag is a scalpel, not a decision: the June items stay code-complete. When the owner decides keep-vs-cut per surface (advisor-plans/audit-2026-07-09-product-scope.md B11), either promote to always-on (delete the gate) or remove the feature.
- Reviewer scrutiny: fail-OPEN semantics everywhere — an `=== true` slip would hide five features on merge day.
