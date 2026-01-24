## 2025-02-19 - Firebase Messaging in JSDOM
**Gap:** JSDOM lacks `window.navigator.serviceWorker`, causing `firebase/messaging` initialization to throw "unsupported-browser" errors that cluttered test output.
**Fix:** Mocked `firebase/messaging` globally in `vitest.setup.ts` to return no-op functions for `getMessaging` and `onMessage`.
