# LifeBalance — Features Roadmap

This document is a catalog of **candidate features**, produced by a multi-agent codebase
exploration + ideation + critic pipeline on **2026-07-13**. Seven domain agents read the actual
code and proposed features grounded in real files/mutations/patterns; a critic pass then proposed
cross-cutting ideas the domain-scoped agents couldn't see. This file is the synthesis: deduped,
cross-referenced against `TODO.md`, and organized for a future agent (human or AI) to pick one
item and implement it without needing this conversation's context.

**Audited and pruned on 2026-08-04:** a nine-agent audit re-verified every brief against the
shipped code. 62 briefs were confirmed shipped and deleted outright — a finished item is deleted,
not annotated, per `CLAUDE.md`'s Repo Hygiene convention — and the remaining 36 were re-verified
as still open; five of those were rewritten to describe only the scope that's actually left, and
two picked up a one-line note where a dependency or target surface shifted underneath them.

**This file is features only.** Bugs, perf/security hardening, ops gates, and other non-feature
backlog live in `TODO.md` — that remains the single source of truth for "what's broken / what
needs a human." Do not duplicate items between the two; where a workflow idea overlapped existing
`TODO.md` items, it was dropped here with a cross-reference instead of being re-listed.

## How to use this doc

Pick an item, read its **Implementation notes** and **Key files**, and go — each entry names the
actual mutations/components/patterns to extend rather than describing the feature abstractly.
Sizes are rough-order-of-magnitude effort (tweak < small < medium < large < suite); "suite" items
are multi-PR efforts that should be sequenced, not shipped as one PR. Nothing here is greenlit —
these are candidates for a product-scope conversation, same as `TODO.md` §3.

**Conventions** (see `CLAUDE.md` for full detail): pnpm only, never npm; `@/` imports only
(no parent-relative `../`); money is stored/passed as **decimal dollars** — `utils/money.ts`
helpers sum in integer cents internally but never write cents to Firestore; "today" comes from
`getLocalDateString()`, never `new Date().toISOString()`; strict TypeScript, zero lint/type
suppressions without a tracked justification (see `LINT_SUPPRESSIONS.md`); any `firestore.rules`
/ `firestore.indexes.json` change ships in its own small, human-watched PR (tagged `[rules]` /
`[index]`); atomic multi-document mutations use a single `writeBatch` (see CLAUDE.md's Atomicity
paragraph for the existing examples to mirror).

---

## Index

| ID | Title | Domain | Size | Value | Hook | Human Notes for AI agent (if empty, no notes / ready to implement) |
|---|---|---|---|---|---|---|
| F-MONEY-03 | Bucket rollover | Money | medium | high | Carry unspent bucket limit into next period | Optional, user settings flag |
| F-MONEY-04 | Credit card due-date tracking + reminders | Money | medium | high | Push reminder before a card's statement due date | Optional, user settings flag like all push notifications|
| F-MONEY-07 | Sweep Safe-to-Spend leftover into a savings goal | Money | tweak | medium | One-tap move unallocated leftover to a goal — engine + goal mutation already wired, only the UI remains | |
| F-HABITS-04 | Export habit completion history to CSV | Habits & Gamification | small | low | Per-completion-date rows — the existing export is per-habit summary only | |
| F-HABITS-08 | "At risk today" streak filter chip | Habits & Gamification | tweak | medium | Triage which habits need attention right now | |
| F-HABITS-10 | Nudge a housemate (partner-nudge) | Habits & Gamification | medium | high | Merged habits+notifications idea; ad-hoc peer push | |
| F-HABITS-11 | Custom color tags per habit category | Habits & Gamification | tweak | low | Bucket-color pattern reused for habit categories | |
| F-HABITS-13 | Photo-verified habit completion (Gemini vision) | Habits & Gamification | suite | high | AI plausibility check on a chore photo | Hold off for now |
| F-MEALS-02 | Meal-plan gap reminder push | Meals & Shopping | medium | medium | Sunday nudge when dinners are unplanned | User-settings flag |
| F-MEALS-05 | Leftover / "use it up" nudge | Meals & Shopping | tweak | medium | Stale catalog items surfaced on the shopping list | Hold off for now |
| F-MEALS-10 | "Repeat last week's shop" | Meals & Shopping | tweak | medium | Re-add everything purchased on the last trip | |
| F-MEALS-12 | Recipe photo attachment | Meals & Shopping | small | low | Personal photo on a saved recipe | Make sure we appropriately compress image size |
| F-MEALS-13 | Shopping list collaborative presence | Meals & Shopping | small | low | "Sam is shopping" live indicator | How would we even track this? |
| F-TODO-02 | Completion points for every member | To-Dos & Lists | medium | high | Extend kid-only to-do points to any assignee | |
| F-TODO-04 | Chore rotation & fairness suite | To-Dos & Lists | suite | high | Rotating assignment + fairness indicator | Dependency shipped: `ToDo.recurrence` (F-TODO-01) is real now — extend it rather than inventing recurrence |
| F-TODO-05 | "Who does what" completion analytics | To-Dos & Lists | large | medium | Per-member completion/on-time-rate bar chart | |
| F-TODO-10 | Batch reassign in FAB | To-Dos & Lists | small | medium | Bulk move tasks from one person to another | |
| F-DASH-01 | Dashboard universal AI quick-capture bar | Dashboard & AI | medium | high | Natural-language capture without opening a modal | Hold off for now |
| F-DASH-05 | Scoped insight regeneration | Dashboard & AI | small | medium | Spending / Habits / Surprise-me insight lens | |
| F-DASH-07 | Streaks-at-risk quick actions in recap | Dashboard & AI | small | medium | "Mark done today" button inline in the recap drawer | Target surface is now `RecapDeck`'s FinishCard too; `streaksAtRisk` still lacks a `habitId` |
| F-DASH-10 | "Explain this number" tap-to-ask AI | Dashboard & AI | medium | medium | On-demand one-sentence explanation of a stat | |
| F-DASH-12 | Insight archive filter and search | Dashboard & AI | small | low | Filter/search past insights | |
| F-DASH-13 | Tappable PulseStrip cells | Dashboard & AI | tweak | low | Spent/Consistency cells become navigation shortcuts | |
| F-NOTIF-01 | Quiet hours / do-not-disturb window | Notifications & Server Jobs | small | high | Global DND across all push categories | |
| F-NOTIF-04 | FCM token health & multi-device UI | Notifications & Server Jobs | small | medium | See/revoke registered push devices | |
| F-NOTIF-05 | Notification action buttons | Notifications & Server Jobs | small | medium | Extend already-live "Mark Paid"/"Snooze"/"Log it" to streak-warning + action-queue pushes | iOS renders no push action buttons at all (confirmed platform limitation) — Android/desktop bonus only |
| F-NOTIF-06 | Smart bill-reminder lead time | Notifications & Server Jobs | small | medium | Suggest lead time from pay-cycle cadence | |
| F-NOTIF-08 | Low-balance alert tuning | Notifications & Server Jobs | small | medium | Percent/trend thresholds, not just a flat dollar amount | |
| F-NOTIF-11 | Snooze a reminder type for N days | Notifications & Server Jobs | tweak | low | Configurable N days + habit/streak/action-queue coverage | Bill-reminder snooze already ships, fixed at 1 day |
| F-PLAT-02 | Freemium usage-limit nudge banners | Platform & Growth | medium | high | Three `PaywallModal` nudges at the AI/member/kid caps | Enforcement is fully live; only the point-of-friction UX remains |
| F-PLAT-04 | In-app waitlist capture | Platform & Growth | medium | medium | Code-only alternative to a landing page | |
| F-PLAT-05 | Stripe customer billing portal | Platform & Growth | medium | medium | Self-serve card update/cancel via Stripe Portal | |
| F-PLAT-06 | Trial period on Stripe checkout | Platform & Growth | small | medium | 14-day free trial, data model already supports it | |
| F-PLAT-08 | Regenerate invite code | Platform & Growth | small | medium | Rotate a leaked household invite code | |
| F-PLAT-10 | GA4 user properties for segmentation | Platform & Growth | small | medium | Segment analytics by plan/module shape | |
| F-PLAT-11 | Onboarding funnel analytics | Platform & Growth | small | medium | Per-step drop-off events, not just one completion event | |

