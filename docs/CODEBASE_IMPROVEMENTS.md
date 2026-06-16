# Codebase Improvement Opportunities

_A read-only audit of the LifeBalance codebase identifying high-impact areas for
improvement. Findings are grouped by theme, prioritized by impact, and cite
`file:line` references so they can be picked up as discrete work items._

**Audit date:** 2026-06-16 · **Branch:** `claude/codebase-exploration-improvements-940nvk`
**Scope:** ~262 TS/TSX files, ~81 test files, Firebase Cloud Functions, Firestore rules.

> **How to read this:** Each finding is tagged 🔴 High / 🟡 Medium / 🟢 Low by the
> risk it poses (correctness, security, performance, or maintainability) weighed
> against the effort to fix. Items marked **✅ Verified** were confirmed by reading
> the cited source directly during this audit; the rest are from focused
> exploration and should be confirmed before acting.

---

## Executive Summary

The codebase is **well-architected overall**: strict TypeScript, domain-sliced
contexts, integer-cent money math, typed Firestore converters, atomic batch
writes, lazy-loaded routes/modals, and a near-zero lint-suppression policy that is
actually upheld. Business logic in `utils/` is heavily and thoughtfully tested
(timezone boundaries, streak thresholds, IEEE-754 drift).

The highest-leverage improvements cluster in five areas:

1. **AI response robustness** — Gemini JSON is cast (`as T`) without runtime
   validation; a hallucinated/partial response can corrupt transactions, habits,
   or meals downstream.
2. **Test coverage of the infrastructure layer** — the 3,797-line state container,
   auth/household/apiKey services, and several critical hooks have **zero** tests,
   despite owning the app's most regression-prone mutations.
3. **Security hardening** — a hardcoded super-admin UID fallback and a
   client-embedded Gemini API key are both known, documented, and still live.
4. **A handful of correctness/robustness gaps** in the Firestore listener layer
   (one listener silently swallows errors; the pending-items listener blocks on a
   slow network call).
5. **Targeted performance & a11y polish** — finish the context-slice migration,
   memoize a few hot handlers, and add an `aria-live` region for toasts.

---

## 1. AI / Gemini Service Robustness

### 1.1 🔴 Unvalidated AI JSON is cast straight to typed objects — **✅ Verified**
`services/geminiService.ts:433`

```ts
const parsed = JSON.parse(text) as T;   // no schema validation
```

`responseSchema` is only a *hint* to Gemini — the model can return JSON that parses
but violates the shape (missing `amount`, wrong types, hallucinated fields). This
single helper backs **every** AI feature (`analyzeReceipt`, `parseBankStatement`,
`suggestMeal`, `parseGroceryReceipt`, `parseMagicAction`,
`parseNaturalLanguageCommand`, `reorganizeHabits`, `parseRecipe`,
`generateWeeklyPlan`, …). A bad parse propagates into Firestore writes and crashes
UI that renders the undefined fields.

**Fix:** validate after parse before casting. A small `zod` schema (or hand-written
guards) per response type, applied in `generateJsonContent<T>`, closes the gap for
all callers at once. Pair with discriminated unions for the `parseMagicAction` /
`parseNaturalLanguageCommand` responses whose valid fields depend on a `type`
discriminator (`geminiService.ts:~960`, `~1384`).

### 1.2 🟡 No validation of inbound image data
`services/geminiService.ts:~340-350` (`extractMimeType`)

Base64 images are forwarded to Gemini with no size/format/well-formedness check; a
failed MIME regex silently defaults to `image/jpeg`. Failures surface as a generic
"Failed to analyze receipt" with no way to distinguish a bad image from an API
outage. Add a `validateBase64Image()` guard and differentiate the error messages.

### 1.3 🟡 Duplicated error-handling & prompt-sanitization boilerplate
`services/geminiService.ts` — ~11 near-identical `catch` blocks and ~11 inline
`sanitizeForPrompt(...)` call sites.

Every exported function repeats the same quota-check-then-rethrow catch and the
same inline sanitization. Extracting a `withErrorHandling(fn, opName)` wrapper and a
named-sanitizer registry removes the drift risk (change the rule once, not in 11
places) and makes "is this user input sanitized?" auditable in review.

### 1.4 🟢 Best-effort quota refund can silently penalize users
`services/geminiService.ts:437-444` (refund path), quota helpers `~113-188`

On API failure the up-front quota increment is refunded in a separate transaction;
if that refund itself fails it's swallowed (`console.warn`) and the user loses a
unit. Low frequency, but logging failures to an audit collection would make it
recoverable.

---

## 2. Test Coverage Gaps

