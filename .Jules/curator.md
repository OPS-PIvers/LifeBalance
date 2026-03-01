# Curator's Journal

## 2026-01-19 - Recharts Pin (resolved)
**Blocker:** recharts (previously)
**Reason:** Library was previously strictly pinned to the v2.x range to maintain compatibility with React 19. As of this PR, recharts has been upgraded to v3.6.0 and compatibility has been verified (tests passing).
**Plan:** Continue to monitor Recharts v3.x releases for ongoing React 19 support and stability, updating as needed.

## 2026-02-18 - Google GenAI Update Blocker
**Blocker:** @google/genai (pinned to v1.37.0)
**Reason:** Updating to v1.38.0 introduces a stricter API key validation in the `GoogleGenAI` constructor that causes the application to crash on startup (and in tests) if the `VITE_GEMINI_API_KEY` is missing or empty. This requires a code change to handle lazy initialization or a more robust fallback strategy before the dependency can be safely updated.
**Plan:** Defer update until a developer can refactor `services/geminiService.ts` to handle missing API keys gracefully without crashing the app module-level initialization.

## 2026-04-18 - Multiple Sub-Dependency Vulnerabilities
**Blocker:** Multiple outdated transitive dependencies (`minimatch`, `fast-xml-parser`, `ajv`, `hono`, `basic-ftp`, `tar`, `rollup`)
**Reason:** `pnpm audit` flagged various high/moderate severity vulnerabilities in these dependencies, but they are brought in transitively so we cannot upgrade them safely without breaking lockfile resolutions.
**Plan:** Implemented `pnpm.overrides` in `package.json` for all flagged versions (`minimatch` across v3/v5/v6/v9/v10, `ajv` across v6/v8, `fast-xml-parser`, `hono`, `basic-ftp`, `tar`, `rollup`). Verifying that the app is fully compatible by running tests and ensuring security patches are applied effectively while avoiding major version bumps to direct dependencies.
