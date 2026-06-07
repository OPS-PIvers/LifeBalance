# Handoff: Normalize import paths to the `@/` alias

**Status:** Not started · **Priority:** Low (consistency / maintainability) · **Risk:** Low (mechanical, but large diff)

---

## Problem

The project defines a `@/` path alias (`tsconfig.json` `paths` + `vite.config.ts` `resolve.alias`)
but ~190 files still use deep relative imports (`../../contexts/...`) alongside ~257 that use
`@/...`. The mix is inconsistent and makes moving files harder.

### Evidence / where to look

- `grep -rn "from '\.\./\.\." --include="*.ts" --include="*.tsx" . | grep -v node_modules` → ~190 hits
- `grep -rn "from '@/" --include="*.ts" --include="*.tsx" . | grep -v node_modules` → ~257 hits

## Why this was deferred

It's pure churn touching ~190 files — high diff noise that would bury the substantive changes in the
optimization PR and complicate review. Best done as its own isolated, easily-verified PR.

## Proposed approach

1. Codemod the relative imports to `@/` (e.g. a small jscodeshift/ts-morph script, or
   `eslint-plugin-import` with a resolver + `--fix`, or a careful `sed` keyed off path depth).
2. Run `pnpm lint` and `pnpm test` — the alias resolves identically, so behavior is unchanged.
3. Add an ESLint guard to prevent regressions, e.g. `no-restricted-imports` patterns banning
   `../../*`, or `eslint-plugin-no-relative-import-paths`.
4. Keep same-directory (`./x`) imports as-is; only rewrite parent-traversing paths.

## Risks

- A bad codemod could rewrite a string that isn't an import — review the diff, rely on `tsc` to
  catch breakage.
- Merge conflicts: land it when few other branches are in flight.

## Acceptance criteria

- No `../../` (or deeper) imports remain (same-dir `./` allowed).
- `pnpm lint` + `pnpm test` green; an ESLint rule prevents new relative parent imports.
