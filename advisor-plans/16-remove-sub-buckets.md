# Plan 16: Remove the write-only sub-bucket feature

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. When done, update this plan's status row in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- types/schema.ts services/geminiService.ts services/geminiValidation.ts contexts/household/mutations/transactionMutations.ts utils/transactionMerge.ts`
> On mismatch with "Current state", STOP.
>
> **Owner gate**: this plan implements the REMOVE branch of a decision the owner
> approved by selecting this plan. If instead nested categories are wanted, this
> plan is void — the alternative is a "finish sub-buckets" feature plan (aggregation
> + display), which this is not.

## Status

- **Priority**: P2 (Phase 1)
- **Effort**: M — wider than it looks: schema, two AI prompts + validation, merge logic, mutations, two form pickers
- **Risk**: LOW-MED — all removals are of write-only data, but the AI prompt/schema edits need care
- **Depends on**: best after Plan 15 (same-area churn)
- **Category**: tech-debt
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

Sub-buckets (`BudgetBucket.subBuckets`, `Transaction.subBucketId`) are collected by the manual-capture and edit forms, suggested by the receipt/statement AI prompts, preserved by the duplicate-merge logic, and sanitized by the mutation layer — and then **never aggregated or displayed anywhere** (zero references in `components/budget/` display components, `utils/bucketSpentCalculator.ts`, or `utils/safeToSpendCalculator.ts`). The June-2026 bloat audit flagged this write-only limbo; since then the feature grew a picker UI without ever growing a reader. Removing it deletes a user-visible control that does nothing, simplifies two AI prompts (fewer tokens, fewer failure modes), and shrinks the merge/mutation surface.

## Current state (verified 2026-07-09)

- `types/schema.ts:144` — `subBuckets?: SubBucket[];` on `BudgetBucket` (the `SubBucket` interface is nearby, ~`:70-73`); `:173` — `subBucketId?: string;` on `Transaction`
- `types/ui.ts:9` — `subBucketId?: string;` (a UI draft type)
- `services/geminiService.ts` — the receipt prompt builds `subBucketContext` (`:751-768`) and declares `subBucket` in its response schema (`:786`); the bank-statement prompt repeats the pattern (`:828-846`, `:865`); the parsed type carries `subBucket?` (`:410`); `services/geminiService.types.ts:23` re-exports it
- `services/geminiValidation.ts:109,124,136` — validates `subBucket` as optional string in receipt + statement results (tests at `geminiValidation.test.ts:39,67`)
- `contexts/household/mutations/transactionMutations.ts:133-134` — writes trimmed `subBucketId` on add; `:499-502` — sanitizes it on update
- `utils/transactionMerge.ts:64,83` — keeps the dupe's `subBucketId` when merging
- Form pickers: grep `subBucket` in `components/` — expect `CaptureTransactionManual.tsx` (~`:62,:87-93`) and `EditTransactionModal.tsx`; also `BucketFormModal` (sub-bucket creation on the bucket side)
- Conventions: strict tsc sweeps stragglers; tests colocated; `pnpm lint` runs tsc first

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Focused | `pnpm test -- geminiValidation` / `-- transactionMerge` | pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**: the files listed above, their tests, `contexts/MockHouseholdContext.tsx` (parity), any component tsc flags.

**Out of scope**:
- `firestore.rules` — it DOES reference the fields (verified): `:355` validates `subBucketId` as an optional string on transactions; `:427`/`:442` type-check `subBuckets`, and `:451` includes `subBuckets` in the bucket-update `hasOnly` key whitelist. LEAVE ALL OF THEM — they are optional/whitelist checks, so clients writing fewer keys still pass; removing the lines is for the next human-watched rules PR (noted in Maintenance).
- Firestore data migration — existing docs keep stale keys harmlessly.
- `bucketId` / category logic — the REAL categorization system; touch nothing about it.

## Git workflow

- Branch: `advisor/16-remove-sub-buckets`
- e.g. `refactor(budget): remove write-only sub-bucket feature`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Remove from schema and let tsc sweep

Delete `SubBucket`, `subBuckets` (`schema.ts:144`), `subBucketId` (`schema.ts:173`), and `types/ui.ts:9`. Run `pnpm lint`; fix every flagged site by REMOVING the sub-bucket handling (form pickers + their state, `transactionMutations.ts:133-134,499-502`, `transactionMerge.ts:83` + its comment at `:64`).

**Verify**: `pnpm lint` → exit 0.

### Step 2: Simplify the two AI prompts

In `services/geminiService.ts`: delete the `subBucketContext` blocks (`:751-768`, `:828-846`), the `subBucket` schema properties (`:786`, `:865`), and the `subBucket?` fields (`:410`; `geminiService.types.ts:23`). In `services/geminiValidation.ts` remove the `subBucket` checks (`:109,:124,:136`) and update its tests. Do NOT otherwise reword the prompts — minimal diff.

**Verify**: `pnpm test -- geminiValidation` and the geminiService tests → pass.

### Step 3: Bucket-side removal + mock parity

Remove sub-bucket creation UI from `BucketFormModal` (grep `subBucket` there). Remove any seeds in `contexts/MockHouseholdContext.tsx`.

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0; `grep -rni "subbucket" --include="*.ts" --include="*.tsx" . | grep -v node_modules` → no app-code matches.

## Test plan

- Update (don't delete) `geminiValidation.test.ts` and `transactionMerge` tests to assert the field is gone from outputs.
- No new test files needed; the deletion is the change.

## Done criteria

- [ ] Zero non-doc `subBucket` matches (Step 3 grep)
- [ ] All gates green; `git status` clean outside scope
- [ ] `advisor-plans/README.md` row updated (+ rules follow-up noted if rules mention the fields)

## STOP conditions

- Any DISPLAY or aggregation of sub-buckets turns up (contradicts the audit — report; the premise "write-only" would be false).
- The AI prompt edits change any behavior for `bucketId`/category selection in tests — report rather than adjusting category logic.

## Maintenance notes

- Follow-up for the NEXT `firestore.rules` PR (human-watched, can ride with Plan 15's telegram lines): drop `firestore.rules:355` (`subBucketId`), `:427`/`:442` (`subBuckets` type checks), and remove `'subBuckets'` from the `:451` `hasOnly` whitelist.
- If nested categories are ever wanted for real, re-add as a designed feature with aggregation + display from day one — git history preserves this implementation for reference.
- Reviewer scrutiny: the merge-logic edit (`transactionMerge.ts`) — confirm no other merged field's handling was disturbed.
