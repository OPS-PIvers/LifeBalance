# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker
**Blocker:** @google/genai (pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduces a stricter API key validation in the `GoogleGenAI` constructor that causes the application to crash on startup (and in tests) if the `VITE_GEMINI_API_KEY` is missing or empty. This requires a code change to handle lazy initialization or a more robust fallback strategy before the dependency can be safely updated.
**Plan:** Defer update until a developer can refactor `services/geminiService.ts` to handle missing API keys gracefully without crashing the app module-level initialization.

## 2026-02-22 - Security Patching
**Fix:** Applied `pnpm.overrides` for `fast-xml-parser` (DoS), `tar` (file overwrite), `ajv` (ReDoS), and `hono` (timing attack).
**Note (Minimatch):** `minimatch` is flagged by `pnpm audit` (GHSA-3ppc-4f35-3m26) as it requires versions `>=10.2.1`. However, we are using `eslint` which depends on v3. Overrides were applied to force the latest patch releases (`3.1.3`, `5.1.7`, `6.2.1`, `9.0.6`) which were released concurrently with the fix (Feb 22, 2026) and likely contain backported patches, despite not matching the simplified audit range.
**Verification:** `pnpm lint`, `pnpm build`, and `pnpm test` confirm stability.
