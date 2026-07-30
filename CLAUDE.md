# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LifeBalance is a React-based household management application combining finance tracking, habit building, and gamification. Built with Vite, TypeScript, and Tailwind CSS, running on port 3000.

## Development Commands

This project uses **pnpm** (`packageManager: pnpm@9.15.0`) — always use `pnpm`, never `npm` (an `npm install` would desync dependencies from what CI resolves via `pnpm-lock.yaml`). It is a pnpm workspace with two packages: the root app and `functions/` (Firebase Cloud Functions). See [pnpm-workspace.yaml](pnpm-workspace.yaml).

```bash
# Install dependencies (root + functions workspace)
pnpm install --frozen-lockfile

# Run development server (http://localhost:3000)
pnpm dev

# Build for production
pnpm run build

# Preview production build
pnpm preview

# Lint: type-check (tsc --noEmit) + eslint
pnpm lint          # root app
pnpm lint:all      # root + functions (recursive)
pnpm lint:fix      # auto-fix eslint issues

# Tests (Vitest)
pnpm test          # run once
pnpm test:watch    # watch mode
pnpm test:coverage # with coverage
```

**Before pushing, all changes must pass `pnpm lint` and `pnpm test`.** CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint (root + functions), tests, and a production build on every PR to `main`.

## Environment Setup

Create a `.env.local` file in the project root (copy from `.env.local.example`):

```bash
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Firebase Cloud Messaging (for push notifications)
VITE_FIREBASE_VAPID_KEY=your_vapid_key_here

# Firebase UID of the global administrator (gates the Developer Console)
VITE_ADMIN_UID=your_uid_here
```

**Required for:**
- Firebase Authentication (Google Sign-In)
- Firestore database persistence and real-time sync
- Push notifications (FCM): habit reminders, budget alerts, streak warnings, bill reminders

**Gemini / AI env vars (optional):** in **production** the client does **not** hold a Gemini API key — AI calls go through the `geminiproxy` Cloud Function (see External Services). The deploy workflow sets `VITE_USE_GEMINI_PROXY=true` and deliberately omits `VITE_GEMINI_API_KEY` from the bundle ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)). For **local development** you can either set `VITE_USE_GEMINI_PROXY=true` (uses the deployed proxy; requires the `GEMINI_API_KEY` Cloud Functions secret) or set `VITE_GEMINI_API_KEY` to use the direct SDK path. `VITE_GEMINI_MODEL` optionally overrides the model. `VITE_ENABLE_TEST_MODE=true` enables Test Mode (see below), which needs no AI/Firebase credentials at all.

**Note:** `.env.local` is git-ignored to protect your credentials.

## Architecture

### State Management

