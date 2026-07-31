# LifeBalance — Backlog (single source of truth)

**This is the single backlog for bugs, ops gates, perf/security hardening, and product-scope
questions.** It replaces the scattered `plans/`, `advisor-plans/`, and `todo/` trees, which were
consolidated and removed on **2026-07-10**. Every item below was **verified against the actual
code + git history** (a 51-document audit sweep), not copied from a stale status line — many of
those old status lines over-claimed or had gone out of date.

**Two other live work docs exist; this file is not the whole picture.** Check them before
concluding something isn't tracked:

- **`FEATURES_ROADMAP.md`** (repo root) — **features only**: 96 candidate feature briefs from the
  2026-07-13 discovery pipeline. The division is deliberate and enforced in both directions —
  that doc drops any item overlapping this one and cross-references instead (e.g. its F-MEALS-14
  points at §3's G9). Nothing there is greenlit; it is the same "needs a product decision" tier
  as §3 below.
- **`docs/plans/phase-2b-deterministic-nl-quickadd.md`** — one surviving execution-detail plan,
  status *planned / not started*: replace the client-side Gemini drain of `pendingItems` with
  deterministic server-side NL parsing, making Gemini opt-in. Real un-started work; indexed from
  §2A below so it isn't invisible from here.

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
| 1.2 | **Open public signup (legal-gated).** Fill the 8 distinct `[PLACEHOLDER]`s (19 occurrences) in `pages/PrivacyPolicy.tsx` + `pages/TermsOfService.tsx`, counsel review, then a code PR to remove the DRAFT banner (+ bump `CONSENT_VERSION` in `utils/legal.ts` if copy changed materially — note it is written only at signup by `services/householdService.ts:98,158` and nothing compares a stored `consentVersion`, so a bump affects **new signups only**). Then add the prod origin to Firebase Auth authorized domains and flip `app_config/global.openSignup=true`. No re-consent flow exists for existing users yet. **⚠️ Sub-gate — the AI/Gemini disclosure is load-bearing, not just one placeholder among eight:** `[PLACEHOLDER: link to Google AI / Gemini terms]` is the app's *only* remaining AI data-handling disclosure, because §2G.3 deleted the in-app PII banner on the explicit grounds that "the Privacy Policy carries the disclosure." Until that placeholder is filled and counsel-reviewed, the app discloses AI image/text handling **nowhere**. Do not flip `openSignup` before it lands. | LOW | `docs/PRELAUNCH_CHECKLIST.md` |
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
- [ ] **Phase 2b — deterministic NL quick-add (cut Gemini off the common path).** Today
  `quickAddNaturalLanguage` parks raw text in `pendingItems` and the **client** drains it through
  Gemini (`parseNaturalLanguageCommand`) on next app open. Replace with deterministic server-side
  parsing, demoting Gemini to an opt-in "✨ Clean up with AI" for genuinely ambiguous input; the
  Phase-1 capture-review drawer (#1062) is the safety net that makes heuristic parsing acceptable.
  Full executable spec — including the "what already exists, REUSE don't rebuild" inventory — is in
  **`docs/plans/phase-2b-deterministic-nl-quickadd.md`**; that doc is the execution reference, this
  line is the backlog entry that makes it findable. **L / MED.**

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
- [x] **Global search v1.1:** deep-link/highlight to the specific result item instead of just its containing tab; add a `SearchOverlay` component test. **M+S / LOW.** ✅ 2026-07-11: scroll-to + transient flash-highlight wired for transactions (Budget → Transactions) and habits (Track tab), reduced-motion-safe; meals/todos/shopping still deep-link to their tab only (their sectioned/paginated layouts need a follow-up — now carried as the open v1.2 item below). SearchOverlay tests extended.
- [x] **Global search v1.2 — deep-link highlight for meals / todos / shopping.** **M / LOW.**
  ✅ 2026-07-27. Prerequisite bug fixed first: `/lists` never accepted a router-state tab (it read
  `lists-active-tab` from localStorage at MOUNT only), so selecting a to-do/meal/shopping result —
  or the Action Queue's "Review" link — did nothing at all when already on `/lists`. `ListsPage` now
  layers `useDeepLinkTab` over the stored preference, and `SearchOverlay`/`ActionQueueItem` send
  `state: { tab, highlightId }`. Surfaces: **shopping** = `data-highlight-target` on both
  `ShoppingItemRow` branches + an `onBeforeScroll` that clears the store filter only when the target
  fails it; **to-dos** = the bespoke `?todo=` ref-map/ring path replaced by the shared hooks (the param
  still works, translated onto the same target), with `onBeforeScroll` switching view mode, clearing
  only the filters the target actually fails, expanding its collapsed category section, and exiting
  the landscape grid; **meals** = a search hit is a RECIPE, and the tab renders plan items for one
  day, so the deep link OPENS the recipe (`RecipeModal` without a plan item) rather than scrolling.
  The shared `.search-highlight-flash` now paints via a `::after` overlay — the old
  background-only flash was hidden under every row's own opaque background.
- [x] **Link a calendar event to an existing transaction from the Edit Event drawer** (paper cut #9,
  deferred 2026-07-27). ✅ 2026-07-27 — shipped together with 2H(a) below; both entry points call the
  ONE new `settleBillWithTransaction` mutation. The Edit Event drawer gained a searchable
  `TransactionLinkPicker` (`components/budget/TransactionLinkPicker.tsx`, filtering/sorting in the pure
  `utils/transactionLinkCandidates.ts`, matched via `useMerchantRules().searchTermsFor` so a renamed row
  stays findable by its raw descriptor). The question the bullet posed — alias vs. real foreign key —
  was answered **both**: the alias write is kept AND a real `Transaction.paidCalendarItemId` foreign key
  was added, holding the REAL paid-instance doc id (never a synthetic `..._instance_...` id). The drawer
  carries the occurrence id/date in its own `settleTarget` state because `openEditModal` deliberately
  swaps a recurring instance for its TEMPLATE — feeding `editingItem.id` to the mutation would have
  permanently rewritten the series' budgeted amount. Original text below.
  Today the bill↔transaction link is **one-directional**: `linkBankTransactionToBill`
  ([contexts/household/mutations/calendarMutations.ts:537](contexts/household/mutations/calendarMutations.ts:537))
  is reachable only from the *transaction* side, via `TransactionReviewForm`'s "Link to bill" picker
  ([components/transactions/TransactionReviewForm.tsx:93](components/transactions/TransactionReviewForm.tsx:93)).
  From `BudgetCalendar`'s Edit Event drawer there is no way to say "this bill is that transaction."
  Add a **searchable combobox** in the Edit Event drawer listing recent transactions — **both
  `pending_review` and confirmed** — that calls the same mutation, so the link persists forward via
  the `CalendarItem.bankDescriptorAliases` mechanism it already teaches ([types/schema.ts:568](types/schema.ts:568)).
  Reuse the existing picker's search/matching rather than writing a second one. Note there is no
  `billId`/`calendarItemId` field on `Transaction` — the association is descriptor-based, so decide
  deliberately whether this needs a real foreign key or whether teaching the alias is sufficient.
  **M / MED.**
- [x] **Sticky save footer for every drawer** (paper cut #10 follow-up). ✅ 2026-07-28, PRs #1128-#1131.
  A fresh audit of all **68** `Drawer` consumers replaced the original 21-item list, which was both
  wrong and short: it named drawers that already had a footer and missed others. Real result —
  **21 already correct, 30 migrated, the rest have no primary action** (read-only sheets, and
  tap-to-commit pickers like `AccountPicker`/`TodoTriageDrawer` where selecting the row IS the save).
  The one bug class that mattered: a moved button that relied on implicit `<form>` submit stops
  working silently once it leaves the form, so `FeedbackModal`/`MemberModal`/`RewardManagerPanel`
  got `id` + `form="…"` association (verified in-browser via `btn.form` resolving to the real node).
  Deliberately NOT forced: `TransactionMasterList`'s mobile filter sheet (filters apply live — no
  commit action) and `HabitSubmissionLogModal`'s inline add form (already at the top of its tab).
  **Finished by #1135**, which closed the one real gap: `TransactionReviewForm` — the app's longest
  review body (measured 719px of content in a 505px viewport) — is SHARED by `ReviewPendingDrawer`
  and `ActionQueueItem`, so neither host could hoist its CTA alone without duplicating the form's
  `canApprove`/`handleApprove` ownership. Solved with an optional
  `actionsContainer?: HTMLElement | null`: the form `createPortal`s its EXISTING Approve+Delete nodes
  into whichever host footer opts in, so position moves and ownership doesn't, and omitting the prop
  keeps the in-body render byte-identical. A render-prop can't work here — a node the form returns
  still renders inside the form's own tree.
- [ ] **Batch-update toasts over-report when the settled-bill guard skips a row.** Found by adversarial
  review 2026-07-28, deliberately deferred as report-only (no money moves wrongly). The guard added in
  #1134 refuses by toasting and returning *normally*, so `TransactionMasterList`'s
  `handleBatchCategorize`/`executeBatchVerify` — which `Promise.allSettled` over the selection — see a
  **fulfilled** promise for a refused row and report "Updated N transactions" when one was skipped.
  Fix is either a distinguishable return value from the guarded mutations or filtering settled rows out
  of the batch selection. Note the guard intentionally does NOT throw, to avoid a generic
  "Failed to update" toast burying the specific refusal. **S / LOW.**
- [ ] **Settle flow ignores an untouched-vs-edited Account select.** The live *amount* is now plumbed
  into `settleBillWithTransaction`, but the Account select is not: for an UNTAGGED row that select is
  pre-filled with a *suggestion* (`suggestAccountIdForTransaction`), so forwarding it blindly would skip
  the `AccountPicker` confirmation the code deliberately requires ("a suggestion, never a silent
  guess"). Needs a "user actually touched this field" signal the form doesn't currently track. Until
  then, changing the Account select without saving has no effect on a settle. **S / LOW.**
- [ ] **Full unlink for a settled bill.** Undo is one-directional by design: once a transaction settles
  a bill, `deleteTransaction`/`mergeTransactions`/`splitTransaction`/`updateTransaction` (money fields)
  and `reverseTransactionApproval` all refuse via `utils/settledBillGuard.ts`, pointing the user at the
  calendar. Deleting the paid calendar doc *does* release the guard (the reference dangles, and the
  guard is keyed on the bill still being paid — so a row can never be trapped), but the transaction
  keeps its `paidCalendarItemId` stamp and stays verified. A real "unlink" action on the transaction
  side would clear the stamp, un-pay the occurrence and reverse the delta in one batch. **M / MED.**
- [x] **HabitSubmission history/stats view** — the data is already captured (`schema.ts:180`: `pointsEarned`/`streakDaysAtTime`/`multiplierApplied`); no reader UI exists. **S / LOW.** ❌ 2026-07-11: stale — `HabitSubmissionLogModal` (Log/Stats/Calendar tabs) already exists and is wired from `HabitCard`.
- [x] **ShoppingListTab** mirrored-state-in-effect → derived `useMemo` (lint no longer fires, so this is optional cleanup). **M / LOW.** ❌ 2026-07-11: won't-fix — the mirrored state is load-bearing for `Reorder.Group` drag gestures (local mutation gated by `isDraggingRef` before committing via `reorderShoppingItems`); a derived `useMemo` would break mid-drag reordering.
- [x] **Finish the `useHousehold()` migration** — ~7 shim consumers remain; move them to narrow domain slices. **S each / LOW.** ❌ 2026-07-11: stale — zero production consumers remain; only test-file mocks reference the shim.

### 2F. Per-member visibility & navigation — ✅ SHIPPED 2026-07-26

**Why.** Plan 090 made pages toggleable **per household**, so two people in one household necessarily
get the same app. Real-user feedback: one member finds the default surface overwhelming (density,
red/"overdue" framing, loud optional-metadata chips) while the other depends on that density. The
generalizable fix is not a "calm mode" — it is to finish Plan 090 by extending the existing toggle
pattern to **every** page/sub-view and moving the "what I see" decision to the **member**.

**Model (decided).** Two layers composed with `&&`:

- **Household** — "does this household use it at all." Stays on `Household.moduleVisibility`, defaults
  all-on, and is what a **new member inherits**.
- **Member** — "do I want it in my nav." New `hiddenKeys` field on `HouseholdMember`, next to
  `dashboardLayout`.

An admin edits **the same member field** the member edits for themselves — no lock, no third layer,
last write wins. Managed kid profiles are the only exception (no login to edit with). Both layers
render as one matrix, household as the top row.

**Key set.** Leaves only; groups are **derived**. A group disappears when all its leaves are off, a
page when all its groups are gone — the cascade `isPlanVisible` already implements. ~20 keys: Home,
Habits' segments, Money's seven leaves (`overview`, `transactions`, `trends`, `calendar`,
`subscriptions`, `buckets`, `accounts` — see `pages/Budget.tsx:35`), Lists' three tabs, plus the
Home widgets. **Settings is never toggleable** (lockout).

**Collapse rule — this is the feature.** Exactly one enabled child ⇒ no `TabSubViewMenu`, no tab
strip; the nav item becomes a **direct link**. Turning off Money's other six leaves makes tapping
Money *be* the budget calendar. This is what turns "hide what I don't use" into "buttons to what I
do use" without building a launcher screen.

| Slice | Contents | Size | Status |
|-------|----------|------|--------|
| **2F.1** | Member `hiddenKeys` layer + full key set + widget merge + collapse rule + Plan→Lists rename | **L / MED** | ✅ 2026-07-26 (#1109) |
| **2F.2** | Home becomes toggleable + per-member `homeScreen` + URL-addressable Money sub-views | **M / LOW** | ✅ 2026-07-26 (#1111) |
| **2F.3** | Admin per-member matrix + one-time discovery prompt + onboarding step | **M / LOW** | ✅ 2026-07-26 (#1110) |

**2F.1 notes.**
- Widgets merge into the unified key set. Resolve as `member.hiddenKeys ?? DEFAULT_HIDDEN_KEYS`, where
  the default set holds **only** the five widget keys from `DEFAULT_HIDDEN_DASHBOARD_WIDGETS`
  (`utils/dashboardLayout.ts:47`). Pages therefore fail **open**, widgets stay hidden exactly as today,
  and **no migration runs**. ⚠️ The two systems have *opposite* defaults today
  (`moduleVisibility` fails open, `resolveHiddenWidgets` fails closed) — this rule is what reconciles
  them; a naive merge would surface 5 extra widgets on every existing member's Home.
- `dashboardLayout` is **ordering, not visibility** — untouched by the merge.
- Rename: the route is *already* `/lists`; only the `'plan'` `ModuleKey` and the "Plan" nav label say
  otherwise (`components/layout/BottomNav.tsx:62`). Needs a **read-time alias** from `'plan'` so
  existing households don't lose saved toggles.
- Free consequence: `useActionQueue` gates to-do items on `isPlanTabVisible`, so member-scoping it
  stops surfacing to-do cards a member never took on — a chunk of the "everything is red and overdue"
  complaint fixed without touching the queue.

**2F.2 notes.** `resolveLandingRoute()` walks *chosen `homeScreen`* → *first enabled nav destination*
→ *Settings*, so there is never a dead end and the case where `/` itself is disabled is covered.
Money sub-views are React state only today (no URL param, no persistence) — make them addressable via
a query param matching Habits' existing `?due=` pattern (`pages/Habits.tsx:373`). Byproduct:
deep-linkable money screens for push notifications and PWA shortcuts.

**Open / to verify.**
- Whether `moduleVisibility.todos` is currently `false` for this household — it was turned off
  believing it was per-member, which hid to-dos (and their Action Queue cards) for **both** members.
- ~~Confirm the `?view=` param shape vs. path segments before 2F.2.~~ ✅ Resolved — 2F.2 shipped the
  query-param form; `hooks/useViewParam.ts` (+ its test) is consumed by `pages/Budget.tsx`, matching
  Habits' `?due=` convention as planned.
- The matrix is ~20 rows × N members — the one screen where this "reduce overwhelm" feature is itself
  dense. Acceptable as an admin surface; revisit if it tests badly.

**Prerequisite.** 2G.1 below fixes the `firestore.rules` member-self-update allowlist. 2F.1 adds
`hiddenKeys` / `homeScreen` to that same allowlist — **it will hit the identical denial if 2G.1 hasn't
shipped**, and it will look like a bug in the new feature rather than a pre-existing rules gap.

**Shipped (2026-07-26).** 2F.1/2F.2/2F.3 landed as #1109/#1111/#1110, depending on the two 2G.1-family
rules PRs (#1106 member self-update allowlist, #1112 managed-kid Case 3 allowlist) exactly as the
Prerequisite note above predicted. Case 3's managed-kid guard was also switched from whole-document
`keys()` to `affectedKeys()` while adding `hiddenKeys`/`homeScreen` to it — the same privilege-escalation
class 2G.1 fixed for Case 1 (see 2G.1's shipped note below), so an admin-planted key on a kid's doc can no
longer permanently lock a non-admin parent out of writing to that kid.

Two things fell out that weren't in the original spec:
- A **kid-aware `MemberModal`** — editing a managed kid was submitting a blank `email: ''`, which was
  clobbering *stored* emails for ordinary (non-kid) members too, not just kids. Fixed alongside 2F.
- **The gap two independent integration reviewers found post-merge, closed in this same PR
  (`fix/2f-matrix-home-row-and-docs`):** 2F.1 reserved `'home'` as a `VisibilityKey` but exposed no
  toggle; 2F.2 built a Home toggle as a hand-coded switch **outside** `MemberVisibilityMatrix`'s
  `NAV_PAGES`-driven rows (in `MyViewSettings`, self-only); 2F.3's admin matrix derives its rows purely
  from `NAV_PAGES`, which structurally excludes Home — so **nobody** had a way to hide a managed kid's
  Home or set a kid's landing screen, even though the matrix's own on-screen copy already promised that
  capability. Fixed by hand-authoring a Home section in `getVisibilityMatrixSections()` (the same way the
  Home-widgets section already was) plus a shared `resolveLandingOptions()` helper feeding a per-member
  landing-screen picker in the matrix. `utils/moduleVisibility.test.ts`'s section-shape pinning test was
  updated deliberately (not just made to pass) to include the new `'home'` section.

**Known follow-ups (not blocking, not re-litigated here):**
- `components/meals/MealPlanTab.test.tsx`'s "extends the day strip window…" test is a pre-existing,
  load-sensitive flake — not caused by 2F/2G, don't chase it as a regression.
- ~~`components/layout/ProfileMenu.tsx`'s add-kid flow still uses a browser-native text prompt.~~
  ✅ Done — the row now opens the kid-aware `MemberModal` in create mode (`createManagedKid`), so adding
  and editing a kid profile share one on-design bottom sheet. No browser-native prompt dialog remains in
  the app; grepping the source for one should return nothing.
- ~~`firestore.rules`' Case 3 kid-allowlist comment still describes stale reachability claims (that
  `MyViewSettings` can render a kid, and that `MemberModal` submits `email` for kids).~~
  ✅ Done — **[rules] PR #1114** (`fix/rules-case3-comment-accuracy`) rewrote that comment and **merged
  2026-07-27**. No longer an outstanding follow-up.

### 2G. Member-permission bug + capture/shopping paper cuts — ✅ SHIPPED 2026-07-26

Four items from real-device use, ordered by urgency. **Ship as three PRs, 2G.1 first.** Everything
below is decided; an executor should not need to re-litigate any of it.

#### 2G.1 [rules] Non-admin members cannot change their own dashboard widgets — **live bug, blocking a real user** — ✅ SHIPPED 2026-07-26 (#1106)

**Symptom.** A non-admin member toggles a widget in Settings → Dashboard Widgets and gets
*"You don't have permission to update the member. Try signing in again, or check that you're still a
member of this household."*

**Root cause.** `firestore.rules:282-285` gates a member's self-update with
`changedKeys().hasOnly(['displayName','email','photoURL','telegramChatId','notificationPreferences','fcmTokens','lastTokenRefresh'])`.
`dashboardLayout` / `dashboardHidden` were added to `HouseholdMember` by F-XCUT-02 (`types/schema.ts:200-207`)
and **never added to that list** — `dashboard` appears zero times in `firestore.rules`.

Two details explain why this survived to production:
- **`changedKeys()` excludes newly-*added* keys** (those land in `addedKeys()`). So a member's *first*
  toggle succeeds — both fields are absent, `changedKeys()` is empty, and `hasOnly` passes vacuously.
  Every toggle *after* that is denied. Matches the report exactly ("toggled on/off").
- **`isAdminOf(householdId)` at `firestore.rules:288` is a blanket bypass.** The feature works perfectly
  for admins and is broken for every non-admin. Which is why it was never seen in dev.

**Fix.** Add `dashboardLayout`, `dashboardHidden`, **and `anyNotificationsEnabled`** to the line-284
allowlist. The third is the same bug in a different feature: `pages/Settings.tsx:553-556` writes
`{notificationPreferences, anyNotificationsEnabled}` together, and `anyNotificationsEnabled`
(`types/schema.ts:191`) is also missing — so a non-admin's *second* notification-preferences save fails
identically. Same for `components/modals/HabitFormModal.tsx:271` and
`services/notificationService.tsx:364-371, 486-494` (those also write `fcmTokens`/`lastTokenRefresh`,
which *are* allowlisted — `anyNotificationsEnabled` is the key that breaks them).

**Also do:** a sweep of every call site writing to `households/{id}/members/{uid}`, checking each
payload's keys against the allowlist. This bug class is invisible to admins by construction, so the
sweep is the only way to find the rest.

**Tests.** `tests/rules/firestore.rules.test.ts` currently has **zero** `dashboard` references, and every
existing member-self-update test writes an already-allowlisted key — so the `changedKeys()`/`addedKeys()`
gap is untested in both directions. Add: non-admin *adds* the fields (must pass), non-admin *changes*
them (must pass, was failing), non-admin writes a genuinely forbidden key such as `role` or `points`
(must still fail). **S / LOW** — but `[rules]`, so its own human-watched PR.

**Shipped.** Landed as #1106, plus more than the spec asked for: fixing the `changedKeys()` gap also
surfaced that the SAME `changedKeys()` predicate was a **live privilege-escalation path** in Case 1 — it
ignores newly-*added* keys, so any member could *add* `points`/`allowanceCents`/`isManaged` to their own
doc on their first write to those fields (the identical "first write passes vacuously" mechanism as the
dashboard-widgets bug, just pointed at security-sensitive fields instead of a settings toggle). Switched
Case 1 to `affectedKeys()` (added ∪ changed ∪ removed) to close it. Lesson for future member-doc field
additions: `isAdminOf` bypassing the whole check means this class of bug is invisible from an admin
account, so always test as a non-admin member, and test *add-then-change* — not just change — since
`changedKeys()` only breaks on the field's first write.

#### 2G.2 Shopping quantity: stop showing it, stop inventing it, let it be removed — ✅ SHIPPED 2026-07-26

Four related changes; the last two are what make the first two safe.

- **Never render quantity in the list row.** Drop the `{item.quantity && …}` span at
  `components/meals/ShoppingItemRow.tsx:250-254` and remove `item.quantity` from the `hasMeta` gate
  (`:138`). Quantity stays in the edit drawer, the CSV export (`ShoppingListTab.tsx:421`) and the shared
  text (`utils/shoppingListFormatter.ts:77-78`) — it just leaves the row. Also drop it from the memo
  comparator's concerns only if nothing else in the row reads it (`:314`).
- **Stepper can reach "none."** `components/meals/ShoppingItemForm.tsx:91` clamps at
  `Math.max(1, count - 1)`. Let decrementing from 1 land on an explicit none state — render an em-dash,
  clear the unit input too, and persist `null`. Today clearing "2 lbs" takes two separate actions
  (step down *and* blank the unit) because `formatQuantity` only returns `''` when count is 1 **and**
  the unit is empty (`utils/grocerySmartDefaults.ts:193-197`).
- **The Shortcut endpoint stops defaulting to 1.** `functions/src/quickAdd/index.ts:1165`
  (`quantity = 1` at destructure) and the batch equivalent at `:1259` (`itemObj.quantity || 1`).
  A submission with no quantity should write no quantity. Adjust the `:1387-1390` validation so absent
  is valid while a supplied non-positive value still 400s. This is the actual cause of the stray "1"
  on every shortcut-captured row: UI-created items normalize 1 → `''`, server-created ones stored a
  literal `1`.
- **Normalize quantity to string; parse on merge.** `ShoppingItem.quantity` is typed `string`
  (`types/schema.ts:927`) but the server writes a **number** and the converter spreads it unchanged —
  both shapes are in Firestore now. Server writes strings going forward. The duplicate-merge paths
  (`index.ts:1426-1428` `currentQty + quantity`, `:1292-1306`, and
  `contexts/FirebaseHouseholdContext.tsx:1076` `increment(item.quantity)`) must parse a leading number
  and increment it while preserving the unit — `"2 lbs"` + 1 → `"3 lbs"`, and a non-numeric quantity is
  left alone rather than mangled. Today those paths string-concatenate. No migration: legacy numeric
  values read correctly through the parse. `utils/grocerySmartDefaults.ts` already has
  `parseQuantity`/`formatQuantity` and tests — reuse them rather than writing a second parser, and
  mirror them server-side.

Duplicate merge still merges. Adding "milk" twice yields one row; a missing quantity counts as 1 for
accumulation, so a visible quantity only appears once there genuinely is more than one.

**Tests.** `ShoppingItemRow.test.tsx` and `ShoppingListTab.test.tsx` currently assert nothing about
quantity, and `ShoppingItemForm.tsx` has **no test file at all** — add one for the new none state.
Extend `functions/src/quickAdd/index.test.ts` for the absent-quantity default and the unit-preserving
merge. **M / LOW.**

**Shipped as #1107 — grew beyond the spec.** The legacy-numeric-quantity problem was worse than "the
duplicate-merge paths string-concatenate": a legacy **numeric** `quantity` crashed four separate
consumers expecting a string — `parseQuantity`, `printWeekHtml`'s `escapeHtml`, `geminiService`'s
`sanitizeForPrompt`, and the voice-capture path. Root-caused at the boundary instead of patched at each
call site: `shoppingItemConverter.fromFirestore` now normalizes `quantity` to a string on read, so every
client consumer sees the type the schema already promised. `functions/` is **not** covered by that
converter — the Admin SDK bypasses client Firestore converters entirely — so the server intentionally
keeps its own `string | number` handling rather than assuming the client-side normalization applies
there too.

#### 2G.3 Capture drawer: back button, and delete two things — ✅ SHIPPED 2026-07-26

All in `components/modals/CaptureModal.tsx` + `CaptureMenu.tsx`.

- **Add a back affordance.** There is currently **none** — confirmed exhaustively. From `manual`,
  `camera`, or `review` the only exit is closing the whole drawer, which wipes everything entered. The
  camera view has no cancel at all, and the two error paths (`:405`, `:468`) *dump you into the manual
  form after a failed scan with no way back to retry the scan*. The tab switcher is also hidden outside
  `menu` (`:732`), so sub-views are a dead end in every direction.
  Add a `ChevronLeft` in the existing shared header block (`:694-743`, left of the `<h2>` at `:697`),
  shown whenever `view !== 'menu'`. Back returns to the tab menu, stops the camera, and clears parsed
  rows; in-progress manual entry is discarded (the sub-view unmounts — preserving it would mean lifting
  the form's state, deliberately out of scope). Copy the pattern from
  `components/modals/HabitCreatorWizard.tsx:283-300` or `GroceryCatalogModal.tsx:145-166` — both are the
  same `Drawer` with a conditional back button composed into a custom header. Note `Drawer` has **no**
  `onBack`/`headerLeft` prop (`components/ui/Drawer.tsx:22-55`); compose it in the caller, don't extend
  the primitive.
  While here: `'upload'` is a **dead `ModalView` value** — declared at `:40`, given a title at `:709`,
  and `setView('upload')` is never called anywhere. Delete it.
- **Delete the AI PII banner outright.** `CaptureMenu.tsx:89-104`, plus the dismiss button and the
  `lifebalance_pii_notice_seen` localStorage key (`:13`, `:16-22`, `:52`, `:56`). It is the app's only
  AI disclaimer — the other AI surfaces (`PhotoImportDrawer`, meal AI, receipt paths) never had one — so
  removing it makes the app consistent, and it renders on the *menu* rather than on the screens where an
  image is actually captured. The Privacy Policy carries the disclosure. ⚠️ **That justification is a
  dependency, and it is not satisfied yet** — the policy's AI clause is still `[PLACEHOLDER: link to
  Google AI / Gemini terms]` behind the DRAFT banner, so today the disclosure exists in neither place.
  Tracked as the sub-gate on §1.2; do not treat this deletion as closed until that placeholder ships.
- **Delete the Magic Action bar and its service function.** Remove
  `components/modals/CaptureMagicAction.tsx`, its render at `CaptureMenu.tsx:106-110`, the
  `handleMagicSuccess` handler (`CaptureModal.tsx:146-174`), `parseMagicAction`
  (`services/geminiService.ts:1533+`), `validateMagicAction` (`services/geminiValidation.ts:310-327`),
  the `MagicActionResponse` type, and their tests. `CaptureMagicAction.tsx:42` is its **only** production
  caller in the repo. ⚠️ Do **not** touch the iOS-Shortcut natural-language pipeline — that is a
  separate function chain (`quickAddNaturalLanguage` → `pendingItems` → `parseNaturalLanguageCommand`)
  and must keep working. `FEATURES_ROADMAP.md:1661` proposes reusing `parseMagicAction` for a future
  `QuickAddBar`; that idea is dropped with this — update the roadmap line rather than leaving it
  pointing at deleted code.
- **Merge Scan Receipt + Upload image into one entry.** ⚠️ They are **not** the same backend today.
  Camera (`:336-341`) calls `parseReceiptLineItems` and gets the line-item split
  (`shouldSplitReceipt`) plus duplicate detection (`findMatchingPendingTransaction`). Upload
  (`:431-436`) calls `parseBankStatement` and *only if it returns an empty array* falls back to
  `analyzeReceipt` — a blind two-call cascade, no split, no duplicate check. So an uploaded receipt
  costs two Gemini round-trips and never gets line items.
  Replace both with one "Add from image" entry that opens the OS sheet (camera or library), then run
  `parseReceiptLineItems` first and fall back to `parseBankStatement` when it yields nothing — the
  reverse of today's cascade. Keep line-item split and duplicate detection on **both** sources. Pass
  `stores` and `habitTitles` consistently (camera passes no habits today, upload passes no stores on
  the non-fallback path). Analytics: keep `receipt_scanned` / `receipt_line_split` / `statement_scanned`
  firing off the parser that actually won, not off the input method, and pick a single `source` value to
  replace `'camera-scan'` / `'file-upload'` (`:517`).

**M / MED** — the image merge is the only part with real behavior risk; the other three are deletions
and a header button.

**Shipped as #1108** — as specified, plus one fix that fell out of review: a `captureRunIdRef`
stale-scan cancellation guard. Review found that the new Back button could let an in-flight scan
resolve *after* the user had already backed out and started manual entry, force-closing the drawer and
destroying the in-progress manual entry out from under them; the ref lets a scan's resolution check
whether it's still the current run before acting on it.

---

### 2H. Recurring bill vs. automated transaction — duplicate resolution

**Why.** Deferred out of the 2026-07-27 paper-cut batch (it was cut #3 there) because both halves are
features, not paper cuts. Reported from real use: a bank-screenshot scan parsed correctly into
individual transactions, but one of them was a **recurring bill that already exists as a manually
created calendar item** — at a different amount, since the bill varies. The action queue then showed
both: `Centerpoint Energy (Natural Gas)` $142.00 (the planned bill, "Due") and `Cpenergy Mngco` $37.91
(the scanned transaction, "Tx"). Two rows, one real expense, and no way to tell the app they are the
same thing.

- [x] **(b) Wire bill matching into the action queue.** — **shipped in the 2026-07-27 paper-cut
      batch.** `utils/billDescriptorMatch.ts` is a lockstep client twin of the bill-matching slice of
      `functions/src/quickAdd/bankSyncMatch.ts`, copied at existing strictness; `useActionQueue`
      runs `pickBillToPay` over its own unpaid expense rows and suppresses the bill's row on a
      match, with `ActionQueueItem` rendering a "Pays ⟨bill⟩" sub-line so the collapse is never
      silent. The collapse is derived, never persisted, so approving or deleting the transaction
      restores the bill's row.
- [x] **(a) Merge an automated transaction into a planned recurring bill from the action queue.**
      ✅ 2026-07-27. New `settleBillWithTransaction`
      (`contexts/household/mutations/calendarMutations.ts`) — added ALONGSIDE
      `linkBankTransactionToBill`, not replacing it, and deliberately not a parameterization of
      `payCalendarItem` (which unconditionally writes a SECOND transaction and carries dead
      income/paycheck/ceremony branches). One `writeBatch`: bill marked paid at the **scanned**
      amount, transaction verified + filed as `Budgeted in Calendar` + stamped with
      `paidCalendarItemId`, account balance moved, descriptor learned onto
      `bankDescriptorAliases`, activity log appended. **Exactly one record** — no transaction is
      created.
      - **Balance model:** routed through `resolveTargetAccount`/`effectiveAccountImpact`/
        `shouldSkipBankSyncDelta`, so a `pending_review` screenshot row debits its amount (it had
        never touched a balance) while a bank-sync row whose balance is already authoritative moves
        nothing, and credit-tagged rows raise card debt — all for free.
      - **Recurrence:** a synthetic occurrence id writes a NEW paid-instance doc dated to the
        occurrence's **due date** (what `expandCalendarItems` suppression keys on); the recurring
        template's own amount is never touched. A recurring template's real doc id is refused
        outright.
      - **payPeriodId is NOT retro-filed** (unlike `payCalendarItem`, which retro-files because it
        creates the transaction): the row already exists and its date is the authoritative charge
        date.
      - **Two entry points, one mutation:** `SettleBillSection` in the transaction review sheet —
        offered on ANY non-bank-sync row via a bill picker, pre-selecting `useActionQueue`'s
        `matchedBill` when there is one (the motivating Centerpoint case does NOT match, which is
        why matched-only would not have fixed it) — and the Edit Event drawer's
        `TransactionLinkPicker` (2E above). The account is confirmed via the existing
        `AccountPicker` whenever the transaction carries no tag; this write moves real money, so it
        is never guessed.
      - **Deliberately NOT done:** no habit firing and no price-change nudge on this path (both
        commented at the call site); **no `MerchantRule` upsert** (deferred — the alias write is
        kept); and **no full unlink** — instead `reverseTransactionApproval` now REFUSES to reverse
        a transaction carrying `paidCalendarItemId`, telling the user to undo from the bill side,
        rather than silently orphaning the paid-instance doc.
      - Tests: `calendarMutations.test.ts` (pending delta, bank-sync no-delta, occurrence-due-date +
        template-amount-unchanged, double-merge guard, one-batch), `transactionLinkCandidates.test.ts`,
        and the reverse-approval guard. Test Mode: new `'bill-merge'` seed variant reproduces the
        reported Centerpoint duplicate.

**Why (b) did not make (a) unnecessary, contrary to the original guess.** Only the **rule** tier
bypasses the ±10%/±$25 amount guard. The **alias** tier is gated by that same tolerance, so on a
variable-amount utility a learned alias still will not match — `Cpenergy Mngco` at $37.91 against a
$142.00 scheduled Centerpoint bill stays two rows even after the alias is learned. Two tests pin
this so nobody "fixes" it by loosening the window; a false positive here silently marks the wrong
bill paid, which is worse than a visible duplicate.

That leaves a real affordance gap, and it is the argument for (a). The alias-learning path —
`linkBankTransactionToBill` (`calendarMutations.ts:547`), surfaced as "Is this a bill payment?" in
`TransactionReviewForm.tsx` — is gated on `bankRef && status === 'verified'`, and `CaptureModal`
writes screenshot rows as `pending_review` with no `bankRef`. Both the UI gate and the mutation
refuse, correctly: that mutation marks a bill paid with **no balance delta**, which is only sound
because a bank-synced row's balance is already authoritative — a `pending_review` row's is not.
So on the screenshot-import road there is no in-drawer way to teach the link at all; today the only
route is authoring a merchant rule by hand in Settings → Merchant Rules with its bill field pointed
at the recurring template. **(a) is that missing entry point, and it needs its own
pay-with-balance-delta mutation — not a widening of the existing gates.**

---

## 3. Product backlog (needs a product decision before planning)

Per-member habit points follow-ups (from the 2026-07-30 six-stage ship, PRs #1152–#1158; spec
`.claude/PER_MEMBER_POINTS_HANDOFF.md`):

- **Automated completions carry NO per-member attribution** — the Cloud Functions quickAdd path
  (iOS Shortcuts) and the habit-trigger fires in `utils/habitTriggerFire.ts` /
  `contexts/household/mutations/{todo,transaction}Mutations.ts` write no `completedBy`, so an
  automated completion credits the household at the legacy habit-level multiplier and counts
  toward nobody's personal score. Self-consistent under grandfathering (the recompute agrees),
  but this household leans on automations, so personal scores under-count. Needs a product
  decision on WHO gets credit (the Shortcut key's owner? the transaction's member? the habit's
  `linkedMemberId`?) before wiring. **M / MED.**
- **`deleteHabitSubmission` treats the OPERATOR as the creditee** — LIVE on `main` today,
  independent of any open PR. `hooks/useHabitActions.tsx:1590` computes
  `const creditedUid = submission.attributedTo ?? submission.createdBy`, but the same file
  documents `createdBy` at :1380 as "The OPERATOR, always". Three of the four submission writers
  set NEITHER `attributedTo` NOR `creditsHousehold`:
  `contexts/household/mutations/transactionMutations.ts:627` (transaction/keyword automation —
  `createdBy` is whoever verified the triggering transaction, a REAL member uid),
  `functions/src/quickAdd/noSpendFire.ts:356` (`createdBy: "system"`), and
  `scripts/migrateHabitSubmissions.ts:130` (`createdBy: 'migration_script'`). For any of those
  docs the `?? createdBy` fallback debits the wrong member, and
  `components/modals/HabitSubmissionLogModal.tsx` lists ALL submissions unfiltered behind a delete
  button, so deleting an automation-fired row reproduces it with no PR involved. Probed: a
  neither-field doc with `createdBy` user1, on a date carrying `completedBy { user1: 1 }`, writes
  `completedBy.<date>.user1: increment -1` plus `[{ uid: user1, points.total: -10 }]` — destroying
  real attribution the doc never created; the SAME doc on a date carrying
  `completedBy { jen-uid: 1 }` debits `jen-uid`, a member with no link to the doc at all. THE TRAP
  that keeps this from being a one-liner: widening `isHouseholdSubmission` to `attributedTo == null`
  also flips `attributionMoved` (:1652), which suppresses `legacyDelta = -submission.pointsEarned`
  (:1654) — the ONLY record of a pre-attribution doc's award — so the obvious fix breaks
  grandfathered reversal. `points.total` drift is permanent (`computeHouseholdPointsSync` only ever
  RAISES it), so this is the severe class. Needs its own PR and test sweep.
  **S–M / decide the creditee rule and the grandfathered-reversal split before coding.**
- **Two trade-offs accepted deliberately in the #1166/#1169 household-undo review** (recorded so
  they are not re-litigated as bugs): (a) the tie-break on a date carrying BOTH an automation doc
  and a manual `creditsHousehold` doc was DECLINED — the newest-`createdAt` sort may delete the
  automation doc, destroying its `sourceTransactionId` audit record, after which `firedHabitIds`
  (`transactionMutations.ts:683`, `arrayUnion`, cleared only by un-verifying) prevents that habit
  ever re-firing from the transaction. Preferring `creditsHousehold` docs was rejected because it
  is NOT points-neutral: the two doc classes reverse the pool by different arithmetic
  (`periodPointsMove` decomposition vs stored `pointsEarned` via `legacyDelta`), so it changes the
  pool delta in an unprobed case. (b) A narrow accepted orphan: a grandfathered doc on a date that
  has SINCE gained attribution is no longer swept and falls back to the attribution-only
  primitive — deliberate, since sweeping it would destroy real attribution. Resolves once the
  `deleteHabitSubmission` bug above is fixed.
- **Stale-deselect of a below-target incremental prior period reverses nothing by design**
  (`processStaleDownToggle` contract) — pool and member stay mutually consistent, only orphan
  attribution residue remains. Revisit only if "undo the previous period" should mean more than
  completion-date reversal for incremental habits.
- **`payCalendarItem` atomicity test flake under heavy parallel load** — `checkPointsReset`'s
  100ms midnight-scheduler timer can add a second batch to the test's capture; fix is to
  reset/filter `batches` in that test (contexts/FirebaseHouseholdContext.test.tsx), not the code.
- **Existing `points.total` drift from the cross-member period-award bug** (fixed in PR #1163,
  2026-07-30). Before that fix, a weekly threshold habit completed by two members on different
  days paid the pool both awards but wrote only the triggering member's. `points.total` is a
  lifetime counter `computeMemberPointsReset` deliberately omits and `computeHouseholdPointsSync`
  only ever RAISES, so any drift already banked is permanent and will not self-heal. **DECIDED
  2026-07-31: do NOT repair.** Nothing reads an adult's `points.total` — every adult surface
  (standings, podium, crown, scoreboard, recap) reads `points.weekly`/`daily`, and the only
  gating reads are kid-only (`KidDashboard.tsx`, `gamificationMutations.ts`) with Kid Mode
  dormant. Magnitude is tens of points over a ~1.5-day exposure window, and the bug is frozen. A
  hardened repair tool (TOCTOU transaction guard, `Number.isFinite` guards, blanket
  threshold-habit exclusion) is PARKED on branch `fix/points-drift-repair`; PR #1168 is closed
  with the full reasoning, including the correction that the tool writes **upward only** — the
  earlier "one-way downward write" framing was wrong. Its Scan path is read-only, so a number can
  be obtained at zero risk if ever wanted. **CORRECTION 2026-07-31: there is no live successor.**
  `PointsBreakdownModal`'s threshold past-date edit (`pointsChange = 0` while `completedDates`
  was still written) carried the same one-award-per-removal inflation — probed at
  `points.total: 0` against a ground truth of `-15` — but it was NOT live and never could fire:
  the drawer's `daily`/`weekly` views went unreachable in PR #819 (`74069195`, 2026-07-05), which
  collapsed Settings' three points rows into one link hard-coded to the `total` view, and no
  other mount existed. That editor has now been DELETED as dead code (PR #1172), so the defect
  is gone rather than frozen. Nothing about the `points.total` decision above changes.
- **Reversal never rescores surviving periods whose streak multiplier the clear changed** —
  clearing period A shifts the multiplier of LATER periods that SURVIVE it, and neither
  `attributionReversalForDates` branch scores those dates: `periodPointsMove` is period-scoped by
  construction, so only the cleared period's own dates move. Probed: a daily threshold habit on a
  7-day streak, clearing day 1 alone, moves `{daily: 0, weekly: -10, total: -10}` where the truth
  is `{daily: -5, weekly: -20, total: -20}` (days 3 and 7 lose their 1.5x/2.0x step); a weekly
  threshold habit on a 4-week streak, clearing week 1 alone, moves `{daily: 0, weekly: 0,
  total: -10}` against a truth of `{daily: -5, weekly: -5, total: -20}`. Daily/weekly self-heal on
  the next corrective sync; the under-debited `total` is permanent (`computeHouseholdPointsSync`
  only ever RAISES it). PRE-EXISTING and branch-agnostic — verified identical on the untouched
  incremental branch and byte-identical pre-PR #1167, so that PR neither caused nor worsened it.
  Only reachable via BACK-DATED clears — `resetHabitDay` alone since PR #1172 deleted
  `PointsBreakdownModal`'s dead day-toggle — never a same-day reset.
  **S / decide the rescoring scope before coding.**
- **`HouseholdBadge` duplicates `MemberAvatar`'s glyph variant** — PR #1164 shipped a standalone
  `components/ui/HouseholdBadge.tsx` because the parallel Household-credit-mode PR owned
  `MemberAvatar.tsx`. Two components now draw the same circle/size/ring. Unify onto the shared
  primitive so the ring and sizing cannot drift. **XS.**
- ~~**Recap chart hides non-positive unattributed days** — `buildRecapChart` filters segments to
  `> 0`, so a week whose household share is net NEGATIVE draws no Household bar while the legend
  (added in #1164) reports the signed total. Pre-existing chart behavior, surfaced by adding the
  number next to it. Decide whether the chart should represent negative days or the legend should
  match the chart's positive-only scope. **XS.**~~ ✅ Resolved — the chart stays positive-only
  (product decision); every fix is on the LABELLING side. The household card's line now gates on
  whether the chart actually DRAWS a Household bar — a positive segment sitting on a column that
  has height, since segment existence (`day.unattributed`) and column height (`day.total`) are
  independent figures — and its wording keys off the figure's SIGN, so a loss is never phrased as
  something "earned". Each branch's stated reason is scoped to what it can actually prove: the
  loss branch names the omitted SEGMENT (all seven columns can still be drawn), and the
  positive/no-bar branch names only the days the share was GAINED on — a day carrying a NEGATIVE
  contribution is clamped out of the chart however tall its column is, so it can be the week's max
  while the total still nets positive. `householdSharePoints` is also rounded to 2dp, which is
  defensive-only in the same way the `?? 0` guards on `unattributed` are: every value the writer
  can emit is floored to an integer (`sign × floor(|basePoints| × multiplier)` × integer units, so
  a 1.5x multiplier yields no `.5`), and the rounding insures against
  `weeklyRecapConverter`'s untyped `as WeeklyRecap` cast letting a float-epsilon sum render as
  `5.55e-17` and slip past the card's `!== 0` gate.

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

- `FEATURES_ROADMAP.md` — **the sibling backlog**, features only (96 candidate briefs, 2026-07-13).
  Not "reference" in the same sense as the rest of this list: it holds real un-built work. The split
  is bugs/ops/hardening here, features there, **no duplication in either direction** — where an idea
  overlapped this file it was dropped there with a cross-reference. Nothing in it is greenlit.
- `docs/plans/phase-2b-deterministic-nl-quickadd.md` — execution detail for the Phase 2b item in §2A
  (the only surviving doc from the old `plans/` tree; status *planned / not started*)
- `docs/PRODUCT_ROADMAP.md` — product strategy + the analytics event dictionary (Part 7)
- `docs/PRELAUNCH_CHECKLIST.md` — the ordered public-launch gate (legal → open signup)
- `docs/DEPLOY_CHECKLIST.md` — gated ops/security actions requiring console/Admin-SDK access
- `docs/STRIPE_SETUP_RUNBOOK.md` · `docs/PLAID_SETUP_RUNBOOK.md` — external-service activation
- `docs/ADR-bucket-color-keys.md` — architecture decision record
- `docs/integrations/*.md` — import/export integration guides
- `SECURITY_MODEL.md` · `NOTIFICATIONS.md` — living reference
- `CLAUDE.md` · `DESIGN.md` · `LINT_SUPPRESSIONS.md` — agent/design/quality guidance
