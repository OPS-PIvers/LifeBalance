# Deferred Work — Handoff Docs

This folder tracks high-impact improvements that were **identified and scoped** during the
app-optimization pass but **intentionally deferred** to dedicated follow-up PRs because they
are architecturally significant, touch many files, and/or change user-visible behavior.

Everything else from the optimization audit shipped in PR #614 (offline persistence, Firestore
indexes, atomic habit writes, precise bucket matching, a11y pass, render-perf memoization,
TypeScript strict mode, build hygiene, etc.).

| # | Item | Why deferred | Doc |
|---|------|--------------|-----|
| 1 | **Context split** — break the monolithic `FirebaseHouseholdContext` into domain contexts | ~40-50 files; biggest perf win but needs focused review | [01-context-split.md](./01-context-split.md) |
| 3 | **Listener pagination** — bound the unbounded Firestore `onSnapshot` reads | Changes user-visible behavior (not all rows shown at once); needs a UX decision | [02-listener-pagination.md](./02-listener-pagination.md) |

Each doc is self-contained: problem statement, current-state references, proposed approach,
risks, and acceptance criteria. Tackle them in separate PRs.
