# Plan 15: Dead-surface cleanup — `weatherSensitive`, Telegram fields, `quickAddReceipt` stub, backfill un-export

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. On any STOP condition, stop
> and report — do not improvise. When done, update this plan's status row in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- types/schema.ts data/presetHabits.ts functions/src/index.ts functions/src/quickAdd/index.ts`
> On mismatch with the "Current state" excerpts, STOP.

## Status

- **Priority**: P1 (Phase 1 of the 2026-07-09 roadmap)
- **Effort**: S–M (many files, all mechanical; strict tsc does the sweeping)
- **Risk**: LOW — every removed surface is verified write-only/dead
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

Three verified-dead surfaces ship in the app: (1) `Habit.weatherSensitive` — a **required** schema boolean written by every habit form and read by zero business logic (the weather feature was never built); (2) a phantom Telegram integration — `telegramChatId`/`telegramAlias` fields plus a `'telegram'` transaction source, modeled in schema/forms/rules with **zero delivery code anywhere in `functions/`**; (3) the `quickAddReceipt` HTTP endpoint, which returns `501 Not Implemented`, plus the completed one-off `backfillanynotificationsenabled` callable still deployed. Users fill in controls that do nothing; a solo maintainer carries the weight. This is the cheapest de-bloat PR on the board.

## Current state (all verified 2026-07-09)

**weatherSensitive** — required field, zero readers (`utils/habitLogic.ts` has no reference):
- `types/schema.ts:287` — `weatherSensitive: boolean;` on `Habit`
- `data/presetHabits.ts:72` (interface) + ~30 preset literals (`:87,:99,:111,…`)
- Writers: `components/modals/HabitFormModal.tsx:124`, `components/modals/HabitCreatorWizard.tsx:119,189`, `components/modals/ChallengeHubModal.tsx:165`, `hooks/useHabitActions.tsx:114`, `hooks/useInsightActions.ts:63`, `utils/onboardingSeed.ts` (~:65)
- Test fixtures: `HabitCard.test.tsx` (4 sites), `HabitHistoryCalendar.test.tsx` (2), `PulseStripWidget.test.tsx:54`, `KidsChoresWidget.test.tsx:49`, `usePointsSync.test.tsx:25`, and any others tsc finds
- Docs: CLAUDE.md has a "Note:" paragraph documenting the field as dead (search `weatherSensitive` in CLAUDE.md); `WEATHER_IMPLEMENTATION.md` is the historical design doc

**Telegram** — schema + pass-through only; `grep -ri telegram functions/src/` returns nothing:
- `types/schema.ts:68` `telegramChatId?: string;` (HouseholdMember), `:288` `telegramAlias?: string;` (Habit), `:169` `'telegram'` in the `Transaction.source` union
- Pass-throughs: `components/modals/HabitFormModal.tsx:128`, `components/modals/HabitCreatorWizard.tsx:196`, `hooks/useHabitActions.tsx:115`, `pages/Settings.tsx:326` (export-sanitizer destructure)
- `firestore.rules:232,250,287-291` validate these as OPTIONAL fields — **leave the rules untouched** (rules changes are high-blast-radius in this repo and ship separately, human-watched; validating an optional field nobody sends is harmless dead code, noted as a follow-up)

**quickAddReceipt** — `functions/src/index.ts:26` exports it; the handler in `functions/src/quickAdd/index.ts` (~`:926`) returns HTTP 501 with a `// TODO: Implement Gemini integration` body.

**backfillanynotificationsenabled** — `functions/src/index.ts:746-823`; a completed, idempotent, admin-gated one-off (Plan 06 backfill) with no reason to stay deployed.

**Deploy caveat (matters for the two function removals):** deleting a deployed function makes non-interactive `firebase deploy` prompt for confirmation and abort unless the deploy runs with `--force` (or the function is ignored). CI auto-deploys on merge to main.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint root | `pnpm lint` | exit 0 |
| Lint all | `pnpm lint:all` | exit 0 |
| Tests | `pnpm test` | all pass |
| Functions tests | check `functions/package.json` for the test script, run it | all pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**: `types/schema.ts`, `data/presetHabits.ts`, `utils/onboardingSeed.ts`, the writer/pass-through files listed above, every test fixture tsc flags, `CLAUDE.md` (the weatherSensitive note; any telegram mention), `WEATHER_IMPLEMENTATION.md` (delete), `functions/src/index.ts`, `functions/src/quickAdd/index.ts` (+ its tests), `contexts/MockHouseholdContext.tsx` (if it seeds these fields), `advisor-plans/README.md`.

