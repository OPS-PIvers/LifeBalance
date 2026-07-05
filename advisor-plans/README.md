# Advisor Plans — "Next Level" Pass (2026-07-04)

A fresh senior-advisor audit of LifeBalance at commit `b6b153d` (post-#792), independent of
the earlier `plans/` and `todo/` backlogs. Every claim below was verified against source
during this pass; each plan is self-contained (an executor needs zero session context).

## The thesis

The engineering floor is high: 1,901 unit tests, strict TS on current majors (React 19,
Vite 8, TS 6, Tailwind 4), a real design system (DESIGN.md), atomic money paths, and a
suppression count you can count on your fingers. That is no longer where the leverage is.

The leverage is that **the app doesn't yet close its own loops**. Three loops, specifically:

1. **The data loop doesn't close.** Eight transaction-ingestion paths exist (manual,
   receipt scan, statement scan, magic/voice, iOS-Shortcut quickAdd, bank-alert email,
   Apple Pay $0 stub, Plaid) but reconciliation is pairwise and path-specific. Plaid — the
   single biggest capability jump, already deployed and cron-synced — is stuck behind its
   flag *because* turning it on would double-ingest what the email/shortcut pipeline
   already captures. → Plan 03 builds the unified transaction-identity layer; Plan 04
   then activates Plaid safely (with balance sync).
2. **The value loop doesn't close.** The paywall (`components/modals/PaywallModal.tsx:30`)
   sells "proactive insights" and a weekly recap; `utils/entitlements.ts` has
   `recapEnabled`; Stripe checkout/webhook code is written and tested but unexported.
   None of the promised intelligence exists — insights are real Gemini analysis but
   strictly button-triggered. → Plan 02 ships the recap/proactive engine, which is both
   the retention loop and the substance behind the subscription.
3. **The learning loop doesn't close.** Exactly two analytics events exist
   (`sign_up`, `login` in `services/authService.ts:23`). Activation, retention, and
   feature engagement — the metrics the owner's own roadmap calls the whole ballgame —
   are unmeasurable. → Plan 01 instruments the funnel in an afternoon.
   **✅ DONE (2026-07-04):** Plan 01 is shipped and its doc removed — ~20 activation/
   engagement/retention events now fire client-side; the event dictionary lives in
   `docs/PRODUCT_ROADMAP.md` Part 7.

Everything else is supporting: cost/scale correctness before growth (06), a safety net
for the money paths before the reconciliation work (07), keeping the agent-facing docs
truthful (05), decomposing the 4,861-line context file before it hits 6k (08), and the
runbook for flipping on the finished-but-dormant features (09).

## Priority order

