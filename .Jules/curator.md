# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker
**Blocker:** @google/genai (pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduces a stricter API key validation in the `GoogleGenAI` constructor that causes the application to crash on startup (and in tests) if the `VITE_GEMINI_API_KEY` is missing or empty. This requires a code change to handle lazy initialization or a more robust fallback strategy before the dependency can be safely updated.
**Plan:** Defer update until a developer can refactor `services/geminiService.ts` to handle missing API keys gracefully without crashing the app module-level initialization.

## 2026-02-22 - BudgetCalendar Test Blocker
**Blocker:** `components/budget/BudgetCalendar.test.tsx`
**Reason:** The test `navigates between months` fails due to date rollover issues when the current date is near the end of the month (e.g., Jan 29th). This pre-existing failure prevents verification of any dependency updates. The Curator agent is restricted from modifying source/test code to fix this.
**Plan:** Developer must fix the flaky test (e.g., using `vi.setSystemTime` or `date-fns` logic) before Curator can safely update and verify dependencies.
