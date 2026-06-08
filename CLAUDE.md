# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LifeBalance is a React-based household management application combining finance tracking, habit building, and gamification. Built with Vite, TypeScript, and Tailwind CSS, running on port 3000.

## Development Commands

This project uses **pnpm** (`packageManager: pnpm@9.15.0`) — always use `pnpm`, not `npm`. It is a pnpm workspace with two packages: the root app and `functions/` (Firebase Cloud Functions). See [pnpm-workspace.yaml](pnpm-workspace.yaml).

> ⚠️ A stray `package-lock.json` exists alongside `pnpm-lock.yaml`; do not run `npm install` (it would desync dependencies from what CI resolves via pnpm).

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

# Gemini API (for AI features)
VITE_GEMINI_API_KEY=your_gemini_api_key

# Firebase Cloud Messaging (for push notifications)
VITE_FIREBASE_VAPID_KEY=your_vapid_key_here
```

**Required for:**
- Firebase Authentication (Google Sign-In)
- Firestore database persistence and real-time sync
- AI features (Gemini API): receipt scanning, meal suggestions, grocery receipt parsing
- Push notifications (FCM): habit reminders, budget alerts, streak warnings, bill reminders

**Note:** `.env.local` is git-ignored to protect your credentials.

## Architecture

### State Management

Application state lives in `FirebaseHouseholdContext` ([contexts/FirebaseHouseholdContext.tsx](contexts/FirebaseHouseholdContext.tsx)), which owns the Firestore listeners but exposes state through **domain-sliced contexts** so a change in one domain doesn't re-render consumers of another. Consume the narrowest slice you need:
- `useFinance()` — accounts, budget buckets, transactions, calendar items, pay periods, Safe-to-Spend
- `useGamification()` — habits, points (daily/weekly/total), challenges, rewards, freeze bank
- `useMealPlan()` — meals (recipes) + weekly meal plan; `useShopping()` — shopping list, grocery catalog, stores (split so checking off a shopping item doesn't re-render the meal planner)
- `useTodos()` — shared household to-dos
- `useHouseholdCore()` — household id, members, loading, settings, insights

A backward-compatible `useHousehold()` shim composes all slices (and `useMeals()` composes the two meal slices) for un-migrated consumers; prefer the granular hooks in new/heavy components. `MockHouseholdContext` mirrors these slices for Test Mode.

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
- "Unpaid bills" are the expense calendar items between the current paycheck and the next one. Bills covered by buckets are excluded to avoid double-counting. A bill is matched to a bucket by exact `CalendarItem.bucketId` when set; otherwise it falls back to whole-word token matching of the bucket name against the bill title (bucket names shorter than 3 chars are skipped to avoid false matches). Note: budget-bucket *remaining limits* are **not** subtracted from `safeToSpend` — buckets only participate in bill-exclusion matching.
- **Pending spend** = the sum of current-period `pending_review` transactions (matched by `payPeriodId === currentPeriodId`; when no period is tracked, all `pending_review` transactions count), **excluding income** (`category === INCOME_CATEGORY`). It is subtracted because checking balances are entered **manually** and do not yet reflect un-cleared spending. There is no double-count with the unpaid-bills term (bills are calendar items, pending is transactions) and bucket remaining limits are not part of the formula. The shared `sumPendingSpend()` helper is the single source of truth; surfaced as the `pendingSpend` field of `SafeToSpendBreakdown` and shown as a "Pending transactions" line in both `SafeToSpendHero` and `SafeToSpendModal`.
- Money is summed in integer cents (`utils/money.ts`) to avoid floating-point drift
- Pure calculation lives in [utils/safeToSpendCalculator.ts](utils/safeToSpendCalculator.ts) and is wired into the context in [contexts/FirebaseHouseholdContext.tsx](contexts/FirebaseHouseholdContext.tsx). The context exposes a memoized `safeToSpendBreakdown` so widgets (e.g. `SafeToSpendHero`) consume it without re-expanding calendar items. Components that need a *different* window of expanded recurring items (e.g. `UpcomingBillsWidget`, `SafeToSpendModal`, `useActionQueue`) share the `useExpandedCalendarItems(start, end)` hook (memoized on `[calendarItems, start, end]`) rather than each calling `expandCalendarItems` in render.

### Habit Tracking System

Habits support two scoring modes:

1. **Threshold**: Points awarded only when `targetCount` is reached (e.g., "Read 30 mins" = 1 completion)
2. **Incremental**: Points on every action (e.g., "Late night snack" = -10 pts each time)

**Streak Multipliers** (the multiplier reflects the streak *including* the current completion). Streaks are measured in the habit's own cadence — consecutive **days** for daily habits, consecutive ISO **weeks** (local-week-anchored) for weekly habits — so weekly habits actually earn multipliers instead of resetting every ~7-day gap:
- **Daily** habits: 3-6 days → 1.5x, 7+ days → 2.0x
- **Weekly** habits: 2-3 weeks → 1.5x, 4+ weeks → 2.0x

`calculateStreak`/`streakEndingOn` are the day-based primitives; `calculateWeeklyStreak`/`streakEndingOnWeek` are the week-based analogues. Call sites use the period-dispatching helpers `streakForHabit(habit)` / `streakEndingOnForHabit(habit, date)`, and `getMultiplier(streak, isPositive, period)` applies the per-cadence thresholds. The Cloud Functions quickAdd path shares identical period-aware logic via [functions/src/quickAdd/streakLogic.ts](functions/src/quickAdd/streakLogic.ts) (`calculateStreak`/`calculateWeeklyStreak`/`streakForPeriod`/`getMultiplier`), unit-tested in `habitProcessor.test.ts`; `processToggleHabit` computes the multiplier from the **prospective** streak (including the current completion), matching the client. These server helpers accept an optional caller-local `today` (yyyy-MM-dd) — Cloud Functions run in UTC, so the quickAdd endpoint forwards `req.body.today` when present (falling back to the server date) to avoid off-by-one-day streaks for non-UTC users; the iOS Shortcut sending its local date is a remaining follow-up.

**Atomicity:** Habit mutations that touch both a habit document and the household points — `toggleHabit`, `resetHabit`, `addHabitSubmission`, `updateHabitSubmission`, `deleteHabitSubmission` — commit in a single `writeBatch` so they can never diverge (see [hooks/useHabitActions.tsx](hooks/useHabitActions.tsx)). The same applies to bucket reallocation and paycheck approval, to the calendar/transaction money paths (`payCalendarItem`, `updateTransaction`, `deleteTransaction`), to `PointsBreakdownModal`'s habit+points edit, and to the multi-document context mutations `updateTransactionCategory` (transaction + related habits + points), `useFreezeBankToken` (habit + token balance **+ the patched day's points**, credited with the period-aware multiplier), and `addMember` (member doc + `memberUids`). Core scoring/streak logic is pure and unit-tested in [utils/habitLogic.ts](utils/habitLogic.ts).

**Points sync:** the full daily/weekly/total recompute (`calculatePointsForDate`/`calculatePointsForDateRange`) is **not** re-run on every habit toggle — the per-toggle `writeBatch` delta is the source of truth. The corrective recompute is a ref-backed callback driven only by a once-per-household login sync and the midnight scheduler ([hooks/useMidnightScheduler.tsx](hooks/useMidnightScheduler.tsx)), so a toggle produces exactly one points write and drift is still corrected on login/rollover.

**Point recalculation:** `calculatePointsForDate`/`calculatePointsForDateRange` (used to re-sync daily/weekly/total points) reconstruct each completion day's streak via the period-aware `streakEndingOnForHabit()` (day- or week-based per `habit.period`) and apply the historical per-period multiplier — they do **not** apply the current streak to past days, so totals don't drift on recalculation.

**Dates:** Calendar dates are stored as `yyyy-MM-dd` strings in the user's **local** timezone. Use `getLocalDateString()` from [utils/dateHelpers.ts](utils/dateHelpers.ts) to derive "today" — never `new Date().toISOString().split('T')[0]` (that returns the UTC day, which is wrong in the evening for western timezones).

**Note:** Weather-sensitive bonuses are temporarily disabled. See [WEATHER_IMPLEMENTATION.md](WEATHER_IMPLEMENTATION.md) for future implementation plan.

Habits auto-reset based on their `period` (daily/weekly).

### Routing

Uses **HashRouter** (not BrowserRouter) to support deployment without server-side routing configuration. Routes are defined in [App.tsx](App.tsx); pages are `React.lazy`-loaded for code-splitting. Current routes: `/login`, `/setup` (public); `/` (Dashboard), `/lists`, `/budget`, `/habits`, `/meals`, `/shopping`, `/todos`, `/settings`, `/migrate-submissions` (protected via `ProtectedRoute` + `MainLayout`). Each protected route is wrapped in its own `ErrorBoundary` keyed on pathname, so a crash on one page doesn't take down the whole app.

### External Services

**Gemini API** ([services/geminiService.ts](services/geminiService.ts)):
- The model is defined once in the exported `GEMINI_MODEL` constant (overridable via the optional `VITE_GEMINI_MODEL` env var) — change it there, not inline at call sites.
- Calls go through a shared helper with a 30s timeout and bounded exponential-backoff retry on transient errors (429/503/network); non-transient errors are not retried.
- The daily AI quota check-and-increment runs in a single Firestore `runTransaction` to avoid a check-then-increment race.
- Plain TypeScript types are in [services/geminiService.types.ts](services/geminiService.types.ts) (re-exported from `geminiService`); import types from there in always-loaded modules so the `@google/genai` SDK stays out of the app boot path (the SDK functions are loaded via dynamic `import()`).
- **Receipt Scanning**: `analyzeReceipt()` - OCR for expense receipts
  - Returns: merchant, amount, category, date
- **Bank Statement Parsing**: `parseBankStatement()` - Extracts transaction lists from screenshots
  - Returns: array of transactions with dates, descriptions, amounts
- **Meal Suggestions**: `suggestMeal()` - AI-powered meal planning based on budget and time constraints
  - Returns: meal name, description, ingredients, tags, reasoning
- **Grocery Receipt Parsing**: `parseGroceryReceipt()` - Extracts grocery items from receipt photos
  - Returns: array of items with name, category, quantity

### Styling

**Tailwind CSS** compiled via PostCSS at build time (not CDN):
- Config in [tailwind.config.js](tailwind.config.js); PostCSS pipeline in [postcss.config.js](postcss.config.js); directives + custom utilities in [index.css](index.css)
- Custom theme colors: `brand-*`, `money-*`, `habit-*`
- Custom fonts: Inter (sans), JetBrains Mono (mono), loaded via Google Fonts in [index.html](index.html)
- Mobile-first with safe-area-inset support
- `clsx` + `tailwind-merge` for conditional/merged class names
- Entrance animations (`animate-in`, `fade-in`, `slide-in-from-*`, `zoom-in-*`) are provided by the **`tailwindcss-animate`** plugin (registered in [tailwind.config.js](tailwind.config.js)). They are fully suppressed for `prefers-reduced-motion` users via a guard in [index.css](index.css) (`.animate-in/.animate-out { animation: none }`).

### Component Organization

```
components/
  ├── analytics/    # Charts/analytics widgets (recharts; lazy-loaded)
  ├── auth/         # Authentication components (ProtectedRoute, HouseholdInviteCard)
  ├── budget/       # Budget-specific UI components (TransactionMasterList is windowed with @tanstack/react-virtual)
  ├── dashboard/    # Dashboard widgets (SafeToSpendHero, action queue, etc.)
  ├── habits/       # Habit tracking UI components
  ├── layout/       # MainLayout, TopToolbar, BottomNav, OfflineBanner
  ├── meals/        # Meal planning components (MealPlanTab, ShoppingListTab)
  ├── modals/       # Modal dialogs for forms
  ├── settings/     # Settings sub-components (NotificationSettings, ThemeToggle)
  └── ui/           # Reusable primitives (Button, Input, Card, Drawer, Skeleton, ConfirmDialog, etc.)

