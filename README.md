# LifeBalance

LifeBalance is a comprehensive household management application designed to gamify personal finance and habit tracking. Built as a mobile-first Progressive Web App (PWA), it combines real-time financial tracking with a robust habit-building system to help users achieve a balanced lifestyle.

## 🚀 Key Features

### 💰 Financial Management
- **"Safe-to-Spend" Metric**: A real-time calculation of your true disposable income, accounting for unpaid bills, budget limits, and pending transactions.
- **Pay Period Budgeting**: Automatically aligns your budget buckets and spending tracking with your paycheck cycle.
- **Transaction Tracking**: Real-time syncing of transactions with automatic categorization.
- **AI Receipt Scanning**: Uses Google Gemini to parse receipts and bank statements for easy data entry.
- **Recurring Expenses**: Calendar-based bill tracking with recurring logic.

### 🎮 Gamified Habits
- **Habit Tracking**: Track daily and weekly habits with customizable scoring (threshold vs. incremental).
- **Streak System**: Earn multipliers for consistency (1.5x for 3-6 days, 2.0x for 7+ days).
- **Freeze Bank**: Earn "Freeze Tokens" to patch missed days and maintain streaks.
- **Challenges & Yearly Goals**: Set long-term targets and track progress over time.
- **Rewards**: Redeem points for real-world rewards defined by the household.

### 🏠 Household Sync
- **Real-time Collaboration**: All data syncs instantly across devices using Firebase Firestore.
- **Shared Habits & Goals**: Participate in challenges together with household members.

## 🛠 Tech Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend** | React 19 + Vite | Fast, modern UI library and build tool. |
| **Language** | TypeScript | Strong typing for reliability. |
| **Styling** | Tailwind CSS | Utility-first CSS framework (PostCSS build). |
| **Backend** | Firebase | Auth, Firestore (NoSQL DB), and Hosting. |
| **AI** | Google Gemini | Receipt OCR and statement parsing (`@google/genai`). |
| **Routing** | react-router-dom | Hash-based routing for static hosting compatibility. |
| **Icons** | Lucide React | Clean, consistent icon set. |
| **Dates** | date-fns | Robust date manipulation library. |

## 🏁 Getting Started

### Prerequisites
- Node.js (v20 or higher recommended)
- pnpm

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/OPS-PIvers/LifeBalance.git
    cd LifeBalance
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

### Configuration

Create a `.env.local` file in the root directory with your Firebase and Gemini credentials.

> **Note:** The values below (e.g., `your_api_key`, `your_project_id`) are placeholders. You must replace them with your actual Firebase and Gemini API keys.

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Google Gemini API (Required for AI features)
VITE_GEMINI_API_KEY=your_gemini_api_key
```

### Running Locally

Start the development server:

```bash
pnpm dev
```

Access the app at `http://localhost:3000` (or the port shown in your terminal).

## 🏗 Architecture & Core Concepts

### State Management (`FirebaseHouseholdContext`)
The application relies on a single, powerful context (`contexts/FirebaseHouseholdContext.tsx`) that acts as the "brain". It subscribes to multiple Firestore collections (accounts, transactions, habits, etc.) and provides a unified state to the entire app. It also handles business logic actions like `addTransaction` or `toggleHabit`.

### The "Safe-to-Spend" Formula
This is the application's "God Metric", located in `utils/safeToSpendCalculator.ts`. It ensures users never overspend by calculating:
```
Safe-to-Spend = (Checking Balance)
              - (Unpaid Bills due this month)
              - (Adjusted Bucket Liabilities)

Where:
Checking Balance      = Sum of all checking account balances (excludes savings/credit)
Unpaid Bills          = Bills due this month that aren't covered by budget buckets
Bucket Liabilities    = Sum of remaining limits across all budget buckets
Pending Spend         = Sum of pending_review transactions
Adjusted Bucket Liabilities = max(0, Bucket Liabilities - Pending Spend)
```

**Note:** Bills are automatically excluded from the calculation if they match a budget bucket name to avoid double-counting liabilities.

### Routing
The app uses `HashRouter` (e.g., `/#/dashboard`) instead of `BrowserRouter`. This is a deliberate choice to ensure compatibility with simple static hosting environments (like Firebase Hosting) without requiring complex server-side rewrite rules.

## 📂 Project Structure

```text
/
├── components/           # UI Components organized by domain
│   ├── auth/             # Authentication & Protected Routes
│   ├── budget/           # Budgeting (Buckets, Accounts, Calendar)
│   ├── habits/           # Habit tracking UI
│   ├── layout/           # App shell (TopToolbar, BottomNav)
│   └── modals/           # Forms and user input dialogs
├── contexts/             # React Context Providers
│   ├── AuthContext.tsx             # User authentication state
│   └── FirebaseHouseholdContext.tsx # Main application state
├── pages/                # Top-level route components
│   ├── Dashboard.tsx     # Home view with summaries
│   ├── Budget.tsx        # Financial management view
│   ├── Habits.tsx        # Habit tracking view
│   └── ...
├── services/             # External API integrations
│   ├── geminiService.ts  # Google AI integration
│   └── ...
├── types/                # TypeScript definitions (schema.ts)
├── utils/                # Pure business logic functions
│   ├── safeToSpendCalculator.ts
│   ├── habitLogic.ts
│   └── ...
└── App.tsx               # Main entry point with Routing
```

## 📦 Building & Deployment

To build the application for production:

```bash
pnpm run build
```

To deploy to Firebase Hosting (assuming you have the Firebase CLI installed and initialized):

```bash
pnpm run deploy
```

## 🤖 AI Agent Guidelines

If you are an AI agent working on this codebase, please refer to `AGENTS.md` in the root directory for strict coding rules, architectural constraints, and modification protocols. **This file is the single source of truth for code modifications.**

## 📄 License

This project is private and proprietary.
