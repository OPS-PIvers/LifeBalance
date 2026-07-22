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

Cached chromium build **1228** at `%LOCALAPPDATA%/ms-playwright`; matches
`playwright@1.61.0` (repo pins `@playwright/test ^1.61.0`). Installed
`playwright@1.61.0` into `.ds-sync/`.

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
- `cfg.dtsPropsFor` carries hand-written prop bodies for the 17 authored
  components (synth mode couldn't extract them). Keep in sync with source if the
  component APIs change.

## Re-sync risks

- **compiled.css is gitignored and regenerated** — if the recompile+sed step is
  skipped, previews render unstyled and fonts fall back. Always run it.
- Tailwind CLI auto-scans the whole repo for classes (superset) — deterministic
  for a fixed source tree; a big refactor changes which utilities ship.
- `guidelinesGlob` defaulted to `docs/*.md` and pulled 8 files (product roadmap,
  runbooks) into `guidelines/` — not strictly "design" guidelines. Narrow
  `cfg.guidelinesGlob` if that noise matters.
