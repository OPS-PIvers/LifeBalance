# design-sync notes — LifeBalance

Repo-specific gotchas for future syncs. Read before re-running.

## Shape & setup

- **Package shape, synth-entry from source.** LifeBalance is a Vite *app*, not a
  component library — no library build emits `.d.ts` + an ES entry. The converter
  bundles from source via a barrel entry `.design-sync/ds-entry.tsx` (32 named
  re-exports of the scoped `components/ui` primitives). `--entry` points at that
  barrel; `PKG_DIR` walks up to the repo root (package.json name "lifebalance"),
  so `componentSrcMap`/`srcDir` paths are repo-root-relative.
- **Scope:** 32 visual primitives from `components/ui`. Excluded 7 behavioral/infra
  (LazyMount, HapticCheck, ToastLimiter, UndoToast, InstallPwaBanner,
  ConfirmDialogHost, toastIcon) + 3 pure `.ts` helpers.
- Build command: none (synth-entry). Run the two commands below.

## CSS — MUST recompile Tailwind each sync

`index.css` is Tailwind v4 *source* (`@import 'tailwindcss'` + `@theme` tokens),
NOT compiled utilities. Components use utility classes (`bg-accent-600`, …) that
only exist after Tailwind compiles. So before every build:

```
node .ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs -i ./index.css -o ./.design-sync/compiled.css --minify
sed -i 's#url(/fonts/#url(../public/fonts/#g' .design-sync/compiled.css
```

`cfg.cssEntry` points at `.design-sync/compiled.css` (gitignored, regenerated).
The **font url rewrite is required**: compiled CSS emits `url(/fonts/x.woff2)`
(absolute), but the fonts live in `public/fonts/`. `extractFonts` resolves
relative to `dirname(cssEntry)` = `.design-sync/`, so rewrite to
`../public/fonts/` (resolves to `<repo>/public/fonts`, inside PKG_DIR root).

## Playwright (render check)

The render check needs a chromium whose build matches the installed playwright.
Repo pins `@playwright/test ^1.61.0`, which pins chromium build **1228** — so
install `playwright@1.61.0` into `.ds-sync/`. Find the existing cache per-OS:
Windows `%LOCALAPPDATA%/ms-playwright`, macOS `~/Library/Caches/ms-playwright`,
Linux `~/.cache/ms-playwright` (a `chromium-1228` dir there is the match). If
nothing is cached, `npx playwright@1.61.0 install chromium`.

## Commands

