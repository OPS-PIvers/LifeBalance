# Mason's Journal

## 2026-01-19 - CI Config Drift
**Bottleneck:** CI pipeline was using an unspecified version of `pnpm`, potentially leading to non-deterministic installs compared to local dev and deployment workflows which use v9.15.0.
**Fix:** Pinned `pnpm` version to `9.15.0` in `.github/workflows/ci.yml` to match `deploy.yml` and `package.json`.

## 2026-01-20 - Feature Branch CI
**Bottleneck:** CI was only running on Pull Requests to `main`, leaving feature branches unchecked until PR creation.
**Fix:** Added `push` trigger for all branches except `main` in `.github/workflows/ci.yml`.

## 2026-01-24 - Functions Linting Gap
**Bottleneck:** The `functions` workspace had no ESLint configuration, meaning backend code quality was not being enforced in CI despite the `lint` script existing (it only ran `tsc`).
**Fix:** Added ESLint configuration to `functions`, updated `tsconfig.json` to target ES2022, and fixed existing lint errors.

## 2026-01-25 - Tailwind CDN Migration
**Bottleneck:** Tailwind CSS was loaded via CDN, causing runtime parsing performance penalty and large download size.
**Fix:** Migrated to PostCSS/Tailwind build process (v3.4) for optimized production builds.

## 2026-01-26 - Test Script Standardization
**Bottleneck:** `npm test` behavior was ambiguous (watch vs run) depending on environment, and developers lacked a single command to lint the entire monorepo.
**Fix:** Standardized `test` to `vitest run` (CI-safe), added `test:watch` for dev, and introduced `lint:all` to run lint across all workspace packages recursively.

## 2026-01-28 - Deployment Gap
**Bottleneck:** The `deploy.yml` workflow was using `FirebaseExtended/action-hosting-deploy`, which only deploys Hosting. Backend Functions and Firestore Rules were not being automatically deployed on push to main, leading to potential inconsistencies between frontend and backend.
**Fix:** Updated `deploy.yml` to use `google-github-actions/auth` and `firebase deploy` (via `firebase-tools` added to devDependencies) to perform a full deployment of Hosting, Functions, and Rules.