---

## Money

### F-MONEY-03 — Bucket rollover: carry unspent limit into next period

**Size:** medium · **Value:** high · **Dependencies:** none

A per-bucket opt-in toggle ("Roll over unspent") so a bucket's effective limit for the current
pay period is `limit + max(0, previousPeriodRemaining)` instead of always resetting flat. Useful
for irregular-cadence categories (car maintenance, gifts, annual subscriptions saved up over
several periods).

**Why:** The historical data already exists and is written every period close: each bucket's
`BucketPeriodSnapshot` (`types/schema.ts`) captures `limit`/`totalSpent`/`periodId`, exposed as
`bucketHistory` on the finance slice. This is additive to the bucket model and does not touch the
Safe-to-Spend formula — buckets are explicitly a display/tracking overlay, never subtracted from
`safeToSpend` (CLAUDE.md), so it can't destabilize core money math.

**Implementation notes:** Add `rolloverEnabled?: boolean` to `BudgetBucket`. Add a pure,
testable `getEffectiveBucketLimit(bucket, bucketHistory, currentPeriodId)` (new
`utils/bucketRollover.ts` or extend `utils/bucketSpentCalculator.ts`): find the most recent
`BucketPeriodSnapshot` for this bucket with `periodId < currentPeriodId`, compute its unspent
(`limit - totalSpent - totalPending`, floored at 0), add to `bucket.limit` when
`rolloverEnabled`. Thread the effective limit through `BudgetBucketCard`/`BudgetBuckets.tsx`
display and `computeSafeToSpendDistribution` (`utils/safeToSpendDistribution.ts`) so "remaining"
figures reflect it. Add the toggle to `components/modals/BucketFormModal.tsx`. Cap rollover
accumulation (never roll over more than N periods, or cap at some multiple of the base limit) to
avoid unbounded "phantom" limit growth — make this an explicit product decision in the toggle's
help text. Unit-test the pure helper against chained snapshots (2-3 period compounding).

**Key files:**
- `types/schema.ts`
- `utils/bucketSpentCalculator.ts` / new `utils/bucketRollover.ts`
- `utils/safeToSpendDistribution.ts`
- `components/budget/BudgetBuckets.tsx`, `components/budget/BudgetBucketCard.tsx`
- `components/modals/BucketFormModal.tsx`

### F-MONEY-04 — Credit card due-date tracking + payment reminders

**Size:** medium · **Value:** high · **Dependencies:** FCM push infrastructure (already live); optionally sequence after the TODO.md-planned 4-cron merge to avoid adding a 5th hourly job

Add optional `dueDayOfMonth` and `statementBalance` fields to credit `Account`s, surfaced as a
due-date chip on the account row and a reminder push ("Chase card payment due in 3 days — $412
statement balance") a few days before due, mirroring the existing bill-reminder pattern.

**Why:** The app already has a full notification-preference + scheduled-reminder pattern for
bills (`NotificationPreferences.billReminders`, `sendbillreminders`), but it only fires off
`CalendarItem` due dates — a credit card's own statement due date isn't a calendar item unless
manually created, so cards silently fall outside bill reminders today.
`CreditCardActivityWidget`/`accountImpactOf()` already model card debt correctly; this closes the
reminder gap for the payment itself.

**Implementation notes:** Add `dueDayOfMonth?: number` (1-28, sidesteps month-length edge cases)
and `statementBalance?: number` to `Account`, editable via a new field in the account drawer in
`components/budget/BudgetAccounts.tsx` (only when `type === 'credit'`). New scheduled Cloud
Function (or fold into the planned bill-reminder dispatcher merge) that, per-member-timezone
(`formatInTimeZone`, matching `sendbillreminders`/`sendstreakwarnings`), scans credit accounts
with `dueDayOfMonth` set, computes days-until-due (rolling to next month once past), and sends via
the shared FCM helper. Reuse or extend the `billReminders` preference. `statementBalance` is
purely informational — never feeds Safe-to-Spend or `Account.balance`, same non-authoritative
pattern as `plaidBalanceCurrent`.

**Key files:**
- `types/schema.ts`
- `components/budget/BudgetAccounts.tsx`
- `functions/src/index.ts`
- `utils/accountImpact.ts`

### F-MONEY-07 — Sweep Safe-to-Spend leftover into a savings goal

**Size:** tweak · **Value:** medium · **Dependencies:** none

**Status: mostly already shipped.** The engine and the mutation both exist —
`computeSafeToSpendDistribution()` (`utils/safeToSpendDistribution.ts`) already computes
`leftover` as a first-class field, `SafeToSpendBreakdownDrawer.tsx` already has a
`LedgerRow panelKey="leftover"` itemizing it, and `contributeToGoal(id, amount)` already exists on
the finance slice (used by `components/budget/SavingsGoals.tsx`) as a single cents-safe doc
update. **Only remaining:** wire the two together with a UI affordance in the drawer, plus the
analytics event.

**Implementation notes:** In `components/budget/SafeToSpendBreakdownDrawer.tsx`, near the
"Unallocated"/leftover `LedgerRow`, add a "Move to a savings goal" button visible only when
`leftover > 0` and `savingsGoals.length > 0`. Clicking opens a small goal picker (reuse `Select`
or a mini `Drawer`) and calls the existing `contributeToGoal(goalId, leftover)`. This is a manual,
user-confirmed action, fitting the existing v1 "manual contributions only" design constraint on
`SavingsGoal` — and since goals never feed back into `safeToSpend`, sweeping money out of the
leftover pool into a goal can't double-count. Track with a new analytics event
`sts_leftover_swept` (mirrors `plaid_balance_adopted` in `services/analytics.ts`).

**Key files:**
- `components/budget/SafeToSpendBreakdownDrawer.tsx`
- `utils/safeToSpendDistribution.ts`, `contexts/household/types.ts`, `services/analytics.ts`

## Habits & Gamification

### F-HABITS-04 — Export habit completion history to CSV

**Size:** small · **Value:** low · **Dependencies:** none

**Status: partially shipped.** A CSV export already exists —
`components/habits/HabitsHeaderMenu.tsx`'s "Export to CSV" calls `pages/Habits.tsx`'s
`handleExport`, via `generateCsvExport`. But it emits **one row per habit** (title, category,
streak, lifetime count, points) — a summary, not a history. **Only remaining:** a per-completion-
date export (one row per date completed, from `completedDates`/`frozenDates`/submissions), which
this brief's original scope actually meant.

**Implementation notes:** New pure `utils/habitExport.ts` building a CSV string with one row per
completion date, from `habit.completedDates` (+ `frozenDates`) and, if available, fetched
`HabitSubmission` docs (reuse the existing on-demand `getDocs` fetch pattern already used by
`HabitSubmissionLogModal.tsx`'s Stats/Calendar tabs — submissions have no standing listener per
CLAUDE.md). Add this as a second export option (e.g. "Export completion history") alongside the
existing per-habit summary export in `HabitsHeaderMenu.tsx`/`pages/Habits.tsx`, or fold both into
one CSV with a `rowType` column. Trigger a client-side Blob download, same idiom as the existing
`generateCsvExport`. No writes, no Cloud Function.

**Key files:**
- `utils/habitExport.ts` (new), `utils/exportUtils.ts` (existing `generateCsvExport` pattern to mirror)
- `components/habits/HabitsHeaderMenu.tsx`, `pages/Habits.tsx`

### F-HABITS-08 — "At risk today" streak sort/filter chip

**Size:** tweak · **Value:** medium · **Dependencies:** none

A segmented toggle on the Habits Track tab that re-sorts/filters to habits whose multiplier is
about to drop or whose period is about to close without a completion, so a user with 15 habits
can triage which actually needs attention right now.

**Why:** All the data already exists client-side (`streakDays`, `period`, `count`,
`completedDates`) — pure client sort logic, zero backend/schema change, directly extending the
existing 3/7-day and 2/4-week multiplier ladders already surfaced via HabitCard's "next tier
nudge."

**Implementation notes:** New pure `utils/habitRisk.ts`: "at risk" = incomplete today AND
(`streakDays` === one-below-next-tier per `getMultiplier`'s thresholds, OR `streakDays >= 1` for a
habit that would reset to 0 tonight). Wire a toggle into `HabitsHeaderMenu.tsx` or above
`HabitCategoryList` in `pages/Habits.tsx`; when active, flatten/re-order the habits array across
categories. No writes, no new reads.

**Key files:**
- `utils/habitRisk.ts` (new)
- `components/habits/HabitsHeaderMenu.tsx`, `pages/Habits.tsx`, `components/habits/HabitCategoryList.tsx`
- `utils/habitLogic.ts` (reuse `getMultiplier`)

### F-HABITS-10 — Nudge a housemate about a shared habit / to-do (partner-nudge)

**Size:** medium · **Value:** high · **Dependencies:** existing FCM token + `notificationPreferences` plumbing

*(Merged: this is the same feature independently proposed by the Habits domain as "Nudge a
housemate about a shared habit" and by Notifications as "Partner-nudge notifications" — one
mechanism, two surfaces.)* A "Nudge" action on a shared, incomplete habit (or pending item) that
sends a push to the other household members ("Sam nudged you about Take out trash" /
"remind Alex to log today's spending"), directly from the habit card or budget review screen —
light social accountability without a full chat/comment system.

**Why:** The FCM push infrastructure and per-member `fcmTokens`/preference plumbing already
exists and is exercised by four scheduled reminder crons; this reuses the exact same
`sendNotificationToUser` helper for an ad-hoc, user-triggered push instead of a scheduled one.

**Implementation notes:** New callable Cloud Function (e.g. `functions/src/nudgeHabit.ts` or a
more generic `sendNudge({toMemberUid, context})`), exported from `functions/src/index.ts`, that
validates the caller is a household member, reads the target doc, checks a rate-limit field
(e.g. `Habit.lastNudgedAt?: string`, capped to once per habit/context per hour or day
server-side), and calls the existing `sendNotificationToUser`
(`functions/src/shared/notifications.ts`) against every OTHER member's `fcmTokens` who has the
relevant reminders enabled. Add a "Nudge household" menu item to `HabitCard.tsx`'s Menu (shown
only when `isShared !== false`, `!assignedTo`, incomplete today) and a small icon on
`TransactionReview`/budget review for money-side nudges, both calling the new callable via lazy
`getFunctionsInstance()` per CLAUDE.md's boot-bundle notes.

