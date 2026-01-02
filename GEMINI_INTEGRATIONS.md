# Gemini AI Integration Opportunities

This document outlines high-reward opportunities to integrate Google Gemini's advanced reasoning and analysis capabilities into the LifeBalance application. These integrations aim to transform the app from a passive tracker into an active financial and lifestyle coach.

## 1. Smart Budget Insights & Anomaly Detection

**File Paths:**
- `services/geminiService.ts`
- `pages/Budget.tsx`
- `components/budget/BudgetBuckets.tsx`

**Description:**
Instead of just showing progress bars, use Gemini to analyze spending trends, detect anomalies (e.g., "Grocery spending is 30% higher than usual this week"), and suggest proactive bucket adjustments.

**Implementation Guide:**
1.  **Update `services/geminiService.ts`:**
    - Create a function `analyzeBudgetTrends(transactions: Transaction[], buckets: BudgetBucket[])`.
    - Prompt Gemini to look for recurring payments that have increased, categories that are trending to overspend, and opportunities to save.
    - Return a structured JSON with `insights` (array of strings) and `suggestedAdjustments` (array of objects with `bucketId` and `suggestedLimit`).

2.  **Update `pages/Budget.tsx`:**
    - Add a "Smart Analysis" button in the sub-navigation or header.
    - Create a state to hold the analysis result.

3.  **Create `components/budget/BudgetInsights.tsx`:**
    - Display the insights in a dismissible card at the top of the budget view.
    - Allow users to "Apply" suggested bucket limit adjustments with one click (using `updateBucketLimit` from context).

## 2. Intelligent Daily Briefing

**File Paths:**
- `services/geminiService.ts`
- `pages/Dashboard.tsx`

**Description:**
Replace the current simple "AI Insight" on the Dashboard with a comprehensive "Daily Briefing" that synthesizes financial health, upcoming bills, and habit goals into a cohesive narrative.

**Implementation Guide:**
1.  **Update `services/geminiService.ts`:**
    - Create `generateDailyBriefing(context: DashboardContextData)`.
    - Pass `safeToSpend`, `dueCalendarItems`, `todaysHabits`, and `activeChallenge` status.
    - Prompt Gemini to act as a supportive but firm coach. Example output: "Good morning! You have $150 safe to spend. Note that your Electric Bill ($45) is due tomorrow. You're on a 3-day streak with 'Morning Run'—keep it up!"

2.  **Update `pages/Dashboard.tsx`:**
    - Call this service on mount (cache the result in localStorage for 24h to save tokens).
    - Replace the existing `Widget C: Gemini Insight` with a richer `DailyBriefingWidget` that supports markdown formatting for bold text and lists.

## 3. Habit Coach & Pattern Recognition

**File Paths:**
- `services/geminiService.ts`
- `pages/Habits.tsx`
- `components/modals/HabitCreatorWizard.tsx` (New Component)

**Description:**
Identify hidden patterns in habit completion and offer personalized advice. For example, realizing a user always misses their gym habit on days they have high "Dining Out" spending.

**Implementation Guide:**
1.  **Update `services/geminiService.ts`:**
    - Create `analyzeHabitPatterns(habits: Habit[], transactions: Transaction[])`.
    - Send the last 30 days of habit completion history and transaction history.
    - Ask Gemini to find correlations (positive or negative) and suggest optimizations.

2.  **Update `pages/Habits.tsx`:**
    - Add a "Coach" tab or button.
    - Display findings like "You tend to miss 'Read' on Fridays. Try moving this habit to the morning?"

3.  **Enhance `HabitCreatorWizard.tsx`:**
    - When creating a habit, ask Gemini: "What is a realistic starting frequency for a 'Marathon Training' habit for a beginner?" to pre-fill the form defaults.

## 4. "Safe-to-Spend" Explainer

**File Paths:**
- `services/geminiService.ts`
- `components/modals/SafeToSpendModal.tsx`

**Description:**
The "Safe-to-Spend" number can be confusing. Use Gemini to generate a natural language explanation of *why* the number is what it is, building trust in the algorithm.

**Implementation Guide:**
1.  **Update `services/geminiService.ts`:**
    - Create `explainSafeToSpend(calculationData: SafeToSpendComponents)`.
    - Pass the raw components: `checkingBalance`, `unpaidBills`, `bucketRemaining`, `pendingTx`.
    - Prompt: "Explain to a 5-year-old why they only have $X to spend despite having $Y in the bank. Mention the specific bills and buckets actively reducing the amount."

2.  **Update `components/modals/SafeToSpendModal.tsx`:**
    - Add a "Why is this my number?" dropdown or section.
    - Display the generated text (e.g., "You see $1,000 in your account, but $400 is reserved for Rent and $300 is set aside for Groceries. That leaves you $300 to play with.").

## 5. Personalized Challenge Generator

**File Paths:**
- `services/geminiService.ts`
- `components/modals/ChallengeHubModal.tsx`

**Description:**
Users often don't know what to challenge themselves with. Gemini can analyze their weakest financial areas (e.g., "Shopping") or lowest habit streaks and generate a custom monthly challenge.

**Implementation Guide:**
1.  **Update `services/geminiService.ts`:**
    - Create `generateChallengeSuggestion(habits: Habit[], budgetStats: BucketStats)`.
    - Prompt Gemini to create a challenge title, description, and target (e.g., "The 'No-Takeout' Sprint: Limit Dining Out to $50 this month").

2.  **Update `components/modals/ChallengeHubModal.tsx`:**
    - Add a "Suggest a Challenge" button in the creation form.
    - When clicked, show a loading state, then auto-fill the Title, Description, Related Habits, and Target fields with Gemini's response.

## 6. Natural Language Transaction Entry

**File Paths:**
- `services/geminiService.ts`
- `components/modals/CaptureModal.tsx`

**Description:**
Allow users to type (or dictate) a transaction in plain English instead of filling out a form manually.

**Implementation Guide:**
1.  **Update `services/geminiService.ts`:**
    - Create `parseNaturalLanguageTransaction(input: string, categories: string[])`.
    - Prompt: "Extract merchant, amount, category, and date from this text: '${input}'. Map category to one of: ${categories}."

2.  **Update `components/modals/CaptureModal.tsx`:**
    - Add a text input field "Quick Add" at the top (e.g., "Lunch at Chipotle $14.50").
    - On blur or enter, call the service and auto-populate the existing form fields (Merchant, Amount, Category, Date) for user verification.
