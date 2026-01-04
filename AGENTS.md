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

## 3. File Structure & Purpose

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

## 4. Architecture & Core Logic

### 4.1. The "Brain": `FirebaseHouseholdContext`
This context syncs all Firestore collections in real-time. It exposes:
- **Data**: `accounts`, `buckets`, `transactions`, `habits`, `pantry`, `meals`, `mealPlan`, `shoppingList`, `safeToSpend`, etc.
- **Actions**: `addTransaction`, `toggleHabit`, `payCalendarItem`, `addPantryItem`, `addMeal`, `addMealPlanItem`, `addShoppingItem`, etc.

**Key Responsibilities:**
- **Real-time Sync**: Uses `onSnapshot` for instant updates across devices.
- **Derived State**: Calculates `safeToSpend`, `dailyPoints` on the fly.
- **Migration**: Automatically runs data migrations (e.g., `migrateToPaycheckPeriods`).

### 4.2. Financial Logic
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

### 4.3. Habit & Gamification Logic
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

### 4.4. AI Integration (Gemini)
- Located in `services/geminiService.ts`.
- **Receipt Scanning**: Extracts merchant, amount, category from expense receipts (model: `gemini-3-flash-preview`).
- **Statement Parsing**: Parses full bank statement screenshots into transaction lists.
- **Pantry Image Analysis**: Identifies food items from photos with quantity, category, expiry (model: `gemini-2.0-flash-exp`).
- **Meal Suggestions**: AI-generated meal ideas based on pantry inventory, budget, time, and novelty preferences.
- **Grocery Receipt Parsing**: Extracts grocery items from receipt photos to populate pantry.
- **API Key**: `VITE_GEMINI_API_KEY`.

**Performance Note**: All AI image processing functions use `Promise.allSettled()` for concurrent item creation to handle partial failures gracefully.

### 4.5. Meals & Nutrition System
**Location**: `pages/MealsPage.tsx` with tabs for Pantry, Meal Plan, and Shopping List.

**Data Models** (in `types/schema.ts`):
- `PantryItem`: Food inventory (name, quantity, category, expiryDate, purchaseDate)
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

## 5. Deployment & Environment

- **Hosting**: Firebase Hosting.
- **Build Command**: `npm run build` (uses Vite).
- **Environment Variables**:
    - `VITE_FIREBASE_*`: Firebase config.
    - `VITE_GEMINI_API_KEY`: Google AI key.
    - Create `.env.local` for local development.

---

## 6. Verification Steps (How to Test)

Before submitting ANY change, you must verify:

1.  **Build**: Run `npm run build` to ensure no TS/build errors.
2.  **Lint/Typecheck**: Run `npx tsc --noEmit` to verify type safety.
3.  **Visual Check**:
    - Start dev server: `npm run dev`.
    - Check the browser console for errors.
    - Verify strict adherence to the Tailwind theme (colors, fonts).

## 7. Common Pitfalls to AVOID

- **❌ Importing from `src/`**: It will fail. Import from root or use `@/`.
- **❌ Modifying `tailwind.config.js`**: It doesn't exist. Edit `index.html`.
- **❌ Modifying `safeToSpend`**: Unless explicitly told to change the formula, TOUCH NOTHING.
- **❌ "Fixing" `HashRouter`**: Do not change it to `BrowserRouter`. It is intentional.
- **❌ Sequential `await` in loops**: Use `Promise.all()` or `Promise.allSettled()` for concurrent operations, especially when adding multiple items from AI analysis.
- **❌ Writing `id` field to Firestore**: Use object destructuring `const { id, ...data } = item` before spreading in `updateDoc()` calls.
- **❌ Forgetting duplicate prevention**: When adding items to pantry/shopping list, check for existing items using normalized name/category matching.
