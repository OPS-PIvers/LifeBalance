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
- **PR #618** — Safe-to-Spend folds current-period pending transactions *(was todo #3)*;
  `TransactionMasterList` virtualized with `@tanstack/react-virtual` *(was todo #6)*; dead
  entrance-animation classes restored via `tailwindcss-animate` with reduced-motion gating
  *(was todo #8)*.
- **PR #620** — fixed daily points recalculating to 0 after a midnight habit auto-reset
  (auto-reset left `completedDates` populated, desyncing the daily total) *(was todo #10)*.
- **PR #621** — weekly habits now earn streak multipliers measured in consecutive weeks
  (2wk → 1.5×, 4wk → 2.0×) *(was todo #9)*; `MealsContext` split into `useMealPlan()` /
  `useShopping()` so shopping changes don't re-render the meal planner *(was todo #12)*; minor
  deferrals — run-once guards on the bucket/paycheck migration effects + batched voice-command
  shopping writes *(was todo #13)*.
- **PR #625** — correctness/atomicity/perf/a11y/quality pass: `syncHouseholdPoints` no longer
  recomputes+re-writes on every habit toggle (ref-backed, login/midnight-driven) *(was todo #11)*;
  quickAdd Cloud Functions made period-aware (weekly streaks) + atomic, with an injectable local
  `today` for UTC safety; freeze-token patch now credits points; `addHabitSubmission` date-gating;
  `payCalendarItem`/transaction/`PointsBreakdownModal` batching; shared `useExpandedCalendarItems`;
  15 a11y fixes; `vendor-icons` chunk; `isSuperAdmin()` rule helper (custom-claim-or-UID).
- **PR #624** — mobile drawer fix: tab-switch no longer pops the iOS keyboard (touch-aware
  `useAutoFocus` replaces bare `autoFocus`); Drawer uses `dvh` (CTA stays above the keyboard) and a
  `height="tall"` detent so multi-tab drawers don't resize between tabs.
- **PR #627** — modal render-isolation: 17 modals migrated off the `useHousehold()` shim to narrow
  domain slices; AI types (`ReceiptData`, …) moved to `geminiService.types` and imported via
  `import type` to keep the `@google/genai` SDK off the boot path. *(was todo #16)*
- **PR #628** — typed Firestore converters: `utils/firestoreConverters.ts` (`FirestoreDataConverter<T>`
  per collection) attached via `.withConverter()` in the context, removing the unchecked
  `d.data() as T` casts; behaviour-preserving, 67 converter tests. *(was todo #15)*
- **PR #629** — import-path normalization: 327 parent-relative imports (`../…`) across 97 files
  rewritten to the `@/` alias, with a `no-restricted-imports` ESLint guard preventing regressions.
  *(was todo #7)*

## Remaining deferred items

| # | Item | Why deferred | Doc |
|---|------|--------------|-----|
| 4 | **Notification scan** — stop hourly full-collection scans in scheduled functions | Needs a member-field migration + DST-correct timeslot + careful deploy ordering | [04-notification-scan.md](./04-notification-scan.md) |
| 5 | **Admin gate server-side** — move beta/admin gating off the client bundle | Security/auth design + custom-claims migration with lockout risk. *Partially advanced in PR #625*: the Firestore rules now accept an `admin` custom claim via `isSuperAdmin()` (backward-compatible with the legacy UID) and `app_config/global` requires auth — remaining work is provisioning the claim and demoting the client `VITE_ADMIN_UID` checks. | [05-admin-gate-serverside.md](./05-admin-gate-serverside.md) |
| 14 | **Unbounded calendar/meals/grocery listeners** — windowing + lazy-load | Recurring-template expansion + cookbook/catalog search must keep working; needs indexes + careful deploy | [14-unbounded-calendar-meals-grocery-listeners.md](./14-unbounded-calendar-meals-grocery-listeners.md) |

Each doc is self-contained: problem statement, current-state references, proposed approach,
risks, and acceptance criteria. Tackle them in separate PRs.

These three remaining items (#4, #5, #14) are **backend/ops** changes whose deploy steps need
human verification that the hosting-auto-deploy pipeline can't provide on its own — a Firestore
index finishing its build (#14), a one-off data backfill running (#4), and custom-claim
provisioning without locking admins out (#5). Run each in a dedicated session and verify the
manual deploy step before declaring done.

Items 10–13 were scoped during the PR #619 optimization pass; #9, #12, and #13 shipped
in PR #621, #10 in PR #620, and #11 in PR #625. Items #14–#16 were scoped during the PR #625 pass;
#16/#15/#7 shipped in PR #627/#628/#629.

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

**#14 — Unbounded calendar/meals/grocery listeners**
> Implement `todo/14-unbounded-calendar-meals-grocery-listeners.md` in the LifeBalance repo. Window
> the still-unbounded `calendarItems`, `meals`, and `groceryCatalog` `onSnapshot` listeners in
> `contexts/FirebaseHouseholdContext.tsx` (lines ~798/953/971). Start with the lowest-risk
> `groceryCatalog` (`orderBy('purchaseCount','desc'), limit(200)` + on-demand search), then `meals`
> (windowed live + lazy `loadAllMeals()` for the cookbook), then `calendarItems` (keep ALL recurring
> templates; window only materialized instances). Add indexes to `firestore.indexes.json` and ship
> them first. Preserve recurring-bill expansion and Safe-to-Spend exactly. `pnpm lint:all` + `pnpm
> test` green; functions build clean.
