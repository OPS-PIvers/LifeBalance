# Mason's Journal

## 2026-01-19 - CI Config Drift
**Bottleneck:** CI pipeline was using an unspecified version of `pnpm`, potentially leading to non-deterministic installs compared to local dev and deployment workflows which use v9.15.0.
**Fix:** Pinned `pnpm` version to `9.15.0` in `.github/workflows/ci.yml` to match `deploy.yml` and `package.json`.

## 2026-01-20 - Omni-Bar & Natural Language Query Architecture
**Pattern:** Introduced the `OmniBar` component as a centralized "Predictive Command Center" to unify data entry (transactions, tasks, shopping) and retrieval (budget, pantry queries).
**Architecture:**
- **Intent Recognition:** Leverages `geminiService.ts` (`parseMagicAction`) to classify user input into `transaction`, `todo`, `shopping`, or `query` intents.
- **Client-Side Logic:** The `query` intent is processed client-side (e.g., comparing `safeToSpend` against a requested amount, or searching the `pantry` array) to provide instant feedback without additional backend roundtrips.
- **Scalability:** This pattern allows easy extension of the app's capabilities by adding new `MagicActionType`s and corresponding client-side handlers in `OmniBar.tsx` without cluttering the UI with more buttons.