Coverage is excellent in `utils/` (~83%) and thin in the infrastructure layer.
Highest-risk untested files (all **✅ Verified** as having no adjacent test):

| File | Why it's high-risk |
|------|--------------------|
| `contexts/FirebaseHouseholdContext.tsx` (3,797 lines) | Owns every batch-write mutation (`updateTransactionCategory`, `payCalendarItem`, `useFreezeBankToken`, habit+points). Regressions here are the most common production-bug source and are caught by **no** unit test today. |
| `hooks/useMidnightScheduler.ts` | Drives habit resets, streak rollover, daily/weekly point recompute across timezones — exactly the logic CLAUDE.md stresses, untested. |
| `hooks/useActionQueue.ts` | Builds/processes the daily action queue. |
| `hooks/useGroceryOptimizer.ts` | Gemini-backed optimization + error recovery. |
| `services/authService.ts` | Google sign-in, popup-vs-redirect, PWA detection. |
| `services/householdService.ts` | Household creation/join, invite codes, membership. |
| `services/apiKeyService.ts` | API-key hashing, validation, rate-limit windows. |
| `functions/src/quickAdd/index.ts` (~1,093 lines) | iOS-Shortcut HTTP endpoint: key validation, rate limiting, batch writes — only the pure `habitProcessor` is tested. |

**Recommended order:** (1) `FirebaseHouseholdContext` batch-write atomicity with a
mocked Firestore; (2) `useMidnightScheduler` with injected `today`/timezone; (3)
auth/household/apiKey services; (4) the `quickAdd` endpoint.

**Flaky-test hygiene 🟢:** a few component tests use real `new Date()` /
`format(new Date(), …)` in fixtures (e.g. `components/budget/TransactionMasterList.test.tsx:144`,
`components/dashboard/CategorySpendWidget.test.tsx`), which can fail when a CI run
crosses midnight UTC. Standardize on `vi.useFakeTimers()` with a fixed system time.

---

## 3. Security

### 3.1 🔴 Hardcoded super-admin UID fallback still live — **✅ Verified**
`firestore.rules:28-31`

```
function isSuperAdmin() {
  return isAuthenticated() &&
         (request.auth.token.get('admin', false) == true ||
          request.auth.uid == "nmYdn3QPsNQEvniJEXW9M3lmV5e2");
}
```

A self-documented `TODO` (line 27) flags this as a temporary backdoor pending the
`admin` custom claim. **Action:** provision the `admin` claim via the Admin SDK,
then delete the UID branch and redeploy rules. Add a deploy/CI checklist item so it
isn't forgotten.

### 3.2 🟡 Gemini API key embedded in the client bundle — **✅ Verified**
`services/geminiService.ts:33-36` reads `VITE_GEMINI_API_KEY`; any `VITE_*` var is
inlined into the shipped JS and visible in DevTools.

Short term: lock the key down in Google Cloud Console (HTTP-referrer restriction +
restrict to the Generative Language API + quota caps). Long term: proxy Gemini
calls through a Cloud Function so the key never leaves the server. (CI already uses
a mock key, so CI logs are clean.)

### 3.3 🟢 Firestore rules are strong, with two minor validation gaps
`firestore.rules` (well-structured: length caps, immutable fields, RBAC,
privilege-escalation defenses per `SECURITY_MODEL.md`). Two small additions:
- Optional `CalendarItem.bucketId` is written but not length-validated (`~line 413`)
  — add `isValidOptionalString(data.get('bucketId', null), 50)`.
- `accounts.lastUpdated` is required to be a `timestamp`; consider accepting
  `timestamp | string` to match the calendar-items pattern and `serverTimestamp()`
  write timing.

---

## 4. State Management & Firestore Listeners

### 4.1 🔴 Calendar listener silently swallows errors — **✅ Verified**
`contexts/FirebaseHouseholdContext.tsx:815-817`

```ts
onSnapshot(calQuery, (snapshot) => {
  setCalendarItems(snapshot.docs.map(doc => doc.data()));
})   // ← no error callback
```

Every sibling listener (e.g. habits at `:823-827`) has an error handler; this one
doesn't. A permission/network error leaves calendar items silently stale — and
calendar items feed Safe-to-Spend. Add the standard `(error) => { console.error… }`
handler (ideally with a toast, matching accounts/buckets).

### 4.2 🟡 Pending-items listener blocks on a slow Gemini call
`contexts/FirebaseHouseholdContext.tsx:~1044-1120`

