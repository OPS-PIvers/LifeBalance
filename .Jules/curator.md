# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker
**Blocker:** @google/genai (pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduces a stricter API key validation in the `GoogleGenAI` constructor that causes the application to crash on startup (and in tests) if the `VITE_GEMINI_API_KEY` is missing or empty. This requires a code change to handle lazy initialization or a more robust fallback strategy before the dependency can be safely updated.
**Plan:** Defer update until a developer can refactor `services/geminiService.ts` to handle missing API keys gracefully without crashing the app module-level initialization.

## 2026-02-25 - Vulnerability Overrides
**Vulnerability Pattern:** Transitive dependencies (`tar`, `minimatch`, `ajv`, `hono`, `fast-xml-parser`) with ReDoS, DoS, and arbitrary code execution vulnerabilities.
**Action:** Applied `pnpm.overrides` in `package.json` to force patched versions:
- `tar`: ^7.5.8 (Critical)
- `minimatch`: Patched versions for v3, v5, v6, v9, v10 (High)
- `ajv`: ^8.18.0 and ^6.14.0 (Moderate)
- `hono`: ^4.11.10 (Low)
- `fast-xml-parser`: ^5.3.6 (Critical/High)
**Plan:** Maintain these overrides until the upstream packages (like `firebase-tools`) update their dependencies.
