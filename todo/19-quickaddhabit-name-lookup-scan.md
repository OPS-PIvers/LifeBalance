# 19 — `quickAddHabit` full-collection scan on `habitName` lookup

## Problem
In `functions/src/quickAdd/index.ts`, when a caller (the iOS Shortcut) provides `habitName`
instead of `habitId`, the function fetches the entire `households/{id}/habits` collection and
fuzzy-matches in process. For households with many habits this is an unbounded read on the
request hot path (after rate-limiting), paid on every name-based invocation.

## Current state
- `functions/src/quickAdd/index.ts` — the `habitName` branch does
  `db.collection('households/{id}/habits').get()` then in-memory matching.
- Habit titles are user-controlled free strings (no normalized field today).

## Proposed approach
1. Add a denormalized `titleLower` field to habit docs (written wherever a habit's `title`
   is created/edited — client `addHabit`/`updateHabit` and any server writer).
2. Back-fill `titleLower` for existing habits with a one-off migration (mirror the existing
   `utils/migrations/*` pattern; or a tiny admin script).
3. In `quickAddHabit`, query `where('titleLower', '==', habitName.trim().toLowerCase())`
   `limit(1)` for the common exact-match case; fall back to the full scan only when the
   exact query misses (preserving today's fuzzy behavior).
4. Add the single-field index if Firestore requires it (single-field equality is usually
   auto-indexed; confirm).

Ship the field + back-fill **before** the query change so no lookup misses during rollout.

## Risks
- Forgetting a habit-title writer would leave `titleLower` stale → exact-match misses (the
  fuzzy fallback keeps it correct but slow; acceptable transitional state).
- Back-fill must run against production before the query path is relied upon.

## Acceptance criteria
- Name-based `quickAddHabit` resolves common cases with a single indexed read; fuzzy
  fallback still works for near-matches.
- New/edited habits always carry an up-to-date `titleLower`.
- `pnpm lint:all` + `pnpm test` green; functions build clean.