pages/              # Route-level page components (lazy-loaded in App.tsx)
  ├── Dashboard.tsx        # Main overview with AI insights
  ├── Budget.tsx           # Finance management
  ├── Habits.tsx           # Habit tracker
  ├── MealsPage.tsx        # Meal planning
  ├── ShoppingPage.tsx     # Shopping list
  ├── ToDosPage.tsx        # Shared household to-dos
  ├── ListsPage.tsx        # Generic lists
  ├── Settings.tsx         # App settings and preferences
  ├── Login.tsx            # Authentication
  ├── HouseholdSetup.tsx   # Household creation/joining
  └── MigrateSubmissions.tsx # One-off data migration tool

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

Tests use **Vitest** with **@testing-library/react** and a `jsdom` environment (config in [vite.config.ts](vite.config.ts), setup in [vitest.setup.ts](vitest.setup.ts)). Test files live next to the code they cover as `*.test.ts(x)`. Business logic in `utils/` (safe-to-spend, habit scoring, money math, date helpers) is the most heavily covered — add/extend tests there when changing that logic. Run with `pnpm test`.

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
- **FreezeBank**: Allows users to patch missed habit days with earned tokens

### Meals & Nutrition
- **Meal**: Recipes with ingredients, tags, and ratings
- **MealPlanItem**: Weekly meal calendar entries linking to meals
- **ShoppingItem**: Grocery list items with category and purchase status

