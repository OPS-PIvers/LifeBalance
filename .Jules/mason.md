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
