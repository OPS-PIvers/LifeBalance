# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LifeBalance is a React-based household management application combining finance tracking, habit building, and gamification. Built with Vite, TypeScript, and Tailwind CSS, running on port 3000.

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

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
- AI features (Gemini API): receipt scanning, pantry image analysis, meal suggestions, grocery receipt parsing
- Push notifications (FCM): habit reminders, budget alerts, streak warnings, bill reminders

**Note:** `.env.local` is git-ignored to protect your credentials.

## Architecture

### State Management

The entire application state is managed through a single **React Context**: `FirebaseHouseholdContext` ([contexts/FirebaseHouseholdContext.tsx](contexts/FirebaseHouseholdContext.tsx)).

This context provides:
- **Finance**: Accounts, budget buckets, transactions, calendar items, pay periods
- **Gamification**: Habits, points (daily/weekly/total), challenges, rewards
- **Meals**: Pantry inventory, meal recipes, weekly meal planning, shopping lists
- **Safe-to-Spend Calculation**: Real-time financial health metric

All data is persisted in **Firestore** with real-time synchronization across devices using Firebase's `onSnapshot` listeners.

### Safe-to-Spend Logic

The core financial metric (`safeToSpend`) is calculated as:
```
Checking Balance - Unpaid Bills (this month) - Remaining Budget Bucket Limits - Pending Transactions
```