| # | Plan | Impact | Effort | Risk | Confidence | Depends on |
|---|------|--------|--------|------|------------|------------|
| 01 | ~~Analytics: activation & retention events~~ **✅ DONE 2026-07-04** (doc removed; event dictionary in `docs/PRODUCT_ROADMAP.md` Part 7) | HIGH — unlocks measurement for everything else | S | LOW | HIGH | — |
| 02 | ~~Weekly recap + proactive insight engine~~ **✅ DONE 2026-07-04** (doc removed; `sendweeklyrecap` scheduled function + recap card/drawer/deep link + streak-rescue proactive insights with 2/week cap; budget-anomaly trigger deferred — `sendbudgetalerts` has no bucket-spend data server-side) | HIGH — flagship differentiator, retention loop, premium substance | M | MED | HIGH | 01 (to measure it) |
| 03 | ~~Unified transaction identity & reconciliation~~ **✅ DONE 2026-07-04** (doc removed; shared `transactionIdentity` module both sides, ±1-day auto-merge / 2-3-day `possible` policy, Plaid+quickAdd wire-ins, review-UI Merge/Keep-both with balance-safe batch merge; Plaid cross-path matches cap at `possible` until Plan 04 adds account mapping) | HIGH — unblocks Plaid; kills duplicate-transaction distrust | L | MED | HIGH | 07 recommended first |
| 04 | ~~Plaid activation: balance sync, dedup, runbook~~ **✅ DONE 2026-07-05** (doc removed; `modified`/`removed` handling + advisory balance sync + account mapping shipped in #807; webhook skipped per time-box; activation = flip `plaidEnabled`, link an account, watch two sync cycles) | HIGH — automatic bank sync, the category-defining feature | M | MED | HIGH | 03 |
| 05 | ~~Docs truth pass (CLAUDE.md et al.)~~ **✅ DONE 2026-07-04** (doc removed; CLAUDE.md/README/AGENTS.md/TODO.md/LINT_SUPPRESSIONS.md verified against source, stale docs pruned, analytics layer documented) | MED — compounds across every future agent session | S | LOW | HIGH | — |
| 06 | ~~Notification fan-out cost fix~~ **✅ DONE 2026-07-05** (doc removed; `anyNotificationsEnabled` flag + backfill + collection-group index shipped in PR-1/#805-#806; the four scheduled jobs + `sendweeklyrecap` switched to the flagged `collectionGroup("members")` query with a `FALLBACK_FULL_SCAN` escape hatch in this PR) | MED — 4 hourly full-collection scans; cost/scale correctness | M | MED | HIGH | — |
| 07 | ~~E2E money-path suite~~ **✅ DONE 2026-07-04** (doc removed; 5 money-path specs in `e2e/` + Test-Mode parity fixes in `MockHouseholdContext`; recap spec deferred until Plan 02 ships) | MED — safety net under 03/04 | M | LOW | HIGH | — |
| 08 | ~~FirebaseHouseholdContext decomposition~~ **✅ DONE 2026-07-05** (doc removed; 5 move-only PRs — types+selectors, todo/meal/shopping, gamification, core/members/kid, finance/transactions/calendar — `FirebaseHouseholdContext.tsx` ~4,992 → 2,070 lines as the provider + re-export shim, listener/mutation factories under `contexts/household/{listeners,mutations}`; entangled closures deliberately left in the provider: the pending-items voice drain and the members listener) | MED — 4,861-line file, still growing; pure mechanical split | L | MED | MED | best after 03 |
| 09 | [Dormant-feature activation runbook (Kid Mode, Stripe)](./09-dormant-activation-runbook.md) | MED — ships finished work; mostly human go/no-go | S | LOW | HIGH | 02 (for Stripe) |

**Suggested execution sequence:** ~~01~~ (done) → ~~05~~ (done) → ~~07~~ (done) → ~~02~~ (done) → ~~03~~ (done) → ~~04~~ (done) → ~~06~~ (done) → ~~08~~ (done),
with 09's Kid-Mode half whenever the owner wants and its Stripe half after 02 ships.

## What this pass deliberately does NOT re-plan

- Bounding the remaining unbounded listeners (`meals`, `groceryCatalog`, `calendarItems`
  in `contexts/FirebaseHouseholdContext.tsx:1154-1176`) — still real, still unshipped, but
  `plans/040-bound-unbounded-listeners.md` remains accurate and human-watch-gated; nothing
  to add.
- The `firestore.rules` hardcoded admin UID (`firestore.rules:31`) — still live; blocked on
  the owner provisioning the `admin` custom claim (`todo/05-admin-gate-serverside.md`).
  Called out in Plan 09's checklist.
- UI/design-system work — the June refresh (#697–#778) finished this; DESIGN.md governs.

## Conventions for executors

- **pnpm only** (`pnpm install --frozen-lockfile`). Gate every PR on `pnpm lint`
  (root), `pnpm lint:all` when `functions/` is touched, `pnpm test`, `pnpm run build`.
- No lint/type suppressions (see CLAUDE.md "Zero Tolerance" policy).
- `@/` path alias for all cross-directory imports; parent-relative imports are lint errors.
- Money in integer cents via `utils/money.ts`; "today" via `getLocalDateString()`
  (`utils/dateHelpers.ts`), never `toISOString().split('T')[0]`.
- Any change touching `firestore.rules` or `firestore.indexes.json` ships in its own PR,
  behind the emulator rules tests, with a human watching the deploy (atomic deploy, no
  staging).
- Update `contexts/MockHouseholdContext.tsx` for parity whenever the real context's public
  surface changes (Test Mode must not drift).
