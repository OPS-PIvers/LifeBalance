# Plan 26: Routing consolidation — `/lists` wins (owner-decided 2026-07-09)

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. Update the status row in `advisor-plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- App.tsx pages/ListsPage.tsx pages/MealsPage.tsx pages/ShoppingPage.tsx components/layout/BottomNav.tsx`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW-MED — route changes; mitigated by redirects (old URLs keep working)
- **Depends on**: none. Coordinates with Plan 18 (manifest shortcuts): its `/#/todos` and `/#/shopping` URLs remain valid as redirects — no change needed there.
- **Category**: tech-debt / IA
- **Planned at**: commit `fce26e4`, 2026-07-09

## Owner decision (recorded)

The `/lists` ("Plan") tab-container is the single home for To-Dos / Meals / Shopping. The standalone `/todos`, `/meals`, `/shopping` routes become **redirects into the right `/lists` tab**; `MealsPage`'s duplicate embedded Shopping tab goes away. BottomNav already points at `/lists` only, so no nav change.

## Why this matters

`ShoppingListTab` is currently reachable from three URLs (`/lists` shopping tab, `/meals`' second tab, `/shopping`), and `ToDosPage` renders inside two hosts. Triple deep-link/scroll/state surface and confusing IA for zero benefit — BottomNav's "Plan" item (`components/layout/BottomNav.tsx:61`, `to: '/lists'`) is the only navigation entry point; the standalone routes are legacy/deep-link paths.

## Current state (verified 2026-07-09)

- `pages/ListsPage.tsx` (107 lines) — 3-tab container. Tab selection is INTERNAL state seeded from localStorage key `'lists-active-tab'` (`:33-45`, values `'todos'|'meals'|'shopping'`), with module-visibility fallback (`activeTab` derivation `:49-51`). **There is no `?tab=` query param** — the redirect mechanism below leans on the localStorage seed instead of inventing param plumbing.
- `pages/MealsPage.tsx` (46 lines) — its own 2-tab container: `MealPlanTab` + `ShoppingListTab` (the duplicate).
- `pages/ShoppingPage.tsx` — thin wrapper around `ShoppingListTab`.
- `pages/ToDosPage.tsx` — the todos content component; ALSO rendered directly by ListsPage (`:88`). It stays; only its standalone ROUTE changes.
- `App.tsx` — lazy imports (`:22-28` region) + `ModuleRoute`-wrapped routes for `/lists`, `/meals`, `/shopping`, `/todos` (locate the route blocks; `/migrate-submissions` handling is Plan 13, don't collide).
- `components/auth/ModuleRoute.tsx` — redirects disabled modules to `/`. ListsPage itself falls back to the first enabled tab when a preference is disabled, so a redirect into a disabled tab degrades gracefully.
- Docs to update: `CLAUDE.md` routing section (`:133`) and the `pages/` tree (`:230` region) list all the standalone pages.
- E2E: `e2e/` specs may navigate by URL — sweep them (Step 3).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | pass |
| Build | `pnpm run build` | exit 0 |
| Route sweep | `grep -rn "'/meals'\|'/shopping'\|'/todos'" --include="*.ts*" . \| grep -v node_modules \| grep -v advisor-plans` | only App.tsx redirects + sw/manifest/e2e hits you've reviewed |

## Scope

**In scope**: `App.tsx`, new tiny `components/auth/PlanTabRedirect.tsx`, delete `pages/MealsPage.tsx` + `pages/ShoppingPage.tsx`, `CLAUDE.md` (routing + tree), `e2e/` specs that hard-code the old routes, `advisor-plans/README.md`.

**Out of scope**:
- `pages/ToDosPage.tsx` and `pages/ListsPage.tsx` internals (Plan 27 handles ToDosPage extraction; don't collide — sequence 26 before or after 27, not simultaneously).
- `MealPlanTab`/`ShoppingListTab` components — unchanged.
- BottomNav, moduleVisibility logic — already correct.
- `public/manifest.json` (Plan 18's URLs stay valid via the redirects).

## Steps

### Step 1: `PlanTabRedirect`

Create `components/auth/PlanTabRedirect.tsx`:

```tsx
// Redirects a legacy standalone route (/todos, /meals, /shopping) into the
// corresponding /lists tab by seeding ListsPage's localStorage preference
// ('lists-active-tab') before navigating. ListsPage's module-visibility
// fallback handles a disabled tab gracefully.
const PlanTabRedirect: React.FC<{ tab: 'todos' | 'meals' | 'shopping' }> = ({ tab }) => {
  try { window.localStorage.setItem('lists-active-tab', tab); } catch { /* best-effort */ }
  return <Navigate to="/lists" replace />;
};
```

(Match repo import style: `@/` alias, `Navigate` from react-router-dom.)

**Verify**: `pnpm lint` → exit 0.

### Step 2: Rewire routes, delete wrappers

In `App.tsx`: replace the `/todos`, `/meals`, `/shopping` route elements with `<ProtectedRoute><PlanTabRedirect tab="…" /></ProtectedRoute>` (drop their `ModuleRoute` wrappers — `/lists`' own gating takes over), remove the now-unused lazy imports of `MealsPage`/`ShoppingPage`, and delete both wrapper files. `/lists` route unchanged.

**Verify**: `pnpm lint && pnpm test` → exit 0 (fix any `App.test.tsx` route assertions to expect the redirect).

### Step 3: Sweep references + docs

Run the route sweep; update `e2e/` specs that visit `/meals`/`/shopping`/`/todos` to either follow the redirect (assert landing on `/lists`) or navigate to `/lists` directly. Update `CLAUDE.md:133` (routes list) and the `pages/` tree (remove MealsPage/ShoppingPage lines, note ToDosPage renders via `/lists`).

**Verify**: sweep grep clean per the expectation; `pnpm lint && pnpm test && pnpm run build` → exit 0.

### Step 4: Test-Mode walkthrough

Visit `/#/shopping` → lands on Plan with the Shopping tab active; `/#/todos` → To-Dos tab; `/#/meals` → Meals tab; disable the Shopping module in Settings → `/#/shopping` lands on the first enabled tab without error. Dark + mobile check (repo rule).

**Verify**: walkthrough recorded in the PR description.

## Done criteria

- [ ] `pages/MealsPage.tsx` and `pages/ShoppingPage.tsx` deleted; ShoppingListTab reachable from exactly ONE place (`/lists`)
- [ ] Old URLs redirect with the correct tab active (walkthrough)
- [ ] All gates green; CLAUDE.md updated; `advisor-plans/README.md` row updated

## STOP conditions

- Anything in-app LINKS to `/meals` or `/shopping` expecting non-tab behavior (the sweep finds a real consumer beyond deep links) — report it.
- The e2e suite depends on MealsPage's two-tab structure in ways beyond URL navigation — report before restructuring specs.

## Maintenance notes

- The localStorage-seed redirect is deliberately mechanism-free; if deep-linking to a tab ever needs to be shareable-stateless (e.g., from a push), add a `?tab=` consumer to ListsPage THEN (mirroring `utils/recapParam.ts`) and route the redirects through it.
- Reviewer scrutiny: the ModuleRoute removal on redirect routes — confirm `/lists`' gating covers every case (all three modules disabled → ModuleRoute on /lists redirects home).
