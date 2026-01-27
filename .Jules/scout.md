## 2025-02-19 - Firebase Messaging in JSDOM
**Gap:** JSDOM lacks `window.navigator.serviceWorker`, causing `firebase/messaging` initialization to throw "unsupported-browser" errors that cluttered test output.
**Fix:** Mocked `firebase/messaging` globally in `vitest.setup.ts` to return no-op functions for `getMessaging` and `onMessage`.

## 2025-02-20 - User Event Timeouts with Fake Timers
**Gap:** Interaction tests using `userEvent` were timing out when `vi.useFakeTimers()` was active because `userEvent` relies on real timers for event batching.
**Fix:** Switched to using dynamic dates (calculating "Monday" relative to `new Date()`) instead of mocking system time with `vi.setSystemTime()`, allowing tests to run with real timers.
