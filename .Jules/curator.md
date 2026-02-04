# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker
**Blocker:** @google/genai (pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduces a stricter API key validation in the `GoogleGenAI` constructor that causes the application to crash on startup (and in tests) if the `VITE_GEMINI_API_KEY` is missing or empty. This requires a code change to handle lazy initialization or a more robust fallback strategy before the dependency can be safely updated.
**Plan:** Defer update until a developer can refactor `services/geminiService.ts` to handle missing API keys gracefully without crashing the app module-level initialization.

## 2026-02-20 - Brace Expansion Security Override
**Vulnerability Pattern:** @isaacs/brace-expansion <= 5.0.0 (GHSA-7h2j-956f-4vf2)
**Reason:** Deep dependency of firebase-tools (via superstatic -> re2 -> node-gyp -> make-fetch-happen -> cacache -> glob -> minimatch). Even latest firebase-tools (15.5.1) uses this chain.
**Plan:** Forced resolution to ^5.0.1 via package.json pnpm.overrides.
