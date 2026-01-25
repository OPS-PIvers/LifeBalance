# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker (resolved)
**Blocker:** @google/genai (previously pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduced strict API key validation. Refactored `services/geminiService.ts` to lazily initialize the client, preventing crashes when the API key is missing.
**Plan:** Updated to ^1.38.0.
