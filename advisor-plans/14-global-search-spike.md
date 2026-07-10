# Plan 14: Global search — spike + bounded v1 (in-memory command palette)

> **Executor instructions**: This is a two-phase plan: a short design spike
> (Step 1) whose output gates the build (Steps 2+). Follow it step by step,
> run every verification command, honor the STOP conditions. When done,
> update this plan's status row in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- components/layout/TopToolbar.tsx components/ui/LazyMount.tsx utils/preloadOnIdle.ts contexts/household/types.ts`
> On mismatch with the "Current state" facts, STOP.

## Status

- **Priority**: P2
- **Effort**: M (coarse — direction feature; the spike bounds it)
- **Risk**: LOW (read-only over already-loaded state; main risk is boot-bundle regression)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

There is no search anywhere in the app: as a household accumulates months of transactions, recipes, habits, and to-dos, "where was that $40 charge / that taco recipe / that chore" has no answer except scrolling the right tab. The owner's roadmap (`docs/PRODUCT_ROADMAP.md`, Tier-1 table) lists global search as an "expected consumer baseline… currently absent entirely." The architecture makes a v1 disproportionately cheap: all four entity types are already held in memory by the domain-sliced contexts, so a client-side fuzzy-match overlay needs **no new data layer, listeners, or indexes**.

## Current state

