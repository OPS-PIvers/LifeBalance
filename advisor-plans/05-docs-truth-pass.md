# Plan 05 — Docs Truth Pass

**Impact:** MED (every future agent session inherits these errors; CLAUDE.md is loaded
into *every* Claude session on this repo) · **Effort:** S (half a day) · **Risk:** LOW
(docs only) · **Confidence:** HIGH — each error below was verified against source on 2026-07-04.

## Why this matters more than usual

This repo is developed almost entirely by AI agents. CLAUDE.md is injected as ground truth
into every session; when it lies, agents make wrong decisions with high confidence (e.g.,
editing a `tailwind.config.js` that no longer exists, or "fixing" a package-lock that was
already removed). Doc rot here is not cosmetic — it is a defect injector.

## Verified errors to fix

### CLAUDE.md
1. **Tailwind section is wrong twice.** Claims "Config in tailwind.config.js; PostCSS
   pipeline in postcss.config.js" and a `tailwindcss-animate` plugin "registered in
   tailwind.config.js". Reality: Tailwind **v4.3.1** (`package.json`), no
   `tailwind.config.js` exists, tokens live in `index.css` under `@theme`, and DESIGN.md
   is the styling source of truth. Rewrite the Styling section to point at `index.css`
   `@theme` + DESIGN.md; verify whether `postcss.config.js` and the animate plugin still
   exist in the v4 setup and describe what's actually there.
2. **Stray `package-lock.json` warning is stale** — the file is gone. Keep the "pnpm only"
   rule, drop the claim.
3. **Custom fonts / theme colors** — claims Inter/JetBrains via Google Fonts and
   `brand-*`/`money-*`/`habit-*` colors. DESIGN.md describes a serif display voice, a
   warm-paper `brand-*` neutral ramp + evergreen/amber accents, and says Inter-everywhere
   is off-spec. Reconcile with `index.css` reality.
4. **Routes list is incomplete/stale** — verify against `App.tsx` (at minimum `/privacy`,
   `/terms`, onboarding, and Kid-Mode routing via `MainLayout.tsx:56-99` shell swap are
   missing; `moduleVisibility` now gates pages).
5. **Missing architecture entries** for systems added since mid-June that agents WILL
   touch: feature flags on `app_config/global` (`services/appConfig.ts` —
   openSignup/billingEnabled/kidModeEnabled/plaidEnabled/aiEnabled + defaults), the
   Gemini **server proxy** (client no longer holds an API key — the env-setup section
   still lists `VITE_GEMINI_API_KEY` as required!), Plaid module, Stripe (written,
   unexported), Kid Mode (flag-gated), entitlements (`utils/entitlements.ts`), the
   quickAdd/email capture pipeline (`functions/src/quickAdd/emailParser.ts`,
   `reconcile.ts`, `accountMatch.ts`), and `moduleVisibility`. One tight paragraph each —
   CLAUDE.md is already long; prefer pointers to deeper docs.
6. **Test Mode section** still describes 3-account/4-bucket mock data — spot-check against
   `contexts/MockHouseholdContext.tsx` and correct counts/claims.

### TODO.md (root)
Nearly every item is done (transaction master list, context split, virtualization, PWA
SW, data export, onboarding wizard) or superseded by `advisor-plans/`/`plans/`. Replace the
file body with a pointer: "Live backlog: `advisor-plans/README.md` (current), `plans/README.md`
(2026-06 pass, partly historical), `todo/README.md` (deferred ops items)." Delete the stale
items rather than curating them — two backlogs is one too many; three is worse.

### LINT_SUPPRESSIONS.md
Re-run the audit it documents. Current reality (2026-07-04): 17 granular suppressions —
12× `react-refresh/only-export-components` (legitimate pattern), 5×
`react-hooks/set-state-in-effect` (each carries a justification comment; locations:
`components/modals/HabitSubmissionLogModal.tsx:65`, `BucketFormModal.tsx:37`,
`DeveloperConsole.tsx:141`, `contexts/FirebaseHouseholdContext.tsx:893,1512`), 4×
`@typescript-eslint/no-explicit-any`. Zero `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`,
zero blanket disables. Update the tables/stats to match.

### docs/CODEBASE_IMPROVEMENTS.md + plans/README.md
Add a dated banner at the top of each: "Historical — superseded by `advisor-plans/`
(2026-07-04) for current priorities." Do not rewrite their content.

### Root clutter (verify, then remove in the same PR)
`verification_desktop.png` / `verification_mobile.png` are session artifacts at repo root —
delete if nothing references them (`grep -rn "verification_" --include="*.{ts,tsx,md,json,yml}" .`).
Check `src/` and `tests/` directories for orphaned content vs the real top-level layout
before touching anything else — report, don't guess.

## Verification & done criteria

- Every claim in the edited CLAUDE.md sections spot-checked against source in the same
  session (the error mode this plan exists to fix).
- `pnpm lint && pnpm test && pnpm run build` green (docs PRs still run CI).
- A reviewer can `grep -n "tailwind.config" CLAUDE.md` → no hits; `grep -n "VITE_GEMINI_API_KEY" CLAUDE.md`
  → only in a "historical/no longer required" context if at all.

## Out of scope

Rewriting DESIGN.md, NOTIFICATIONS*.md consolidation, README.md marketing copy. If
NOTIFICATIONS_QUICKSTART.md/RECEIPT_SCANNING_IMPLEMENTATION.md/WEATHER_IMPLEMENTATION.md
are found stale during the pass, banner them "historical" — don't rewrite.
