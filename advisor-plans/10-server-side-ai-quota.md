# Plan 10: Enforce the AI daily quota server-side in `geminiproxy`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- functions/src/geminiProxy.ts services/geminiService.ts utils/entitlements.ts`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the money-adjacent AI spend path; must not double-count or lock out legitimate users)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The deployed `geminiproxy` Cloud Function holds the server-side `GEMINI_API_KEY` and performs Gemini calls for any **authenticated** caller — it checks `request.auth` and nothing else. The entire daily AI quota (kill-switch, per-household cap, plan-aware limits) lives in **client** code, which any user can bypass by invoking the callable directly from DevTools. Today, with a private allowlist, exposure is limited to trusted alpha users; the moment signup opens (and especially once billing makes the AI cap a *paid* limit — free 3/day vs premium 500/day), the paywall is cosmetic and server-side Gemini spend is uncapped. `utils/entitlements.ts` itself documents that paid features "must ALWAYS be gated on the server" — this plan makes that true for the one metered feature.

## Current state

Files and roles:

- `functions/src/geminiProxy.ts` — the deployed callable proxy. Auth check only (lines 71–95): rejects unauthenticated callers, validates `model`/`contents`, forwards to `ai.models.generateContent`. **No household, membership, quota, or plan check.**
- `services/geminiService.ts` — client. `checkAndIncrementAiUsage(householdId)` (lines 194–254) runs the whole quota flow client-side: kill-switch read (`app_config/global.aiEnabled`, fail-open, 60s cache), `getBillingEnabled()` (fail-closed), then a Firestore `runTransaction` on `households/{id}` that resets/increments `aiUsage: { dailyCount, lastResetDate }` against a cap.
- `utils/entitlements.ts` — client-side plan limits. `getLimits(household).aiDailyCap` (free 3, premium 500); `getPlan()` returns `'premium'` when `household.subscription.status` is `active|trialing|past_due`.
- `functions/src/quickAdd/` — exemplar for functions-side patterns: rate limiting, per-endpoint tests (`*.test.ts` next to source), and the "server accepts a caller-local `today` (yyyy-MM-dd)" convention (Cloud Functions run in UTC; the client's local date is forwarded so day boundaries match the user).
- `functions/src/utils/` (check exact path) — the server-side `formatCurrency()` twin shows the repo's convention for porting small client utils into the functions package rather than cross-importing (the two packages do not import from each other).

Client cap selection excerpt (`services/geminiService.ts:228–238`):

```ts
    // Plan-aware cap once billing is live; the legacy flat cap for everyone until then
    // (an absent subscription resolves to the free tier inside getLimits).
    const cap = billingEnabled ? getLimits(data).aiDailyCap : LEGACY_AI_DAILY_QUOTA;

    const usage = data.aiUsage ?? { dailyCount: 0, lastResetDate: today };

    // If the date rolled over, treat the count as 0 for the new day.
    const currentCount = usage.lastResetDate === today ? usage.dailyCount : 0;

    if (currentCount >= cap) {
      throw new Error(`Daily AI quota exceeded (${cap} requests/day). Try again tomorrow.`);
    }
```

`LEGACY_AI_DAILY_QUOTA = 100` (`services/geminiService.ts:101`). The proxy transport is chosen statically by `VITE_USE_GEMINI_PROXY` (`USE_GEMINI_PROXY` constant in `geminiService.ts`); production always uses the proxy.

Key design decision (already made — implement it, don't re-litigate): **the server owns the counter when the proxy is used.** When `USE_GEMINI_PROXY` is true, the client SKIPS its own increment (it may keep a read-only pre-check for fast-fail UX, but must not write `aiUsage`); the proxy performs the authoritative check-and-increment. Otherwise every call would be double-counted. The direct-SDK dev path (flag off) keeps the existing client-side transaction unchanged.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Lint root | `pnpm lint` | exit 0 (tsc + eslint) |
| Lint all | `pnpm lint:all` | exit 0 (root + functions) |
| Root tests | `pnpm test` | all pass |
| Functions tests | `pnpm --filter functions test` (verify the exact script in `functions/package.json` first) | all pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `functions/src/geminiProxy.ts`
- `functions/src/geminiProxy.test.ts` (create if absent; extend if present)
- A new small server-side entitlements helper in `functions/src/` (e.g. `functions/src/entitlements.ts`) + its test
- `services/geminiService.ts` (client: skip increment on proxy path; send `householdId` + local `today` in the callable payload)
- `services/geminiService.test.ts` or the existing geminiService test file (extend)
- `advisor-plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `firestore.rules` — server writes via the Admin SDK bypass rules; no rules change is needed or wanted (rules changes are high-blast-radius in this repo and ship separately with a human watching).
- `utils/entitlements.ts` — the client copy stays as-is (UI still uses it).
- `functions/src/stripe/**` — deliberately unexported; unrelated.
- Any change to the proxy's transport shape beyond adding fields to the request payload (the `{ text }` response contract must not change).

## Git workflow

- Branch: `advisor/10-server-side-ai-quota`
- Conventional commits, e.g. `feat(functions): enforce AI daily quota server-side in geminiproxy`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Port a minimal entitlements helper into `functions/src/`

Create `functions/src/entitlements.ts` with just what the proxy needs: `getAiDailyCap(householdData, billingEnabled): number` replicating the client logic — when `billingEnabled` is false return the legacy flat 100; when true, return 500 if `subscription.status` is `active|trialing|past_due`, else 3. Copy the exact numbers and status list from `utils/entitlements.ts` (open it and mirror; do not import across packages). Add a unit test next to it following the style of `functions/src/quickAdd/*.test.ts`.

**Verify**: `pnpm --filter functions test` → all pass including the new entitlements tests.

### Step 2: Add membership + quota enforcement to `geminiproxy`

In `functions/src/geminiProxy.ts`, after the existing auth/arg validation:

1. Accept two new payload fields: `householdId` (required, non-empty string → `invalid-argument` otherwise) and `today` (optional `yyyy-MM-dd` string; validate with a regex and **clamp**: if absent, malformed, or more than 1 calendar day away from the server's UTC date, use the server's UTC date instead — this mirrors the quickAdd `req.body.today` convention while preventing date-gaming).
2. Load `households/{householdId}` via the Admin SDK. If missing → `not-found`. If `request.auth.uid` is not in the household's `memberUids` array → `permission-denied`.
3. Read `app_config/global`: if `aiEnabled === false` → `failed-precondition` ("AI features are temporarily disabled"). Missing doc/field → proceed (fail-open, matching the client). Read `billingEnabled` from the same doc (missing → false, fail-closed).
4. Run the check-and-increment inside an Admin-SDK Firestore transaction on the household doc, replicating the client logic exactly (reset on date rollover, compare against `getAiDailyCap(...)`, write the full `aiUsage` object). Over cap → `resource-exhausted` with a message containing "Daily AI quota exceeded" (the client already retries `resource-exhausted` for *transient* 429s — see Step 3 for how it must distinguish these).
5. Only then call `generateContent` (unchanged).

**Verify**: `pnpm lint:all` → exit 0; `pnpm --filter functions test` → all pass.

### Step 3: Make the client proxy path stop incrementing, and not retry quota errors

In `services/geminiService.ts`:

1. Where the proxy transport builds its payload, add `householdId` and `today: getLocalDateString()`.
2. When `USE_GEMINI_PROXY` is true, do NOT run the client `runTransaction` increment. Keep the kill-switch fast-fail if trivially separable; otherwise skip `checkAndIncrementAiUsage` entirely on the proxy path (the server now throws the same user-facing messages).
3. **Critical**: the shared retry helper treats `resource-exhausted` as transient (Gemini 429). A quota rejection must NOT be retried. Distinguish by message: if the callable error message contains "Daily AI quota exceeded", surface it immediately without retry. Find the retry helper in this file and add that carve-out with a test.

**Verify**: `pnpm test` → all pass, including new tests for (a) proxy path sends `householdId`/`today`, (b) proxy path performs no client-side `aiUsage` write, (c) quota-exceeded callable error is not retried; direct-SDK path tests unchanged and green.

### Step 4: Full gates

**Verify**: `pnpm lint:all && pnpm test && pnpm --filter functions test && pnpm run build` → all exit 0.

## Test plan

- `functions/src/entitlements.test.ts`: cap = 100 when billing off regardless of subscription; 3 free / 500 premium when billing on; `past_due` counts as premium.
- `functions/src/geminiProxy.test.ts` (mock Admin SDK like the existing functions tests do): unauthenticated → `unauthenticated`; missing/invalid `householdId` → `invalid-argument`; non-member → `permission-denied`; kill-switch off → `failed-precondition`; at-cap → `resource-exhausted` + no `generateContent` call; under-cap → increment written + call forwarded; date rollover resets count; malformed/far `today` falls back to server date.
- Client tests as in Step 3.

## Done criteria

- [ ] `pnpm lint:all` exits 0
- [ ] `pnpm test` and the functions test suite exit 0 with the new tests present
- [ ] `pnpm run build` exits 0
- [ ] `functions/src/geminiProxy.ts` contains a membership check and a transaction on `aiUsage` before `generateContent`
- [ ] On the proxy path, `grep -n "runTransaction" services/geminiService.ts` shows the client transaction is not reachable when `USE_GEMINI_PROXY` is true (or `checkAndIncrementAiUsage` is only called on the direct path)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The proxy request payload already carries `householdId` or any quota logic (drift — someone got here first).
- The functions package has no workable way to run its tests locally (report the exact failure; do not ship untested).
- You find the client retry helper cannot distinguish quota errors from transient 429s without changing the proxy's error *shape* for other callers — report the options instead of changing the response contract.
- Implementing the membership check reveals `memberUids` is absent on some household docs (would lock out real users) — report immediately.

## Maintenance notes

- Once billing goes live, the free-tier cap on the server comes from `functions/src/entitlements.ts` — keep it in sync with `utils/entitlements.ts` (add a comment in both pointing at each other).
- Deploy note for the human: this changes a deployed function; a normal CI deploy suffices (no new secrets). After deploy, verify one AI insight still generates in prod and that `households/{id}.aiUsage` increments exactly once per call.
- Reviewer scrutiny: the no-double-count property (client must not increment on the proxy path) and the no-retry-on-quota carve-out.