**Key files:**
- `functions/src/nudgeHabit.ts` (new), `functions/src/index.ts`, `functions/src/shared/notifications.ts`
- `types/schema.ts`, `components/habits/HabitCard.tsx`, `components/budget/`

### F-HABITS-11 — Custom color tags per habit category

**Size:** tweak · **Value:** low · **Dependencies:** none

Let a household pick a color per habit category (Health, Chores, Learning, etc.), rendered as a
colored header/pill in the Track tab's category groups — same visual affordance budget buckets
already have.

**Why:** Categories today are plain strings with a flat neutral header
(`HabitCategoryList.tsx`); the app already has a proven "named color token" pattern for exactly
this (`BudgetBucket.color`/`data/bucketColors.ts`/`bucketColorClass`), so this is direct reuse in
a new spot.

**Implementation notes:** Add `habitCategoryColors?: Record<string,string>` to `Household`
(category name → a key from a new/reused color-token set, mirroring `data/bucketColors.ts`'s
key-based approach post the bucket-color migration). Add a small color-swatch picker to the
category field in `HabitFormModal.tsx`/`CustomHabitForm.tsx`, write via a lightweight
`setHabitCategoryColor` mutation (plain `updateDoc` on the household doc, no rules change). Read
in `HabitCategoryList.tsx` to color the section header.

**Key files:**
- `types/schema.ts`
- `components/modals/HabitFormModal.tsx`, `components/habits/CustomHabitForm.tsx`, `components/habits/HabitCategoryList.tsx`
- `data/bucketColors.ts` (pattern to mirror)

### F-HABITS-13 — Photo-verified habit completion via Gemini vision

**Size:** suite · **Value:** high · **Dependencies:** `aiEnabled` flag, daily AI quota, likely `billingEnabled`/premium gating; new Storage rules surface

