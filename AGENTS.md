# AGENTS.md

> **Read [CLAUDE.md](CLAUDE.md) — it is the single source of truth for AI agents
> working on this repository** (architecture, commands, coding rules, Test Mode).
> For anything visual, [DESIGN.md](DESIGN.md) is the styling source of truth.
> This file exists only because some tools read `AGENTS.md` by convention; it is
> deliberately thin so the two files can't drift apart.

A previous version of this file duplicated CLAUDE.md at length and rotted badly
(it still described a Tailwind-via-CDN setup). Do not grow it back into a second
handbook — update CLAUDE.md instead.

## Non-negotiable ground rules (verified 2026-07-04; details in CLAUDE.md)

- **pnpm only** (`packageManager: pnpm@9.15.0`). Never run `npm install`.
- **Zero tolerance for lint/type suppressions.** No `@ts-ignore`/`@ts-expect-error`/
  `@ts-nocheck`/blanket `eslint-disable`; see CLAUDE.md "Code Quality Standards" and
  [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md).
- **Tailwind CSS v4**: there is **no Tailwind config file** — design tokens live in
  `index.css` under `@theme`. Use the token families documented in DESIGN.md.
- **`HashRouter` is intentional** (static hosting without rewrites). Do not switch
  to `BrowserRouter`.
- **Source code lives at the repo root** (`components/`, `pages/`, `utils/`, …),
  not in `src/` (`src/` holds only `vite-env.d.ts`). Use the `@/` alias for
  cross-directory imports; parent-relative (`../`) imports are lint-banned.
- **Safe-to-Spend** (`utils/safeToSpendCalculator.ts`) is the core financial
  metric — never change its formula without explicit instruction.
- **Before pushing:** `pnpm lint && pnpm test` must pass (CI also runs a
  production build).
