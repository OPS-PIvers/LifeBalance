# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker
**Blocker:** @google/genai (pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduces a stricter API key validation in the `GoogleGenAI` constructor that causes the application to crash on startup (and in tests) if the `VITE_GEMINI_API_KEY` is missing or empty. This requires a code change to handle lazy initialization or a more robust fallback strategy before the dependency can be safely updated.
**Plan:** Defer update until a developer can refactor `services/geminiService.ts` to handle missing API keys gracefully without crashing the app module-level initialization.

## 2026-02-21 - Tar Vulnerability (via firebase-tools)
**Blocker:** `tar` (transitive dependency)
**Reason:** `firebase-tools@15.7.0` (latest) depends on `superstatic` -> `re2` -> `node-gyp` -> `tar@7.5.7`. We cannot force `tar` update without potentially breaking the native build toolchain or waiting for upstream updates.
**Plan:** Monitor `firebase-tools` releases for updates that bump `superstatic` or `node-gyp` dependencies.
