# Curator Journal

## 2025-02-27 - Recharts Version Lock (RESOLVED)
**Blocker:** recharts
**Reason:** Recharts must be strictly kept within the v2.x range (avoiding v3) to ensure React 19 compatibility.
**Plan:** Monitor Recharts v3 releases for React 19 support and migration guides. Stay on v2.15.0+ but <3.0.0.
**Update:** v3.7.0 verified working with React 19 on 2025-02-27. Lock removed.

## 2025-02-27 - Tailwind Merge v3 Scope Limitation
**Blocker:** tailwind-merge
**Reason:** Updating to v3 requires updating the importmap in `index.html` (CDN link), which is outside Curator's file modification scope.
**Plan:** Request valid scope expansion or coordinate update with another agent.
**Update:** `package.json` is already on v3.4.0 and build passes. Importmap discrepancy noted but not blocking `package.json` management.

## 2025-02-27 - Google GenAI Test Configuration
**Blocker:** @google/genai (v1.38.0)
**Reason:** Updating to v1.38.0 enforces API key validation in the constructor, causing unit tests to fail unless `vitest.setup.ts` is modified to mock the key. Modification of `vitest.setup.ts` is outside Curator scope.
**Plan:** Reverted to v1.37.0. Request 'Sentinel' or 'Catalyst' to update test configuration to globally mock `VITE_GEMINI_API_KEY`.