Application state lives in `FirebaseHouseholdContext` ([contexts/FirebaseHouseholdContext.tsx](contexts/FirebaseHouseholdContext.tsx)), which owns the Firestore listeners but exposes state through **domain-sliced contexts** so a change in one domain doesn't re-render consumers of another. Consume the narrowest slice you need:
- `useFinance()` — accounts, budget buckets, transactions, calendar items, pay periods, Safe-to-Spend
- `useGamification()` — habits, points (daily/weekly/total), challenges, rewards, freeze bank
- `useMealPlan()` — meals (recipes) + weekly meal plan; `useShopping()` — shopping list, grocery catalog, stores (split so checking off a shopping item doesn't re-render the meal planner)
- `useTodos()` — shared household to-dos
- `useHouseholdCore()` — household id, members, loading, settings, insights

A backward-compatible `useHousehold()` shim composes all slices (and `useMeals()` composes the two meal slices) for un-migrated consumers; prefer the granular hooks in new/heavy components. The always-mounted `TopToolbar` and the heavy `CaptureModal`, plus `ProfileMenu` and `useInsightActions`, have been migrated off the shim onto narrow slices so they only re-render on the state they actually read. `MockHouseholdContext` mirrors these slices for Test Mode.

`FirebaseHouseholdContext.tsx` is the provider component and public re-export surface, but its listener/mutation bodies live in `contexts/household/{listeners,mutations}/` as one factory module per domain family (e.g. `financeListeners.ts` + `financeMutations.ts`/`transactionMutations.ts`/`calendarMutations.ts`), plus shared `contexts/household/types.ts` (slice value interfaces) and `selectors.ts`. Each provider `useCallback`/listener-attach call constructs a small deps object and delegates to a `make*`/`attach*` factory — this is a pure file decomposition (Plan 08), not a behavior change: dependency arrays, memo boundaries, and batch compositions are unchanged from before the split.

All data is persisted in **Firestore** with real-time synchronization across devices using Firebase's `onSnapshot` listeners.

Firestore is initialized in [firebase.config.ts](firebase.config.ts) with **offline persistence** (`persistentLocalCache` + multi-tab manager), with a safe fallback to the default in-memory cache where IndexedDB is unavailable (SSR, private browsing, CI). This enables offline reads and faster cold starts for the PWA.

Collection refs in the context attach a **typed `FirestoreDataConverter<T>`** (one per major collection in [utils/firestoreConverters.ts](utils/firestoreConverters.ts)) via `.withConverter()`, so listeners/loaders return typed `T` instead of unchecked `d.data() as T` casts. `fromFirestore` injects the synthetic `id` (`uid` for members), normalizes legacy `Timestamp` fields to ISO strings, and drops the deprecated `BudgetBucket.spent`; `toFirestore` strips the synthetic id so it's never written back. Each converter is unit-tested (well-formed + partial/legacy doc).

### Safe-to-Spend Logic

The core financial metric (`safeToSpend`) is calculated as:
```
Checking Balance - Unpaid Bills (this paycheck → next) - Pending Spend (this period)
```

**Critical implementation details:**
- Only checking accounts count as available funds (not savings or credit)
- "Unpaid bills" are the expense calendar items between the current paycheck and the next one, PLUS still-unpaid (overdue) bills up to 1 month **before** the current paycheck (`SAFE_TO_SPEND_OVERDUE_LOOKBACK_MONTHS`, matching the Action Queue's overdue window) — an old-period bill stays reserved until paid, so approving it is StS-neutral for the active period, and `payCalendarItem` retro-files its transaction under the prior period's `payPeriodId` — **every** one of them subtracts (Plan 016 removed the old bill↔bucket exclusion, so a bill whose title happened to match a bucket name no longer silently vanishes). Note: budget buckets do **not** participate in the `safeToSpend` formula at all — neither their limits nor their remaining are subtracted. Buckets are a **display/tracking overlay** on the checking pool: the `SafeToSpendBreakdownDrawer` (opened by tapping the `TopToolbar` figure) *decomposes* the pool as `safeToSpend = Σ max(0, bucket remaining) + unallocated leftover` for visibility only — it is explicitly **not** an envelope model. See [utils/safeToSpendDistribution.ts](utils/safeToSpendDistribution.ts).
- **Pending spend** = the sum of current-period `pending_review` transactions (matched by `payPeriodId === currentPeriodId`; when no period is tracked, all `pending_review` transactions count), **excluding income** (`category === INCOME_CATEGORY`). It is subtracted because checking balances are entered **manually** and do not yet reflect un-cleared spending. There is no double-count with the unpaid-bills term (bills are calendar items, pending is transactions) and bucket remaining limits are not part of the formula. The shared `sumPendingSpend()` helper is the single source of truth; surfaced as the `pendingSpend` field of `SafeToSpendBreakdown` and shown as a "Pending transactions" line both in `SafeToSpendDetail`'s collapsed "How is this calculated?" disclosure at the bottom of Money → Overview and in the `SafeToSpendBreakdownDrawer` waterfall (the `TopToolbar` figure now opens that drawer; Plan 016).
- Money is summed in integer cents (`utils/money.ts`) to avoid floating-point drift — but the helpers take and return **decimal dollars**, which is also how values are stored (`Transaction.amount`, `Account.balance`); never write cents to Firestore
- Pure calculation lives in [utils/safeToSpendCalculator.ts](utils/safeToSpendCalculator.ts) and is wired into the context in [contexts/FirebaseHouseholdContext.tsx](contexts/FirebaseHouseholdContext.tsx). The context exposes a memoized `safeToSpendBreakdown` so widgets (e.g. `TopToolbar`, `SafeToSpendDetail`) consume it without re-expanding calendar items. Components that need a *different* window of expanded recurring items (e.g. `UpcomingBillsWidget`, `useActionQueue`) share the `useExpandedCalendarItems(start, end)` hook (memoized on `[calendarItems, start, end]`) rather than each calling `expandCalendarItems` in render.

### Habit Tracking System

Habits support two scoring modes:

1. **Threshold**: Points awarded only when `targetCount` is reached (e.g., "Read 30 mins" = 1 completion)
2. **Incremental**: Points on every action (e.g., "Late night snack" = -10 pts each time)

**Streak Multipliers** (the multiplier reflects the streak *including* the current completion). Streaks are measured in the habit's own cadence — consecutive **days** for daily habits, consecutive ISO **weeks** (local-week-anchored) for weekly habits — so weekly habits actually earn multipliers instead of resetting every ~7-day gap:
- **Daily** habits: 3-6 days → 1.5x, 7+ days → 2.0x
- **Weekly** habits: 2-3 weeks → 1.5x, 4+ weeks → 2.0x

`calculateStreak`/`streakEndingOn` are the day-based primitives; `calculateWeeklyStreak`/`streakEndingOnWeek` are the week-based analogues. All four (and their server twins) accept an optional `frozenDates` array (Plan 25): a frozen date BRIDGES the chain without counting — streak continuity survives an auto-frozen miss, later days keep their multiplier continuity, but the frozen day itself is never a completion and earns zero points. The shared frozen-date test table is duplicated verbatim in `utils/habitLogic.test.ts` and `functions/src/quickAdd/habitProcessor.test.ts` — change both together. The client `calculateStreak`/`calculateWeeklyStreak` accept an optional caller-local `today` (defaulting to `getLocalDateString()`) for parity with the server helpers and deterministic boundary tests. Call sites use the period-dispatching helpers `streakForHabit(habit)` / `streakEndingOnForHabit(habit, date)`, and `getMultiplier(streak, isPositive, period)` applies the per-cadence thresholds. `getHabitResetUpdate` (the midnight auto-reset patch) is itself period-aware — it recomputes `streakDays` via `streakForHabit`, so weekly habits keep their ISO-week streak across the reset instead of collapsing to a daily streak. The Cloud Functions quickAdd path shares identical period-aware logic via [functions/src/quickAdd/streakLogic.ts](functions/src/quickAdd/streakLogic.ts) (`calculateStreak`/`calculateWeeklyStreak`/`streakForPeriod`/`getMultiplier`), unit-tested in `habitProcessor.test.ts`; `processToggleHabit` computes the multiplier from the **prospective** streak (including the current completion), matching the client. These server helpers accept an optional caller-local `today` (yyyy-MM-dd) — Cloud Functions run in UTC, so the quickAdd endpoint forwards `req.body.today` when present (falling back to the server date) to avoid off-by-one-day streaks for non-UTC users. The four **scheduled** notification jobs (`sendstreakwarnings`, `sendactionqueuereminders`, `sendbillreminders`, plus bill logic) likewise compute "today" in each member's stored timezone via `formatInTimeZone` rather than the UTC day, so evening reminders/warnings match the user's local date; the iOS Shortcut sending its local date is a remaining follow-up.

**Atomicity:** Habit mutations that touch both a habit document and the household points — `toggleHabit`, `resetHabit`, `addHabitSubmission`, `updateHabitSubmission`, `deleteHabitSubmission` — commit in a single `writeBatch` so they can never diverge (see [hooks/useHabitActions.tsx](hooks/useHabitActions.tsx)). The same applies to bucket reallocation and paycheck approval, to the calendar/transaction money paths (`payCalendarItem`, `updateTransaction`, `deleteTransaction`), to `PointsBreakdownModal`'s habit+points edit, and to the multi-document context mutations `updateTransactionCategory` (transaction + checking-balance delta + related habits + points — its optional 5th `overrides` param co-commits an inline amount/merchant/date edit and clears the `needsAmount` stub flag in the SAME batch, with `overrides.amount` driving the balance delta so a `$0` stub debits the entered amount exactly once), `autoApplyFreezes` (one batch per application: habit `frozenDates` + freeze-token spend, **never any points** — a frozen day earns zero), and `addMember` (member doc + `memberUids`). Core scoring/streak logic is pure and unit-tested in [utils/habitLogic.ts](utils/habitLogic.ts).

**Points sync:** the full daily/weekly/total recompute (`calculatePointsForDate`/`calculatePointsForDateRange`) is **not** re-run on every habit toggle — the per-toggle `writeBatch` delta is the source of truth. The corrective recompute is a ref-backed callback driven only by a once-per-household login sync and the midnight scheduler ([hooks/useMidnightScheduler.ts](hooks/useMidnightScheduler.ts)), so a toggle produces exactly one points write and drift is still corrected on login/rollover.

**Point recalculation:** `calculatePointsForDate`/`calculatePointsForDateRange` (used to re-sync daily/weekly/total points) reconstruct each completion day's streak via the period-aware `streakEndingOnForHabit()` (day- or week-based per `habit.period`) and apply the historical per-period multiplier — they do **not** apply the current streak to past days, so totals don't drift on recalculation.

**Submission-aware recompute:** submissions are a *partial* record — the submissions path (back-dated hand logs, transaction-fired habits) writes a `HabitSubmission`, the toggle path writes none — so one date can carry both. `reconcileStoredDayPoints` (in [utils/habitLogic.ts](utils/habitLogic.ts), reached through `pointsForHabitOnDate`) is the single rule: **stored covers the units it recorded, the derived attribution covers the rest** — incremental days add `max(derived − stored.count, 0)` on top of the stored points, threshold periods treat a submission with non-zero points as *the* award. Neither extreme is used: ignoring submissions loses multi-unit/back-dated logs (no historical per-day counters exist to recover them), and letting them override the day loses the toggle units they never saw. Pass no `submissionTotals` and every scorer is bit-for-bit the pre-submissions behaviour. The totals come from `fetchSubmissionTotals` ([utils/habitSubmissionTotals.ts](utils/habitSubmissionTotals.ts)), shared by the habit calendars (`useHabitCalendarData`) and the corrective recompute so both score a day identically; it reads **only** `hasSubmissionTracking` habits over **only** the window being scored, and `usePointsSync` additionally caches the result against a habit-`lastUpdated` fingerprint so an idle 5-minute scheduler tick issues no queries.

**Dates:** Calendar dates are stored as `yyyy-MM-dd` strings in the user's **local** timezone. Use `getLocalDateString()` from [utils/dateHelpers.ts](utils/dateHelpers.ts) to derive "today" — never `new Date().toISOString().split('T')[0]` (that returns the UTC day, which is wrong in the evening for western timezones). Also avoid `format(new Date(), 'yyyy-MM-dd')`; the app's call sites have all been migrated to `getLocalDateString()` so there is a single source of truth for "today".

Habits auto-reset based on their `period` (daily/weekly).

### Routing

Uses **HashRouter** (not BrowserRouter) to support deployment without server-side routing configuration. Routes are defined in [App.tsx](App.tsx); pages are `React.lazy`-loaded for code-splitting. Current routes:
- **Public:** `/login`, `/privacy`, `/terms`, `/setup`
- **Protected** (via `ProtectedRoute`): `/onboarding` (full-page first-run wizard, `components/onboarding/OnboardingWizard.tsx`, rendered *without* `MainLayout`), then inside `MainLayout`: `/` (Dashboard), `/lists` (tab container for To-Dos/Meals/Shopping — see below), `/budget`, `/habits`, `/settings`. A catch-all `*` redirects to `/`.
- **Legacy redirects:** `/todos`, `/meals`, `/shopping` are no longer standalone pages — `PlanTabRedirect` (`components/auth/PlanTabRedirect.tsx`) seeds `ListsPage`'s `'lists-active-tab'` localStorage preference with the requested tab and navigates to `/lists`, so old deep links (including the PWA manifest shortcuts, Plan 18) land on the right tab instead of a dedicated route.

Each protected route is wrapped in its own `ErrorBoundary` keyed on pathname, so a crash on one page doesn't take down the whole app. `ProtectedRoute` checks auth only (no household → `/setup`); per-module page gating is done by the `ModuleRoute` wrapper ([components/auth/ModuleRoute.tsx](components/auth/ModuleRoute.tsx)) — see "Feature Flags, Modules & Monetization" below. When Kid Mode is active, `MainLayout` swaps the entire shell (toolbar + routed page + bottom nav) for the kid surface — see the Kid Mode entry in that same section.

### Code-Splitting & Boot Bundle

Pages are `React.lazy`-loaded (see Routing). The always-mounted toolbar/nav modals — `CaptureModal`, `FeedbackModal` — are also lazy: they render inside [`LazyMount`](components/ui/LazyMount.tsx) (mounts on first open, stays mounted so the Drawer exit animation plays) and are warmed during browser idle via [`preloadOnIdle`](utils/preloadOnIdle.ts). This keeps `Drawer`/`framer-motion` out of the boot bundle, so don't statically import any `Drawer`-based modal from `MainLayout`, `TopToolbar`, or `BottomNav`. Vendor chunking uses rolldown's **`build.rollupOptions.output.codeSplitting`** with **priority-ordered `groups`** in [vite.config.ts](vite.config.ts) (Vite 8 = rolldown; `codeSplitting` replaces the deprecated `advancedChunks`) — not the old function-form `manualChunks`, which couldn't stop recharts' own bundled CJS React copies from heading `vendor-charts` and force-preloading all of recharts (~124 KB gz) onto the eager boot path. The React-core group has the highest priority so those CJS copies are claimed for `vendor-react` first; `vendor-utils` sits *above* `vendor-charts` so `clsx`/`cn()` (used by core primitives like `Button`) can't back-door the charts chunk onto boot; and each group's `test` matches on the module **path** so package subpaths (`react-dom/client`, `react/jsx-runtime`) and virtual CJS-interop ids land in the right chunk. Read the comment there before changing it. The service worker ([public/sw.js](public/sw.js)) serves hashed `/assets/` files cache-first from a statically named cache; bump its `CACHE_VERSION` only when the caching strategy itself changes (hashed assets are content-addressed, so deploys don't need a bump).

### External Services

**Gemini API** ([services/geminiService.ts](services/geminiService.ts)):
- **Transport — server proxy in production:** when `VITE_USE_GEMINI_PROXY=true` (set by the deploy workflow), all Gemini calls go through the `geminiproxy` Firebase **callable** Cloud Function ([functions/src/geminiProxy.ts](functions/src/geminiProxy.ts)), which holds the `GEMINI_API_KEY` secret server-side; the client bundle contains **no API key**. Without the flag, the client uses the `@google/genai` SDK directly with `VITE_GEMINI_API_KEY` (local dev / tests only). The transport is chosen statically by the flag — there is no runtime fallback from proxy to direct.
- The model is defined once in the exported `GEMINI_MODEL` constant (overridable via the optional `VITE_GEMINI_MODEL` env var) — change it there, not inline at call sites.
- Calls go through a shared helper with timeout and bounded exponential-backoff retry on transient errors (429/503/network, including their callable equivalents `resource-exhausted`/`unavailable`); non-transient errors are not retried.
- The daily AI quota check-and-increment runs in a single Firestore `runTransaction` to avoid a check-then-increment race. The `aiEnabled` flag on `app_config/global` is a kill-switch checked before calls (fail-open; see Feature Flags below), and when `billingEnabled` is on the daily cap becomes plan-aware via [utils/entitlements.ts](utils/entitlements.ts) (otherwise a flat legacy quota applies).
- Plain TypeScript types are in [services/geminiService.types.ts](services/geminiService.types.ts) (re-exported from `geminiService`); import types from there in always-loaded modules so the `@google/genai` SDK stays out of the app boot path (the SDK functions are loaded via dynamic `import()`).
- **Receipt Scanning**: `CaptureModal`'s "Add from image" flow calls `parseReceiptLineItems()` first — itemized OCR that extracts merchant/date/store plus every line item (each with description, amount, category), enabling the multi-category receipt split. That call is also the flow's **classifier**: a bank/card transaction-list screenshot is structurally identical to an itemized receipt (rows of text + amount), so the response carries a `documentType` verdict (`'receipt' | 'transaction_list'`, enum-constrained in the response schema, normalized by `validateReceiptLineItems`). `'transaction_list'` comes back with no items and routes to `parseBankStatement()` — one transaction per row. **Route on `documentType`, never on `items.length` alone**: doing the latter sent every statement screenshot down the receipt path, where `groupLineItemsByCategory` summed a dozen separate purchases into a couple of lump transactions sharing one merchant and one date. `items.length` survives in the condition only as a redundant second signal (the prompt asks for empty items on a transaction list too).
  - `parseReceiptLineItems()` returns: merchant, date, store, suggested habits, items[] (description, amount, category)
  - `parseBankStatement()` returns: array of transactions with dates, descriptions, amounts
- **Meal Suggestions**: `suggestMeal()` - AI-powered meal planning based on budget and time constraints
  - Returns: meal name, description, ingredients, tags, reasoning
- **Grocery Receipt Parsing**: `parseGroceryReceipt()` - Extracts grocery items from receipt photos
  - Returns: array of items with name, category, quantity

### Analytics

Product analytics (GA4 via Firebase Analytics) go through `track(event, params?)` in [services/analytics.ts](services/analytics.ts) — a lazy, fully defensive wrapper:

- **Initialization**: only in a production browser with a `measurementId` and `isSupported()`. The `firebase/analytics` SDK loads via dynamic `import()` (off the boot path); everywhere else (dev, tests, SSR, unsupported browsers) `track()` no-ops and never throws.
- **Pre-init queue**: events fired before initialization settles are queued (bounded at 20) and flushed once the SDK is ready, so boot-time events like `notification_opened` aren't dropped.
- **Event dictionary**: ~20 activation/engagement/retention events fire client-side; the dictionary lives in [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) Part 7 — add new events there when instrumenting.
- **Supporting utils**: [utils/firstTimeFlags.ts](utils/firstTimeFlags.ts) (once-per-device `first_transaction_added`/`first_habit_completed` via localStorage flags) and [utils/notificationSource.ts](utils/notificationSource.ts) (push-open attribution — the service worker can't call the GA SDK, so `public/sw.js` tags navigations with `?nsrc=<type>` and the app consumes it on boot via `trackNotificationOpenFromUrl()`; keep the sw.js tagging in sync with `appendNotificationSource`).

### Weekly Recap

Weekly recaps (Plan 02) are written **server-side on MONDAY MORNING, member-local** (07:00, hourly `sendweeklyrecap` scheduler, `functions/src/recap/`) to `households/{id}/recaps/{isoWeek}` (`WeeklyRecap` in [types/schema.ts](types/schema.ts); doc id = ISO week, e.g. `2026-W27`). It moved off Sunday 17:00 when the ceremony landed — the week must be **closed** before anyone is crowned — so **the recap describes the week that ENDED YESTERDAY, not the week the run falls in**. `closedWeekFor()` in `recap/index.ts` is the single place that conversion happens; naming a recap after `isoWeekId(now, tz)` would label it with the brand-new week and mis-target the `lastRecapWeek` dedupe. The client subscribes with a bounded newest-first listener (`RECAPS_LIMIT` in [utils/listenerWindows.ts](utils/listenerWindows.ts), converter `weeklyRecapConverter`) exposed as `recaps` on the **core slice** (`useHouseholdCore`). The Dashboard shows [WeeklyRecapCard](components/dashboard/WeeklyRecapCard.tsx) for ~4 days after generation (dismissible per-week via localStorage); tapping it — or arriving via the push deep link `/?recap=<isoWeek>` ([utils/recapParam.ts](utils/recapParam.ts), dual search/hash parsing like `notificationSource`) — opens [WeeklyRecapDrawer](components/dashboard/WeeklyRecapDrawer.tsx). Push delivery is opt-out via the `weeklyRecap` key in `NotificationPreferences` (toggle in `NotificationSettings`, default ON). Analytics: `recap_viewed` / `recap_push_opened` / `recap_shared` / `recap_deck_completed`.

**The weekly ceremony IS the recap — one artifact, not a second system** (per-member points, stage 5). Same doc, same card, same deep link, same premium gate. The document gained four **optional** ceremony fields — `memberFacts`, `dailyPoints` (7 Monday-first days, member-stacked + an `unattributed` grandfathering series), `totalPoints`, `priorWeekPoints`, plus the `ceremonyTone` in force at generation. When they are present the drawer renders [RecapDeck](components/dashboard/RecapDeck.tsx) — a 4-card swipeable story deck (cover → household week + 7-day chart → the **viewer's own** personal card → finish) with the money/habit sections tucked into a "Week details" disclosure beneath it; when they are absent (every recap written before stage 5) it renders the pre-deck layout unchanged. `hasCeremonyData` in [utils/recapDeck.ts](utils/recapDeck.ts) is the ONLY gate — never make those fields required. The narrative stays premium-gated (blurred + upsell when `recap.premium === false`, on the finish card in deck mode); headline numbers show for every plan. `Household.ceremonyTone` (resolved via `resolveCeremonyTone`) reframes the deck: `podium` leads with the head-to-head, `household_first` (the absent default) keeps it about the household, `adaptive` crowns only a runaway week — and the runaway thresholds are duplicated in `utils/recapDeck.ts` and `functions/src/recap/narrative.ts`, so **change both together** or the deck lays out one verdict while the narrative phrases another. **NO flame rings anywhere in the deck** — streaks render as stat tiles; the ring is habits-page-only UI.

**Per-member recap figures are DERIVED, never read from `points.weekly`** ([functions/src/recap/memberFacts.ts](functions/src/recap/memberFacts.ts)). Monday-morning generation runs *after* the client's midnight weekly rollover, so reading a member's stored weekly points would hand the ceremony a household of zeroes. Everything is recomputed from `Habit.completedBy` over the closed week, mirroring `utils/habitAttribution.ts`'s rules (`household = Σ members + unattributed`) and sharing the streak/multiplier primitives from `functions/src/quickAdd/streakLogic.ts`. Only CLOSED periods are scored, so the live `Habit.count` is deliberately never consulted. `pointsByMember` keeps its legacy source (`points.weekly`) for a week with **no attribution at all**, so fully-grandfathered households are unaffected.

### Feature Flags, Modules & Monetization

Systems agents will touch; one paragraph each, with pointers to deeper docs.

**Feature flags (`app_config/global`):** [services/appConfig.ts](services/appConfig.ts) reads/writes operator flags on the shared `app_config/global` Firestore doc, each cached 60s: `openSignup`, `billingEnabled`, `kidModeEnabled`, `plaidEnabled` (all **fail-closed** — default `false` on missing doc/field/error) and `aiEnabled` (**fail-open** AI kill-switch, read by `geminiService.getAiEnabled()`). Consumed via per-flag async getters and mount-time hooks (`useKidModeEnabled`, `usePlaidEnabled`) — there is no flags React context. The admin Developer Console edits them via `readAppConfigFlags`/`setAppFlag`. `kidModeEnabled` has a DEV+Test-Mode-only short-circuit to `true`.

**Visibility — two layers, composed with `&&`** ([utils/moduleVisibility.ts](utils/moduleVisibility.ts) is the single source of truth for all of it; built across 2F.1/2F.2/2F.3):

- **Household** ("does this household use it at all"): `ModuleKey = 'habits' | 'money' | 'lists' | 'todos' | 'meals' | 'shopping'` with `Household.moduleVisibility?: ModuleVisibilityMap` ([types/schema.ts](types/schema.ts)). **Fail-open** and inherited by new members — only an explicit `false` disables. 2F.1 renamed `'plan'` → `'lists'` (the route was already `/lists`); `'plan'` survives as a **read-time alias** in `isHouseholdModuleEnabled` and is never written, so no migration runs.
- **Member** ("do I want it in my nav"): `HouseholdMember.hiddenKeys?: string[]` over the unified `VisibilityKey` set — **LEAVES ONLY** (Habits' 6 sub-views, Money's 7, Lists' 3, plus Home and the Home widget ids). Groups and pages are **DERIVED** from `NAV_PAGES`, the single page→group→leaf registry: `getPageNavigation()` drops a group when all its leaves are hidden, a page when all its groups are; the **collapse rule** (`PageNavigation.soleLeaf`) turns a page with exactly one reachable leaf into a direct link (no tab strip, no `TabSubViewMenu`); and `resolveActiveLocation` maps any incoming tab value (a stale deep link, a hidden leaf) onto a still-visible one. Resolution is `hiddenKeys ?? dashboardHidden ?? MEMBER_DEFAULT_HIDDEN_KEYS`, where the default holds **only** the five `DEFAULT_HIDDEN_DASHBOARD_WIDGETS` — the one rule reconciling the two systems' opposite defaults (pages fail **open**, widgets stay hidden exactly as before, no migration). `dashboardHidden` is read-only legacy; `dashboardLayout` is **ordering, not visibility**, untouched by the merge. **Settings is absent from the key set and from `NAV_PAGES`**, so it is structurally impossible to hide (the lockout guard every fallback chain below terminates at).
- **Flag-gated leaves** (today: Habits' Coach behind `powerToolsEnabled`) declare a `NavLeafDef.gate` and ride the exact same hidden-key set via `useHiddenVisibilityKeys` + `flagGatedHiddenKeys` — there is deliberately **exactly ONE hidden-key set**, and `usePageNavigation`/`useModuleVisibility` have **no per-caller "extra hidden" override**. A per-caller set previously let the nav offer a page whose own reachable-leaf set was empty — a nav item leading to a blank frame. Don't reintroduce one.
- **Home** (`isHomeVisible`, 2F.2) is a **member-only toggle with no household layer** — like Home widgets, it isn't a `ModuleKey` and isn't in `NAV_PAGES`. `HomeRoute` guards `/`: `resolveLandingRoute` resolves the member's chosen `homeScreen` → the first still-enabled nav destination → Settings (the terminal, structurally-un-hideable fallback). Money's sub-views are addressable via `?view=` (`useViewParam`), matching Habits' `?due=` convention.
- **ONE editor, not three.** Settings → Modules & Dashboard used to stack "App Modules" (household toggles), "What I see" (own leaves) and an admin-only "Member visibility" table, which said the same thing three times. It is now the single **"Who sees what"** section: [components/settings/MemberVisibilityMatrix.tsx](components/settings/MemberVisibilityMatrix.tsx) carries BOTH layers (section headers = the household switches, columns = each person's nav) and renders for **every** member — an admin gets all columns, anyone else gets only their own, which is what keeps a non-admin's self-editor alive. The household switches inside it stay **any-member-editable** (they always were; don't let that regress to admin-only). It is also the **only** way to set visibility or a landing screen for a login-less managed kid; its Home row/landing-screen picker is hand-authored in `getVisibilityMatrixSections()` the same way the Home-widgets section already was, since Home isn't derivable from `NAV_PAGES` either. `firestore.rules` already allowlists `hiddenKeys`/`homeScreen` for member self-update, the admin path, and the managed-kid branch, so nothing there needs to change when this set grows.
- The one thing the matrix can't express is widget **order**, which lives in [components/settings/HomeWidgetOrder.tsx](components/settings/HomeWidgetOrder.tsx) (Settings → "Home widget order") — a framer-motion drag list whose grip is deliberately a real keyboard-operable button, unlike this app's other `aria-hidden` pointer-only grips, because it replaced two chevron buttons. [components/settings/MyViewSettings.tsx](components/settings/MyViewSettings.tsx) survives as the **first-run wizard's** step-4 surface only (`OnboardingWizard`, with an e2e test pinning its "What I see" heading) and mounts that same shared widget list — so don't delete it thinking Settings still uses it.

Live values come from `useModuleVisibility()` (page/module answers) and `usePageNavigation(page)` (the group/leaf tree + collapse state); [components/auth/ModuleRoute.tsx](components/auth/ModuleRoute.tsx) redirects unreachable pages to `/` and `BottomNav` hides their nav items.

**ONE hidden-key set — never subtract a leaf page-side:** both hooks (and `SearchOverlay`) read their hidden set from [hooks/useHiddenVisibilityKeys.ts](hooks/useHiddenVisibilityKeys.ts), so the nav, the route guard and the page always agree on which leaves are reachable. A leaf gated by a **global flag** rather than by either visibility layer declares that on the registry (`NavLeafDef.gate` → `NavFlagGates`; today only Habits' Coach behind `powerToolsEnabled`) and `flagGatedHiddenKeys` folds it into that one set — so it takes part in the page-level derivation and the collapse rule identically to a member-hidden leaf. Hiding a leaf inside one page only makes the page's reachable set narrower than the nav's, which is exactly how a nav item leads to a blank page. Because `isModuleEnabled`'s page answers are *derived*, they route through `getPageNavigation` **unconditionally** — there is deliberately no "empty hidden set ⇒ enabled" shortcut (a member who un-hides all five default Home widgets stores a genuinely empty list). Every page driven by this data also carries a zero-leaf `return null` guard (Budget, Habits, ListsPage) so a future divergence degrades to the redirect instead of an empty frame. Search gates each result on the **specific leaf** its nav target deep-links to (`isNavLeafKeyVisible`), never at page level, so a result can't land somewhere other than what was searched for.

**Entitlements (Plan 050):** [utils/entitlements.ts](utils/entitlements.ts) is the single source of truth for what a plan unlocks — `getPlan()` (`'free'` unless a subscription is `active|trialing|past_due`), `isPremium()`, `getLimits()` (member/AI/history/kid-profile limits), `kidProfileLimitReached()`. All consumers gate on `billingEnabled` first. **The member and kid caps ARE enforced server-side (Plan 051) — don't re-implement them:** `maxMembers` in `firestore.rules` (`planMaxMembers()`/`withinMemberCap`, ~line 106) and `maxKidProfiles` in the `createkidprofile` callable ([functions/src/kid/createKidProfile.ts](functions/src/kid/createKidProfile.ts), mirroring `functions/src/entitlements.ts`) — a managed kid is never in `memberUids`, so rules can't count them and only the server is authoritative. `aiDailyCap` is enforced in `geminiService.checkAndIncrementAiUsage`. `historyMonths`/`recapEnabled` are **not** gated by anything yet (Settings only displays them; the recap's premium gate reads the server-written `recap.premium`, not `PlanLimits.recapEnabled`). Every one of these gates is **inert until `billingEnabled` flips** — dormant, not missing — so the client-side calls remain UX pre-checks, never the boundary.

**Stripe (written, dormant):** `functions/src/stripe/` contains `createcheckoutsession` + `stripewebhook`, fully implemented and tested but **deliberately NOT exported** from `functions/src/index.ts` — exporting would deploy them and require the `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` secrets to pre-exist, breaking CI deploys. Activation is a human step: [docs/STRIPE_SETUP_RUNBOOK.md](docs/STRIPE_SETUP_RUNBOOK.md).

**Plaid (deployed, flag-gated):** `functions/src/plaid/` (link-token, public-token exchange, scheduled daily `plaidsynctransactions`, disconnect) **is exported/deployed**, using the `PLAID_CLIENT_ID`/`PLAID_SECRET`/`PLAID_ENV` secrets; the access token never reaches the client. The "Connect a bank" UI (`components/settings/ConnectBankCard.tsx`, `react-plaid-link`) renders only when the `plaidEnabled` flag is on. Runbook: [docs/PLAID_SETUP_RUNBOOK.md](docs/PLAID_SETUP_RUNBOOK.md).

**Kid Mode (flag-gated):** when `kidModeEnabled` is on and `activeMemberId` points at a member with `isManaged === true`, `MainLayout` **early-returns the entire kid surface** (lazy `components/kid/KidDashboard.tsx` in its own ErrorBoundary) instead of toolbar + routed page + bottom nav, with a loading guard against flashing the parent shell. Kid PIN hashing in `utils/kidPin.ts` (`household.kidModePinHash`); managed-profile CRUD and `actAs`/`exitToParent` live in the household context. Activation (flip `kidModeEnabled`) is tracked in [TODO.md](TODO.md) §1.4.

**quickAdd / email capture pipeline:** the `quickAddExpense` HTTP endpoint (`functions/src/quickAdd/index.ts`, API-key auth for iOS Shortcuts) accepts a raw `emailText` body and runs three pure, unit-tested layers: [functions/src/quickAdd/emailParser.ts](functions/src/quickAdd/emailParser.ts) extracts `{amount, merchant, cardLast4, date}` from bank-alert emails (HTML-stripped; alert-threshold amounts excluded); [functions/src/quickAdd/accountMatch.ts](functions/src/quickAdd/accountMatch.ts) maps a card's last-4 to an account (unique match only) and normalizes US dates; [functions/src/quickAdd/reconcile.ts](functions/src/quickAdd/reconcile.ts) fills a prior Apple Pay `$0` `needsAmount` stub with the bank-notification amount (unique merchant match, else single-stub-in-30-min window; ambiguity → new row rather than a wrong merge). Other endpoints: `quickAddHabit`, `quickAddShoppingItem`, `quickAddNaturalLanguage`.

### Styling

**Tailwind CSS v4** compiled via PostCSS at build time (not CDN). **There is no Tailwind config file** (v4 needs none here) — all design tokens live in [index.css](index.css) under the `@theme` block, and **[DESIGN.md](DESIGN.md) is the source of truth** for how to use them:
- PostCSS pipeline in [postcss.config.js](postcss.config.js) (`@tailwindcss/postcss`); [index.css](index.css) starts with `@import 'tailwindcss'` + `@plugin 'tailwindcss-animate'`, then the `@theme` token block and custom utilities
- Color token families: `brand-*` (warm-paper neutrals), `accent-*` (evergreen; primary at `accent-600`), `warm-*` (amber), `money-*` (pos/neg + backgrounds), `habit-*` (streak/gold/blue)
- Fonts are **self-hosted** from `public/fonts/` via `@font-face` in `index.css` (no Google Fonts/CDN): Besley (`--font-display`, Clarendon serif display voice), Schibsted Grotesk (`--font-sans`), Spline Sans Mono (`--font-mono`). Inter-everywhere and purple-gradient/glass looks are explicitly off-spec — see DESIGN.md's anti-patterns
- Mobile-first with safe-area-inset support
- `clsx` + `tailwind-merge` for conditional/merged class names
- Entrance animations (`animate-in`, `fade-in`, `slide-in-from-*`, `zoom-in-*`) come from the **`tailwindcss-animate`** plugin (loaded via `@plugin` in `index.css`). They are fully suppressed for `prefers-reduced-motion` users via a guard in [index.css](index.css) (`.animate-in/.animate-out { animation: none }`).

### Component Organization

```
components/
  ├── analytics/    # Charts/analytics widgets (recharts; lazy-loaded)
  ├── auth/         # ProtectedRoute, ModuleRoute, PlanTabRedirect, HouseholdInviteCard
  ├── budget/       # Budget-specific UI components (TransactionMasterList is windowed with @tanstack/react-virtual)
  ├── dashboard/    # Dashboard widgets (PulseStripWidget, action queue, etc.)
  ├── habits/       # Habit tracking UI components
  ├── kid/          # Kid Mode surface (KidDashboard; lazy-loaded shell swap)
  ├── layout/       # MainLayout, TopToolbar, BottomNav, OfflineBanner
  ├── meals/        # Meal planning components (MealPlanTab, ShoppingListTab)
  ├── modals/       # Modal dialogs for forms (incl. DeveloperConsole)
  ├── onboarding/   # First-run OnboardingWizard (route: /onboarding)
  ├── settings/     # Settings sub-components (NotificationSettings, ConnectBankCard, ThemeToggle)
  ├── transactions/ # Transaction review/list components
  └── ui/           # Reusable primitives (Button, Input, Card, Drawer, Skeleton, ConfirmDialog, etc.)

pages/              # Route-level page components (lazy-loaded in App.tsx)
  ├── Dashboard.tsx        # Main overview with AI insights
  ├── Budget.tsx           # Finance management
  ├── Habits.tsx           # Habit tracker
  ├── ToDosPage.tsx        # Shared household to-dos (rendered via /lists' To-Dos tab; no standalone route)
  ├── ListsPage.tsx        # Tab container for To-Dos / Meals / Shopping (route: /lists)
  ├── Settings.tsx         # App settings and preferences
  ├── Login.tsx            # Authentication
  ├── HouseholdSetup.tsx   # Household creation/joining
  ├── PrivacyPolicy.tsx    # Public /privacy page
  └── TermsOfService.tsx   # Public /terms page

contexts/           # React Context providers (AuthContext, FirebaseHouseholdContext,
                    #   ThemeContext, and Mock* providers used by Test Mode)
hooks/              # Custom hooks (useHabitActions, useFocusTrap, useReducedMotion,
                    #   useMidnightScheduler, useMediaQuery, etc.)
services/           # External API integrations (authService, geminiService,
                    #   householdService, notificationService)
types/              # TypeScript type definitions (schema.ts)
utils/              # Business logic utilities (safeToSpendCalculator, habitLogic,
                    #   money, dateHelpers, bucketSpentCalculator, migrations/, etc.)
data/               # Static seed data (presetHabits, groceryCategories, etc.)
functions/          # Firebase Cloud Functions (separate pnpm package; e.g. quickAdd)
```

### Path Aliases

The project uses `@/` as an alias for the root directory:
```typescript
import { Habit } from '@/types/schema';
import TopToolbar from '@/components/layout/TopToolbar';
```

Configured in both [tsconfig.json](tsconfig.json) and [vite.config.ts](vite.config.ts). **Always use `@/` for cross-directory imports** (only same-directory `./x` relative imports are allowed) — a `no-restricted-imports` ESLint rule bans parent-relative (`../…`) imports.

## Testing

Tests use **Vitest** with **@testing-library/react** (config in [vite.config.ts](vite.config.ts)). Test files live next to the code they cover as `*.test.ts(x)`. Business logic in `utils/` (safe-to-spend, habit scoring, money math, date helpers) is the most heavily covered — add/extend tests there when changing that logic. Run with `pnpm test`.

**Two environments, node by default.** `test.projects` splits the suite into a `node` project and a `jsdom` project. Booting a jsdom is what this suite actually spent its time on — globally-`jsdom` runs burned 301s of worker time in `environment` against 85s of real `tests` — and most of the suite (`utils/**`, `functions/**`, `contexts/household/**`) is pure logic. A file gets jsdom in one of two ways:

1. It sits in a UI directory — `components/**`, `pages/**`, `hooks/**`, `App.test.tsx`, `contexts/*.test.tsx`, `services/notificationService.test.tsx` (the `JSDOM_INCLUDE` list). Matched by directory, not by `.tsx`, because several `.ts` suites in `hooks/` drive `renderHook`.
2. It carries a `// @vitest-environment jsdom` docblock. That is how the ~16 pure-logic suites that drive `window`/`document`/`localStorage` (e.g. `utils/firstTimeFlags.test.ts`, `utils/swNavigation.test.ts`, `services/analytics.test.ts`) opt back in. **Prefer the docblock over adding a path to `JSDOM_INCLUDE`** — it survives renames and documents itself where it applies.

A test needing the DOM with neither fails loudly (`ReferenceError: window is not defined`); it never silently degrades to a fallback branch. Setup is split to match: [vitest.setup.shared.ts](vitest.setup.shared.ts) is environment-agnostic and loaded by both, while [vitest.setup.ts](vitest.setup.ts) adds `@testing-library/jest-dom` for the jsdom project only — so don't reach for jest-dom matchers in a node-project test (a test that needs them renders something, and belongs in the jsdom project). `isolate: false` and `pool: 'threads'` were both measured and deliberately not adopted; see the notes in [vite.config.ts](vite.config.ts) before revisiting either.

## Repo Hygiene

Multi-agent projects leave branches and worktrees behind. **[docs/REPO_CLEANUP_RUNBOOK.md](docs/REPO_CLEANUP_RUNBOOK.md)** is the procedure for clearing them — archive to a bundle first, check for open PRs (deleting a head branch closes its PR), then delete. Two things that trip up the obvious approach: this repo **squash-merges**, so `git branch -d` and `--merged main` can't recognise a merged branch and `-D` is required; and a worktree's branch is pinned by metadata in `.git/worktrees/`, not by the directory — clearing that metadata frees the branches instantly, which matters because `git worktree remove` fails outright on a populated `node_modules`.

## TypeScript

The project compiles in **strict mode** — [tsconfig.json](tsconfig.json) enables `strict: true` plus `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters`. `noUncheckedIndexedAccess` types indexed/array/`Map.get()` access as `T | undefined`; narrow with a guard, `??` default, or optional chaining (a non-null assertion `!` is acceptable only when provably safe, with a justifying comment in production code). `pnpm lint` runs `tsc --noEmit` first, so type errors fail the build. Write fully-typed code (see the no-suppressions policy below); for an unused parameter required by a signature, prefix it with `_`.

## Key Data Models

All TypeScript interfaces defined in [types/schema.ts](types/schema.ts):

### Finance
- **Account**: Financial accounts (checking, savings, credit)
- **BudgetBucket**: Spending categories with limits and period tracking
- **Transaction**: Expense records with categorization and pay period tracking
- **CalendarItem**: Recurring/one-time income and expenses

### Gamification
- **Habit**: Tracks user behaviors with points, streaks, and completion history
- **Challenge**: Monthly goals tied to specific habits
- **RewardItem**: Redeemable rewards using accumulated points
- **FreezeBank**: Auto-applied streak protection (Plan 25): at midnight/login a token is consumed to freeze a missed day on a daily habit with a 3+ day streak (`Habit.frozenDates`); frozen days preserve streak continuity but never earn points. Stock refills to 2 monthly. **`Household.freezeMode`** (per-member points, stage 6) selects how tokens are spent — `'shared'` (the absent default = the behavior above), `'freeze_both'` (identical mechanics, pinned deliberately) or `'per_member'` (each adult holds their own bank in `Household.freezeBanksByMember` and their own frozen dates in `Habit.frozenDatesBy`, which bridges only that member's chain). [utils/freezeSettings.ts](utils/freezeSettings.ts) is the single source of truth for resolving both that field and `Household.ceremonyTone` (`'podium' | 'household_first' | 'adaptive'`, absent ⇒ `'household_first'`, consumed by the weekly ceremony); both resolvers map absent/unrecognised onto today's behavior, so the settings are inert until an admin picks one in Settings → Household → Habits. `freezeBanksByMember` and `frozenDatesBy` are written ONLY via dot paths (`freezeBanksByMember.<uid>.*`, `arrayUnion` on `frozenDatesBy.<date>`) — never whole-map writes, same discipline as `completedBy`.

### Meals & Nutrition
- **Meal**: Recipes with ingredients, tags, and ratings
- **MealPlanItem**: Weekly meal calendar entries linking to meals
- **ShoppingItem**: Grocery list items with category and purchase status

### Core
- **Household**: Main entity containing all household data, members, and settings
- **HouseholdMember**: User membership info with roles and permissions

## Meals Feature

The Meals tab (`MealPlanTab`, rendered by [pages/ListsPage.tsx](pages/ListsPage.tsx) at `/lists`) provides comprehensive meal planning and grocery management:

### Meal Planning
- Weekly calendar view for meal planning
- Create new meals or reuse previous recipes from your cookbook
- **AI meal suggestions**: Get personalized meal ideas based on:
  - Budget constraints (cheap option)
  - Time constraints (quick 30-min meals)
  - Novelty (new meals vs. favorites)
- Link meals to dates with meal type (breakfast, lunch, dinner, snack)
- Ingredient management
- One-click shopping list generation from meal ingredients

### Shopping List
- Manual item entry with category grouping
- **AI receipt scanning**: Upload grocery receipt photos to auto-populate shopping list
- Mark items as purchased to track what you've bought
- Duplicate prevention when adding items
- Smart filtering: only adds ingredients to shopping list if not already in list

**Implementation:**
- Components: [MealPlanTab.tsx](components/meals/MealPlanTab.tsx), [ShoppingListTab.tsx](components/meals/ShoppingListTab.tsx)
- AI Services: `suggestMeal()`, `parseGroceryReceipt()` in [geminiService.ts](services/geminiService.ts)
- Data stored in Firestore subcollections: `meals`, `mealPlan`, `shoppingList`

## Important Notes

- **Persistence**: All data is stored in **Firebase Firestore** with real-time sync across devices
- **Multi-household support**: Users can create or join households using 6-character invite codes
- **Authentication**: Google Sign-In required via Firebase Auth
- **Toast notifications**: Provided by `react-hot-toast` for user feedback
- **Mobile-optimized**: Designed for mobile-first with bottom navigation and touch-friendly UI
- **AI-powered features**:
  - Receipt/statement scanning for quick transaction entry
  - AI meal suggestions based on budget and time constraints
  - Dashboard insights generated by Gemini (`generateInsight()` via the context's `refreshInsight`)

## Code Quality Standards

### 🚨 CRITICAL: Zero Tolerance for Error Suppressions

**IT IS NEVER ACCEPTABLE TO SUPPRESS LINT OR TYPE ERRORS IF THERE IS ANY OTHER WAY TO FIX THE ACTUAL ISSUE.**

This is the **#1 most important rule** for maintaining code quality in this project.

#### Forbidden Suppressions

**NEVER add these without explicit approval:**

```typescript
/* eslint-disable */                           // ❌ FORBIDDEN - Blanket file-level disable
// @ts-ignore                                  // ❌ FORBIDDEN - Hides type errors
// @ts-expect-error                            // ❌ FORBIDDEN - Hides type errors
// @ts-nocheck                                 // ❌ FORBIDDEN - Disables all type checking
// eslint-disable-next-line [rule]             // ⚠️  REQUIRES JUSTIFICATION
```

#### When Suppressions Are Acceptable

Suppressions are **ONLY** acceptable for:

1. **React Context/Hook Exports** (legitimate pattern):
   ```typescript
   // eslint-disable-next-line react-refresh/only-export-components
   export const useMyContext = () => { ... }
   ```

2. **Third-party Library Issues** (beyond our control):
   - Must include a comment with link to upstream issue
   - Must include a TODO to remove when fixed upstream

3. **Temporary Workarounds** (rare, requires approval):
   - Must include a detailed comment explaining WHY
   - Must include a TODO with assigned owner and timeline
   - Must be tracked in [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md)

#### How to Fix Common Suppressions

**Instead of `/* eslint-disable */`:**
1. Remove the suppression
2. Run `pnpm lint` to see actual errors
3. Fix each error individually
4. If truly needed, use granular `eslint-disable-next-line` with justification

**Instead of `@typescript-eslint/no-explicit-any`:**
1. Define proper TypeScript interfaces/types
2. Use generics where appropriate
3. Import types from third-party libraries
4. Use `unknown` instead of `any`, then narrow with type guards

**Instead of `react-hooks/exhaustive-deps`:**
1. Add the missing dependencies to the array
2. If the effect intentionally shouldn't re-run, restructure the code:
   - Use refs for values that shouldn't trigger re-runs
   - Move logic outside the component
   - Split into multiple effects
3. **NEVER suppress without understanding the implications** - this causes stale closure bugs

**Instead of `@typescript-eslint/no-unused-vars`:**
1. Remove the unused variable
2. If required by a function signature, prefix with `_` (e.g., `_unusedParam`)
3. If it's dead code, delete it

#### Current Technical Debt

See [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md) for:
- Complete audit of all suppressions in the codebase
- Status of each suppression (acceptable vs. needs fixing)
- Action items for eliminating technical debt

**Current stats** (2026-07-24 audit; run `grep -rn "eslint-disable" --include="*.ts" --include="*.tsx" . | grep -v node_modules` to refresh):
- 0 blanket `/* eslint-disable */` files — all removed; only granular `eslint-disable-next-line` remain (23 in the root app + 1 in `functions/`)
- 12× `react-refresh/only-export-components` on context/hook exports (legitimate pattern), 7× `react-hooks/set-state-in-effect` (each with a justification comment), 4× `@typescript-eslint/no-explicit-any` (all in one test file), and 1× `no-control-regex` in `functions/` — locations tracked in [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md) - **REVIEW WHEN TOUCHED**
- 1 config-level rule override (`react-hooks/incompatible-library`, scoped to the single `useVirtualizer` consumer) — see LINT_SUPPRESSIONS.md "Accepted Configurations"
- 0 `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`

#### Enforcement

- All new code **MUST** pass linting without suppressions
- Pull requests with new suppressions will be rejected unless justified
- Existing suppressions should be removed as files are touched
- Goal: Zero suppressions except for legitimate exceptions

#### Examples of Good vs. Bad Practices

**❌ BAD - Suppressing instead of fixing:**
```typescript
useEffect(() => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [householdId]); // Missing householdSettings dependency!
```

**✅ GOOD - Actually fixing the issue:**
```typescript
useEffect(() => {
  // Now includes all dependencies
}, [householdId, householdSettings]);
```

**❌ BAD - Using any:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = await fetchData();
```

**✅ GOOD - Proper typing:**
```typescript
interface UserData {
  id: string;
  name: string;
}
const data: UserData = await fetchData();
```

## Test Mode for AI Coding Agents

LifeBalance includes a **secure test mode** specifically designed for AI coding agents to explore and test the application without requiring Firebase authentication or a real backend.

### Activating Test Mode

**Requirements:**
1. Must be running in development mode (`pnpm dev`)
2. Must have `VITE_ENABLE_TEST_MODE=true` in your `.env.local` file
3. Navigate to: `http://localhost:3000/#/login?test=true`

**Security Features:**
- ✅ Only works in development (`import.meta.env.DEV`)
- ✅ Requires explicit environment variable (`VITE_ENABLE_TEST_MODE=true`)
- ✅ Mock code is **excluded from production builds** via dynamic imports
- ✅ Session-only persistence (cleared on browser restart)
- ✅ Visible orange banner: "🧪 TEST MODE - MOCK DATA"

### What Test Mode Provides

**Mock Authentication:**
- Pre-authenticated as "Test User" (test@example.com)
- Mock household ID: `test-household-id`
- No Firebase calls required

**Mock Data** (seeded in [contexts/MockHouseholdContext.tsx](contexts/MockHouseholdContext.tsx)):
- **Accounts**: 3 sample accounts (checking, savings, credit)
- **Budget Buckets**: 4 categories
- **Transactions**: 2 sample transactions
- **Habits**: 3 (2 shared + 1 kid-assigned chore)
- **Stores**: 2
- **Members**: 2 (the admin test user with points + a managed kid profile for Kid Mode)
- Plus seed challenges, rewards, redemptions, todos, and a grocery catalog

**Full CRUD Operations:**
All context methods are fully implemented with **in-memory persistence**:
- ✅ Add/Update/Delete accounts, buckets, transactions
- ✅ Add/Update/Delete habits, calendar items
- ✅ Add/Update/Delete meals, shopping items
- ✅ Add/Update/Delete todos, stores
- ✅ Toggle habits, update balances
- ✅ All operations show toast notifications

### Example Usage

```bash
# 1. Add to .env.local
echo "VITE_ENABLE_TEST_MODE=true" >> .env.local

# 2. Start dev server
pnpm dev

# 3. Navigate to test mode URL
# Browser: http://localhost:3000/#/login?test=true

# 4. Application loads with mock data, no login required
```

### Implementation Details

**Files:**
- [contexts/MockAuthContext.tsx](contexts/MockAuthContext.tsx) - Mock authentication provider
- [contexts/MockHouseholdContext.tsx](contexts/MockHouseholdContext.tsx) - Mock data provider with full CRUD
- [App.tsx](App.tsx) - Dynamic import logic (tree-shaken in production)
- [pages/Login.tsx](pages/Login.tsx) - Test mode activation (`?test=true` sets the sessionStorage flag)

**Key Architecture:**
- Uses **dynamic imports** (`import()`) to load mock providers
- Mock code is automatically **tree-shaken** from production builds
- Providers swap at runtime based on test mode flag
- All state is kept in-memory (React useState) - no Firebase calls

### Deactivating Test Mode

Test mode automatically deactivates when:
- User signs out
- Browser/tab is closed (session storage cleared)
- User navigates to login without `?test=true` parameter

Or manually:
```javascript
sessionStorage.removeItem('LIFEBALANCE_TEST_MODE');
window.location.reload();
```

### Production Safety

**Multiple layers of protection:**
1. **Build-time**: Mock code excluded via dynamic imports
2. **Runtime**: Requires `import.meta.env.DEV === true`
3. **Environment**: Requires `VITE_ENABLE_TEST_MODE=true`
4. **Session**: Only persists in sessionStorage (not localStorage)

**Verification:**
```bash
# Build for production
pnpm run build

# Check bundle - mock code should NOT be present
grep -r "MockAuthProvider" dist/   # Should return nothing
grep -r "TEST MODE" dist/           # Should return nothing
```