The `onSnapshot` callback `await`s `parseNaturalLanguageCommand()` inline, so the
listener is tied up for the duration of the network call. A `processingIdsRef` guard
prevents double-processing, but under voice-command volume this starves the
listener. Prefer enqueuing items and processing them from a separate effect so the
snapshot callback returns immediately.

### 4.3 🟡 Meal-plan CRUD callbacks recreated on every snapshot
`contexts/FirebaseHouseholdContext.tsx:~3422-3450`

`updateMealPlanItem` / `deleteMealPlanItem` depend on the memoized `mealPlan` array,
which changes on every meal-plan snapshot, churning the callbacks and their
consumers. Read the previous item via a ref-backed getter instead of closing over
`mealPlan`.

### 4.4 🟡 `MockHouseholdContext` omits `safeToSpendBreakdown` — **✅ Verified**
The real context exposes `safeToSpendBreakdown` (6 references); the mock has none.
Any component consuming it via `useFinance()` in **Test Mode** will get `undefined`
and can break — meaning tests/Test-Mode can pass where production would fail. Mirror
the field (and keep mock parity on the checklist when the finance slice changes).

---

## 5. Performance & Accessibility Polish

### 5.1 🟡 Finish the context-slice migration off `useHousehold()` — **✅ Verified**
Only two shim consumers remain: `pages/Settings.tsx:67` (702-line page, real
re-render concern — migrate to `useHouseholdCore()` + `useGamification()`) and
`pages/MigrateSubmissions.tsx` (one-off tool, low priority). The heavy/always-mounted
components are already migrated, so this is nearly done.

### 5.2 🟡 Add an `aria-live` region for toast notifications
`App.tsx:~232-248` — the `react-hot-toast` `<Toaster>` isn't wrapped in a
`role="status"` / `aria-live="polite"` region, so screen-reader users may miss
success/error feedback. Low-effort, high-value a11y win.

### 5.3 🟢 Memoize a few hot handlers
Modal-open handlers in `pages/ToDosPage.tsx` and `components/meals/MealPlanTab.tsx`
are recreated each render (no `useCallback`), defeating `React.memo` on their
children. `components/budget/TransactionMasterList.tsx` virtualizes well but its
inline `FilterControls` re-renders with the parent — extract + memoize it.

### 5.4 🟢 Minor theme/markup cleanups
A stray `style={{ WebkitAppearance: 'none' }}` (`pages/ToDosPage.tsx:~793`) can be
the Tailwind `appearance-none` class; an `rgb(0,0,0,0.06)` shadow in
`BudgetBucketCard.tsx:~102` can use a Tailwind shadow utility. (Codebase is
otherwise free of hardcoded hex colors — good.)

---

## 6. Type Safety & Tooling

- 🟡 **Bypass of typed converters** — `services/geminiService.ts:139,178` use
  `snap.data() as Household` for the quota doc instead of `.withConverter()`. Route
  through `householdConverter` for validated reads.
- 🟢 **Lint parity** — the functions workspace enforces
  `@typescript-eslint/no-explicit-any: 'error'` but the root ESLint config
  (`eslint.config.js`) does not. Add it to the root to match (only two test files
  would need an `as unknown` touch-up).
- 🟢 **CI coverage gate** — `vite.config.ts` configures coverage but CI never runs
  `pnpm test:coverage` against a threshold. Consider a floor for critical `utils/`.
- 🟢 **Pre-commit hooks** — no husky/lint-staged; adding them prevents
  lint/type/test failures from reaching CI.

---

## 7. Known Dead Code / Stale Feature

🟢 **`weatherSensitive` field** (`types/schema.ts:171`) is persisted across ~15
files but drives no logic; `WEATHER_IMPLEMENTATION.md` describes an unbuilt feature
and CLAUDE.md notes weather bonuses are disabled. Per `TODO.md`, decide: implement
in `utils/habitLogic.ts#getMultiplier` or remove the field + doc to shrink the API
surface.

---

## Suggested Sequencing

| Phase | Items | Rationale |
|-------|-------|-----------|
| **P0 — correctness/security, low effort** | 1.1 (validate AI JSON), 3.1 (remove admin UID), 4.1 (calendar error handler), 4.4 (mock parity) | High risk, small, well-scoped diffs. |
| **P1 — robustness** | 1.2–1.3, 3.2 (key restrictions), 4.2–4.3, 6 (converter + lint parity) | Hardening and de-duplication. |
| **P2 — safety net** | §2 tests, starting with context batch-writes & `useMidnightScheduler` | Locks in the above and guards future change. |
| **P3 — polish** | 5.1–5.4, 6 (CI/hooks), §7 cleanup | UX/a11y/perf and tidiness. |

_All findings are read-only observations; no source files were modified by this
audit._
