# Plan 18: PWA manifest `shortcuts` — long-press quick actions

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. When done, update this plan's status row in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fce26e4..HEAD -- public/manifest.json App.tsx`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2 (Phase 5, cheapest retention win)
- **Effort**: S (hours)
- **Risk**: LOW — pure manifest config; navigation-only v1
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The installed PWA offers no long-press quick actions: `public/manifest.json` (24 lines) has `name/short_name/description/start_url/display/colors/orientation/icons` and **no `shortcuts` array**. Adding OS-level shortcuts (Android/desktop long-press → "Shopping list", "To-dos", "Habits", "Money") removes 2–3 taps from the highest-frequency actions — free re-engagement with zero new code paths, because the targets are existing routes.

**Scoping decision (made — don't expand):** v1 is **navigation-only**. A "quick add expense" shortcut would need a new `?capture=` param consumer (the pattern exists in `utils/recapParam.ts` but wiring CaptureModal open-on-boot is real work); that is explicitly deferred.

## Current state (verified 2026-07-09)

- `public/manifest.json` — full current content is the 24-line object described above; no `shortcuts` key.
- Routing is **HashRouter** (`App.tsx`), so in-app locations live in the hash: the shortcut `url` values must be `/#/todos`, `/#/shopping`, `/#/habits`, `/#/budget`. All four are real routes today; note that Plan 26 (owner-approved) converts `/todos` and `/shopping` into redirects that land on the correct `/lists` tab — the URLs stay valid either way, so this plan needs no coordination beyond knowing the redirect is intentional.
- `pages/ListsPage.tsx` has NO `?tab=` query support (verified) — do not invent tab params; use the standalone routes above.
- Icons: only `/icon-192.png` and `/icon-512.png` exist in `public/`. Manifest `shortcuts[].icons` are optional; per spec, when provided they should be ≥96px. Reuse `icon-192.png` for all four (acceptable v1) or omit icons entirely — either is fine; do NOT generate new art.
- The service worker (`public/sw.js`) serves hashed `/assets/` cache-first; `manifest.json` is not content-hashed — check how it's cached (if the SW caches it, note that installed clients pick the change up on SW update cycle; no `CACHE_VERSION` bump is needed unless the caching strategy itself changes, per CLAUDE.md).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm run build` | exit 0; `dist/manifest.json` contains `shortcuts` |
| JSON sanity | `node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8')); console.log('ok')"` | prints `ok` |

## Scope

**In scope**: `public/manifest.json`, `advisor-plans/README.md`.

**Out of scope**: `App.tsx`/router (no new params), `public/sw.js`, any capture/quick-add mechanism, icon assets.

## Git workflow

- Branch: `advisor/18-pwa-shortcuts`
- e.g. `feat(pwa): manifest shortcuts for shopping/todos/habits/money`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the `shortcuts` array

Append to `public/manifest.json` (keys per the W3C manifest spec):

```json
  "shortcuts": [
    { "name": "Shopping list", "short_name": "Shopping", "url": "/#/shopping",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }] },
    { "name": "To-dos", "short_name": "To-dos", "url": "/#/todos",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }] },
    { "name": "Log a habit", "short_name": "Habits", "url": "/#/habits",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }] },
    { "name": "Money", "short_name": "Money", "url": "/#/budget",
      "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }] }
  ]
```

**Verify**: the JSON-sanity command → `ok`; `pnpm run build` → exit 0 and `grep -c "shortcuts" dist/manifest.json` ≥ 1.

### Step 2: Confirm route behavior

`pnpm dev`, open `http://localhost:3000/#/shopping` (Test Mode if needed) — lands on the Shopping page; with the module hypothetically disabled it would redirect to `/` (read `components/auth/ModuleRoute.tsx` to confirm the redirect target — do not test-toggle prod flags).

**Verify**: all four URLs render their page in the dev browser.

## Done criteria

- [ ] `dist/manifest.json` includes 4 shortcuts with hash URLs
- [ ] `pnpm lint` + `pnpm run build` exit 0
- [ ] `advisor-plans/README.md` row updated, with a user-facing note: existing installs surface shortcuts only after the PWA updates (or reinstall); iOS home-screen PWAs ignore manifest shortcuts entirely (Android/desktop feature) — set expectations in the PR description.

## STOP conditions

- The hash-URL form (`/#/shopping`) fails the browser's within-scope check for shortcuts (some agents resolve `url` against scope) — if shortcuts don't register in a Chrome install test, report; the fallback (`/?goto=shopping` + a param consumer) is a scope expansion needing approval.

## Maintenance notes

- If capture deep-links are ever built (`?capture=expense` consumed like `utils/recapParam.ts`), add an "Add expense" shortcut then — highest-value slot.
- Keep shortcut count ≤4 (platforms truncate).