**Out of scope** (do NOT touch):
- `firestore.rules` — leave the now-dead optional-field validations; record them in Maintenance notes for the next rules PR.
- `subBucketId` / sub-buckets — deeper than it looks (AI prompts, merge logic); it is Plan 16, not this one.
- `.github/workflows/deploy.yml` — read it (Step 4) but do not edit it.
- Any Firestore data migration — existing docs keep the stale fields harmlessly; converters/readers simply ignore them.

## Git workflow

- Branch: `advisor/15-dead-surface-cleanup`
- Conventional commits, one per step group, e.g. `chore(habits): remove dead weatherSensitive field`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove `weatherSensitive`

Delete the field from `types/schema.ts:287` and `data/presetHabits.ts:72`, then run `pnpm lint` — strict tsc (`noUnusedLocals`, excess-property checks) will flag every remaining literal and writer. Remove each flagged site (preset literals, form defaults, `useHabitActions.tsx:114`, `useInsightActions.ts:63`, `onboardingSeed`, all test fixtures). Then remove the CLAUDE.md paragraph documenting the dead field and delete `WEATHER_IMPLEMENTATION.md`.

**Verify**: `pnpm lint && pnpm test` → exit 0; `grep -rn "weatherSensitive" --include="*.ts" --include="*.tsx" . | grep -v node_modules` → no matches.

### Step 2: Remove the Telegram fields

Delete `telegramChatId` (`schema.ts:68`), `telegramAlias` (`schema.ts:288`), and `'telegram'` from the source union (`schema.ts:169`). Fix what tsc flags: the three habit-form/hook pass-throughs, the `Settings.tsx:326` destructure (just drop `telegramChatId` from it), and any `source === 'telegram'` comparisons (`grep -rn "'telegram'" --include="*.ts*" .`). If a rendered `telegramAlias` input exists in the habit forms, remove the input row too.

**Verify**: `pnpm lint && pnpm test` → exit 0; `grep -rni "telegram" --include="*.ts" --include="*.tsx" . | grep -v node_modules` → no app-code matches (docs/plans mentions are fine).

### Step 3: Delete the `quickAddReceipt` stub and un-export the backfill

Remove `quickAddReceipt` from the export at `functions/src/index.ts:26`, delete its handler + tests in `functions/src/quickAdd/` (there is a `describe("quickAddReceipt", …)` block in `functions/src/quickAdd/index.test.ts` ~`:1184`), and remove the `backfillanynotificationsenabled` export (`index.ts:746-823`, keep nothing — the backfill ran; the code is in git history). Known client-side references to update: `services/apiKeyService.ts:186` maps `receipt: "quickAddReceipt"` in its endpoint table — remove the `receipt` entry and the matching assertion in `services/apiKeyService.test.ts` (~`:164`); then check `components/settings/ShortcutSetupGuide.tsx` and `docs/` for receipt-endpoint mentions.

**Verify**: `pnpm lint:all` → exit 0; functions tests pass.

### Step 4: Deploy-safety check (read-only)

Read `.github/workflows/deploy.yml`. If the functions deploy command does NOT include `--force` (or an equivalent non-interactive delete confirmation), the removal of two deployed functions will abort CI's deploy. In that case: keep the code deletions, and add a prominent note to the PR description + the README status row that the first deploy after merge needs a human to either add `--force` for that run or delete the two functions via `firebase functions:delete quickAddReceipt backfillanynotificationsenabled` first. Do not edit the workflow yourself.

**Verify**: the PR description (or status note) states which case applies.

### Step 5: Full gates

**Verify**: `pnpm lint:all && pnpm test && pnpm run build` + functions tests → all exit 0.

## Done criteria

- [ ] Zero non-doc matches for `weatherSensitive` and `telegram` (greps in Steps 1–2)
- [ ] `quickAddReceipt` and `backfillanynotificationsenabled` absent from `functions/src/index.ts`
- [ ] All gates green; no files outside scope modified (`git status`)
- [ ] Deploy-safety note recorded (Step 4)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- Any business-logic READ of `weatherSensitive` or `telegramAlias`/`telegramChatId` turns up (contradicts the audit — report the site, do not delete).
- A `source === 'telegram'` branch does something load-bearing (e.g., analytics param mapping that would break) — report it.
- `MockHouseholdContext` or E2E specs depend on the removed fields in ways beyond fixture literals — report before restructuring tests.

## Maintenance notes

- Follow-up for the NEXT `firestore.rules` PR (human-watched): drop the dead `telegramChatId`/`telegramAlias` validation lines (`firestore.rules:232,250,287-291`).
- Existing Firestore habit docs retain a stale `weatherSensitive` key; harmless (readers ignore unknown keys). If a converter is ever made strict, add it to the strip list like `BudgetBucket.spent`.
- Reviewer scrutiny: the source-union removal — confirm no analytics `source` param or dedup path enumerated `'telegram'`.