**Critical implementation details:**
- Only checking accounts count as available funds (not savings or credit)
- Bills covered by buckets are excluded to avoid double-counting
- Pending transactions reduce both checking balance and bucket liabilities
- Located in [contexts/HouseholdContext.tsx:258-308](contexts/HouseholdContext.tsx#L258-L308)

### Habit Tracking System

Habits support two scoring modes:

1. **Threshold**: Points awarded only when `targetCount` is reached (e.g., "Read 30 mins" = 1 completion)
2. **Incremental**: Points on every action (e.g., "Late night snack" = -10 pts each time)

**Streak Multipliers:**
- 3-6 days: 1.5x points
- 7+ days: 2.0x points

**Note:** Weather-sensitive bonuses are temporarily disabled. See [WEATHER_IMPLEMENTATION.md](WEATHER_IMPLEMENTATION.md) for future implementation plan.

Habits auto-reset based on their `period` (daily/weekly).

### Routing

Uses **HashRouter** (not BrowserRouter) to support deployment without server-side routing configuration. Routes defined in [App.tsx:21-26](App.tsx#L21-L26).

### External Services

**Gemini API** ([services/geminiService.ts](services/geminiService.ts)):
- **Receipt Scanning**: `analyzeReceipt()` - OCR for expense receipts (model: `gemini-3-flash-preview`)
  - Returns: merchant, amount, category, date
- **Bank Statement Parsing**: `parseBankStatement()` - Extracts transaction lists from screenshots
  - Returns: array of transactions with dates, descriptions, amounts
- **Pantry Image Analysis**: `analyzePantryImage()` - Identifies food items from photos (model: `gemini-2.0-flash-exp`)
  - Returns: array of items with name, quantity, category, expiry date
- **Meal Suggestions**: `suggestMeal()` - AI-powered meal planning based on pantry, budget, time constraints
  - Returns: meal name, description, ingredients, tags, reasoning
- **Grocery Receipt Parsing**: `parseGroceryReceipt()` - Extracts grocery items from receipt photos
  - Returns: array of items with name, category, quantity

### Styling

**Tailwind CSS** via CDN (configured in [index.html](index.html)):
- Custom theme colors: `brand-*`, `money-*`, `habit-*`
- Custom fonts: Inter (sans), JetBrains Mono (mono)
- Mobile-first with safe-area-inset support
- No separate Tailwind config file; configuration embedded in HTML `<script>` tag

### Component Organization

```
components/
  ├── auth/         # Authentication components (ProtectedRoute, HouseholdInviteCard)
  ├── budget/       # Budget-specific UI components
  ├── habits/       # Habit tracking UI components
  ├── layout/       # TopToolbar, BottomNav
  ├── meals/        # Meal planning components (PantryTab, MealPlanTab, ShoppingListTab)
  └── modals/       # Modal dialogs for forms

pages/              # Route-level page components
  ├── Dashboard.tsx      # Main overview with AI insights
  ├── Budget.tsx         # Finance management
  ├── Habits.tsx         # Habit tracker
  ├── MealsPage.tsx      # Meal planning, pantry, and shopping
  ├── Settings.tsx       # App settings and preferences
  ├── Login.tsx          # Authentication
  ├── HouseholdSetup.tsx # Household creation/joining
  └── PlaceholderPage.tsx

contexts/           # React Context providers (AuthContext, FirebaseHouseholdContext)
services/           # External API integrations (authService, geminiService, householdService)
types/              # TypeScript type definitions
utils/              # Business logic utilities (safeToSpendCalculator, habitLogic, etc.)
```

### Path Aliases

The project uses `@/` as an alias for the root directory:
```typescript
import { Habit } from '@/types/schema';
import TopToolbar from '@/components/layout/TopToolbar';
```

Configured in both [tsconfig.json](tsconfig.json) and [vite.config.ts](vite.config.ts).

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
- **PantryItem**: Food inventory with quantity, category, and expiry tracking
- **Meal**: Recipes with ingredients, tags, and ratings
- **MealPlanItem**: Weekly meal calendar entries linking to meals
- **ShoppingItem**: Grocery list items with category and purchase status

### Core
- **Household**: Main entity containing all household data, members, and settings
- **HouseholdMember**: User membership info with roles and permissions

## Meals Feature

The Meals page ([pages/MealsPage.tsx](pages/MealsPage.tsx)) provides comprehensive meal planning and grocery management:

### Pantry Management
- Manual item entry with category, quantity, and expiry dates
- **AI-powered image analysis**: Upload photos of your pantry/fridge to automatically identify and add items
- Track food inventory across categories (Produce, Dairy, Meat, Grains, etc.)
- Visual organization with category grouping

### Meal Planning
- Weekly calendar view for meal planning
- Create new meals or reuse previous recipes from your cookbook
- **AI meal suggestions**: Get personalized meal ideas based on:
  - Available pantry items
  - Budget constraints (cheap option)
  - Time constraints (quick 30-min meals)
  - Novelty (new meals vs. favorites)
- Link meals to dates with meal type (breakfast, lunch, dinner, snack)
- Ingredient management with pantry autocomplete
- One-click shopping list generation from meal ingredients

### Shopping List
- Manual item entry with category grouping
- **AI receipt scanning**: Upload grocery receipt photos to auto-populate pantry
- Mark items as purchased → automatically adds to pantry
- Duplicate prevention when marking items purchased
- Smart filtering: only adds ingredients to shopping list if not in pantry or list

**Implementation:**
- Components: [PantryTab.tsx](components/meals/PantryTab.tsx), [MealPlanTab.tsx](components/meals/MealPlanTab.tsx), [ShoppingListTab.tsx](components/meals/ShoppingListTab.tsx)
- AI Services: `analyzePantryImage()`, `suggestMeal()`, `parseGroceryReceipt()` in [geminiService.ts](services/geminiService.ts)
- Data stored in Firestore subcollections: `pantry`, `meals`, `mealPlan`, `shoppingList`

## Important Notes

- **Persistence**: All data is stored in **Firebase Firestore** with real-time sync across devices
- **Multi-household support**: Users can create or join households using 6-character invite codes
- **Authentication**: Google Sign-In required via Firebase Auth
- **Toast notifications**: Provided by `react-hot-toast` for user feedback
- **Mobile-optimized**: Designed for mobile-first with bottom navigation and touch-friendly UI
- **AI-powered features**:
  - Receipt/statement scanning for quick transaction entry
  - Pantry image analysis for instant inventory updates
  - AI meal suggestions based on available ingredients, budget, and time
  - Dashboard insights (currently randomized, expandable for future AI integration)

## Test Mode for AI Coding Agents

LifeBalance includes a **secure test mode** specifically designed for AI coding agents to explore and test the application without requiring Firebase authentication or a real backend.

### Activating Test Mode

**Requirements:**
1. Must be running in development mode (`npm run dev`)
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
- **Pantry**: 2 sample items (Milk, Eggs)
- **Stores**: 2 stores (Safeway, Costco)
- **Members**: 1 test user with points

**Full CRUD Operations:**
All context methods are fully implemented with **in-memory persistence**:
- ✅ Add/Update/Delete accounts, buckets, transactions
- ✅ Add/Update/Delete habits, calendar items
- ✅ Add/Update/Delete pantry items, meals, shopping items
- ✅ Add/Update/Delete todos, stores
- ✅ Toggle habits, update balances
- ✅ All operations show toast notifications

### Example Usage

```bash
# 1. Add to .env.local
echo "VITE_ENABLE_TEST_MODE=true" >> .env.local

# 2. Start dev server
npm run dev

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
npm run build

# Check bundle - mock code should NOT be present
grep -r "MockAuthProvider" dist/   # Should return nothing
grep -r "TEST MODE" dist/           # Should return nothing
```
