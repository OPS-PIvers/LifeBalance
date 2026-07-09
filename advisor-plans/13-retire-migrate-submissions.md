# Plan 13: Retire the `/migrate-submissions` route and page

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> On any STOP condition, stop and report. When done, update this plan's
> status row in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- App.tsx pages/MigrateSubmissions.tsx CLAUDE.md`
> On mismatch with the "Current state" excerpts, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (deletion of a one-off tool; the CLI twin remains)
- **Depends on**: none
- **Category**: tech-debt / security-hygiene
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

`pages/MigrateSubmissions.tsx` is a one-off habit-submission backfill tool, yet it is still routed at `/migrate-submissions` behind only `ProtectedRoute` — meaning **any signed-in user** who discovers the URL can trigger bulk `HabitSubmission` writes against their household. The migration has an equivalent operator CLI (`pnpm migrate:submissions` → `scripts/migrateHabitSubmissions.ts`), so the page adds risk with no remaining purpose. It is also (per `docs/CODEBASE_IMPROVEMENTS.md`) the last page-level consumer of the deprecated `useHousehold()` context shim, so removing it clears real debt.

## Current state

- `App.tsx:25` — `const MigrateSubmissions = React.lazy(() => import('./pages/MigrateSubmissions'));`
- `App.tsx:260-267` — the route:

```tsx
                <Route
                  path="/migrate-submissions"
                  element={
                    <ProtectedRoute>
                      <MigrateSubmissions />
                    </ProtectedRoute>
                  }
                />
```

- `pages/MigrateSubmissions.tsx` — the page; line 4 imports `useHousehold` (the deprecated shim), line 64 destructures `{ habits, householdSettings, currentUser }`.
- `package.json:19` — `"migrate:submissions": "tsx --env-file=.env.local scripts/migrateHabitSubmissions.ts"` — the CLI twin that stays.
- Doc references to update: `CLAUDE.md:133` (routing list includes `/migrate-submissions`) and `CLAUDE.md:230` (`pages/` tree lists `MigrateSubmissions.tsx`). Check `README.md` / `AGENTS.md` too (grep below).
- Tests: `App.test.tsx` exists — check whether it references the route.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Reference sweep | `grep -rn "MigrateSubmissions\|migrate-submissions" --include="*.ts" --include="*.tsx" --include="*.md" . \| grep -v node_modules \| grep -v advisor-plans \| grep -v plans/` | only the locations named above (App.tsx, the page, CLAUDE.md; possibly tests) |
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**:
- `App.tsx` (remove lazy import + route)
- `pages/MigrateSubmissions.tsx` (delete)
- `CLAUDE.md` lines 133 and 230 (remove the two mentions)
- `App.test.tsx` (only if it references the route)
- `advisor-plans/README.md` (status row)

**Out of scope**:
- `scripts/migrateHabitSubmissions.ts` and the `migrate:submissions` npm script — the operator CLI stays.
- The `useHousehold()` shim itself in `contexts/FirebaseHouseholdContext.tsx` — other non-page consumers may remain; removing the shim is a separate decision. Do not touch it.
- Historical docs (`plans/`, `advisor-plans/`, `docs/CODEBASE_IMPROVEMENTS.md`) — they are records; leave their mentions.

## Git workflow

- Branch: `advisor/13-retire-migrate-submissions`
- Conventional commit, e.g. `chore(routes): remove one-off /migrate-submissions page (CLI twin remains)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove route + page

Delete the route block (`App.tsx:260-267`) and the lazy import (`App.tsx:25`), then delete `pages/MigrateSubmissions.tsx`. The existing catch-all `*` route already redirects unknown paths to `/`, so old bookmarks degrade gracefully — verify the catch-all is still last in the route list.

**Verify**: `pnpm lint` → exit 0 (unused-import rules will catch stragglers).

### Step 2: Update docs and tests

Remove `/migrate-submissions` from the routing list at `CLAUDE.md:133` and the `MigrateSubmissions.tsx` line from the tree at `CLAUDE.md:230`. Run the reference sweep command; fix any remaining app-code or doc hit outside the out-of-scope historical records.

**Verify**: the sweep grep returns hits only under `plans/`, `advisor-plans/`, `docs/CODEBASE_IMPROVEMENTS.md`, and `scripts/`/`package.json`.

### Step 3: Full gates

**Verify**: `pnpm lint && pnpm test && pnpm run build` → all exit 0.

## Done criteria

- [ ] `pages/MigrateSubmissions.tsx` no longer exists
- [ ] Reference sweep clean (Step 2 expectation)
- [ ] `pnpm lint`, `pnpm test`, `pnpm run build` all exit 0
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `App.test.tsx` (or any test) asserts the route exists in a way that suggests the page is still operationally needed — report before deleting.
- The reference sweep reveals a live consumer of the page (e.g. a link rendered somewhere in the app) — report it.

## Maintenance notes

- This removes the last *page* consumer of the deprecated `useHousehold()` shim. A follow-up may inventory remaining shim consumers (`grep -rn "useHousehold()" --include="*.tsx"`) and retire the shim — deliberately out of scope here.
- If the owner ever needs the backfill again, the CLI (`pnpm migrate:submissions`) is the supported path.