### Core
- **Household**: Main entity containing all household data, members, and settings
- **HouseholdMember**: User membership info with roles and permissions

## Meals Feature

The Meals page ([pages/MealsPage.tsx](pages/MealsPage.tsx)) provides comprehensive meal planning and grocery management:

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
  - Dashboard insights (currently randomized, expandable for future AI integration)

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

**Current stats** (run `grep -rln "eslint-disable" --include="*.ts" --include="*.tsx" . | grep -v node_modules` to refresh):
- 0 blanket `/* eslint-disable */` files — all removed; only granular `eslint-disable-next-line` remain
- The remaining granular disables are the legitimate `react-refresh/only-export-components` pattern on context/hook exports, plus a small set of pre-existing single-line `@typescript-eslint/no-explicit-any` / `react-hooks/set-state-in-effect` cases tracked in [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md) - **REVIEW WHEN TOUCHED**
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

**Mock Data:**
- **Accounts**: 3 sample accounts (checking, savings, credit)
- **Budget Buckets**: 4 categories (Groceries, Entertainment, Utilities, Gas)
- **Transactions**: 2 sample transactions
- **Habits**: 2 health habits ready for tracking
- **Stores**: 2 stores (Safeway, Costco)
- **Members**: 1 test user with points

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
- [App.tsx:55-90](App.tsx#L55-L90) - Dynamic import logic (tree-shaken in production)
- [pages/Login.tsx:14-36](pages/Login.tsx#L14-L36) - Test mode activation

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
