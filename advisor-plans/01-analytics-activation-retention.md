# Plan 01 — Analytics: Activation & Retention Events

**Impact:** HIGH (prerequisite for evaluating every other investment) · **Effort:** S (half a day)
· **Risk:** LOW (fire-and-forget, PROD-only, no behavior change) · **Confidence:** HIGH

## Context an executor needs

LifeBalance is a React 19 + Vite PWA (repo root is the app; `functions/` is a separate
pnpm workspace). Firebase Analytics (GA4) is already wired and verified live:
`services/analytics.ts` exposes `track(event, params?)` (line 60), lazily loads the SDK,
no-ops outside production, and requires `VITE_FIREBASE_MEASUREMENT_ID` (already set in
prod). **Only two events are instrumented in the entire app:** `sign_up` and `login` in
`services/authService.ts:23`.

The owner's product goal (docs/PRODUCT_ROADMAP.md Part 7) is proving retention for a
household finance+habits app. Nothing that matters — onboarding completion, first
transaction, habit engagement, AI usage, recap opens — is measured today.

## What to build

Add ~15 `track()` calls at the moments below. `track` is safe to call anywhere client-side
(it's a void fire-and-forget); never `await` it, never let it affect control flow, and do
not add it to Cloud Functions (GA4 client SDK only).

### Activation funnel
| Event | Where (verify exact call site before editing) |
|---|---|
| `household_created` / `household_joined` | `services/householdService.ts` — creation + invite-join success paths |
| `onboarding_completed` | `components/onboarding/OnboardingWizard.tsx` — the `done` step / `completeOnboarding` call (~line 55) |
| `first_transaction_added` | see "first-time flags" below |
| `first_habit_completed` | see "first-time flags" below |

### Engagement (the retention signal)
| Event | Where |
|---|---|
| `transaction_added` with `{ source }` | the context's `addTransaction` in `contexts/FirebaseHouseholdContext.tsx` — one call site covers manual/scan/voice since they all converge there; pass the transaction's `source` field (`types/schema.ts:134` union) |
| `transaction_verified` | `updateTransactionCategory` in the same file (the pending→verified path) |
| `habit_toggled` with `{ positive: boolean }` | `hooks/useHabitActions.tsx` toggle success path |
| `insight_generated` | `refreshInsight` success path, `contexts/FirebaseHouseholdContext.tsx` (~line 4626 where the insight doc is written) |
| `insight_action_executed` with `{ type }` | `hooks/useInsightActions.ts` |
| `receipt_scanned`, `statement_scanned` | `components/modals/CaptureModal.tsx` (~lines 343-382 and 413-499) success paths |
| `meal_planned`, `shopping_item_checked` | meal-plan add + shopping toggle in the context (nice-to-have; skip if time-boxed) |
| `reward_redeemed` | the redemption request path (search `utils/redemption.ts` consumers) |
| `notification_opened` with `{ type }` | `public/sw.js` routes clicks by URL — the SW cannot call the GA client SDK, so instead append a `?nsrc=<type>` query param in the SW's click handler URL (`public/sw.js:29-51`) and fire `notification_opened` from a tiny client-side check on app boot (read + strip the param). Keep it dependency-free. |

### First-time flags
For `first_transaction_added` / `first_habit_completed`, don't add server state: derive
client-side — at the `transaction_added` / `habit_toggled` call sites, if the relevant
in-memory list length was 0 before the write (or `localStorage` flag
`lb_first_txn_tracked` unset), also fire the `first_*` event and set the flag.
Approximate is fine; this is analytics, not accounting.

## Guardrails

- **No PII in params.** Amounts, merchant names, habit titles, emails are all forbidden.
  Allowed: `source`, booleans, counts, coarse types. This is a finance app; treat GA4 as
  a hostile bucket.
- Do not import `services/analytics` into `functions/` or the SW.
- `track` already guards non-PROD; do not add test-mode conditionals at call sites.
- Keep each call one line; no new abstractions.

## Verification & done criteria

1. `pnpm lint && pnpm test && pnpm run build` green.
2. Grep check: `grep -rn "track(" services components contexts hooks pages | grep -v analytics.ts | wc -l` ≥ 12.
3. Add one unit test per *file-with-new-logic* only where logic exists (the SW query-param
   round-trip and the first-time flag derivation); plain `track()` insertions need no tests.
4. In a `pnpm dev` session, confirm zero console errors and (in dev) zero network calls to
   GA (the PROD guard).
5. Document the event dictionary as a table appended to `docs/PRODUCT_ROADMAP.md` Part 7
   (event name → trigger → params) so the owner can build GA4 explorations against it.

## Out of scope

Server-side/BigQuery export, session stitching, A/B infra, consent-mode changes (the
signup consent gate from PR #670 already covers the disclosure).
