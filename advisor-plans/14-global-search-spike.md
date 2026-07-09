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

- [ ] Spike notes appended to this file with evidence
- [ ] `pnpm lint`, `pnpm test`, `pnpm run build` all exit 0
- [ ] `utils/globalSearch.ts` + tests exist; overlay lazy-loaded (separate chunk)
- [ ] Manual Test-Mode walkthrough recorded
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The spike (Step 1) finds no reasonable deep-link target for a given entity type — report options rather than inventing new routes or params.
- Wiring the overlay requires adding slice consumption to `TopToolbar` itself (would re-couple the toolbar to heavy state) — report; the overlay must own the data.
- Bundle check shows Drawer/framer-motion entering the boot chunk — fix or report; never ship that regression.

## Maintenance notes

- The search corpus equals the live listener windows; when listener bounding (plans/040) or history windows change, search coverage changes with them — future "search all history" needs a server-side path, deliberately out of v1.
- New modules/entities must be added to `searchAll` and its visibility mapping — reviewer checklist item for future module PRs.
- UI PRs in this repo require a visual verification before merge (owner-established rule): dark mode + mobile viewport in Test Mode.
