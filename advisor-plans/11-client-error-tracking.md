# Plan 11: Wire client error tracking (Sentry) — stop launching blind

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- components/ErrorBoundary.tsx services/analytics.ts index.tsx vite.config.ts`
> On any mismatch with the "Current state" excerpts, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (additive; main risks are bundle weight and PII leakage, both addressed below)
- **Depends on**: none
- **Category**: dx / direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The product-analytics half of observability shipped (~20 GA4 events via `services/analytics.ts`), but the *failure* half never did: `components/ErrorBoundary.tsx:30-32` only `console.error`s, there is no global `unhandledrejection` handler, and `package.json` has no error-tracking dependency. The owner's roadmap (`docs/PRODUCT_ROADMAP.md` Phase 0) calls this a launch blocker: once signup opens, a crash on a stranger's device is invisible. For a PWA handling household finances, entitlement/money bugs would surface only as silent churn.

## Current state

- `components/ErrorBoundary.tsx` — class boundary wrapping every route (keyed per pathname in `App.tsx`). `componentDidCatch(error, errorInfo)` at lines 30–33:

```tsx
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }
```

- `services/analytics.ts` — the pattern to mirror: lazy dynamic `import()` of the SDK, init only in a production browser, a bounded pre-init queue, `track()` no-ops and never throws elsewhere. Read this file before writing any code — the new module must copy its defensive posture.
- `index.tsx` — app bootstrap (React root render).
- Env: client env vars are `VITE_*`, inlined at build; `.env.local.example` documents them; the deploy workflow (`.github/workflows/deploy.yml`) injects prod values from GitHub secrets.
- CSP: a Content-Security-Policy exists in **Report-Only** mode (check `firebase.json` headers). Sentry ingest needs an allowed `connect-src`; in Report-Only it won't block, but the header should still be updated so the eventual enforce-flip doesn't break reporting.
- Bundle discipline (CLAUDE.md "Code-Splitting & Boot Bundle"): heavyweight SDKs stay off the boot path via dynamic `import()`. Sentry must follow the same rule.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install dep | `pnpm add @sentry/react` | lockfile updated, exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**:
- `services/errorTracking.ts` (create) + `services/errorTracking.test.ts` (create)
- `components/ErrorBoundary.tsx` (one call added in `componentDidCatch`)
- `index.tsx` (init call + global handlers)
- `.env.local.example` (document `VITE_SENTRY_DSN`)
- `firebase.json` (append the Sentry ingest origin to the Report-Only CSP `connect-src` if a CSP header is present)
- `package.json` / `pnpm-lock.yaml` (the new dependency)
- `advisor-plans/README.md` (status row)

**Out of scope**:
- `.github/workflows/deploy.yml` — adding the `VITE_SENTRY_DSN` secret is a HUMAN step (the secret must exist in GitHub first); note it in the PR description instead of editing the workflow blind.
- `services/analytics.ts` — reference only, do not modify.
- Any source-map upload / Sentry release tooling — deferred (needs an auth token secret; v1 is DSN-only).

## Git workflow

- Branch: `advisor/11-client-error-tracking`
- Conventional commits, e.g. `feat(observability): wire Sentry into ErrorBoundary + global handlers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `services/errorTracking.ts`

Mirror `services/analytics.ts`'s structure: an `initErrorTracking()` that (a) no-ops unless `import.meta.env.PROD` and `import.meta.env.VITE_SENTRY_DSN` is a non-empty string, (b) dynamically `import('@sentry/react')` and calls `Sentry.init` with:

- `dsn: import.meta.env.VITE_SENTRY_DSN`
- `sendDefaultPii: false`
- `beforeSend` that strips `event.request` and any breadcrumb `data` bodies (this app handles financial data — no amounts/merchants may leave the device; mirror the "No PII is ever sent" rule documented for analytics in `docs/PRODUCT_ROADMAP.md` Part 7)
- no performance/replay integrations (error events only — keeps bundle and quota minimal)

Export `captureException(error: unknown, context?: Record<string, string>)` that no-ops (never throws) when uninitialized, and queues up to ~10 pre-init errors flushed on init (same bounded-queue idea as analytics).

**Verify**: `pnpm lint` → exit 0.

### Step 2: Wire the boundary and global handlers

- `components/ErrorBoundary.tsx` `componentDidCatch`: add `captureException(error, { componentStack: errorInfo.componentStack ?? '' })` above the existing `console.error` (keep the console line — dev still relies on it).
- `index.tsx`: call `initErrorTracking()` once at boot (fire-and-forget — must not block render), and register `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)` handlers that forward to `captureException`.

**Verify**: `pnpm lint && pnpm test` → exit 0 (existing ErrorBoundary/App tests still green).

### Step 3: Env + CSP housekeeping

- Add `VITE_SENTRY_DSN=` with a comment to `.env.local.example`.
- If `firebase.json` defines a CSP header, append the Sentry ingest origin (`https://*.ingest.sentry.io` — or the region variant, note it) to `connect-src`. If no CSP header exists in `firebase.json`, skip and say so in the PR notes.

**Verify**: `pnpm run build` → exit 0. Then `grep -rn "sentry" dist/assets/*.js | head -1` → the SDK appears only in a lazy chunk, NOT in the entry chunk (compare against the entry file named in `dist/index.html`). If it lands in the boot chunk, fix the import to be dynamic before proceeding.

### Step 4: Tests

`services/errorTracking.test.ts`, modeled on the existing `services/analytics` tests (find them next to the source): no-op in dev/test env; init gated on DSN presence; `captureException` never throws pre-init; queue bounded; `beforeSend` strips request data.

**Verify**: `pnpm test` → all pass including the new file.

## Done criteria

- [ ] `pnpm lint`, `pnpm test`, `pnpm run build` all exit 0
- [ ] `grep -n "captureException" components/ErrorBoundary.tsx` → 1 match
- [ ] `grep -n "unhandledrejection" index.tsx` → 1 match
- [ ] Sentry SDK absent from the entry bundle (Step 3 check)
- [ ] `.env.local.example` documents `VITE_SENTRY_DSN`
- [ ] `advisor-plans/README.md` status row updated, with the human follow-ups noted: create the Sentry project, add the `VITE_SENTRY_DSN` GitHub secret, add it to `deploy.yml`'s env block

## STOP conditions

- `services/analytics.ts` no longer matches the described lazy/defensive pattern (drift — re-read and adapt, or report).
- The bundle check in Step 3 cannot be satisfied without eagerly importing Sentry (report — do not ship it on the boot path).
- Adding the dependency causes a peer/major conflict with React 19 (report the exact resolution options; do not force).

## Maintenance notes

- When CSP flips from Report-Only to enforce, the Sentry `connect-src` entry from Step 3 becomes load-bearing — verify events still arrive after the flip.
- Future: source-map upload (readable prod stacks) needs `SENTRY_AUTH_TOKEN` in CI — deliberately deferred.
- Reviewer scrutiny: the `beforeSend` scrubbing (no financial data in events) and that init cannot delay first paint.
