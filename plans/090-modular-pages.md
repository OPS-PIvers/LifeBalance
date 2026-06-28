# Plan 090 — Modular pages: per-household page/tab on-off toggles

> **Status:** 📝 **PLAN WRITTEN — not started.** Design fully grilled & locked with the owner
> (via `/grill-me`, 8 decisions below). No code written yet. · **Tag:** `[C]` (pure client feature,
> **no `firestore.rules` change** — the household-doc update rule is field-permissive) · **Risk:** LOW
> (ships live, default **all-on** → zero behavior change for existing data; reversible) · **Effort:** M
> (splits into 4 small independent PRs; PR1 is the bulk of the value). · **Planned against:** branch
> `claude/practical-meitner-21686e`, main at `c096364`.
>
> **Resume instruction:** This doc is self-contained. To pick up after a compaction, read it top to
> bottom, then start **PR1** (§Phasing). Everything decided is in §Locked decisions; everything to
> touch is in §Blast-radius map with file:line anchors.

## The ask (owner, verbatim)

> "Can we explore what it would take to modularize the app so users could toggle on/off the different
> pages depending on their needs. Like they could toggle off the plans page entirely and it wouldn't
> appear in the footer or I could toggle off the meal plan and then that tab won't appear in the plans
> page at all."

Two levels of granularity, both required: **top-level footer pages** AND **sub-tabs inside the Plan page**.

## Current structure (as explored)

- **Footer** ([components/layout/BottomNav.tsx](../components/layout/BottomNav.tsx)) = a **hard-coded**
  4-slot layout split into two fixed groups: left `Home (/)` + `Habits (/habits)`, center FAB
  (capture), right `Money (/budget)` + `Plan (/lists)`. FAB is absolutely positioned at center.
- **"Plan" page** = [pages/ListsPage.tsx](../pages/ListsPage.tsx) — 3 hard-coded tabs: **To-Dos**,
  **Meals**, **Shopping**. Remembers last tab in `localStorage['lists-active-tab']`.
- **Standalone routes** `/meals` `/shopping` `/todos` ALSO exist in [App.tsx](../App.tsx) (deep-link
  targets; the bloat audit `audit/07` flags them as orphan routes). The footer only links to `/lists`.
- **Settings** is reached via the TopToolbar profile menu, **not** the footer.
- **Existing flag infra is operator-global, NOT this:** `app_config/global` flags
  (`plaidEnabled`, `kidModeEnabled`, `billingEnabled`, `openSignup`) flipped via the hidden
  **Developer Console** ([services/appConfig.ts](../services/appConfig.ts), admin-only). That pattern is
  the wrong tool here — this is a **user-facing per-household** preference.
- **Household settings** live as **top-level fields on the Household doc** (no nested `settings`
  object) — [types/schema.ts:398](../types/schema.ts) `interface Household`.