```
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/ds-entry.tsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

## Render warns triaged

- 6 components render blank on the floor card because default props produce no
  visible output (Badge, Card, CollapsibleSection, EmptyState, ListRow,
  PageHeader) → resolved by authoring their previews.
- ProgressRing floor render is "thin" (small ring, no text) → authored.

## The barrel exports more than the 32 cards

`ds-entry.tsx` also exports composition parts and a provider. None are in
`componentSrcMap`, so none become cards — in synth-entry mode the card list is
`componentSrcMap` verbatim (`exportedNames` finds nothing without a `.d.ts`
tree), so adding barrel exports never creates cards.

- **Compound parts:** `SurfaceList`/`Row`/`DisclosureRow`/`Stat`/`StatGroup`
  (from `Section.tsx`), `SkeletonText`/`SkeletonCard`, `Tabs{List,Trigger,Content}`.
  Previews compose them; the conventions header documents them.
- **`AppProviders`** (defined in `ds-entry.tsx`): `MemoryRouter` + `ThemeProvider`.
  **Two components throw without it** — `SwipeActionRow` (`useTheme()`) and
  `SectionActionLink` (router `Link`). Their previews wrap in it, and because
  it's a real bundle export the design agent can too. Deliberately NOT
  `cfg.provider`: that field is grade-keyed, so setting it would wipe every
  grade on the next sync just to serve 2 of 32 components.

## Preview authoring gotchas

- **NEVER import `lucide-react` in a preview `.tsx`.** The preview compiler's
  story-imports policy plugin re-resolves every import async; lucide-react's
  huge barrel (thousands of internal modules) hangs/crashes the esbuild service
  (build never completes). Use small inline `<svg>` icon components instead —
  all authored previews do this.
- Previews import components from `'lifebalance'` (shimmed to `window.LifeBalance`).
  Tabs subcomponents (TabsList/TabsTrigger/TabsContent) are exported from the
  barrel `ds-entry.tsx` (bundled onto the global) but NOT in `componentSrcMap`,
  so they compose in previews without becoming their own cards.
- `cfg.overrides`: Drawer/Modal use `cardMode: single` (open overlay);
  CollapsibleSection/EmptyState/PageHeader/Tabs use `cardMode: column`
  (they render wider than a grid cell → GRID_OVERFLOW without it).
- `cfg.dtsPropsFor` carries hand-written prop bodies for **all 32** components.
  Synth mode extracts nothing (no `.d.ts` tree), so without an entry a component
  ships `[key: string]: unknown` — a useless contract for the design agent.
  **Any component added to `componentSrcMap` needs a `dtsPropsFor` entry too.**
  Keep them in sync with source when the component APIs change.
- **`cardMode: column` is needed at ~340px.** Any preview wrapper wider than
  ~330px trips `[GRID_OVERFLOW] wide`; 300px and under is fine in the default
  grid. Currently column: CollapsibleSection, EmptyState, PageHeader, Tabs,
  Section, SectionActionLink, SwipeActionRow, QuickAddBar, SectionHeading,
  ShowMoreRow. Single (overlay): Drawer, Modal, ConfirmDialog, Menu, Popover,
  TabSubViewMenu.
- **`TabSubViewMenu`: the `anchorRef` container must HUG the tab bar.** The menu
  renders at the container's bottom edge (`top-full`), so a wrapper padded out
  to give the popover visual room pushes the menu that far down the page
  instead. Give it `{position:'relative', width:N}` with no height and let
  `cfg.overrides.TabSubViewMenu.viewport` supply the room (380x230).
- **`Menu`/`Popover` previews** use `position="top-0 left-0"` inside a fixed-size
  relative box — those anchor to the container's TOP, so a tall box is correct
  there (the opposite of TabSubViewMenu).
- **`SubViewHint` latches itself into localStorage** the moment it dismisses, so
  its preview clears `lifebalance-subview-hint-seen` at module scope. Without
  that the card renders empty on any repeat page load in the same profile.
- **`SwipeActionRow` can only be previewed at rest.** The action rails exist
  only mid-drag or while stuck open — both gesture-driven, neither reachable in
  a static render. One export, documented in the preview's header comment. Not a
  defect; don't "fix" it on a later sync.

## Known render warns

None. As of the 2026-07-24 sync `.render-check.json` is fully clean: 32/32
render, 0 bad / thin / blank / variants-identical, 0 page errors, no
`[GRID_OVERFLOW]`, no `[FONT_MISSING]`, no `[DTS_PARSE]`. **Any warn line on a
future run is new** — look at it, then fix it or record it here.

## Re-sync risks

- **Grade wipe on 2026-07-24 (cause not pinned down).** The project's uploaded
  `_ds_sync.json` carried `sourceKeys` that no longer matched a recompute from
  the same committed config + same `KEY_RECIPE` (7) + same `scriptsSha`
  (verified byte-identical) — so the diff called all 32 components "changed" and
  capture cleared all 17 existing grades. Config slices recomputed identically
  old-vs-new, so it was NOT a config edit. If a future re-sync clears grades it
  didn't expect, this is a known failure mode: the honest fix is to re-grade
  from the fresh sheets (which is what happened), not to hand-edit keys.
- The 15 previews authored on 2026-07-24 encode component APIs (`MenuItem`
  shape, `SwipeAction` tones, `TabSubViewMenu` anchoring). If those components'
  props change, the previews compile but may render wrong — the render check
  won't catch a silently-ignored prop.

- **compiled.css is gitignored and regenerated** — if the recompile+sed step is
  skipped, previews render unstyled and fonts fall back. Always run it.
- Tailwind CLI auto-scans the whole repo for classes (superset) — deterministic
  for a fixed source tree; a big refactor changes which utilities ship.
- `guidelinesGlob` defaulted to `docs/*.md` and pulled 8 files (product roadmap,
  runbooks) into `guidelines/` — not strictly "design" guidelines. Narrow
  `cfg.guidelinesGlob` if that noise matters.
