# Plan 24: Savings goals / sinking funds — design spike + rules-gated build

> **Executor instructions**: Deliverable (A) is a design spike appended to this
> file resolving the open questions; deliverable (B) is the build, EXCLUDING the
> `firestore.rules` change (own PR, human-watched — repo rule; draft the diff in
> the spike). Update the status row in `advisor-plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- types/schema.ts utils/firestoreConverters.ts utils/safeToSpendCalculator.ts firestore.rules`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P3 (Phase 6)
- **Effort**: M–L
- **Risk**: MED — a new money-adjacent entity; the one hard invariant is that goals must NOT silently change Safe-to-Spend
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The only "goal" primitive is a single number on an account (`Account.monthlyGoal`); budget buckets are spend-envelopes; the Kid-Mode `allowanceCents` is an IOU with nothing to save toward. There is no way to model "save $1,200 for Christmas by December" with visible shared progress — the emotional, rally-the-family feature (a core YNAB/EveryDollar job), and the thing that turns a kid's allowance IOU into a motivating "jar." The design must keep goals clearly DISTINCT from buckets: buckets = spend-within, goals = save-toward.

## Design (v1 boundaries — decided; spike refines, doesn't reopen)

- **Entity**: `SavingsGoal { id, name, targetAmount, savedAmount, dueDate?, ownerId? (member — enables kid jars), color?, createdAt, completedAt? }` in `households/{hid}/savingsGoals` subcollection. Amounts are decimal dollars (repo storage convention); math in cents via `utils/money.ts`.
- **Contributions v1 = manual only**: a "Add to goal" action writes `savedAmount += x` (single doc update; a contributions LEDGER subcollection is v2 — record the tradeoff). **No account linkage, no automatic transfers, no transaction coupling** in v1 — the goal is a tracked intention, deliberately decoupled from balances so it cannot corrupt Safe-to-Spend.
- **Hard invariant**: `utils/safeToSpendCalculator.ts` is untouched; nothing about goals feeds the StS formula.
- **Kid jars**: a goal with `ownerId` = a managed member renders on `components/kid/KidDashboard.tsx` as a progress jar over the allowance IOU. Kid Mode is dormant-behind-flag; the jar renders only inside the kid surface, so no flag work is needed.
- **Surface**: goals list + create/edit drawer on the Money page (spike decides which tab — likely Accounts, near the existing `monthlyGoal` affordance) using `ProgressBar`/`ProgressRing` from `components/ui` (both exist — UI-unification primitives).

## Current state (verified 2026-07-09)

- `Account.monthlyGoal` + `setAccountGoal` (`components/budget/BudgetAccounts.tsx:113`) — the adjacent existing affordance; do not remove it in this plan (note overlap for a later decision).
- `allowanceCents` (`types/schema.ts:87`) — kid IOU, explicitly "NOT an in-app payout."
- Converter/mutation/listener conventions as in CLAUDE.md: typed converter in `utils/firestoreConverters.ts` (+ tests), mutation factory in `contexts/household/mutations/`, listener factory in `contexts/household/listeners/` — a NEW LISTENER needs a decision (see spike Q3) because this repo deliberately bounds listener count.
- Rules: no `savingsGoals` rules exist → default-deny; the rules PR (member read/write with field validation, amounts numeric ≥ 0) is separate and human-watched.
- `MockHouseholdContext` parity required.

## Steps

### Step A: Design spike (append "## Spike notes" here)

1. Draft the `firestore.rules` diff (style-matched to an existing subcollection block). Do not apply.
2. Which context slice hosts goals — finance (`useFinance`) or gamification? Recommend finance (money entity) and confirm where its listener attaches (`financeListeners.ts`), including whether a bounded `limit()` is warranted (goals are few; an unbounded listener on a ≤~20-doc collection is acceptable — record the reasoning against `plans/040`'s listener-bounding rationale).
3. Exact Money-page placement + one exemplar component to structurally copy (e.g., how `BudgetAccounts` sections its list).
4. Kid-jar rendering point in `KidDashboard.tsx` and how it reads the kid's `allowanceCents` today.
5. Confirm the goal↔bucket confusion risk: write one sentence of UI copy distinguishing them ("Buckets cap what you spend; goals track what you're saving toward") and where it appears (the create drawer).

**Verify**: Spike notes appended with file:line evidence + draft rules diff.

### Step B: Build (code only; rules PR separate, sequenced first)

1. Schema + `savingsGoalConverter` (+ tests: well-formed, partial doc, id injection/strip).
2. `savingsGoalMutations.ts`: add/update/delete/`contributeToGoal(id, amount)` (validates amount > 0; cents-safe addition; sets `completedAt` when `savedAmount >= targetAmount`). Mock parity.
3. Listener per spike Q2; expose on the chosen slice.
4. UI: goals section + create/edit drawer + contribute action; kid jar on KidDashboard for `ownerId` goals.
5. Tests: converter, mutation math (cents rounding), completion transition, component render.

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0; Test-Mode walkthrough (create goal → contribute → progress renders → complete state), dark + mobile per repo rule. Record the rules-PR-first sequencing as in Plan 23.

## Done criteria

- [ ] Spike notes + draft rules diff appended
- [ ] Entity/converter/mutations/listener/UI + tests green; Mock parity; kid jar renders in Test Mode's kid profile
- [ ] `grep -n "savingsGoal" utils/safeToSpendCalculator.ts` → no matches (the invariant)
- [ ] `advisor-plans/README.md` row updated

## STOP conditions

- Applying `firestore.rules` changes yourself — draft only.
- Any design pressure to debit an account or affect Safe-to-Spend on contribution — refuse; decoupling is load-bearing in v1.
- The finance slice's memoization structure makes adding a collection non-trivial (would re-render widely) — report with the memo boundary details.

## Maintenance notes

- v2 candidates: contributions ledger (who added what — the family-visibility feature), auto-contribution on paycheck approval, linking a goal to a savings account balance, retiring `Account.monthlyGoal` in favor of goals.
- Reviewer scrutiny: cents math on contributions; the completed-state transition; that no listener regression hits the finance slice's render count.
