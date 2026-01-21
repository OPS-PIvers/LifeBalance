# AGENTS.md

> **CRITICAL**: This file is the **Single Source of Truth** for any AI agent working on this repository. Read it completely before making any changes.

## 1. Project Overview

**LifeBalance** is a household management application that gamifies finance and habit tracking. It is a **mobile-first** web application (PWA) built with **Vite + React**.

### Core Tech Stack
- **Framework**: React 19 (Vite)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (Loaded via CDN - **DO NOT TRY TO CONFIGURE POSTCSS/TAILWIND.CONFIG.JS**)
- **Backend/DB**: Firebase (Auth, Firestore)
- **Routing**: `HashRouter` (Required for Firebase Hosting compatibility without rewrites)
- **Icons**: Lucide React
- **Date Handling**: `date-fns`
- **AI Integration**: Google Gemini (via `@google/genai`) for receipt/statement parsing, pantry analysis, and meal planning

---

## 2. Rigid Coding Rules

**Failure to follow these rules will result in broken functionality or regressions.**

1.  **Tailwind via CDN**:
    *   This project loads Tailwind via a `<script>` tag in `index.html`.
    *   **NEVER** attempt to install `tailwindcss` via npm or create a `tailwind.config.js` file.
    *   Custom theme colors (`brand-*`, `money-*`, `habit-*`) are defined in `index.html`. Use them.
    *   Do not use `@apply` in CSS files (it won't work). Use utility classes directly in JSX.

2.  **State Management**:
    *   **ALL** global state lives in `contexts/FirebaseHouseholdContext.tsx`.
    *   **NEVER** create local state that duplicates global state.
    *   Always access state/actions via `useHousehold()`.
    *   Do not modify Firestore directly from components; use the actions provided by `FirebaseHouseholdContext`.

3.  **Routing**:
    *   Use `HashRouter`. Do not switch to `BrowserRouter`.
    *   Navigation must use `useNavigate` or `Link` from `react-router-dom`.

4.  **Data Integrity**:
    *   **Safe-to-Spend**: This is the "God Metric". Never modify its calculation logic (`utils/safeToSpendCalculator.ts`) without explicit instruction.
    *   **Transactions**: Must always have a valid `payPeriodId` if period tracking is active.
    *   **Buckets**: `spent` field is deprecated. Spend is calculated in real-time from transactions.

5.  **File Structure**:
    *   Source code is in the **ROOT** directory (`/components`, `/pages`, etc.), NOT `/src`.
    *   `/src` only contains environment types. Do not move files there.
    *   Use `@/` alias for imports (mapped to root).

---

## 3. Code Quality & Error Suppression Policy

### 🚨 CRITICAL RULE: ZERO TOLERANCE FOR ERROR SUPPRESSIONS

**IT IS NEVER ACCEPTABLE TO SUPPRESS LINT OR TYPE ERRORS IF THERE IS ANY OTHER WAY TO FIX THE ACTUAL ISSUE.**

This is a **top priority rule** that supersedes convenience or speed.

### 3.1. Forbidden Suppressions

**NEVER add these without explicit written approval from the repository owner:**

```typescript
/* eslint-disable */                           // ❌ FORBIDDEN - Blanket file-level disable
// @ts-ignore                                  // ❌ FORBIDDEN - Hides type errors
// @ts-expect-error                            // ❌ FORBIDDEN - Hides type errors
// @ts-nocheck                                 // ❌ FORBIDDEN - Disables all type checking
// eslint-disable-next-line [any-rule]         // ⚠️  REQUIRES DETAILED JUSTIFICATION
```

### 3.2. Why This Matters

Suppressions hide real issues:
- **Type errors**: Can cause runtime crashes, data corruption, security vulnerabilities
- **Unused variables**: Often indicate dead code or logic errors
- **Missing dependencies**: Cause stale closures, subtle bugs, and race conditions
- **Exhaustive deps**: Lead to effects not re-running when they should, causing UI desync

### 3.3. When Suppressions Are Acceptable (Rare Exceptions Only)

1. **React Context/Hook Exports** (standard pattern):
   ```typescript
   // ✅ ACCEPTABLE - Context files legitimately export non-components
   // eslint-disable-next-line react-refresh/only-export-components
   export const useMyContext = () => { ... }
   ```

2. **Third-party Library Type Issues** (beyond our control):
   ```typescript
   // ✅ ACCEPTABLE IF:
   // - Includes link to upstream issue/PR
   // - Includes TODO to remove when fixed
   // - Documented in LINT_SUPPRESSIONS.md
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   const chartData: any = externalLib.getData(); // TODO: Remove when https://github.com/lib/issue/123 is fixed
   ```

3. **Temporary Workarounds** (extremely rare, requires approval):
   - Must include detailed comment explaining WHY the proper fix isn't possible
   - Must include TODO with owner and timeline
   - Must be tracked in [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md)
   - Will be reviewed in next PR

### 3.4. How to Fix Instead of Suppress

**For `@typescript-eslint/no-explicit-any`:**
```typescript
// ❌ BAD - Suppressing
// @ts-ignore
const data: any = await fetchData();

// ✅ GOOD - Proper typing
interface FirestoreDocument {
  id: string;
  name: string;
  createdAt: Timestamp;
}
const data = await fetchData() as FirestoreDocument;

// ✅ ALSO GOOD - Using generics
async function fetchData<T>(): Promise<T> { ... }
const data = await fetchData<UserData>();
```

**For `react-hooks/exhaustive-deps`:**
```typescript
// ❌ BAD - Suppressing dependency warning
useEffect(() => {
  calculateTotal(items, settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [items]); // Missing settings!

// ✅ GOOD - Add the dependency
useEffect(() => {
  calculateTotal(items, settings);
}, [items, settings]);

// ✅ ALSO GOOD - Use ref if intentionally static
const settingsRef = useRef(settings);
useEffect(() => {
  calculateTotal(items, settingsRef.current);
}, [items]);
```

**For `@typescript-eslint/no-unused-vars`:**
```typescript
// ❌ BAD - Suppressing unused var
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const unusedVar = getData();

// ✅ GOOD - Remove it entirely
// (Just delete the line)

// ✅ ALSO GOOD - Prefix with _ if required by signature
function handler(_event: Event, data: Data) {
  // _event is required by signature but not used
  process(data);
}
```

**For blanket `/* eslint-disable */`:**
```typescript
// ❌ BAD - Hiding all errors in entire file
/* eslint-disable */

// ✅ GOOD - Remove and fix each error individually
// (No suppression needed if code is written correctly)
```

### 3.5. Current Technical Debt

**This codebase currently has 38 files with blanket `/* eslint-disable */` suppressions.**

See [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md) for:
- Complete audit of all suppressions
- Status of each (acceptable vs. needs fixing)
- Action plan for eliminating technical debt

**Your Responsibility as an Agent:**
- ✅ **NEVER** add new suppressions
- ✅ **ALWAYS** fix errors properly
- ✅ **REMOVE** suppressions when touching files that have them
- ✅ **DOCUMENT** if you must add a suppression (rare)

### 3.6. Verification

Before submitting code:
```bash
# 1. Must pass type checking
npx tsc --noEmit

# 2. Must pass linting
npm run lint

# 3. Must build successfully
npm run build
```

If any of these fail, fix the actual issue. **Do not suppress.**

### 3.7. Example: Recent Fix

**Bad approach (suppressing):**
```typescript
// ❌ This was done incorrectly
useEffect(() => {
  syncPoints();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [householdId, householdSettings?.points]); // Missing householdSettings in usage!
```

**Good approach (fixing properly):**
```typescript
// ✅ This was the correct fix
useEffect(() => {
  if (!householdSettings?.points) return;
  const currentPoints = householdSettings.points; // Now directly using what we're watching
  syncPoints(currentPoints);
}, [householdId, householdSettings?.points]); // Deps match usage
```

**Result:**
- No stale closures
- No false sense of security
- Code is more maintainable
- Linter helps catch future bugs

---

## 4. File Structure & Purpose

```text
/
├── components/           # UI Components
│   ├── auth/             # Authentication & ProtectedRoute
│   ├── budget/           # Budget specific (Buckets, Accounts, Calendar)
│   ├── habits/           # Habit tracking (Cards, Lists, Forms)
│   ├── layout/           # Global layout (TopToolbar, BottomNav)
│   ├── meals/            # Meal planning (PantryTab, MealPlanTab, ShoppingListTab)
│   └── modals/           # ALL forms/interactions open in modals
├── contexts/
│   ├── AuthContext.tsx             # Firebase Auth state
│   └── FirebaseHouseholdContext.tsx # CORE APPLICATION STATE & LOGIC
├── data/                 # Static data (e.g., presetHabits.ts)
├── hooks/                # Custom hooks
│   └── useMidnightScheduler.ts     # Handles auto-resets at 00:00
├── pages/                # Route components
│   ├── Dashboard.tsx     # Home view (Summary, Insights)
│   ├── Budget.tsx        # Finance view
│   ├── Habits.tsx        # Habit view
│   ├── MealsPage.tsx     # Meal planning, pantry, shopping
│   ├── Settings.tsx      # App settings
│   ├── Login.tsx         # Auth entry
│   ├── HouseholdSetup.tsx # Household creation/joining
│   └── ...
├── services/             # External API integrations
│   ├── authService.ts    # Auth logic
│   ├── geminiService.ts  # AI: Receipt/Statement/Pantry scanning, Meal suggestions
│   └── householdService.ts # Household creation/joining
├── types/
│   └── schema.ts         # TypeScript Interfaces (Source of Truth for Data Models)
├── utils/                # Business Logic (PURE FUNCTIONS ONLY)
│   ├── safeToSpendCalculator.ts    # CRITICAL: Financial health formula
│   ├── habitLogic.ts               # Scoring, streaks, toggles
│   ├── bucketSpentCalculator.ts    # Real-time bucket spend aggregation
│   ├── paycheckPeriodCalculator.ts # Pay period date logic
│   └── ...
├── index.html            # Entry point, Tailwind CDN config
├── vite.config.ts        # Build config
└── firebase.json         # Deployment config
```

---

## 5. Architecture & Core Logic

### 5.1. The "Brain": `FirebaseHouseholdContext`
This context syncs all Firestore collections in real-time. It exposes:
- **Data**: `accounts`, `buckets`, `transactions`, `habits`, `pantry`, `meals`, `mealPlan`, `shoppingList`, `safeToSpend`, etc.
- **Actions**: `addTransaction`, `toggleHabit`, `payCalendarItem`, `addPantryItem`, `addMeal`, `addMealPlanItem`, `addShoppingItem`, etc.

**Key Responsibilities:**
- **Real-time Sync**: Uses `onSnapshot` for instant updates across devices.
- **Derived State**: Calculates `safeToSpend`, `dailyPoints` on the fly.
- **Migration**: Automatically runs data migrations (e.g., `migrateToPaycheckPeriods`).

### 5.2. Financial Logic
**Safe-to-Spend Formula (`utils/safeToSpendCalculator.ts`):**
```
Safe-to-Spend = (Checking Account Balance)
              - (Unpaid Bills due before end of month)
              - (Remaining Limit of all Budget Buckets)
              - (Pending Transactions)
```
*Note: Bills covered by buckets are EXCLUDED from "Unpaid Bills" to prevent double counting.*

**Pay Period Tracking:**
- User defines a "Paycheck Date".
- `currentPeriodId` = Date of the last paycheck (YYYY-MM-DD).
- When a new paycheck is approved:
    1. A snapshot of all buckets is saved to `bucketHistory`.
    2. Buckets are "reset" (limits restored, spend clears).
    3. `currentPeriodId` updates.

### 5.3. Habit & Gamification Logic
**Scoring Types (`utils/habitLogic.ts`):**
1.  **Threshold**: Points awarded ONLY when `targetCount` is reached (e.g., "Drink 8 glasses of water").
2.  **Incremental**: Points awarded PER action (e.g., "Do 1 pushup").

**Streaks:**
- Calculated based on consecutive days in `completedDates`.
- **Multipliers**:
    - 3-6 days: **1.5x** points.
    - 7+ days: **2.0x** points.

**Freeze Bank:**
- Allows users to "patch" missed habit days.
- **Tokens**: Earned monthly (max 3).
- Logic in `utils/freezeBankValidator.ts`.

### 5.4. AI Integration (Gemini)
- Located in `services/geminiService.ts`.
- **Receipt Scanning**: Extracts merchant, amount, category from expense receipts (model: `gemini-3-flash-preview`).
- **Statement Parsing**: Parses full bank statement screenshots into transaction lists.
- **Pantry Image Analysis**: Identifies food items from photos with quantity, category, expiry (model: `gemini-3-flash-preview`).
- **Meal Suggestions**: AI-generated meal ideas based on pantry inventory, budget, time, and novelty preferences.
- **Grocery Receipt Parsing**: Extracts grocery items from receipt photos to populate pantry.
- **API Key**: `VITE_GEMINI_API_KEY`.

**Performance Note**: All AI image processing functions use `Promise.allSettled()` for concurrent item creation to handle partial failures gracefully.

### 5.5. Meals & Nutrition System
**Location**: `pages/MealsPage.tsx` with tabs for Pantry, Meal Plan, and Shopping List.

**Data Models** (in `types/schema.ts`):
- `PantryItem`: Food inventory (name, quantity, category, purchaseDate)
- `Meal`: Recipes (name, description, ingredients[], tags[], rating, createdBy)
- `MealPlanItem`: Calendar entries (date, mealName, mealId, type, isCooked)
- `ShoppingItem`: Grocery list (name, category, quantity, isPurchased, addedFromMealId)

**Key Features**:
1. **Pantry Management** (`components/meals/PantryTab.tsx`):
   - Manual item entry with category grouping
   - AI image upload for bulk item detection
   - Expiry date tracking

2. **Meal Planning** (`components/meals/MealPlanTab.tsx`):
   - Weekly calendar view (Sunday-Saturday)
   - Meal library/cookbook for reusing recipes
   - AI meal suggestions with customizable constraints
   - Ingredient autocomplete from pantry
   - "Shop Ingredients" button → auto-adds missing items to shopping list

3. **Shopping List** (`components/meals/ShoppingListTab.tsx`):
   - Categorized grocery list
   - Receipt scanning for quick pantry population
   - **Critical Logic**: When marking item as "purchased":
     - Checks if item already exists in pantry (normalized name/category)
     - Only adds if NOT already present (prevents duplicates)
     - Displays appropriate toast feedback
   - **Note**: Unmarking does NOT remove from pantry (intentional design)

**Firestore Structure**:
```
households/{householdId}/
  ├── pantry/{itemId}
  ├── meals/{mealId}
  ├── mealPlan/{planItemId}
  └── shoppingList/{itemId}
```

---

## 6. AI Agent Test Mode (Auth Bypass)

**LifeBalance includes a secure test mode specifically designed for AI coding agents to explore and test the application without requiring Firebase authentication.**

### 6.1. How to Activate Test Mode

**Requirements:**
1. Running in development mode (`npm run dev`)
2. Environment variable `VITE_ENABLE_TEST_MODE=true` in `.env.local`
3. Navigate to: `http://localhost:3000/#/login?test=true`

**Setup Steps:**
```bash
# 1. Add to .env.local
echo "VITE_ENABLE_TEST_MODE=true" >> .env.local

# 2. Start dev server
npm run dev

# 3. Open browser to test mode URL
# http://localhost:3000/#/login?test=true

# 4. Application loads with mock data, no login required
```

### 6.2. Security Features

Test mode has **triple-layer protection** to prevent accidental production usage:

1. ✅ **Development Only**: Requires `import.meta.env.DEV === true`
2. ✅ **Explicit Env Var**: Requires `VITE_ENABLE_TEST_MODE=true`
3. ✅ **Session Storage**: State only persists for browser session (auto-clears on restart)

**Production Safety:**
- Mock code is **excluded from production bundles** via dynamic imports
- Vite's tree-shaking removes all test mode code during `npm run build`
- Multiple build checks confirm zero production bundle impact

### 6.3. What Test Mode Provides

**Mock Authentication:**
- Pre-authenticated as "Test User" (test@example.com)
- Mock household ID: `test-household-id`
- No Firebase API calls

**Mock Data Available:**
- **Accounts**: 3 sample accounts (checking $5,420.50, savings $12,000, credit -$850.25)
- **Budget Buckets**: 4 categories (Groceries, Entertainment, Utilities, Gas)
- **Transactions**: 2 sample transactions
- **Habits**: 2 health habits ready for tracking
- **Pantry**: 2 sample items (Milk, Eggs)
- **Stores**: 2 stores (Safeway, Costco)
- **Members**: 1 test user with points (daily: 30, weekly: 150, total: 500)

**Full CRUD Operations:**
All context methods are fully implemented with **in-memory persistence**:
- ✅ Add/Update/Delete accounts, buckets, transactions
- ✅ Add/Update/Delete habits, calendar items
- ✅ Add/Update/Delete pantry items, meals, shopping items
- ✅ Add/Update/Delete todos, stores
- ✅ Toggle habits, update balances, manage grocery categories
- ✅ All operations show toast notifications

### 6.4. Implementation Details

**Key Files:**
- `contexts/MockAuthContext.tsx` - Mock Firebase authentication provider
- `contexts/MockHouseholdContext.tsx` - Mock data provider with full CRUD (460 lines)
- `App.tsx` (lines 56-90) - Dynamic import logic (tree-shaken in production)
- `pages/Login.tsx` (lines 14-36) - Test mode activation from URL parameter

**Architecture:**
- Uses **dynamic imports** (`import()`) to load mock providers on-demand
- Providers swap at runtime based on test mode flag
- All state kept in-memory (React `useState`) - zero Firebase calls
- Mock code automatically **tree-shaken** from production builds

### 6.5. Using Test Mode as an AI Agent

When test mode is active:
- Orange banner displays: "🧪 TEST MODE - MOCK DATA (Development Only)"
- All UI features work identically to production
- Data persists across navigation during the session
- Changes don't affect real Firebase backend
- Perfect for testing UI flows, forms, and interactions

**Deactivating Test Mode:**
- User signs out (clears session storage automatically)
- Browser/tab closed (session storage auto-clears)
- Navigate to `/login` without `?test=true` parameter

Or manually:
```javascript
sessionStorage.removeItem('LIFEBALANCE_TEST_MODE');
window.location.reload();
```

### 6.6. Verification

To verify test mode is properly excluded from production:
```bash
# Build for production
npm run build

# Check bundle - should return nothing
grep -r "MockAuthProvider" dist/
grep -r "TEST MODE" dist/
```

**See Also:** Detailed documentation in `CLAUDE.md` section "Test Mode for AI Coding Agents"

---

## 7. Deployment & Environment

- **Hosting**: Firebase Hosting.
- **Build Command**: `npm run build` (uses Vite).
- **Environment Variables**:
    - `VITE_FIREBASE_*`: Firebase config.
    - `VITE_GEMINI_API_KEY`: Google AI key.
    - `VITE_ENABLE_TEST_MODE`: Enable test mode for AI agents (development only).
    - Create `.env.local` for local development (copy from `.env.local.example`).

---

## 8. Verification Steps (How to Test)

Before submitting ANY change, you must verify:

1.  **Build**: Run `npm run build` to ensure no TS/build errors.
2.  **Lint/Typecheck**: Run `npx tsc --noEmit` to verify type safety.
3.  **Visual Check**:
    - Start dev server: `npm run dev`.
    - Check the browser console for errors.
    - Verify strict adherence to the Tailwind theme (colors, fonts).
4.  **Test Mode Check** (for AI agents):
    - If you don't have Firebase credentials, use test mode (see Section 6).
    - Verify your changes work with mock data before submitting.

## 9. Common Pitfalls to AVOID

- **❌ Importing from `src/`**: It will fail. Import from root or use `@/`.
- **❌ Modifying `tailwind.config.js`**: It doesn't exist. Edit `index.html`.
- **❌ Modifying `safeToSpend`**: Unless explicitly told to change the formula, TOUCH NOTHING.
- **❌ "Fixing" `HashRouter`**: Do not change it to `BrowserRouter`. It is intentional.
- **❌ Sequential `await` in loops**: Use `Promise.all()` or `Promise.allSettled()` for concurrent operations, especially when adding multiple items from AI analysis.
- **❌ Writing `id` field to Firestore**: Use object destructuring `const { id, ...data } = item` before spreading in `updateDoc()` calls.
- **❌ Forgetting duplicate prevention**: When adding items to pantry/shopping list, check for existing items using normalized name/category matching.

## 10. Agent Journals

Regardless of the capitalization in the user's prompt (e.g., .Jules, .jules, Jules), always use the .jules directory for reading and writing agent journals. Consolidate all agent logs there.
