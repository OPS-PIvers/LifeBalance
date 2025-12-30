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

# Gemini API (for receipt scanning)
VITE_GEMINI_API_KEY=your_gemini_api_key
```

**Required for:**
- Firebase Authentication (Google Sign-In)
- Firestore database persistence
- Receipt scanning feature (Gemini API)

**Note:** `.env.local` is git-ignored to protect your credentials.

## Architecture

### State Management

The entire application state is managed through a single **React Context**: `HouseholdContext` ([contexts/HouseholdContext.tsx](contexts/HouseholdContext.tsx)).

This context provides:
- **Finance**: Accounts, budget buckets, transactions, calendar items
- **Gamification**: Habits, points (daily/weekly/total), challenges, rewards
- **Safe-to-Spend Calculation**: Real-time financial health metric

All state is currently in-memory (no persistence). State resets on page refresh.

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
- Weather-sensitive habits: +1.0x on nice days

Habits auto-reset based on their `period` (daily/weekly). Logic in [contexts/HouseholdContext.tsx:519-633](contexts/HouseholdContext.tsx#L519-L633).

### Routing

Uses **HashRouter** (not BrowserRouter) to support deployment without server-side routing configuration. Routes defined in [App.tsx:21-26](App.tsx#L21-L26).

### External Services

**Gemini API** ([services/geminiService.ts](services/geminiService.ts)):
- Model: `gemini-3-flash-preview`
- Function: `analyzeReceipt()` - OCR for receipt scanning
- Returns structured JSON: merchant, amount, category, date

### Styling

**Tailwind CSS** via CDN (configured in [index.html](index.html)):
- Custom theme colors: `brand-*`, `money-*`, `habit-*`
- Custom fonts: Inter (sans), JetBrains Mono (mono)
- Mobile-first with safe-area-inset support
- No separate Tailwind config file; configuration embedded in HTML `<script>` tag

### Component Organization

```
components/
  ├── budget/       # Budget-specific UI components
  ├── habits/       # Habit tracking UI components
  ├── layout/       # TopToolbar, BottomNav
  └── modals/       # Modal dialogs for forms

pages/              # Route-level page components
  ├── Dashboard.tsx # Main overview with AI insights
  ├── Budget.tsx    # Finance management
  ├── Habits.tsx    # Habit tracker
  └── PlaceholderPage.tsx

contexts/           # React Context providers
services/           # External API integrations
types/              # TypeScript type definitions
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

- **Habit**: Tracks user behaviors with points, streaks, and completion history
- **Account**: Financial accounts (checking, savings, credit)
- **BudgetBucket**: Spending categories with limits
- **Transaction**: Expense records with categorization status
- **CalendarItem**: Recurring/one-time income and expenses
- **Challenge**: Monthly goals tied to specific habits
- **RewardItem**: Redeemable rewards using accumulated points

## Important Notes

- **No persistence layer**: All data is mock/in-memory
- **Toast notifications**: Provided by `react-hot-toast` for user feedback
- **Mobile-optimized**: Designed for mobile-first with bottom navigation
- **AI-powered insights**: Dashboard shows randomized insights (placeholder for future AI integration)
