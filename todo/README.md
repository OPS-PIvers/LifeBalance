# Deferred Work — Handoff Docs

This folder tracks high-impact improvements that were **identified and scoped** during the
app-optimization passes but **intentionally deferred** to dedicated follow-up PRs because they
are architecturally significant, touch many files, change user-visible behavior, and/or require
a product/security decision.

## Shipped so far

- **PR #613/#614** — offline persistence, Firestore indexes, atomic habit writes, precise bucket
  matching, a11y pass, render-perf memoization, TypeScript strict mode, build hygiene.
- **PR #617** — point-recalc drift, divide-by-zero guards, money rounding, freeze-bank floor,
  atomic reset/reallocate/paycheck/submission writes, AI/Functions hardening (timeout+retry,
  quota transaction, collection-group key lookup, FCM token cleanup), context/render perf,
  suppression removal, build chunking.
- **PR #615** — split the monolithic `FirebaseHouseholdContext` into domain slices
  (`useFinance` / `useGamification` / `useMeals` / `useTodos` / `useHouseholdCore`) with a
  backward-compatible `useHousehold()` shim. *(was todo #1)*
- **PR #616** — bounded the unbounded Firestore `onSnapshot` listeners with windowing + cursor
  pagination; listeners keyed on `user?.uid`. *(was todo #2)*
- **PR #619** — correctness + perf + backend + a11y + code-quality pass (Net-Flow expense bug,
  budget-alert balance bug, rate-limit transaction, Gemini kill-switch cache, last blanket
  `eslint-disable` removal, `functions` strict types, ref-stabilized habit callbacks, more atomic
  `writeBatch` paths, ConfirmDialog/ARIA a11y).
- **This pass** — Safe-to-Spend now folds current-period pending transactions *(was todo #3)*;
  `TransactionMasterList` is virtualized with `@tanstack/react-virtual` *(was todo #6)*; the dead
  entrance-animation classes are restored via `tailwindcss-animate` with reduced-motion gating
  *(was todo #8)*.

## Remaining deferred items

| # | Item | Why deferred | Doc |
|---|------|--------------|-----|
| 4 | **Notification scan** — stop hourly full-collection scans in scheduled functions | Needs a member-field migration + DST-correct timeslot + careful deploy ordering | [04-notification-scan.md](./04-notification-scan.md) |
| 5 | **Admin gate server-side** — move beta/admin gating off the client bundle | Security/auth design + Firestore rules / custom-claims migration with lockout risk | [05-admin-gate-serverside.md](./05-admin-gate-serverside.md) |
| 7 | **Import-path normalization** — relative imports → `@/` alias | ~266-file mechanical churn; own PR to keep review clean | [07-import-path-normalization.md](./07-import-path-normalization.md) |
| 9 | **Weekly-habit streaks** — `calculateStreak` counts days, so weekly habits never earn multipliers | Behavior change + threshold-in-weeks is a product decision | [09-weekly-habit-streaks.md](./09-weekly-habit-streaks.md) |
| 10 | **Daily points after midnight reset** — auto-reset leaves `completedDates`, so recalc can zero earned points | Points-critical; needs a repro test before fixing | [10-daily-points-after-midnight-reset.md](./10-daily-points-after-midnight-reset.md) |
| 11 | **Points sync on every toggle** — `syncHouseholdPoints` recomputes + can re-write on each habit toggle | Points-critical corrective path; restructure carefully | [11-points-sync-on-every-toggle.md](./11-points-sync-on-every-toggle.md) |
| 12 | **Meals context split** — `useMeals()` re-renders all meal/shopping consumers on any shopping change | Many consumers; continuation of the context-split strategy | [12-meals-context-split.md](./12-meals-context-split.md) |
| 13 | **Minor deferrals** — migration-effect run-once guard; voice-command shopping batching | Low impact; batch into any cleanup PR | [13-minor-deferrals.md](./13-minor-deferrals.md) |

Each doc is self-contained: problem statement, current-state references, proposed approach,
risks, and acceptance criteria. Tackle them in separate PRs.

Items 09–13 were scoped during the PR #619 optimization pass (Net-Flow expense bug,
budget-alert account-balance bug, rate-limit transaction + Gemini kill-switch cache,
removal of the last blanket `eslint-disable` test files, `functions` strict-type flags,
`useHabitActions` ref-stabilized callbacks, atomic `writeBatch` for
`updateTransactionCategory` / `useFreezeBankToken` / `addMember`, and an a11y pass) and
deferred to their own follow-ups.

## Kickoff prompts

Copyable prompts to start each remaining item in a fresh session:

**#4 — Notification scan**
> Implement `todo/04-notification-scan.md` in the LifeBalance repo. Add a denormalized
> `notificationTimeslot` (UTC hour) + enabled flags to `HouseholdMember`, maintain it wherever
> notification settings are saved, write a one-off backfill migration, then replace the
> `db.collection("households").get()` scans in the four scheduled functions in
> `functions/src/index.ts` with `collectionGroup('members')` queries filtered on those fields.
> Add the collection-group indexes to `firestore.indexes.json`. Ship the field + migration before
> the query change. No suppressions; `pnpm lint:all` + `pnpm test` green; functions build clean.

**#5 — Admin gate server-side**
> Implement `todo/05-admin-gate-serverside.md` in the LifeBalance repo. Move beta/admin gating off
> the client: represent approval via a Firestore custom claim (`admin` / `betaApproved`) set by a
> secured callable/Admin script, make Firestore rules the authoritative guard, and demote the
> client `VITE_ADMIN_UID` checks in `contexts/AuthContext.tsx` and `pages/Settings.tsx` to UX
> hints reading `getIdTokenResult()`. Test rules with the emulator before deploying; handle
> claim-propagation for already-signed-in users. Remove `VITE_ADMIN_UID` from `deploy.yml` once
> nothing reads it. No suppressions; lint + tests + build green.

**#7 — Import-path normalization**
> Implement `todo/07-import-path-normalization.md` in the LifeBalance repo. Codemod the ~266
> parent-traversing relative imports (`../../…`) to the `@/` alias across all `.ts`/`.tsx` files
> (keep same-dir `./x` as-is), then add an ESLint guard (`no-restricted-imports` patterns banning
> `../../*`) to prevent regressions. Behavior is unchanged (the alias resolves identically), so
> rely on `tsc` + tests to confirm. Land it when few branches are in flight. `pnpm lint` + `pnpm
> test` green.
