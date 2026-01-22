# Mason's Journal

## 2026-01-19 - CI Config Drift
**Bottleneck:** CI pipeline was using an unspecified version of `pnpm`, potentially leading to non-deterministic installs compared to local dev and deployment workflows which use v9.15.0.
**Fix:** Pinned `pnpm` version to `9.15.0` in `.github/workflows/ci.yml` to match `deploy.yml` and `package.json`.

## 2026-01-20 - Bundle Bloat from AI Service
**Bottleneck:** The `geminiService` (using `@google/genai`) was being statically imported in the main bundle, causing the entire AI library to be loaded on initial page load, and preventing proper code splitting (Vite warning).
**Fix:** Refactored `services/geminiService.ts` to lazy-initialize the AI client and updated all consumers to use dynamic `await import(...)`. The `geminiService` is now split into its own chunk (`dist/assets/geminiService-*.js`).