- **A `Switch` primitive already exists**: [components/ui/Switch.tsx](../components/ui/Switch.tsx)
  (the Developer Console's flag toggles use it).

## Locked decisions (8 — grilled with the owner)

| # | Branch | Decision |
|---|--------|----------|
| 1 | **Scope** | **Per-household (shared).** One config on the `Household` doc, read through the existing household context. Both members see the same nav. (Not per-member, not per-device.) |
| 2 | **Toggleable set** | **All but Home.** Toggleable: `Habits`, `Money`, `Plan` (footer) + `To-Dos`, `Meals`, `Shopping` (Plan sub-tabs). **Locked ON:** Home (dashboard + default landing + catch-all target), Settings (toolbar), the capture FAB. |
| 3 | **Route behavior** | **Hide nav + guard routes.** A disabled page's route redirects to Home (handles deep links / bookmarks / stale PWA shortcuts / the standalone `/meals` `/shopping` `/todos`). Plan page falls back to first enabled tab if the remembered one is off. |
| 4 | **Cascade depth** | **Full cascade** — off disappears everywhere: nav, routes, **capture tabs, dashboard, toolbar.** |
| 5 | **Mixed widgets** | **Degrade gracefully** — a mixed-domain widget drops only the disabled domain's content and keeps the rest; hides entirely only when everything it'd show is gone. |
| 6 | **Plan ↔ sub-tabs** | **Master toggle + per-tab.** A dedicated `Plan` toggle (1 tap kills the whole page) PLUS independent To-Dos/Meals/Shopping toggles. Turning Plan back on restores prior tab choices. |
| 7 | **Footer layout** | **Balanced split, FAB stays centered.** Filtered enabled items split into left/right groups around the FAB, balancing counts (4→2\|2, 3→2\|1, 2→1\|1, 1→Home\|∅). Home anchors the left. |
| 8 | **Toggle UI** | **New "App Modules" collapsible section in the normal Settings page; any household member can edit** (like the currency picker). Ships **live**, default **all-on**. |

### Additional decisions folded in (stated, owner did not object)
- **Ships live, no global dormancy flag** (unlike Plaid/Kid Mode) — it's self-contained, no secrets/cost,
  and all-on default = zero change. No `app_config` flag needed.
- **Default = all-on, fail-open to enabled** — absent field/key ⇒ module enabled. Backward-compatible
  with every legacy household; no migration.
- **Edge — FAB with zero enabled capture tabs:** hide the FAB (only happens if Money + To-Dos + Shopping
  are ALL off — extreme). Default the capture modal's active tab to the first enabled tab.

## Data model

One new optional field on the `Household` doc. **No `firestore.rules` change** — the household update
rule ([firestore.rules:111](../firestore.rules)) validates only specific fields and blocks immutable/
sensitive ones (`subscription`, `memberUids`, `createdBy`, …); an arbitrary new field passes via merge.

```ts
// types/schema.ts — add to interface Household (near currency?, kidModePinHash?, etc.)
moduleVisibility?: Partial<Record<ModuleKey, boolean>>;

// new exported type (types/schema.ts)
export type ModuleKey = 'habits' | 'money' | 'plan' | 'todos' | 'meals' | 'shopping';
```

**Single source of truth helper** (fail-open to enabled):

```ts
// utils/moduleVisibility.ts  (new, unit-tested)
import type { Household, ModuleKey } from '@/types/schema';

export const isModuleEnabled = (
  settings: Pick<Household, 'moduleVisibility'> | null | undefined,
  key: ModuleKey,
): boolean => settings?.moduleVisibility?.[key] !== false;

// Derived visibility (the rules layered on top of raw flags):
export const isPlanVisible = (s) =>
  isModuleEnabled(s, 'plan') &&
  (isModuleEnabled(s, 'todos') || isModuleEnabled(s, 'meals') || isModuleEnabled(s, 'shopping'));

export const isPlanTabVisible = (s, tab: 'todos' | 'meals' | 'shopping') =>
  isModuleEnabled(s, 'plan') && isModuleEnabled(s, tab);
```

**React access:** a `useModuleVisibility()` hook reading the already-live `householdSettings` from
`useHouseholdCore()` (so toggles propagate in real time via the existing `onSnapshot` — no polling, no
cache like the `app_config` getters). Plus a `setModuleVisibility(key, value)` context method that does
a merge-write to the household doc (mirror `setHouseholdCurrency` in
[contexts/FirebaseHouseholdContext.tsx](../contexts/FirebaseHouseholdContext.tsx)).

### Derived visibility rules (apply everywhere)
- **Money / Habits footer + route** = `isModuleEnabled('money' | 'habits')`
- **Plan footer + `/lists` route** = `isPlanVisible(s)`
- **Each Plan tab + standalone `/todos` `/meals` `/shopping` route** = `isPlanTabVisible(s, tab)`

## Blast-radius map (full cascade — every surface to touch)

| Surface | File (anchor) | Change |
|---|---|---|
| **Footer** | [BottomNav.tsx](../components/layout/BottomNav.tsx) | Replace the hard-coded 2/2 split with a filtered item list → **balanced split around the centered FAB** (decision 7). Items: Home (always) + Habits + Money + Plan, filtered by visibility. |
| **Route guards** | [App.tsx](../App.tsx) (routes ~169–228) | Wrap `/budget` `/habits` `/lists` `/meals` `/shopping` `/todos` in a new `<ModuleRoute module=...>` (inside `ProtectedRoute`+`MainLayout`) that redirects to `/` when the module/tab is disabled. Routes live **inside** the household provider, so the guard can read context. |
| **Plan tabs** | [ListsPage.tsx](../pages/ListsPage.tsx) | Build the tab list from enabled sub-tabs; if `localStorage['lists-active-tab']` points at a disabled tab, fall back to the first enabled one. Hide the tab strip if only 1 tab remains (optional polish). |
| **Capture FAB** | [CaptureModal.tsx](../components/modals/CaptureModal.tsx) (tabs `tabOptions` ~540, `activeTab` state ~63) | Show only enabled tabs: **Expense→money, To-Do→todos, Shop→shopping** (Meals has no capture tab). Default `activeTab` = first enabled. Hide the FAB in [BottomNav.tsx](../components/layout/BottomNav.tsx) if **zero** capture tabs enabled. |
| **Toolbar** | [TopToolbar.tsx](../components/layout/TopToolbar.tsx) | Left **Safe-to-Spend** button (→/budget) hidden if `money` off; right **points cluster + Rewards** (→/habits) hidden if `habits` off. Both off ⇒ just Feedback + Profile. |
| **Dashboard — pure** | [Dashboard.tsx](../pages/Dashboard.tsx) | Hide `SafeToSpendHero` + the header `BarChart2` trends button (money off); hide `DailyHabitsWidget` (habits off). |
| **Dashboard — mixed** | [PulseStripWidget.tsx](../components/dashboard/PulseStripWidget.tsx) | 3 cells: **Spent**=money, **Points**+**Consistency**=habits. Render only enabled cells (dynamic `grid-cols-N`, fix the `divide-x`), `return null` if both domains off. Currently `grid-cols-3 divide-x` (~line 125). |
| **Dashboard — mixed** | [useActionQueue.ts](../hooks/useActionQueue.ts) | Filter the combined queue: drop `calendar` (bills) + `transaction` items if `money` off; drop `todo` items if `todos` off. The hook already builds `dueCalendarItems` / `pendingTx` / `immediateToDos` separately (~lines 58–88) — gate each by visibility. |
| **Dashboard — best-effort** | `InsightWidget`, `ActivityFeedWidget` | Filter content referencing a disabled module; hide if empty. Lowest priority (can be PR4 / v1.1). |
| **Settings UI** | [Settings.tsx](../pages/Settings.tsx) | New `App Modules` `CollapsibleCard` (id `'modules'`) of [Switch](../components/ui/Switch.tsx) rows — Habits, Money, Plan, with To-Dos/Meals/Shopping **indented** under Plan. Wire to `setModuleVisibility`. Any member can edit. |

## Edge cases (all handled by the rules above)
- **Only Home left** (Habits+Money+Plan all off): footer = Home + FAB. Harmless, bare but valid.
- **All capture tabs off** (money+todos+shopping off): hide the FAB entirely.
- **Plan ON but all 3 sub-tabs OFF**: `isPlanVisible` is false ⇒ Plan footer + `/lists` auto-hide.
- **Deep link to a disabled page**: `<ModuleRoute>` redirects to `/`; catch-all (`*→/`) already covers
  unknown routes.
- **Remembered Plan tab disabled**: ListsPage falls back to first enabled tab.

## Testing (project convention: heavy on utils/*)
- `utils/moduleVisibility.test.ts` — `isModuleEnabled` fail-open, `isPlanVisible` / `isPlanTabVisible`
  truth tables (absent field, partial map, all-off, plan-on-tabs-off, etc.).
- Component tests: BottomNav renders only enabled items + balanced split; `<ModuleRoute>` redirects when
  disabled; ListsPage tab fallback.
- `MockHouseholdContext` mirrors the new field/method for Test Mode (default all-on).

## Phasing — 4 small PRs (each ships independently; all-on default keeps everything working)

1. **PR1 — Core (the headline feature, ~half the work, low-risk):** schema field + `ModuleKey` +
   `utils/moduleVisibility.ts` (+test) + `useModuleVisibility()` + `setModuleVisibility` context method
   (+ MockHouseholdContext) + **Settings "App Modules" UI** + **dynamic footer** + **route guards** +
   **Plan-tab fallback**. ⟵ *This alone delivers both owner examples ("kill Plan", "kill Meals tab").*
2. **PR2 — Capture cascade:** FAB tabs + default-active-tab + hide-FAB-when-empty.
3. **PR3 — Dashboard/Toolbar pure cascade:** SafeToSpendHero, header chart, DailyHabitsWidget, toolbar
   STS + points cluster.
4. **PR4 — Graceful degradation (the fiddly 20%):** PulseStrip dynamic cells + `useActionQueue`
   filtering + Insight/Activity content filtering.

## Execution conventions (standing, from this repo + owner)
- **Ship via PR → merge to `main` → CI auto-deploys** (no personal login). Owner has standing
  authorization to merge → live-test ("push to main and I'll live test it. No one else uses the app").
- **`main` is protected:** required `validate` CI check + `enforce_admins`; no direct pushes. Every PR
  must be CI-green.
- **Before each PR:** `git reset --mixed origin/main` (squash-merge rewrites history, so the working
  branch diverges after each merge — reset keeps the working tree, drops the stale commits).
- **Windows quoting:** use `git commit -F <file>` and `gh pr create --body-file <file>` — never inline
  `-m`/`--body` (PowerShell 5.1 mangles embedded quotes).
- **Fetch the gemini-code-assist[bot] review before merging** (CI-green ≠ reviewed) — `gh` + `jq`.
- **Do NOT stage `.claude/launch.json`** (untracked; leave it).
- **No lint/type suppressions** (CLAUDE.md zero-tolerance). `pnpm lint` (tsc+eslint) + `pnpm test` must
  pass; pre-commit lint-staged runs eslint --fix + tsc.
- **Test Mode** walkthrough available at `/#/login?test=true` (needs `VITE_ENABLE_TEST_MODE=true`).
- **No superpowers skills** (owner: "Disable superpowers skills… if anything use /grill-me"). Ultracode
  is ON → use the Workflow tool for big fan-out work.

## Index wiring (do when picked up)
Add a row to [plans/README.md](./README.md) status table:
`| 090 | Modular pages — per-household page/tab on-off toggles | — (new UX track) | C | LOW | 📝 PLAN WRITTEN ([090](./090-modular-pages.md)) — 4 PRs; no rules change; ships live default-on |`
