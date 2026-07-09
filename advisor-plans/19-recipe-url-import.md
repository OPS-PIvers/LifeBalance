# Plan 19: Recipe import from URL

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. When done, update this plan's status row in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- services/geminiService.ts components/meals/RecipeImportModal.tsx functions/src/index.ts`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2 (Phase 5)
- **Effort**: M
- **Risk**: MED — introduces a server-side URL fetch (SSRF surface); mitigations specified below are mandatory
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

Families cook from links (NYT Cooking, AllRecipes, blogs), but the AI Recipe Parser is paste-text-only: `RecipeImportModal` says "Paste the full text of a recipe" and `parseRecipe` takes raw text. URL import is the marquee reason people pay for Paprika/Plan-to-Eat. The hard half (structured parse with a response schema + validator) is already built and tested — only a server-side page fetch is missing (server-side because of CORS and because the Gemini model cannot browse).

## Current state (verified 2026-07-09)

- `services/geminiService.ts:1904-1960` — `parseRecipe(householdId, text, _aiClient?)`: sanitizes + truncates to 10,000 chars, prompts for `{name, description, ingredients[{name,quantity}], instructions[], tags[], recipeUrl}` with a `responseSchema` and a `validateRecipe` validator, via `generateJsonContent` (which runs the quota check + proxy transport). **Reuse it unchanged** — the URL path just produces better input text for it.
- `components/meals/RecipeImportModal.tsx` (90 lines) — Drawer with a `textarea`, `handleParse` dynamic-imports `parseRecipe` (`:32-33`). Styling uses the repo's field classes (see the textarea at `:69`); note repo convention `outline-hidden` (Tailwind v4) — never "fix" it to `outline-none`.
- Functions conventions: callable exemplar is `functions/src/geminiProxy.ts` (onCall, auth check, typed request/response, `HttpsError` codes); exports live in `functions/src/index.ts`; tests colocated (`functions/src/quickAdd/*.test.ts` style). **No secrets are needed for this function** (plain fetch), so deploying it cannot break CI (no `defineSecret` binding).
- `recipeUrl` convention (repo memory, `ai-prompt-quality-conventions`): recipe URLs are set in CODE, not trusted from the model — when importing from a URL, overwrite `result.recipeUrl` with the actual fetched URL client-side.
- Client callable pattern: grep `httpsCallable` in `services/` or `components/` for the existing invocation style (e.g., PaywallModal or notification test) and the lazy `getFunctionsInstance` helper — match it so the functions SDK stays lazy.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint all | `pnpm lint:all` | exit 0 |
| Tests | `pnpm test` | pass |
| Functions tests | per `functions/package.json` script | pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**: new `functions/src/fetchRecipePage.ts` (+ test), `functions/src/index.ts` (one export line), `components/meals/RecipeImportModal.tsx` (+ test if one exists), `advisor-plans/README.md`.

**Out of scope**:
- `services/geminiService.ts` — `parseRecipe` is reused, NOT modified.
- Any headless-browser/readability dependency — v1 is JSON-LD extraction + a dumb HTML-to-text fallback, stdlib only.
- Meal-save flow (`onConfirm`) — unchanged.

## Git workflow

- Branch: `advisor/19-recipe-url-import`
- e.g. `feat(meals): import a recipe from a URL`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: `fetchrecipepage` callable with SSRF guards

`functions/src/fetchRecipePage.ts`, exported as `fetchrecipepage` from `index.ts`. onCall, `cors: true`, `timeoutSeconds: 30`. Logic:

1. Require `request.auth` (unauthenticated → `unauthenticated`).
2. Validate `request.data.url`: string, parses via `new URL()`, protocol `http:`/`https:` only; **reject** hostnames that are IP literals (v4 or v6), `localhost`, `*.local`, `*.internal`, or end in `.localhost` → `invalid-argument`. (These checks are mandatory — the function is a server-side fetch proxy; without them it can be pointed at internal metadata endpoints.)
3. `fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'LifeBalanceRecipeBot/1.0' } })` with an AbortController timeout (~10s). Reject non-2xx (`not-found`) and non-`text/html`/`text/plain`/`application/ld+json` content types (`failed-precondition`). Cap the body read at ~1.5 MB.
4. Extract, in order of preference: (a) every `<script type="application/ld+json">` block; parse; find the object (possibly nested in `@graph` or an array) whose `@type` is or includes `"Recipe"`; if found, return a compact text rendition: name, description, `recipeIngredient` lines, `recipeInstructions` (flatten `HowToStep.text`). (b) Fallback: strip `<script>`/`<style>` blocks and all tags, collapse whitespace. Truncate the result to 10,000 chars (matches `parseRecipe`'s cap).
5. Return `{ text: string, usedJsonLd: boolean }`.

Unit-test the extraction as a pure exported helper (`extractRecipeText(html): {text, usedJsonLd}`) with: a JSON-LD Recipe sample, an `@graph`-nested sample, a no-JSON-LD HTML fallback, and a malformed-JSON-LD fallback. Test the URL validator: rejects `file:`, IP literal, localhost; accepts a normal https URL.

**Verify**: `pnpm lint:all` → exit 0; functions tests → pass.

### Step 2: URL field in `RecipeImportModal`

Add a URL `Input` (reuse `components/ui/Input` / the repo's `fieldStyles`) above the textarea with a "Fetch from link" secondary button: calls `fetchrecipepage` (lazy functions instance, matching the existing `httpsCallable` call style found in Step-0 grep), puts the returned text into the existing `text` state (user can eyeball/edit), toasts on failure. `handleParse` then works unchanged. After a successful parse that originated from a URL, set `result.recipeUrl = fetchedUrl` before `onConfirm` (code-owned URL, per repo convention).

**Verify**: `pnpm lint && pnpm test` → exit 0.

### Step 3: Manual verification

Dev + Test Mode is insufficient here (callable needs deployed function or emulator). Verify what you can: unit tests green, modal renders the new field, the fetch button disabled-states correctly. Record in the PR description that the first end-to-end URL fetch needs post-deploy verification with a real recipe URL (suggest one: any AllRecipes page — they ship JSON-LD).

**Verify**: `pnpm lint:all && pnpm test && pnpm run build` → all exit 0.

## Done criteria

- [ ] `fetchrecipepage` exported; extraction helper unit-tested (≥5 cases incl. SSRF rejections)
- [ ] Modal has URL input + fetch button; `recipeUrl` overwritten in code on URL imports
- [ ] All gates green; `advisor-plans/README.md` row updated with the post-deploy verification note

## STOP conditions

- The functions runtime lacks global `fetch` (Node <18) — check `functions/package.json` engines; report rather than adding a fetch polyfill dependency without approval.
- `parseRecipe`'s quota/proxy path rejects being called right after a callable (unexpected interaction) — report.
- Any need to modify `parseRecipe` itself — that's out of scope by design.

## Maintenance notes

- The SSRF validator is the security-sensitive piece — reviewer should try to think of a bypass (redirect to internal host is partially mitigated by content-type + no-credentials, but a follow-up could re-validate the final URL after redirects; note this as a known v1 limitation in the PR).
- If sites block the bot UA, consider per-site fallbacks LATER — do not add them speculatively.