- Domain slices (all exported from `contexts/FirebaseHouseholdContext.tsx`; value shapes in `contexts/household/types.ts`):
  - `useFinance()` → `transactions` (windowed listener — recent history only; that bound is the search corpus too, and that's acceptable for v1)
  - `useMealPlan()` → meals (recipes); `useShopping()` → shopping list + stores
  - `useGamification()` → `habits`; `useTodos()` → `todos`
  - `useHouseholdCore()` → `householdSettings` (needed for `moduleVisibility`)
- `utils/moduleVisibility.ts` — `isModuleEnabled(settings, key)`; search results for a disabled module must be excluded (its pages redirect to `/`).
- Boot-bundle rule (CLAUDE.md "Code-Splitting & Boot Bundle"): anything Drawer/framer-motion-based opened from the always-mounted chrome must be lazy — mount via `components/ui/LazyMount.tsx` on first open and warm with `utils/preloadOnIdle.ts`. `CaptureModal`/`FeedbackModal` in `components/layout/` are the exemplars; copy their wiring exactly.
- `components/layout/TopToolbar.tsx` — the always-mounted toolbar where the search entry point goes (an icon `Button size="icon"`; note repo memory: `size="icon"` is 36px). It has already been migrated to narrow slices — do NOT make it consume more slices; the overlay itself (lazy) consumes the slices instead.
- Filtering exemplar: `components/budget/TransactionMasterList.tsx` does client-side text filtering over transactions — match its case-insensitive matching approach rather than adding a fuzzy-search dependency (v1 = substring/token match; a fuzzy lib is an explicit non-goal).
- Routing is `HashRouter`; navigation targets: `/budget?tab=transactions` (Money), `/lists` sub-pages for todos/shopping, `/meals`, `/habits`. Check `App.tsx` and `pages/ListsPage.tsx` for the exact tab/param conventions before wiring deep links.
- Design system: DESIGN.md governs; reuse `Drawer`, `Input`/`fieldStyles`, `EmptyState`, `Section`/`Row` primitives from `components/ui/` — no hand-rolled surfaces.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm run build` | exit 0 |
| Dev (Test Mode) | `pnpm dev` then `http://localhost:3000/#/login?test=true` (requires `VITE_ENABLE_TEST_MODE=true` in `.env.local`) | app boots with mock data |

## Scope

**In scope**:
- `utils/globalSearch.ts` (create — pure matching/ranking) + `utils/globalSearch.test.ts`
- `components/search/SearchOverlay.tsx` (create — lazy Drawer UI)
- `components/layout/TopToolbar.tsx` (entry-point icon + LazyMount wiring only)
- `advisor-plans/README.md` (status row)
- The Step-1 spike note appended to THIS file

**Out of scope**:
- Any server-side/Firestore search, new listeners, or index changes.
- New dependencies (no fuse.js etc.) — v1 is substring/token matching.
- Searching settings, members, calendar items, or historical transactions beyond the existing listener window.
- Keyboard shortcut registration beyond a simple `Cmd/Ctrl+K` listener (mobile-first app; the toolbar icon is the primary entry).

## Git workflow

- Branch: `advisor/14-global-search`
- Conventional commits, e.g. `feat(search): global search overlay over in-memory slices`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Design spike (append the answers to this file under "## Spike notes" before writing code)

Resolve, by reading the code (not by guessing):

1. Exact deep-link target per entity type (route + query param/tab), verified against `App.tsx`, `pages/Budget.tsx`, `pages/ListsPage.tsx`. Does tapping a transaction result open the master list filtered, or a detail drawer? (Pick the cheapest that exists today — pre-filling the master list's search field via a URL param is acceptable ONLY if such a param already exists; otherwise navigate unfiltered and note the gap.)
2. The searchable text fields per entity (e.g. transaction `merchant`+`category`; meal `name`+`tags`; habit `title`; todo `title`) — confirm exact field names in `types/schema.ts`.
3. Result model: `{ type, id, title, subtitle, route }` — confirm nothing more is needed for v1.
4. Ranking: exact-prefix > word-boundary > substring; cap results per type (e.g. 5) and overall (e.g. 20).

**Verify**: the "Spike notes" section exists in this file with all four answers and `file:line` evidence.

### Step 2: Pure matcher

Implement `utils/globalSearch.ts`: `searchAll(corpus, query, visibility) → GlobalSearchResult[]` per the spike's model — pure, no React. Unit-test heavily (this is the repo's convention: business logic in `utils/` gets the coverage): empty query → [], case-insensitivity, ranking order, per-type caps, disabled-module exclusion.

**Verify**: `pnpm test -- globalSearch` → all pass.

### Step 3: Overlay UI

`components/search/SearchOverlay.tsx`: a `Drawer`-based surface with an autofocused `Input`, results grouped by type using `Section`/`Row` primitives, an `EmptyState` (compact, not hero-sized — the UX audit flagged oversized empty states) for no-matches, and `useNavigate` on select. Consume slices inside the overlay. Wire into `TopToolbar` behind `LazyMount` + `preloadOnIdle`, copying the `FeedbackModal` wiring verbatim.

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0. Then confirm the boot bundle didn't grow: the overlay chunk must be separate (check `dist/` output listing for a distinct chunk containing SearchOverlay).

### Step 4: Manual verification in Test Mode

Boot Test Mode, open search, verify: mock transactions/habits/todos/meals are findable; selecting navigates to the right page; a module disabled via Settings → App Modules disappears from results; dark mode renders correctly.

**Verify**: record the walkthrough result (pass/fail per check) in the PR description or status note.

## Test plan

- `utils/globalSearch.test.ts` as in Step 2 (≥8 cases).
- One component test for `SearchOverlay` (render with mock slice data via the Test-Mode mock provider pattern used by existing component tests — find an existing Drawer-component test to model after).

## Done criteria

- [x] Spike notes appended to this file with evidence
- [x] `pnpm lint`, `pnpm test`, `pnpm run build` all exit 0
- [x] `utils/globalSearch.ts` + tests exist; overlay lazy-loaded (separate chunk — verified `dist/assets/SearchOverlay-*.js` exists and is absent from `dist/index.html`'s modulepreload list)
- [ ] Manual Test-Mode walkthrough recorded — **not done by the executor**; operator instructions for this run explicitly skip manual/browser verification (the orchestrator does visual checks). See "What to check" note below.
- [ ] `advisor-plans/README.md` status row updated — **skipped per operator override** for this run.

**What to check in the orchestrator's visual pass:** open Test Mode, tap the new search icon in `TopToolbar` (top-right, before the Profile avatar) or press Cmd/Ctrl+K; type a query that matches a mock transaction/habit/meal/todo/shopping item; confirm results are grouped by type with the right icon/subtitle; select a result and confirm it navigates to the right page/tab (transactions → Money → Transactions tab, habits → Habits → Track tab, meals/todos/shopping → Lists on the matching sub-tab) — landing on the page unfiltered is expected (see Spike note 1, a known v1 gap), not a bug; disable a module in Settings → App Modules and confirm its results disappear; check dark mode and mobile viewport.

## STOP conditions

- The spike (Step 1) finds no reasonable deep-link target for a given entity type — report options rather than inventing new routes or params.
- Wiring the overlay requires adding slice consumption to `TopToolbar` itself (would re-couple the toolbar to heavy state) — report; the overlay must own the data.
- Bundle check shows Drawer/framer-motion entering the boot chunk — fix or report; never ship that regression.

## Spike notes

> Recorded by the executor agent, 2026-07-09. Main has moved since this plan
> was written (`fce26e4`) — plan 26 collapsed `/todos`, `/meals`, `/shopping`
> into tabs of `/lists`. Per the operator amendment, deep-links to those three
> entity types target `/lists` (seeding the `lists-active-tab` localStorage key
> the same way `PlanTabRedirect` does — `components/auth/PlanTabRedirect.tsx:11`)
> instead of the old standalone routes referenced in "Current state" above.

**1. Deep-link target per entity type.**

None of the four entity pages expose a URL param or `location.state` field
that pre-filters to a single record — confirmed by grep: no
`useSearchParams`/highlight-id/scroll-to-id handling in `pages/ToDosPage.tsx`,
`components/meals/MealPlanTab.tsx`, `components/meals/ShoppingListTab.tsx`, or
`pages/Habits.tsx`. So v1 navigates to the right **page/tab**, unfiltered —
selecting a result lands the user on the list that contains it, not a
pre-filtered/detail view. This is a real UX gap (noted in Maintenance notes
below as a v1.1 follow-up), not a blocker: it's the cheapest option that
exists today, matching the plan's own guidance ("navigate unfiltered and note
the gap").

- **Transaction** → `/budget` via `navigate('/budget', { state: { tab: 'transactions' } })`, the `useDeepLinkTab` convention (`hooks/useDeepLinkTab.ts`, consumed at `pages/Budget.tsx:69` with `MONEY_TABS` including `'transactions'` at `pages/Budget.tsx:20`). `TransactionMasterList`'s own text filter (`searchTerm` state, `components/budget/TransactionMasterList.tsx:50`) has no URL-param wiring, so the query is not pre-filled — gap noted.
- **Habit** → `/habits` via `navigate('/habits', { state: { tab: 'track' } })`, same `useDeepLinkTab` convention (`pages/Habits.tsx:35` `HABIT_TABS`, default `'track'`).
- **Todo** → `/lists`, seeding `localStorage.setItem('lists-active-tab', 'todos')` then `navigate('/lists')` — mirrors `PlanTabRedirect` (`components/auth/PlanTabRedirect.tsx`). `ListsPage` reads that key on mount (`pages/ListsPage.tsx:34`) and shows the To-Dos tab.
- **Meal** → `/lists` with `lists-active-tab = 'meals'`, same mechanism.
- **Shopping item** → `/lists` with `lists-active-tab = 'shopping'` — `ShoppingListTab` lives on its own *shopping* sub-tab of `/lists` (`VALID_TABS` in `pages/ListsPage.tsx:9` includes `'shopping'` alongside `'todos'`/`'meals'`).

**2. Searchable text fields per entity** (confirmed in `types/schema.ts`):

- `Transaction` (`types/schema.ts:154`): `merchant` (string, line 157), `category` (string, line 158).
- `Habit` (`types/schema.ts:242`): `title` (string, line 244).
- `Meal` (`types/schema.ts:426`): `name` (string, line 428), `tags` (string[], line 433).
- `ToDo` (`types/schema.ts:614`): `text` (string, line 616) — note the field is `text`, not `title`.
- `ShoppingItem` (`types/schema.ts:449`): `name` (string, line 451).

**3. Result model.** `{ type, id, title, subtitle, route, navState? }` is
sufficient for v1 — one extra field beyond the plan's proposal:
`navState: { path: string; tab?: string; listsTab?: 'todos' | 'meals' | 'shopping' }`
so the overlay can perform the exact navigation described in (1) without
re-deriving it from `type`. `subtitle` carries the secondary matched field
(category for transactions, tags joined for meals, "Due <date>" for todos,
etc.) so a bare title isn't the only context shown.

**4. Ranking.** Confirmed as specified — exact-prefix match on the primary
field ranks highest, then word-boundary (any token in the text starts with
the query), then plain substring. Cap 5 results per type, 20 overall, matching
`TransactionMasterList`'s case-insensitive `.toLowerCase().includes()` style
(`components/budget/TransactionMasterList.tsx:99`) rather than a fuzzy library.

**Decision: proceed to Step 2.** No entity lacks a reasonable deep-link
target (STOP condition 1 does not apply) — the gap is "page not filtered
record," which the plan already accepted as a valid v1 outcome.

## Maintenance notes

- The search corpus equals the live listener windows; when listener bounding (plans/040) or history windows change, search coverage changes with them — future "search all history" needs a server-side path, deliberately out of v1.
- v1.1 follow-up (not built here): none of the four target pages support pre-filtering to a single record via URL/state, so selecting a search result lands on the containing page/tab unfiltered rather than the specific item. Adding a `searchTerm` URL param to `TransactionMasterList` and a highlight/scroll-to-id param to `ToDosPage`/`MealPlanTab`/`ShoppingListTab`/`Habits` would close this gap.
- New modules/entities must be added to `searchAll` and its visibility mapping — reviewer checklist item for future module PRs.
- UI PRs in this repo require a visual verification before merge (owner-established rule): dark mode + mobile viewport in Test Mode.