Let a household mark specific habits (workout, a kid's chore, practicing an instrument) as
requiring a photo to check off — tapping opens the camera, the photo uploads and gets a quick AI
plausibility check, then the habit completes with the photo attached to its history.

**Why:** Directly reuses the app's most-proven AI pattern — `analyzeReceipt()`/
`parseGroceryReceipt()` already do "upload a photo, get structured AI output back" through the
`geminiproxy` Cloud Function with no client-held API key — applied to habit proof instead. A
meaningful accountability upgrade over an honor-system tap, particularly valuable for the dormant
Kid Mode chore flow once flipped.

**Implementation notes:** Add `Habit.requiresPhotoProof?: boolean`. New `HabitProof` subcollection
doc under `households/{id}/habits/{habitId}/proof/{date}` with
`{date, photoUrl, aiVerdict: 'plausible'|'unclear', confidence, verifiedAt}`. Client: reuse the
existing camera-capture UI pattern from the receipt-scan flow, upload to Firebase Storage at a
new path (needs its own Storage-rules PR, human-watched — same caveat as `TODO.md` §3's G10
receipt-persistence item, scoped narrowly to habit proof). Server: new `analyzeHabitProof()` in
`services/geminiService.ts` + a matching case in `functions/src/geminiProxy.ts`, following the
exact `analyzeReceipt` request/response/retry/timeout pattern, gated by `aiEnabled` and the daily
AI-quota transaction — likely worth premium-gating via `utils/entitlements.ts` given the added AI
cost per household.

**Key files:**
- `types/schema.ts`, `services/geminiService.ts`, `services/geminiService.types.ts`
- `functions/src/geminiProxy.ts`, `components/habits/HabitCard.tsx`, `components/modals/HabitFormModal.tsx`
- `utils/entitlements.ts`, `firestore.rules`/Storage rules (separate human-watched PR)

## Meals & Shopping

Note: meals/grocery spend → Groceries bucket linkage and the AI Weekly Planner save-back-to-calendar
item are already tracked in `TODO.md` §3 — not re-listed here.

### F-MEALS-02 — Meal-plan gap reminder push notification

**Size:** medium · **Value:** medium · **Dependencies:** none

A new opt-in scheduled push (e.g. Sunday evening) checking whether the upcoming week has any
unplanned dinner slots and, if so, nudging the user to plan meals.

**Why:** The app already has four scheduled per-timezone notification jobs and a full FCM
plumbing/`NotificationPreferences` pattern — this slots a fifth into an existing, well-understood
system.

**Implementation notes:** Add `mealPlanReminders?: {enabled, time}` to `NotificationPreferences`,
toggle in `NotificationSettings.tsx`. New scheduled function `sendmealplanreminders` in
`functions/src/index.ts`, modeled on `sendbillreminders` (per-member-timezone via
`formatInTimeZone`) — read `mealPlan` items for the next 7 days directly via Admin SDK (not the
client's windowed listener), count dinner slots with no item, send via the shared FCM helper if
any unplanned dinners exist.

**Key files:**
- `types/schema.ts`, `components/settings/NotificationSettings.tsx`
- `functions/src/index.ts`, `functions/src/shared/notifications.ts`

### F-MEALS-05 — Leftover / "use it up" nudge on shopping list

**Size:** tweak · **Value:** medium · **Dependencies:** none

Surface a small badge/section at the top of the shopping list for catalog items with an old
`lastPurchased` date not currently on the list — a lightweight "you might be low on these"
reminder, distinct from the AI-driven weekly-plan use-it-up logic (which only fires during full
plan generation).

**Why:** Cheap, pure-client feature reusing the already-loaded `groceryCatalog` slice (bounded to
200, purchase-count ordered) with zero new Firestore writes or AI calls.

**Implementation notes:** Add pure selector `utils/staleCatalogItems.ts` filtering
`groceryCatalog` for `purchaseCount > 1 && lastPurchased older than X days` (configurable, e.g.
21) and not already name-matched in current `shoppingList`. Render as a collapsible "Running low?"
chip row above the main list in `ShoppingListTab.tsx`; tapping a chip calls the existing
`addShoppingItems([...])` mutation (already used by `QuickRestockDrawer.tsx`).

**Key files:**
- `utils/staleCatalogItems.ts`
- `components/meals/ShoppingListTab.tsx`, `contexts/household/mutations/shoppingMutations.ts`

### F-MEALS-10 — "Repeat last week's shop" one-tap restock

**Size:** tweak · **Value:** medium · **Dependencies:** none

A single button that re-adds every item purchased in the most recent completed shopping trip back
onto the current list, for households that buy roughly the same groceries weekly but don't want
to maintain a formal QuickStockList template.

**Why:** `clearPurchasedShoppingItems` already wipes purchased items after a trip; capturing what
was cleared as a lightweight "last trip" snapshot is cheap and serves the same repeat-shopper need
as QuickStockList but with zero manual template setup — a complement, not a duplicate.

**Implementation notes:** In `makeClearPurchasedShoppingItems`
(`contexts/household/mutations/shoppingMutations.ts`), before deleting purchased items, snapshot
`{name, category, store, quantity}` into a new bounded field `Household.lastShoppingTrip?: {items:
[...], clearedAt: string}` (small array, similar bounding to `redemptionHistory`). Add a "Repeat
last shop" button in `ShoppingListTab.tsx` (near the `QuickRestockDrawer` trigger) calling the
existing `addShoppingItems()` with the snapshot, filtering out names already on the current list
(reuse `QuickRestockDrawer.tsx`'s normalization logic).

**Key files:**
- `contexts/household/mutations/shoppingMutations.ts`, `types/schema.ts`
- `components/meals/ShoppingListTab.tsx`, `components/meals/QuickRestockDrawer.tsx`

### F-MEALS-12 — Recipe photo attachment (own-photo, not OCR import)

**Size:** small · **Value:** low · **Dependencies:** Firebase Storage bucket + security rules for household-scoped image uploads (verify existing usage elsewhere before assuming set up)

Let a user attach a photo to a saved Meal (finished-dish photo, or a handwritten family recipe
card snapshot) — distinct from the receipt-OCR/recipe-URL-import flows, which extract structured
data rather than preserve a personal image.

**Why:** The app already has a full image-capture pipeline (`CaptureModal`, receipt scanning) and
Firebase Storage is implicitly available elsewhere (photo uploads for gamification/profile
avatars) — reuses that infra for a low-effort Cookbook personalization touch.

**Implementation notes:** Add `Meal.photoUrl?: string`. In `RecipeModal.tsx`/`AddMealModal.tsx`,
add an optional image picker (reuse the `CaptureModal`/camera-input pattern, or a plain
`<input type="file" accept="image/*">` if no shared uploader exists) uploading to Firebase Storage
under `households/{householdId}/mealPhotos/{mealId}`, storing the download URL on `photoUrl`.
Display as a thumbnail/header image in `CookbookModal.tsx`/`RecipeModal.tsx`. Verify Storage
security rules permit household-scoped writes before shipping.

**Key files:**
- `types/schema.ts`
- `components/meals/RecipeModal.tsx`, `components/meals/AddMealModal.tsx`, `components/meals/CookbookModal.tsx`, `firebase.config.ts`

### F-MEALS-13 — Shopping list collaborative presence ("who's shopping now")

**Size:** small · **Value:** low · **Dependencies:** none

Show a small avatar/indicator on the Shopping tab when another household member currently has the
shopping list open, so two people don't accidentally duplicate a trip.

**Why:** Firestore's real-time `onSnapshot` sync already makes the list live across devices; this
surfaces that liveness as a small social signal at the cost of one ephemeral presence write.

**Implementation notes:** Lightweight presence doc `households/{id}/presence/{uid}` with
`{screen: 'shopping', updatedAt: serverTimestamp()}`, written on mount/unmount of
`ShoppingListTab.tsx` (or a small reusable `usePresence(screen)` hook), refreshed every ~30s while
mounted; treat entries older than ~2 min as stale (computed client-side, no cleanup function
needed). Subscribe via a small bounded listener. Given CLAUDE.md's emphasis on
bounded/minimal listeners, weigh whether the added listener count is worth it — genuinely
nice-to-have, not core.

**Key files:**
- `contexts/household/listeners/shoppingListeners.ts`, `components/meals/ShoppingListTab.tsx`
- `hooks/usePresence.ts` (new), `types/schema.ts`

## To-Dos & Lists

### F-TODO-02 — Completion points for every household member, not just managed kids

**Size:** medium · **Value:** high · **Dependencies:** new household settings toggle; interacts with Kid Mode's points display, which currently assumes only managed kids earn to-do points

Today `computeTodoCompletionCredit` only ever credits a managed kid; a parent or teen who
completes their own to-dos earns nothing. Add a household-level toggle extending the same points
system so any assignee can optionally earn points, feeding the same daily/weekly/total
points/leaderboard habits already use.

**Why:** Habits already have a full points/streak/leaderboard system; to-dos are
gamification-adjacent but currently opt out for everyone except kids. Surfacing this as a
deliberate, toggleable extension respects the existing dormancy-gate design intent rather than
silently changing behavior for existing households.

**Implementation notes:** Add `Household.settings.choresEarnPointsForAll?: boolean` (default
`false`, existing behavior unchanged), toggle in `pages/Settings.tsx`. Modify
`computeTodoCompletionCredit` (`utils/todoPoints.ts`, currently
`if (!assignee || assignee.isManaged !== true) return null`) to accept the setting and, when true,
also credit non-managed assignees at a smaller default (new distinct constant, or reuse
`DEFAULT_TODO_POINTS`). No change needed to the atomic write path — `makeCompleteToDo`
(`contexts/household/mutations/todoMutations.ts`) already batches the completion write with the
member's points increment; it just needs the gate function to return non-null more often. Loosen
`TodoRow.tsx`'s points-badge conditional (currently gated on `assignee?.isManaged === true`) in
tandem so non-kid assignees also see their earned-points chip.

**Key files:**
- `utils/todoPoints.ts`, `contexts/household/mutations/todoMutations.ts`
- `components/todos/TodoRow.tsx`, `pages/Settings.tsx`, `types/schema.ts`

### F-TODO-04 — Chore rotation & fairness suite

**Size:** suite · **Value:** high · **Dependencies:** the "who does what" analytics view below; FCM tokens + `actionQueueReminders` preference must be enabled per member

**Note:** `ToDo.recurrence` (F-TODO-01) has since shipped — this suite should extend that real
field rather than invent recurrence from scratch, as the original dependency note assumed.

Turns recurring chores into a fair rotation system: a recurring to-do can be assigned to a
rotating pool of members instead of one fixed person, auto-reassigning to the next person each
recurrence; a fairness indicator shows each member's completed-vs-assigned ratio over the last 30
days; the morning reminder is enriched to call out whose turn it is.

**Why:** Combines three flagged gaps (no recurrence, no analytics, to-dos points-dormant for
adults) into one coherent, higher-ambition surface — the household's answer to "whose turn is it
to take out the trash," genuinely differentiated versus a generic to-do app.

**Implementation notes:** Builds on F-TODO-01's `recurrence` field: extend to `recurrence:
{frequency; rotation?: string[] /* ordered member uids */; rotationIndex?: number}`. When
`makeCompleteToDo`'s recurring-spawn batch creates the next instance, if `rotation` is set it
assigns to `rotation[(rotationIndex + 1) % rotation.length]` and advances `rotationIndex` —
denormalize onto each spawned instance the same way `CalendarItem.parentRecurringId` already
denormalizes recurrence identity, rather than a new parent-doc model. The fairness indicator
reuses the "who does what" analytics view's per-member completion counts, filtered to
recurrence-having tasks. For the reminder digest, extend `sendactionqueuereminders`
(`functions/src/index.ts`) — it already computes each member's incomplete todos due today per
their stored timezone; no new cron needed, just enrich the notification body with rotation
context when marked as a rotating chore. Ship in phases: (1) recurrence + rotation assignment +
tests, (2) fairness view, (3) notification copy enrichment — each independently shippable.

**Key files:**
- `types/schema.ts`, `contexts/household/mutations/todoMutations.ts`, `contexts/household/mutations/calendarMutations.ts`
- `functions/src/index.ts`, `components/todos/TodoStatsDrawer.tsx`, `pages/ToDosPage.tsx`

### F-TODO-05 — "Who does what" completion analytics view

**Size:** large · **Value:** medium · **Dependencies:** optional premium gating via `billingEnabled` + `entitlements.ts` `historyMonths` for windows beyond 30 days

A stats view showing per-member completion counts and on-time rate over the last 7/30 days — a
simple bar chart giving visibility into whether chore load is actually balanced.

**Why:** The domain explorer flagged "no task performance metrics/analytics on completion rates
per assignee" as a gap. The app already has a `components/analytics/` folder with recharts-based
widgets for finance/habits — this extends the pattern to to-dos, and can be premium-gated the same
way weekly recap is, giving billing a second differentiator.

**Implementation notes:** The live todos array is already windowed to a 30-day completed set
(`TODO_COMPLETED_PAGE_SIZE`, `utils/listenerWindows.ts`) plus on-demand older pages via
`loadOlderCompletedTodos`, sufficient for a 30-day view without a new query. For longer windows,
gate on `getLimits(household).historyMonths` (`utils/entitlements.ts`, same free/premium split
used elsewhere) and repeatedly page via `loadOlderCompletedTodos`. Build
`components/todos/TodoStatsDrawer.tsx` (or a chart in `components/analytics/`), grouping
`todos.filter(t => t.isCompleted)` by `assignedTo`, computing count + `completedAt`-minus-
`completeByDate` lateness per member using the same date-parsing already in `ToDosPage.tsx`'s
completed-bucket memo. Add an entry point in the overflow menu. Lazy-load the drawer/chart
component — recharts is already vendor-chunked off the boot path per CLAUDE.md.

**Key files:**
- `pages/ToDosPage.tsx`, `components/todos/TodoStatsDrawer.tsx` (new)
- `utils/entitlements.ts`, `utils/listenerWindows.ts`

### F-TODO-10 — Batch reassign in the floating action bar

**Size:** small · **Value:** medium · **Dependencies:** none

The batch selection FAB currently offers Complete, Reschedule, Delete. Add a fourth action,
Reassign, opening a small member picker and updating `assignedTo` on every selected task in one
batch.

**Why:** Natural sibling to the existing batch-reschedule flow — same shape of problem (bulk
`updateToDo` across `selectedIds`), and a common real need: moving last week's overflow from one
person to another.

**Implementation notes:** Add `BatchReassignModal.tsx` modeled directly on
`BatchRescheduleModal.tsx` (same `isOpen`/`onClose`/`onConfirm`/`count` shape, swapping the date
picker for the member-chip picker already used in the assign-to fieldset). Add
`isBatchReassignOpen` state and a `handleBatchReassign(uid)` mirroring `handleBatchReschedule` but
calling `updateToDo(id, {assignedTo: uid})` via `Promise.allSettled` over `selectedIds`. Add the
FAB button next to Reschedule with a `User` icon (lucide-react).

**Key files:**
- `pages/ToDosPage.tsx`, `components/modals/BatchRescheduleModal.tsx`, `components/modals/BatchReassignModal.tsx` (new)

## Dashboard & AI

### F-DASH-01 — Dashboard universal AI quick-capture bar

**Size:** medium · **Value:** high · **Dependencies:** AI kill-switch (`aiEnabled`) must be on; needs a NEW natural-language classifier (see Why)

A persistent free-text input pinned near the top of the Dashboard (built on `QuickAddBar`) that
accepts natural language — "spent $12 at Target," "buy milk," "call the vet tomorrow" — and routes
it to create a transaction, shopping item, or todo directly, without opening the full
`CaptureModal`.

**Why:** This previously proposed reusing `CaptureModal`'s "Magic Action" classifier
(`parseMagicAction`/`CaptureMagicAction.tsx`), but that tab was removed (paper cut 2G.3, 2026-07)
as dead weight — a low-usage, low-confidence fourth capture path duplicating the app's real quick-add
routes (Manual Entry, "Add from image", and the iOS Shortcuts `quickAddNaturalLanguage` pipeline).
This brief now needs its OWN lightweight classifier (or should route through the existing
`quickAddNaturalLanguage` → `parseNaturalLanguageCommand` server pipeline instead of inventing a
client-side one) rather than pointing at deleted code.

**Implementation notes:** New `components/dashboard/QuickCaptureBar.tsx` wrapping
`components/ui/QuickAddBar.tsx`. Before building this, decide whether to (a) write a new, purpose-built
classifier call in `services/geminiService.ts`, or (b) reuse the server-side
`functions/src/quickAdd/parseNaturalLanguageCommand` pipeline that already backs the iOS Shortcuts
`quickAddNaturalLanguage` endpoint (**do not** touch that pipeline in place — it must keep working
unmodified; call it, don't fork it). Branch on the result's type to call
`useFinance().addTransaction`, `useTodos().addToDo`, or `useShopping().addShoppingItem`. Show a toast
with an "Edit" action opening the relevant existing edit drawer so a misparse is one tap to correct.
Mount above the Action Queue in `pages/Dashboard.tsx`, gated on `getAiEnabled()`.

**Key files:**
- `components/dashboard/QuickCaptureBar.tsx` (new)
- `services/geminiService.ts`, `pages/Dashboard.tsx`, `contexts/FirebaseHouseholdContext.tsx`
- `functions/src/quickAdd/` (reference only, if reusing the server pipeline — do not modify)

### F-DASH-05 — Scoped insight regeneration (Spending / Habits / Surprise me)

**Size:** small · **Value:** medium · **Dependencies:** none

A small segmented control next to "Get Insight" letting the user pick a lens — Spending, Habits,
or Surprise me — before generating, so the AI insight targets the domain the user actually wants.

**Why:** `generateInsight` already takes transactions and habits separately; scoping is a matter
of slicing inputs and adding one prompt line, and it fixes a latent gap where the written
`Insight.type` is always hardcoded to `'general'` even though `InsightWidget` already has dormant
domain-gating logic keyed on `'spending'`/`'habits'`.

**Implementation notes:** Extend `generateInsight()` with an optional `focus?: 'spending' |
'habits'` param slicing `simplifiedTransactions`/`simplifiedHabits` to just that domain and
appending a one-line prompt hint. Thread `focus` through `makeRefreshInsight`
(`contexts/household/mutations/coreMutations.ts`) and write it as the new Insight's `type`
(`focus ?? 'general'`) instead of the current always-`'general'` literal — this activates the
existing `insightDomainHidden` gating already written in `InsightWidget.tsx`. Add the segmented
control to `InsightWidget`'s action row, hiding Spending/Habits options per `isModuleEnabled`.

**Key files:**
- `services/geminiService.ts`, `contexts/household/mutations/coreMutations.ts`
- `contexts/household/types.ts`, `components/dashboard/InsightWidget.tsx`

### F-DASH-07 — Streaks-at-risk quick actions in Weekly Recap

**Size:** small · **Value:** medium · **Dependencies:** none

**Note:** the target surface has shifted — the weekly ceremony was rebuilt into the 6-card
`RecapDeck` (see CLAUDE.md's Weekly Recap section), so this action belongs on `RecapDeck.tsx`'s
`FinishCard` (which today renders streaks-at-risk as inert chips) as well as the legacy
`WeeklyRecapDrawer.tsx` pre-deck layout.

In `WeeklyRecapDrawer`'s "Streaks at risk" list, add an inline "Mark done today" button per habit
(when not already completed today) so a user who notices a threatened streak can save it without
leaving the recap.

**Why:** The data already exists (`recap.streaksAtRisk`); today it's a static, non-actionable list
even though the whole point of surfacing it is to prompt action.

**Implementation notes:** `WeeklyRecap.streaksAtRisk` entries currently carry only `{habitTitle,
streakDays}` with no habit id — add `habitId` there and in the server-side writer
`functions/src/recap/dataAssembly.ts` (update `dataAssembly.test.ts` accordingly). In
`WeeklyRecapDrawer.tsx`, pull `habits` from `useGamification()` and the atomic toggle from
`hooks/useHabitActions.tsx`, resolve each entry by `habitId`, render a Button calling the habit
toggle for today's date when not yet completed; hide/disable once done.

**Key files:**
- `types/schema.ts`, `functions/src/recap/dataAssembly.ts`, `functions/src/recap/dataAssembly.test.ts`
- `components/dashboard/WeeklyRecapDrawer.tsx`, `hooks/useHabitActions.tsx`

### F-DASH-10 — "Explain this number" tap-to-ask AI

**Size:** medium · **Value:** medium · **Dependencies:** none

Tapping a headline stat — PulseStrip's Spent/Consistency figures, or the recap's spend delta —
opens a small inline popover with a one-sentence, on-demand AI explanation of why the number
moved, rather than waiting for the pre-written weekly narrative.

**Why:** Gives raw stat-band numbers narrative context in the moment, using the same
transaction-summarization approach `generateInsight` already does, just scoped to one metric and
called ad hoc.

**Implementation notes:** Add `explainMetric(householdId, metricLabel, contextData)` to
`services/geminiService.ts` following `generateInsight`'s exact pattern (`generateJsonContent`,
`sanitizeForPrompt`, geminiProxy/quota path) but with a small pre-filtered data slice (e.g. just
this week's transactions for "Spent") and a minimal `{text: string}` response schema — no actions.
Add a small `HelpCircle` icon button (16px) next to the stat in `PulseCell`
(`PulseStripWidget.tsx`) calling it and showing the answer in a lightweight popover with a loading
skeleton; check `components/ui` for an existing Popover primitive first, otherwise build a minimal
absolutely-positioned one. Cache the answer per session (ref keyed by metric + day) so repeat taps
don't burn AI quota.

**Key files:**
- `services/geminiService.ts`, `services/geminiService.types.ts`, `components/dashboard/PulseStripWidget.tsx`, `components/ui/`

### F-DASH-12 — Insight archive filter and search

**Size:** small · **Value:** low · **Dependencies:** none

Add type filter chips (All / Spending / Habits / General) and a text search box to
`InsightsArchiveModal` so users can find a specific past insight instead of scrolling a flat
chronological list.

**Why:** `insightsHistory` is already fully loaded via `loadAllInsights()` when the modal opens;
pure client-side filtering over existing data using primitives already in the design system.

**Implementation notes:** In `InsightsArchiveModal.tsx` add local `typeFilter`/`query` state;
render a segmented control bound to `Insight['type']` above the `SurfaceList`; filter
`insightsHistory` client-side with `.filter(i => (typeFilter === 'all' || i.type === typeFilter)
&& i.text.toLowerCase().includes(query.toLowerCase()))`; reuse `EmptyState` for a distinct "no
matches" state vs the existing "no insights yet" state.

**Key files:**
- `components/modals/InsightsArchiveModal.tsx`

### F-DASH-13 — Tappable PulseStrip cells

**Size:** tweak · **Value:** low · **Dependencies:** none

Make the "Spent" and "Consistency" cells in `PulseStripWidget` tap targets: Spent navigates to
Money → Trends, Consistency navigates to Habits.

**Why:** Reuses the exact `navigate('/budget', {state: {tab: 'trends'}})` call already present in
`pages/Dashboard.tsx`'s header button; turns a static stat band into a real navigation shortcut
for almost no code.

**Implementation notes:** In `PulseStripWidget.tsx`, change `PulseCell` to optionally wrap its
content in a `<button>` when an `onClick`/`aria-label` prop is passed; import `useNavigate` and
call `navigate('/budget', {state: {tab: 'trends'}})` for Spent and `navigate('/habits')` for
Consistency. Only wire the click when the corresponding module is enabled (`showSpend`/
`showHabits` already gate rendering).

**Key files:**
- `components/dashboard/PulseStripWidget.tsx`

## Notifications & Server Jobs

Note: F-HABITS-10 (Partner-nudge / "Nudge a housemate") lives in the Habits & Gamification
section since it was merged there — a housemate-nudge callable serving both habit and money
surfaces. Quiet hours / DND is listed once here (cross-cutting critic and this domain proposed the
same feature); the per-category-only variant below is the fuller spec.

### F-NOTIF-01 — Quiet hours / do-not-disturb window

**Size:** small · **Value:** high · **Dependencies:** none

Users set a nightly window (e.g. 9pm-7am) during which push notifications are suppressed or
deferred, so streak warnings and bill reminders don't wake anyone or interrupt dinner. *(Merged
with the critic's cross-cutting "Global quiet hours / notification digest schedule" idea — same
feature, one spec.)*

**Why:** All four hourly jobs and budget alerts currently fire any hour the per-type `time`
matches; there's no global do-not-disturb, a common expectation for household apps with several
members and habits risking notification fatigue.

**Implementation notes:** Add `NotificationPreferences.quietHours?: {enabled, start, end}` (local
HH:mm) to `types/schema.ts`. Each of the four scheduled Cloud Functions in
`functions/src/index.ts` already computes "today" in the member's stored timezone via
`formatInTimeZone` — extend that same per-member timezone-aware check to also test
current-local-time-in-window before sending; apply uniformly across habit/actionQueue/streak/bill
jobs via a shared gate in `functions/src/shared/notifications.ts`'s `isTimeToSend`/
`sendNotificationToUser`. Budget alerts (Firestore-triggered, not scheduled) need a "defer to
window end" queue doc rather than just skip, or simplest: suppress and rely on the next trigger.
Add one time-range control (not per-category) in `NotificationSettings.tsx` above the existing
per-type toggles.

**Key files:**
- `types/schema.ts`, `functions/src/shared/notifications.ts`, `functions/src/index.ts`
- `components/settings/NotificationSettings.tsx`

### F-NOTIF-04 — FCM token health & multi-device management UI

**Size:** small · **Value:** medium · **Dependencies:** requires a data migration

Settings shows which devices are registered for push ("iPhone - last active 2 days ago," "Chrome
on Desktop") and lets users remove stale/duplicate tokens instead of the array silently
accumulating.

**Why:** `fcmTokens` is currently a plain string array with no per-token metadata; users have no
visibility or control over which devices receive pushes.

**Implementation notes:** Change `fcmTokens` from `string[]` to `{token, addedAt, deviceLabel,
lastUsedAt}[]` (needs a data migration since existing docs are flat strings — write a
converter/migration similar to the bucket-color migration pattern). UI in
`NotificationSettings.tsx` to list/revoke.

**Key files:**
- `types/schema.ts`, `services/notificationService.ts`, `components/settings/NotificationSettings.tsx`, `utils/migrations/`

### F-NOTIF-05 — Notification action buttons (mark done / snooze) in `sw.js`

**Size:** small · **Value:** medium · **Dependencies:** none

**Status: partially shipped.** Inline action buttons already exist and route correctly for
`bill_reminder` pushes (`pay-bill`, `snooze-bill`) and per-habit reminders ("Log it") — see
`public/sw.js`, `functions/src/shared/notificationActions.ts`, `utils/notificationActions.ts`.
**Confirmed platform limitation, not a gap:** an installed iOS PWA renders no web-push action
buttons at all (verified 2026-07-24 on device, recorded at
`functions/src/shared/notificationActions.ts:60-68`) — Android/desktop Chrome is where the
buttons actually render. **Only remaining:** extend the same action-button mechanism to
streak-warning and action-queue reminder pushes, as an Android/desktop bonus (bill/habit types are
done).

**Implementation notes:** Follow the existing `bill_reminder`/habit-reminder pattern in
`functions/src/shared/notificationActions.ts` — add matching `actions` entries for the
streak-warning and action-queue reminder notification types, and extend `sw.js`'s
`notificationclick` branch (and `utils/notificationActions.ts`'s client-side handling where
applicable) to route the new action ids.

**Key files:**
- `public/sw.js`, `functions/src/shared/notificationActions.ts`, `utils/notificationActions.ts`
- `functions/src/index.ts`

### F-NOTIF-06 — Smart bill-reminder lead time (learn from pay cycle)

**Size:** small · **Value:** medium · **Dependencies:** none

Instead of a fixed `daysBeforeDue`, the reminder lead time auto-suggests based on the household's
pay period cadence so reminders land right after a paycheck lands, not before.

**Why:** `billReminders.daysBeforeDue` is a flat user-set number (1-7); many users don't tune it
and miss the sweet spot relative to when checking balance is actually funded.

**Implementation notes:** Compute a suggested lead time from `calendarItems` income cadence
(existing pay-period expansion logic already in `useExpandedCalendarItems`) and surface it as a
one-time suggestion chip in `NotificationSettings.tsx`; `sendbillreminders` job logic itself is
unchanged.

**Key files:**
- `components/settings/NotificationSettings.tsx`, `utils/safeToSpendCalculator.ts`

### F-NOTIF-08 — Low-balance alert tuning: relative + trend-based thresholds

**Size:** small · **Value:** medium · **Dependencies:** trend mode needs a new snapshot collection

Let `budgetAlerts` trigger not just on an absolute dollar threshold crossing but also on a
percentage-of-typical-balance drop or a "trending toward zero within N days" prediction.

**Why:** `budgetAlerts.threshold` is a single flat number today (default $100); household spending
patterns vary widely, so a fixed number is either too noisy or too late for different households.

**Implementation notes:** Extend `budgetAlerts` prefs with `mode: 'absolute'|'percent'|'trend'`;
trend mode needs a rolling average of `safeToSpend` history, which doesn't currently exist as a
stored series — would need a lightweight daily snapshot write (new subcollection) to compute a
slope (the Net Worth History feature has since shipped its own daily snapshot mechanism — check
whether it already covers this before building a second one). Keep absolute as default/simple
case.

**Key files:**
- `functions/src/shared/notifications.ts`, `types/schema.ts`, `components/settings/NotificationSettings.tsx`

### F-NOTIF-11 — Snooze a specific reminder type for N days

**Size:** tweak · **Value:** low · **Dependencies:** none

**Status: partially shipped.** `billReminders.snoozedUntil` already exists on
`NotificationPreferences`, `isBillReminderSnoozed` already gates `sendbillreminders`, and a
"Snooze 1 day" push action button already ships (F-NOTIF-05). **Only remaining:** a configurable
N-day snooze instead of the fixed 1-day button, the same coverage extended to habit/streak/
action-queue reminder types, and a Settings-side snooze control — today snoozing is reachable only
from the notification itself, not from Settings.

**Implementation notes:** Extend the snooze action's payload/handler
(`functions/src/shared/notificationActions.ts`, `utils/notificationActions.ts`) to accept a
day-count rather than hard-coding 1. Add `snoozedUntil?: string` (yyyy-MM-dd) to the other
notification-type sub-objects in `NotificationPreferences`, mirroring `billReminders`'s existing
field; the corresponding scheduled jobs' gates check `snoozedUntil` in addition to `enabled`
before sending, matching `isBillReminderSnoozed`'s pattern. Add a snooze control (day picker +
"until" display) to `NotificationSettings.tsx` for each reminder type.

**Key files:**
- `types/schema.ts`, `functions/src/shared/notifications.ts`, `functions/src/shared/notificationActions.ts`
- `utils/notificationActions.ts`, `components/settings/NotificationSettings.tsx`

## Platform & Growth

Note: TODO.md §3 already tracks the landing page/waitlist decision (DIR-08), referral/invite
rewards, achievements/badges, year-in-review, i18n, multi-household switching, TWA/app-store wrap,
and a re-consent flow as pre-traction/deferred. F-PLAT-04 below (in-app waitlist capture) is a
narrower, code-only alternative that needs neither a landing page nor a domain decision — flagged
as distinct, not a duplicate.

### F-PLAT-02 — Freemium usage-limit nudge banners

**Size:** medium · **Value:** high · **Dependencies:** none

**Status: enforcement is fully live; only the UX layer remains.** The kid-profile cap is enforced
in `contexts/household/mutations/kidMutations.ts` + `utils/entitlements.ts`
(`kidProfileLimitReached()`), the member cap is enforced server-side in `firestore.rules`, and the
AI daily cap is enforced in `geminiService.checkAndIncrementAiUsage`. What's missing is the
point-of-friction messaging: the kid cap today just fires a plain `toast.error`,
`pages/Settings.tsx`'s `handleAddMember` has no pre-check at all (the member cap is only
discovered when the rules write is rejected), and no AI-quota catch opens `PaywallModal` — which
today has exactly one generic "Upgrade" entry point with no context on why the user landed there.

A cohesive set of contextual, non-blocking upgrade nudges firing exactly at these entitlement
boundaries the app already computes but never surfaces to end users: an inline banner when the AI
daily cap is nearly/fully used, an explanatory message (instead of a silent failure) when a
household tries to add a member past `maxMembers`, and similarly for the Kid Mode profile cap.
Each nudge opens the existing `PaywallModal`.

**Implementation notes:** Three coordinated call sites, each gated on `billingEnabled`
(`useBillingEnabled`) so they stay silent while billing is dormant: (1) AI cap — grep call sites of
`checkAndIncrementAiUsage`'s thrown quota error (receipt scan / meal suggestion / insight refresh
flows), catch the quota error and open `PaywallModal` instead of a generic toast, naming the actual
`FREE_LIMITS.aiDailyCap`. (2) Member cap — in the "Add Member" flow (`pages/Settings.tsx`
`handleAddMember`), before opening `MemberModal` check `members.length >=
getLimits(householdSettings).maxMembers` and open `PaywallModal` instead of relying on the rules
rejection. (3) Kid profile cap — replace the plain `toast.error` at `kidProfileLimitReached()`'s
current call site with `PaywallModal`. Each nudge fires
`track('upgrade_nudge_shown', {surface: 'ai'|'members'|'kids'})`.

**Key files:**
- `utils/entitlements.ts`, `services/geminiService.ts`, `pages/Settings.tsx`
- `contexts/household/mutations/kidMutations.ts`, `firestore.rules`
- `components/modals/PaywallModal.tsx`, `services/analytics.ts`

### F-PLAT-04 — Public "request early access" waitlist capture (in-app, code-only)

**Size:** medium · **Value:** medium · **Dependencies:** ships its own `[rules]`-tagged PR

A simple public form (reachable from Login when signup is closed) where an interested visitor
leaves their email to be notified when LifeBalance opens up, writing to a new
`waitlist_requests` Firestore collection. `DeveloperConsole` gets a "Waitlist" tab to review
requests and one-click promote an email into the existing `beta_testers` allowlist.

**Why:** Today, when `openSignup` is false (current Private Alpha state), an interested but
non-allowlisted user hits a dead end at Login. `TODO.md` §3's "Marketing/landing page + waitlist
capture (DIR-08)" needs a hosting/domain decision — this lightweight in-app capture form needs
neither, and gives the team a growth-interest signal well before open signup, feeding directly
into the existing `beta_testers` review flow.

**Implementation notes:** New collection `waitlist_requests/{id}` with `{email, requestedAt,
note?}`. New `firestore.rules` match block (own `[rules]`-tagged PR):
`allow create: if request.resource.data.keys().hasOnly(['email','requestedAt','note']) &&
request.resource.data.email is string && request.resource.data.email.size() < 200; allow read,
delete: if isSuperAdmin();` — no update, no auth required for create (mirrors the field-
allowlisting pattern already used elsewhere). On `pages/Login.tsx`, when the sign-in flow surfaces
a "not on the allowlist" error (`contexts/AuthContext.tsx`'s `beta_testers` check), show an inline
form instead of a dead-end toast, writing via a small `services/waitlistService.ts`. In
`DeveloperConsole.tsx`, add a 5th `TABS` entry (`waitlist`) alongside testers/ai_meter/
reports/flags, with a `loadData()` branch querying `waitlist_requests` ordered by `requestedAt
desc`, and a "Promote to beta" button per row reusing the existing `handleAddTester`-style
`addDoc(collection(db,'beta_testers'), {...})` logic, then deleting the waitlist doc.

**Key files:**
- `pages/Login.tsx`, `contexts/AuthContext.tsx`, `components/modals/DeveloperConsole.tsx`
- `services/appConfig.ts`, `firestore.rules`

### F-PLAT-05 — Stripe customer billing portal (self-serve subscription management)

**Size:** medium · **Value:** medium · **Dependencies:** one-time manual Stripe Dashboard step (configure Customer Portal allowed actions/products); shares the human-activation gate from `TODO.md` §1.3

A "Manage billing" row in Settings → Account (visible only to premium households once billing is
live) opening the Stripe-hosted Customer Portal, so the household admin can update their card,
view invoices, or cancel — without an operator doing it manually.

**Why:** `functions/src/stripe/` only has `checkout.ts` (start a subscription) and `webhook.ts`
(receive events) — no portal/cancel path exists today, so once `billingEnabled` flips on, a
subscriber has no self-serve way to manage or cancel, both a support burden and a legal/UX gap.

**Implementation notes:** New `functions/src/stripe/portal.ts`, an `onCall` (same secrets/auth/
admin-role-check pattern as `checkout.ts`) named `createbillingportalsession` that reads
`household.subscription.stripeCustomerId`, calls
`stripe.billingPortal.sessions.create({customer, return_url})`, returns `{url}`. Deliberately do
NOT export it from `functions/src/index.ts` yet — mirrors the existing dormancy pattern for
`createcheckoutsession`/`stripewebhook`, so it activates only as part of the same `TODO.md` §1.3
human activation step. Client-side: addition to `pages/Settings.tsx`'s Account section, gated on
`billingEnabled && isPremium(householdSettings)`, calling the callable via `getFunctionsInstance()`
+ `httpsCallable` exactly like `PaywallModal.tsx`'s `handleUpgrade` does for
`createcheckoutsession`.

**Key files:**
- `functions/src/stripe/portal.ts` (new), `functions/src/stripe/checkout.ts`, `functions/src/index.ts`
- `pages/Settings.tsx`, `utils/entitlements.ts`, `docs/STRIPE_SETUP_RUNBOOK.md`

### F-PLAT-06 — Trial period on Stripe checkout

**Size:** small · **Value:** medium · **Dependencies:** none (data model already supports `trialing`)

Offer a 14-day free trial on the premium subscription via `subscription_data.trial_period_days` on
the Stripe Checkout session, updating `PaywallModal`'s copy/CTA to "Start your 14-day free trial."

**Why:** `checkout.ts`'s `stripe.checkout.sessions.create` call has no trial configuration today,
and `Household['subscription']['status']` already models `'trialing'` and is already treated as
premium-granting in `entitlements.ts`'s `PREMIUM_STATUSES` — the data model supports trials
end-to-end, just nothing initiates one. A trial materially lowers activation-energy for the first
paid conversion.

**Implementation notes:** In `functions/src/stripe/checkout.ts`, add `subscription_data:
{trial_period_days: 14}` to the `stripe.checkout.sessions.create({...})` call. No webhook change
needed — `webhook.ts` already handles `checkout.session.completed`/subscription events
generically and `subscriptionEvent.ts` already parses `status` off the Stripe subscription object,
so `trialing` flows through unchanged. Update `PaywallModal.tsx`'s `BENEFITS` array/CTA copy. Make
the trial length a named constant (`TRIAL_PERIOD_DAYS = 14`) shared between the function and any
Settings copy referencing it.

**Key files:**
- `functions/src/stripe/checkout.ts`, `functions/src/stripe/webhook.ts`, `functions/src/stripe/subscriptionEvent.ts`
- `components/modals/PaywallModal.tsx`

### F-PLAT-08 — Regenerate invite code

**Size:** small · **Value:** medium · **Dependencies:** none

Add an admin-only "Regenerate code" action next to the invite code in Settings/
`HouseholdInviteCard` that rotates the household's 6-character invite code, invalidating any
previously shared code or link.

**Why:** `HouseholdInviteCard.tsx` only offers copy/share of the existing code today — no way to
revoke a leaked code short of deleting the household. Small, self-contained security/hygiene
feature reusing existing invite-code generation logic.

**Implementation notes:** Find/reuse the invite-code generator used by
`services/householdService.ts`'s `createHousehold` (grep the `inviteCode` generation helper) and
add `regenerateInviteCode(householdId)` writing a freshly generated code (same uniqueness check as
`createHousehold`). Add a mutation entry point via `useHouseholdCore` (mirror other single-field
household updates, e.g. `updateHouseholdSettings`). Wire a confirm-guarded button (`ConfirmDialog`
primitive) in `HouseholdInviteCard.tsx`, admin-role-gated (mirror the `currentUser?.role ===
'admin'` check already used around member actions in `pages/Settings.tsx`). If invite codes also
live in a lookup collection, ship any `firestore.rules` change as its own `[rules]`-tagged PR (the
current `invites/{code}` rule currently disallows update/delete).

**Key files:**
- `components/auth/HouseholdInviteCard.tsx`, `services/householdService.ts`
- `pages/Settings.tsx`, `firestore.rules`

### F-PLAT-10 — GA4 user properties for segmentation

**Size:** small · **Value:** medium · **Dependencies:** none

Set Firebase Analytics user properties (plan tier, member count bucket, which modules are
enabled, kid-mode active) once per session so GA4 reports/audiences can be segmented by household
shape, not just raw events.

**Why:** `services/analytics.ts` only exposes `track(event, params)` — no `setUserProperties`
call anywhere, so every GA4 report is stuck aggregating across all households with no way to slice
"free vs premium" or "habits-only vs full-suite" cohorts, which matters once billing/module
toggles are used for growth decisions.

**Implementation notes:** Add `setUserProperties(props: Record<string,string>)` to
`analytics.ts` mirroring `track()`'s defensive/queued pattern (import `setUserProperties`
alongside `logEvent` in the dynamic `import('firebase/analytics')`). Call once from a
low-frequency spot such as `FirebaseHouseholdContext.tsx` after the household doc first loads (gate
with a ref, not on every render), passing `plan: getPlan(household)`, `moduleCount: <n enabled>`,
`kidModeActive: <bool>` from `household.moduleVisibility`/`household.subscription`. Keep property
values short strings per GA4's 25-char value limit.

**Key files:**
- `services/analytics.ts`, `contexts/FirebaseHouseholdContext.tsx`, `utils/entitlements.ts`

### F-PLAT-11 — Onboarding funnel analytics

**Size:** small · **Value:** medium · **Dependencies:** none

Instrument each `OnboardingWizard` step transition and key choice (balance entered vs skipped,
count of starter habits picked, invite step reached, wizard finished vs skipped early) as
discrete GA4 events, instead of the single `onboarding_completed` event fired today.

**Why:** `components/onboarding/OnboardingWizard.tsx` currently only calls
`track('onboarding_completed', {step})` once at the end — no visibility into per-step drop-off,
the highest-leverage funnel for a household-management app's activation.

**Implementation notes:** In `OnboardingWizard.tsx`, add `track()` calls inside `goToStep` for a
generic `onboarding_step_viewed` event with `{step}`, plus targeted events:
`onboarding_balance_entered` (in `submitBalance`, param whether `parsed > 0`),
`onboarding_habits_selected` (in `submitHabits`, param `count: chosen.length`), and keep the
existing `onboarding_completed`. Add the new events to `docs/PRODUCT_ROADMAP.md` Part 7's
dictionary. No schema changes; `track()` is already a safe no-op outside production.

**Key files:**
- `components/onboarding/OnboardingWizard.tsx`, `services/analytics.ts`, `docs/PRODUCT_ROADMAP.md`

---

## Suggested first picks

High-value, low-effort starters spanning the domains — good candidates for a first PR from this
roadmap. (Two picks from the original list — F-PLAT-01 PWA install prompt and F-XCUT-04 full data
export — have since shipped and were removed from this catalog; every pick below was re-checked
against the current file.)

- **F-MONEY-07** (Sweep Safe-to-Spend leftover into a savings goal) — now tweak/medium: the engine and the mutation both already exist, only a button and a goal picker remain.
- **F-HABITS-08** ("At risk today" filter chip) — tweak/medium, pure client sort logic over data already in memory, ships in an afternoon.
- **F-NOTIF-01** (Quiet hours) — small/high, closes a real notification-fatigue gap and unifies two independently-proposed specs (domain + critic) into one.
- **F-MEALS-05** (Leftover / "use it up" nudge) — tweak/medium, zero new writes or AI calls, reuses an already-loaded slice.
- **F-TODO-10** (Batch reassign in FAB) — small/medium, mirrors the already-shipped batch-reschedule flow, self-contained to `ToDosPage.tsx`.
- **F-DASH-05** (Scoped insight regeneration) — small/medium, slices inputs already passed to `generateInsight` and activates dormant gating logic already sitting in `InsightWidget.tsx`.
- **F-PLAT-08** (Regenerate invite code) — small/medium, self-contained security hygiene reusing the existing invite-code generator.
- **F-NOTIF-06** (Smart bill-reminder lead time) — small/medium, a one-time suggestion chip computed from pay-cycle data the app already expands.
