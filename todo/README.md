# Deferred Work — Handoff Docs

This folder tracks high-impact improvements that were **identified and scoped** during the
app-optimization pass but **intentionally deferred** to dedicated follow-up PRs because they
are architecturally significant, touch many files, and/or change user-visible behavior.

Earlier audit work shipped in PR #614 (offline persistence, Firestore indexes, atomic habit
writes, precise bucket matching, a11y pass, render-perf memoization, TypeScript strict mode, build
hygiene). A later optimization pass (PR #617) shipped more correctness fixes (point-recalc drift,
divide-by-zero guards, money rounding, freeze-bank floor, atomic reset/reallocate/paycheck/
submission writes), AI/Functions hardening (timeout+retry, quota transaction, collection-group
key lookup, FCM token cleanup), context/render perf (listener keyed on uid, memoized derived
values + STS breakdown, debounced points sync), an a11y pass, suppression removal, and build
chunking.

The items below remain intentionally deferred:

| # | Item | Why deferred | Doc |
|---|------|--------------|-----|
| 1 | **Context split** — break the monolithic `FirebaseHouseholdContext` into domain contexts | ~40-50 files; biggest perf win but needs focused review | [01-context-split.md](./01-context-split.md) |
| 2 | **Listener pagination** — bound the unbounded Firestore `onSnapshot` reads | Changes user-visible behavior (not all rows shown at once); needs a UX decision | [02-listener-pagination.md](./02-listener-pagination.md) |
| 3 | **Safe-to-Spend pending** — fold pending transactions into the STS calc | Depends on whether balances are manual or bank-synced (product fact) | [03-safe-to-spend-pending.md](./03-safe-to-spend-pending.md) |
| 4 | **Notification scan** — stop hourly full-collection scans in scheduled functions | Needs a member-field migration + DST-correct timeslot | [04-notification-scan.md](./04-notification-scan.md) |
| 5 | **Admin gate server-side** — move beta/admin gating off the client bundle | Security/auth design + rules migration | [05-admin-gate-serverside.md](./05-admin-gate-serverside.md) |
| 6 | **List virtualization** — window large transaction/todo/shopping lists | Layout/UX work for variable-height + drag-and-drop rows | [06-list-virtualization.md](./06-list-virtualization.md) |
| 7 | **Import-path normalization** — relative imports → `@/` alias | ~190-file mechanical churn; own PR to keep review clean | [07-import-path-normalization.md](./07-import-path-normalization.md) |

Each doc is self-contained: problem statement, current-state references, proposed approach,
risks, and acceptance criteria. Tackle them in separate PRs.
