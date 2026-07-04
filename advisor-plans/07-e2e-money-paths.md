# Plan 07 — E2E Money-Path Suite

**Impact:** MED standalone, HIGH as the safety net under Plans 03/04 (which rewire how
money enters the app) · **Effort:** M (2–3 days) · **Risk:** LOW (test-only; zero app-code
changes except Test-Mode seams) · **Confidence:** HIGH

## Current state

Playwright is configured (`playwright.config.ts`, Chromium preinstalled in CI and this
environment) with exactly **one spec**: `e2e/smoke.spec.ts` — boots Test Mode
(`/#/login?test=true`) and clicks through Budget/Habits via the bottom nav. The CI `e2e`
job is separate and **non-required** (kept from blocking merges; see
`.github/workflows/ci.yml`). Test Mode (`VITE_ENABLE_TEST_MODE=true`, dev-only) provides
full in-memory CRUD via `contexts/MockHouseholdContext.tsx` (1,052 lines) — everything an
E2E needs without Firebase.

The app's highest-regression surface is the money arithmetic the unit tests cover *in
isolation* but nothing exercises *through the UI*: Safe-to-Spend recomputation, the
pending→verified transaction flow, balance debits, bucket matching. PR #792 just
rewrote the transaction-review UX; Plans 03/04 will rewire ingestion. This suite is the
regression floor for that work.

## Specs to write (each independent, Test-Mode booted)

1. **`safe-to-spend.spec.ts`** — read the Safe-to-Spend figure from `TopToolbar`; add a
   manual expense via the capture FAB; assert the figure drops by exactly that amount
   (pending-spend subtraction); open `SafeToSpendModal` and assert the "Pending
   transactions" line matches. Then verify the transaction (review flow) and assert the
   checking balance line moved and pending line shrank.
2. **`transaction-review.spec.ts`** — the #792 unified review: a `pending_review`
   transaction appears in the review drawer on open; categorize it into a bucket; assert
   it leaves the queue, the bucket's spent figure updates, and it appears in the master
   list. Include the `needsAmount` $0-stub path: enter an amount inline, assert the
   balance delta uses the entered amount (the CLAUDE.md-documented single-debit rule).
3. **`habit-points.spec.ts`** — toggle a threshold habit to target; assert points header
   increments with the streak multiplier shown on the card; untoggle; assert exact
   reversal (the classic drift bug class this repo has fixed twice).
4. **`bucket-reallocation.spec.ts`** — move budget between buckets; assert both limits
   update and totals conserve.
5. **`onboarding.spec.ts`** — fresh Test-Mode household (if the mock supports the
   new-creator path; if not, add a `?test=true&fresh=true` seam to
   `MockHouseholdContext` — keep the seam trivial) → wizard seeds one checking account +
   chosen habits → dashboard renders with the seeded balance.
6. **`recap.spec.ts`** — *after Plan 02 ships:* recap card renders from mock data; detail
   drawer opens; dismiss persists across reload.

House style: use accessible selectors (`getByRole`) — the June a11y passes made this
feasible; treat any place a `data-testid` is required as an a11y smell to note. Assert on
formatted currency via a helper tolerant of the `formatCurrency` locale output.

## CI

- Keep the `e2e` job non-required until it's proven quiet for ~2 weeks, then make it
  required (flip in repo branch-protection settings — human, one click; note in PR body).
- Parallelize with Playwright's default workers; the suite must stay under ~4 minutes so
  making it required later is palatable.
- Screenshots + traces on failure only.

## Verification & done criteria

- All specs green locally 5× consecutively (`pnpm exec playwright test --repeat-each=5`)
  to flush flake before CI.
- `pnpm lint && pnpm test` unaffected (`e2e/` stays excluded from vitest/tsc — verify the
  existing exclusions in `vite.config.ts`/`tsconfig.json` still hold).
- Any Mock-context gaps discovered (missing fields vs the real context) fixed in
  `contexts/MockHouseholdContext.tsx` as part of this work — that parity debt is exactly
  what this plan is designed to surface.

## Out of scope

Real-Firebase E2E (auth flows, rules), visual regression, mobile-device farms, load tests.
