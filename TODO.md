# TODO List

This document lists all known missing features, incomplete functionalities, and technical debt in priority order.

## 1. Immediate Priority (Critical for Core Usage)

- [ ] **Fix `AnalyticsModal.tsx`**: Currently uses hardcoded mock data. Connect it to real `habits` and `transactions` data from `FirebaseHouseholdContext`.
- [ ] **Implement `Meals` Page**: The `/meals` route currently renders `PlaceholderPage.tsx`. Needs a functional implementation (meal planning, grocery list, etc.) or removal from navigation if not part of MVP.
- [ ] **Add "All Transactions" View**: Create a dedicated page or modal to view the master list of all transactions (historical and current). Currently, transactions are only visible within buckets or in the "Review" queue.
- [ ] **Setup Testing Framework**: No test files or framework (Vitest/Playwright) exist. Setup basic testing infrastructure and write critical path tests (e.g., `safeToSpend` calculation).

## 2. High Priority (Important for UX/Retention)

- [ ] **Offline Support (PWA)**:
    - Install and configure `vite-plugin-pwa`.
    - Set up a service worker for offline caching.
    - Ensure Firebase offline persistence is verified.
- [ ] **Budget History View**: Users cannot view past pay periods' performance. Implement a UI to visualize data from the `bucketHistory` collection.
- [ ] **New User Onboarding**: Create a guided tour or wizard for new households to explain concepts like "Safe-to-Spend", "Buckets", and "Habits".
- [ ] **Transaction Creation**: There is no "Add Transaction" button in the `Budget` view (only in the Dashboard FAB). Add a clear way to manually add transactions from the Budget page.

## 3. Medium Priority (Enhancements)

- [ ] **Recurring Transaction Manager**: While `BudgetCalendar` handles recurring items, there is no central "Subscriptions" or "Recurring Bills" list to manage them easily outside the calendar view.
- [ ] **Data Export/Import**: Allow users to export their data (JSON/CSV) for backup or analysis.
- [ ] **Accessibility Audit**: Review all modals and interactive elements for ARIA labels, keyboard navigation, and focus management.
- [ ] **Gemini Integration in UI**: `refreshInsight` in context currently uses random strings. Connect it to `geminiService` to generate real insights based on transaction/habit data.
- [ ] **Theme Polish**: Remove hardcoded colors in some components and strictly use Tailwind variables defined in `index.html`.

## 4. Cleanup & Technical Debt

- [ ] **Remove Legacy Files**: Delete `components/modals/ChallengeFormModal.legacy.tsx` if it is truly unused.
- [ ] **Decide on Weather Feature**: `WEATHER_IMPLEMENTATION.md` exists, but the feature is not implemented. Either implement it (High effort) or remove the `weatherSensitive` field from the schema and the doc (Cleanup).
- [ ] **Optimize Context**: `FirebaseHouseholdContext` is very large. Consider splitting it into smaller contexts (e.g., `FinancialContext`, `HabitContext`) to prevent unnecessary re-renders.

## 5. Future Ideas

- [ ] **Social Features**: Leaderboards between households?
- [ ] **Advanced Analytics**: Year-over-year spending comparison.
- [ ] **Integration**: Plaid integration for automatic bank syncing (replacing manual/OCR entry).
