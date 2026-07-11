# LifeBalance — Backlog (single source of truth)

**This is the one remaining-work doc.** It replaces the scattered `plans/`, `advisor-plans/`,
and `todo/` trees, which were consolidated and removed on **2026-07-10**. Every item below was
**verified against the actual code + git history** (a 51-document audit sweep), not copied from a
stale status line — many of those old status lines over-claimed or had gone out of date.

Deleted planning docs are fully preserved in git history (`git log --diff-filter=D --name-only`)
if you ever need the fine-grained execution steps behind an item here.

Living **reference** docs were kept in place — see [Reference docs](#reference-docs) at the bottom.

Conventions for anyone (or any agent) executing these: pnpm only; `@/` imports; money is **stored in
decimal dollars** — `utils/money.ts` helpers take/return dollars (summing in integer cents internally to
avoid FP drift), never write cents to Firestore; "today" via `getLocalDateString()`; no lint/type
suppressions; any
`firestore.rules` / `firestore.indexes.json` change ships in **its own PR, human-watched** (atomic
deploy, no staging). See `CLAUDE.md`.

---

## 1. Blocked on a human (launch & ops gates)

These need a person — secrets, flag flips, legal review, or a watched deploy. The step-by-step
procedures live in the kept runbooks; this is the index.

| # | Item | Risk | Runbook |
|---|------|------|---------|
| 1.1 | **Admin custom claim → retire the hardcoded super-admin UID.** Provision `admin:true` on the super-admin UID via the Admin SDK (one-off script/callable — nothing in the repo sets a claim today), then remove the UID fallback `nmYdn3QPsNQEvniJEXW9M3lmV5e2` from `firestore.rules` `isSuperAdmin()` (~line 31), demote client checks in `contexts/AuthContext.tsx:79` + `pages/Settings.tsx:150` to `getIdTokenResult()`, and drop `VITE_ADMIN_UID` from `.github/workflows/deploy.yml`, `.env.local.example`, `vite-env.d.ts`. **Blocks open-signup and paid launch.** | HIGH (admin lockout if mis-ordered) | `docs/DEPLOY_CHECKLIST.md` §1 |
| 1.2 | **Open public signup (legal-gated).** Fill the 7 `[PLACEHOLDER]`s in `pages/PrivacyPolicy.tsx` + `pages/TermsOfService.tsx`, counsel review, then a code PR to remove the DRAFT banner (+ bump `CONSENT_VERSION` in `utils/legal.ts` if copy changed materially). Then add the prod origin to Firebase Auth authorized domains and flip `app_config/global.openSignup=true`. No re-consent flow exists for existing users yet. | LOW | `docs/PRELAUNCH_CHECKLIST.md` |
| 1.3 | **Activate Stripe billing.** Code step first: export `createcheckoutsession` + `stripewebhook` from `functions/src/index.ts` (deliberately unexported today), add an emulator subscription-write test, verify the entitlement flow in Test Mode. Gated: the `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` secrets must exist **before** CI can deploy the secret-bound functions. Then Stripe account/entity/bank/product (Phase 0) + secrets/webhook (Phase 1) → flip `billingEnabled`. Entitlement enforcement (member/kid caps) is already live. ⚠️ Flipping `billingEnabled` drops the free AI cap for alpha users — sequence with comms. | MED | `docs/STRIPE_SETUP_RUNBOOK.md` |
| 1.4 | **Reveal Kid Mode.** Test-Mode kid-loop walkthrough (add kid → switch → dashboard → chore → points → reward → approval → exit PIN), fix any breakage, then flip `app_config/global.kidModeEnabled=true`. Feature is code-complete + deployed dormant. | LOW | — |
| 1.5 | **Populate the `VITE_SENTRY_DSN` GitHub Actions secret.** Code + `deploy.yml` wiring already shipped; error tracking stays dark until the real DSN is set. | LOW | — |
| 1.6 | **CSP: promote Report-Only → enforcing.** After reviewing violation telemetry + an authed-path verify, change `Content-Security-Policy-Report-Only` → `Content-Security-Policy` in `firebase.json`. Mistuned `connect-src`/`script-src` can break the Firebase SDK/PWA. | MED | — |
| 1.7 | **Verify the first real `deleteHousehold`** on a throwaway household before relying on it. | LOW | — |

---

## 2. Actionable now — code-only (executor-ready)

No human gate; ship as normal PRs to `main`. Rules/index changes still ship in their own
human-watched PR (tagged **[rules]** / **[index]**).

### 2A. Performance & scale (the pre-monetization cost items)

- [ ] **Bound the 3 unbounded Firestore listeners** — the biggest cold-start-cost item.
  - [x] **groceryCatalog** (`contexts/household/listeners/shoppingListeners.ts:41`): `orderBy('purchaseCount','desc') limit(200)` + converter default + on-demand full-catalog fallback for shopping-form search. **S / LOW.** ✅ 2026-07-11: bounded, with `loadFullGroceryCatalog()` on the shopping slice for Smart Add / template picker / catalog modal.
  - [x] **meals** (`contexts/household/listeners/mealListeners.ts:35`): `orderBy('lastCooked'/'createdAt') limit(50)` + `loadAllMeals()` for the cookbook + by-id resolution for `mealPlan`-referenced meals outside the window. **M / MED.** ✅ 2026-07-11: bounded on `createdAt` (always written; `lastCooked` is sparse and orderBy drops docs missing the field), with `loadAllMeals()` + by-id resolution for plan references outside the window. Note: SearchOverlay now searches the bounded meals/catalog windows until a loader has run.
  - **calendarItems** (`contexts/household/listeners/financeListeners.ts:105`): split into an *unbounded recurring-templates* listener + a *date-windowed instances* listener. **[index]** ships first (composite index, human watches it reach *Enabled*), then the query change; verify Safe-to-Spend + upcoming-bills values are unchanged. **L / HIGH.**
- [x] **quickAddHabit: kill the full-collection scan** (`functions/src/quickAdd/index.ts:185-191`). Add denormalized `titleLower` on habit docs (written in client `addHabit`/`updateHabit` + any server writer), ship a one-off backfill migration **first**, then `where('titleLower','==',…) limit(1)` before the existing fuzzy fallback. **S each / LOW.** ✅ 2026-07-11: shipped (run-once client backfill migration + indexed exact-match query; fuzzy full-scan kept as fallback for un-backfilled docs).
- [x] **BudgetCalendar: dedupe `expandCalendarItems`** (`components/budget/BudgetCalendar.tsx:120`). Window-keyed memo cache so the month window isn't re-expanded independently of the Safe-to-Spend memo. Pure perf hygiene, identical output. **S / LOW.** ✅ 2026-07-11: now uses the shared `useExpandedCalendarItems(start, end)` hook.
- [x] **`sendbudgetalerts` N+1**: parallelize/reduce the members+accounts reads fired on every account write. **S / LOW.** ✅ 2026-07-11: reads now issued via `Promise.all`.
- [ ] **Merge the 4 hourly notification crons into one dispatcher** (`functions/src/index.ts` `sendhabitreminders`/`sendactionqueuereminders`/`sendstreakwarnings`/`sendbillreminders`). The full-collection-*scan* cost is already fixed (plan-06 collection-group query); this is the remaining invocation-count reduction. **M / LOW-MED.**

### 2B. Security hardening (2026-06 audit, re-verified 2026-07-10 — still open)

- [x] **SEC-04 — quickAdd rate-limiter fails OPEN.** `functions/src/quickAdd/apiKeyValidation.ts` returns `{allowed:true}` on a Firestore error; make it fail closed. **S / LOW-MED.** ❌ 2026-07-11: stale finding — `checkRateLimit()` already fails CLOSED on error, with an existing test covering the path. No change needed.
- [x] **SEC-05 — quickAdd CORS is `Access-Control-Allow-Origin: *`** on 5 `onRequest` endpoints. Restrict to an allowlist after confirming iOS Shortcuts sends no `Origin` header. **S / LOW.** ✅ 2026-07-11: allowlisted to the two Firebase-default hosting origins (no custom domain configured); Origin-less callers (iOS Shortcuts/curl) unaffected. If a custom domain is added later, append it to `ALLOWED_ORIGINS` in `functions/src/quickAdd/index.ts`.
- [x] **SEC-11 — quickAdd 404 echoes user input** (`functions/src/quickAdd/index.ts:198`, `Habit not found: ${…}`). Stop reflecting it. **S / LOW.** ✅ 2026-07-11: generic message, no reflection.
- [ ] **[rules] SEC-06 — missing audit-log rule.** Add an explicit `firestore.rules` match for `logs/api_calls/requests` (only `logs/ai_usage/requests` is covered). **S / LOW.**
- [ ] **[rules] SEC-10 — catch-all subcollection write rule** (`firestore.rules` ~907-912) is exclusion-list-permits. Change to deny-by-default after grepping every `.collection()` usage so nothing untracked breaks. **S / LOW-MED.**
- [ ] **[rules] Sub-bucket field cleanup.** Drop the now-dead `subBucketId` / `subBuckets` references from `firestore.rules` (~389, 482, 497, 506) — the app code for sub-buckets was removed; rules just permit an unused field. Bundle with the next rules PR. **S / LOW.**

### 2C. Correctness / atomicity (2026-06 audit — ⚠️ re-validate before acting)

> Several money-path findings here were written **before** the `#737` verified-only balance model
> shipped; some may now be by-design. Re-check each against current behavior first.

- [x] **Non-atomic multi-writes** (real regardless of model — batch into a `writeBatch`):
  `deferCalendarItem` recurring branch (two `addDoc`s, `calendarMutations.ts` ~459);
  `markChallengeComplete` + linked yearly goal (`gamificationMutations.ts` ~284);
  `toggleShoppingItemPurchased` (`shoppingMutations.ts` ~236). **S each / LOW.** ✅ 2026-07-11: each is now a single `writeBatch`.
- [x] **payCalendarItem income path** commits `handlePaycheckApproval` and the payment as two separate batches (`calendarMutations.ts` ~297-336) — a partial commit could advance the pay period without crediting income. **Re-validate**, then batch. **L / HIGH if real.** ✅ 2026-07-11: re-validated as real; the paycheck-approval family now accepts an optional external `WriteBatch` and the income path stages the period roll into payCalendarItem's single batch (rollback test added).
- [x] **calculatePointsForDate** skips historical completions when `count===0` regardless of whether the target date is today (`utils/habitLogic.ts:596`) — points-recalc drift. **S / MED.** ✅ 2026-07-11: counter guards now apply only when the target date is in the current period (day/ISO week); historical dates score from `completedDates`, mirroring `calculatePointsForDateRange` (regression tests added).
- [x] **Dead code:** `safeToSpendCalculator.ts:63` `getTime()`-equality branch. **S / LOW.** ❌ 2026-07-11: stale finding — the branch is reachable and load-bearing (it includes a bill dated exactly on the next paycheck; covered by the "bills on boundary dates" test). Kept.

### 2D. Tooling / deps

- [x] Add pnpm overrides: `basic-ftp >=5.2.0` (firebase-tools path-traversal), `minimatch >=3.1.3` (eslint ReDoS). Dev-chain only. **S / LOW.** ✅ 2026-07-11.
- [x] Bump `functions/package.json` TypeScript `^5.9.3` → root `^6.0.x`; fix any newly-surfaced type errors. **S / MED.** ✅ 2026-07-11: bumped to `^6.0.3`; no new type errors.
- [x] Add an explicit `pnpm --filter functions run test` step to `ci.yml` + `deploy.yml` (+ a real `test` script in `functions/package.json`) — functions tests currently run only via implicit root-vitest glob pickup. **S / LOW.** ✅ 2026-07-11.
- [x] Split the atomic `firebase deploy` in `deploy.yml` into ordered `--only` steps (rules → functions → hosting) and/or add a PR preview channel, to shrink blast radius. **M / LOW.** ✅ 2026-07-11: ordered `--only` steps (rules → functions → hosting); PR preview channel not added.
- [x] Add coverage-threshold floors for `contexts/**` and `services/**` in `vite.config.ts` (only `utils/**` is gated today). **S / LOW.** ✅ 2026-07-11: floors set ~5 points below then-current coverage.

### 2E. UX / product polish (small, code-only)

- [x] **Empty-state CTAs:** `DailyHabitsWidget` (and similar dashboard widgets) `return null` when empty — show an add-first CTA instead. **S / LOW.** ✅ 2026-07-11: `DailyHabitsWidget` + `MoneyPulseWidget` (the two true first-run cases) now show a compact `EmptyState` + CTA; the other null-returning widgets are period-scoped or intentionally dormant, left as-is.
- [x] **Global search v1.1:** deep-link/highlight to the specific result item instead of just its containing tab; add a `SearchOverlay` component test. **M+S / LOW.** ✅ 2026-07-11: scroll-to + transient flash-highlight wired for transactions (Budget → Transactions) and habits (Track tab), reduced-motion-safe; meals/todos/shopping still deep-link to their tab only (their sectioned/paginated layouts need a follow-up). SearchOverlay tests extended.
- [x] **HabitSubmission history/stats view** — the data is already captured (`schema.ts:180`: `pointsEarned`/`streakDaysAtTime`/`multiplierApplied`); no reader UI exists. **S / LOW.** ❌ 2026-07-11: stale — `HabitSubmissionLogModal` (Log/Stats/Calendar tabs) already exists and is wired from `HabitCard`.
- [x] **ShoppingListTab** mirrored-state-in-effect → derived `useMemo` (lint no longer fires, so this is optional cleanup). **M / LOW.** ❌ 2026-07-11: won't-fix — the mirrored state is load-bearing for `Reorder.Group` drag gestures (local mutation gated by `isDraggingRef` before committing via `reorderShoppingItems`); a derived `useMemo` would break mid-drag reordering.
- [x] **Finish the `useHousehold()` migration** — ~7 shim consumers remain; move them to narrow domain slices. **S each / LOW.** ❌ 2026-07-11: stale — zero production consumers remain; only test-file mocks reference the shim.

---

## 3. Product backlog (needs a product decision before planning)

From the 2026-07-09 product-scope audit — grounded findings, not yet greenlit:

- **Meals/grocery spend → Groceries budget-bucket linkage** — flagged the highest-value net-new differentiator; needs a matching-logic decision. **M / MED.**
- **AI Weekly Planner: full save-back to the calendar/meal-plan** (today it only writes the shopping list). **M / LOW-MED.**
- **G1** — full shared family calendar (beyond the bills-only ICS feed).
- **G8** — generalized email-in inbox (per-household inbound address → existing parser).
- **G9** — printable "fridge" views (`@media print` + `/print` route). **S.**
- **G10** — receipt-image persistence / document shelf (`firebase/storage` + a new rules surface).
- **G11** — kid allowance payout ledger (parent-confirmed IOU + savings jar; not real-money Greenlight tier).
- **G12** — Alexa/Google Home shopping entry (skill + platform certification).
- **Marketing/landing page + waitlist capture** (DIR-08) — needs a hosting/domain decision + copy.
- **Deferred pre-traction by the roadmap:** referral/invite rewards, achievements/badges layer, monthly/annual recap payloads ("year in review"), i18n, multi-household switching, TWA/app-store wrap, re-consent flow for post-launch policy changes.

---

## Reference docs

Kept in place — these are living reference, not backlog:

- `docs/PRODUCT_ROADMAP.md` — product strategy + the analytics event dictionary (Part 7)
- `docs/PRELAUNCH_CHECKLIST.md` — the ordered public-launch gate (legal → open signup)
- `docs/DEPLOY_CHECKLIST.md` — gated ops/security actions requiring console/Admin-SDK access
- `docs/STRIPE_SETUP_RUNBOOK.md` · `docs/PLAID_SETUP_RUNBOOK.md` — external-service activation
- `docs/ADR-bucket-color-keys.md` — architecture decision record
- `docs/integrations/*.md` — import/export integration guides
- `SECURITY_MODEL.md` · `NOTIFICATIONS.md` — living reference
- `CLAUDE.md` · `DESIGN.md` · `LINT_SUPPRESSIONS.md` — agent/design/quality guidance
