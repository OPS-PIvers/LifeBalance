# Plan 27: Extract the To-Dos matrix/grid views (move-only, owner-decided 2026-07-09)

> **Executor instructions**: This is a MOVE-ONLY refactor — zero behavior change,
> zero markup/class changes, zero renames beyond what extraction requires. Follow
> step by step; run every verification; honor STOP conditions. Update the status
> row in `advisor-plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat fce26e4..HEAD -- pages/ToDosPage.tsx utils/eisenhower.ts`
> On mismatch with "Current state", STOP. (If Plan 26 landed first, only its
> route-level changes should appear — the page internals must still match.)

## Status

- **Priority**: P3
- **Effort**: M (mechanical but large)
- **Risk**: LOW-MED — pure decomposition; the risk is accidental behavior drift, controlled by the move-only rule + tests
- **Depends on**: sequence with Plan 26 (either order, never simultaneous)
- **Category**: tech-debt
- **Planned at**: commit `fce26e4`, 2026-07-09

## Owner decision (recorded)

Keep ALL THREE view arrangements exactly as shipped (list, Eisenhower matrix, landscape 2×2 grid — PRs #839-#841). The change is purely structural: extract the matrix/grid rendering out of `pages/ToDosPage.tsx` (2,038 lines — the largest page in the repo) into components, so the page stops being a maintenance hazard. **Zero behavior change.**

## Current state (verified 2026-07-09)

- `pages/ToDosPage.tsx` — 2,038 lines. Landmarks:
  - `:39` `type Arrangement = 'list' | 'matrix' | 'grid';` with a cycle map at `:47-48`
  - `:431` `effectiveArrangement` derivation (selection-mode forces grid→matrix); `:434` landscape gate (`viewMode === 'active' && effectiveArrangement === 'grid' && isLandscape`)
  - `:891` the `effectiveArrangement === 'matrix'` render branch; the grid branch and the immersive landscape mode are nearby (map the exact block boundaries in Step 1)
  - `:947` an empty-state branch conditioned on `!== 'grid'`
- `utils/eisenhower.ts` — the quadrant engine, already separate; unchanged.
- Precedent for this exact operation: the Plan-08 context decomposition (CLAUDE.md: "a pure file decomposition… not a behavior change: dependency arrays, memo boundaries, and batch compositions are unchanged"). Match that discipline.
- Component home: create `components/todos/` (none exists; matches the per-domain layout in CLAUDE.md's component tree).
- Tests: check for `pages/ToDosPage.test.tsx` and any todos component tests — they must pass UNCHANGED (a move-only refactor that requires editing test expectations has drifted).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | pass, unchanged expectations |
| Build | `pnpm run build` | exit 0 |
| Size check | `wc -l pages/ToDosPage.tsx` | ≤ ~1,200 after extraction |

## Scope

**In scope**: `pages/ToDosPage.tsx`, new files under `components/todos/` (e.g. `EisenhowerMatrixView.tsx`, `EisenhowerGridView.tsx`, plus any shared row/quadrant subcomponents the extraction naturally carries), `advisor-plans/README.md`.

**Out of scope**:
- ANY behavior, styling, copy, or a11y change — including "improvements" you notice along the way (file them as review comments in the PR description instead).
- `utils/eisenhower.ts`, `pages/ListsPage.tsx`, routing (Plan 26's territory).
- The list arrangement (it can stay in the page if extraction doesn't fall out naturally).
- State ownership: arrangement/selection/orientation state STAYS in ToDosPage; the extracted views are presentational components receiving props.

## Steps

### Step 1: Map the blocks

Read `pages/ToDosPage.tsx` fully. Produce (in the PR description or a scratch note) the exact line ranges of: the matrix render branch, the grid/landscape render branch, any helper components/functions defined in-file that ONLY those branches use, and the full list of identifiers each branch closes over (these become the props interfaces).

**Verify**: the map exists and each branch's closed-over identifier list is written down.

### Step 2: Extract, one view per commit

For each of matrix then grid: create the component in `components/todos/` with an explicit typed props interface (the identifier list from Step 1 — no context reads inside the extracted components unless the code already read context inside that block; if it did, keep it identical). Move the JSX + branch-local helpers verbatim. Replace the in-page block with the component invocation. One commit per view.

**Verify** (after each): `pnpm lint && pnpm test` → exit 0 with UNCHANGED test expectations.

### Step 3: Gates + walkthrough

`wc -l pages/ToDosPage.tsx` ≤ ~1,200. Test-Mode walkthrough: cycle list → matrix → grid; rotate to landscape for the immersive grid; toggle selection mode in grid (must force matrix, per `:431`); complete a todo from each view; verify empty states. Dark + mobile. This is a UI-adjacent PR — the repo rule (visual verification before merge) applies even though nothing should look different: compare each view against `main` side-by-side.

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0; walkthrough + visual comparison recorded in the PR description.

## Done criteria

- [ ] Matrix + grid views live in `components/todos/`; ToDosPage ≤ ~1,200 lines
- [ ] Zero test-expectation changes; all gates green
- [ ] Walkthrough confirms identical behavior in all three arrangements + landscape + selection mode
- [ ] `advisor-plans/README.md` row updated

## STOP conditions

- Extraction requires changing any dependency array, memo boundary, or state ownership — stop and report (that's no longer move-only).
- A test fails and the fix would change its expectation — stop; the refactor has drifted.
- The branches share mutable in-render state in a way that props can't carry without restructuring — report the entanglement (the Plan-08 precedent deliberately LEFT entangled closures in place; the same judgment applies here).

## Maintenance notes

- Follow-up candidates surfaced by the audit but NOT owner-approved: none — the owner explicitly chose keep-all-three. If a future audit revisits the landscape grid, this extraction makes removal a file-delete instead of surgery.
- Reviewer scrutiny: props interfaces should be boring mirrors of the closed-over identifiers — any "cleanup" in them is drift.
