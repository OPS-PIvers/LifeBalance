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

Everything else is supporting: cost/scale correctness before growth (06), a safety net
for the money paths before the reconciliation work (07), keeping the agent-facing docs
truthful (05), decomposing the 4,861-line context file before it hits 6k (08), and the
runbook for flipping on the finished-but-dormant features (09).

## Priority order

| # | Plan | Impact | Effort | Risk | Confidence | Depends on |
|---|------|--------|--------|------|------------|------------|
| 01 | [Analytics: activation & retention events](./01-analytics-activation-retention.md) | HIGH — unlocks measurement for everything else | S | LOW | HIGH | — |
| 02 | [Weekly recap + proactive insight engine](./02-weekly-recap-engine.md) | HIGH — flagship differentiator, retention loop, premium substance | M | MED | HIGH | 01 (to measure it) |
| 03 | [Unified transaction identity & reconciliation](./03-transaction-identity-reconciliation.md) | HIGH — unblocks Plaid; kills duplicate-transaction distrust | L | MED | HIGH | 07 recommended first |
| 04 | [Plaid activation: balance sync, dedup, runbook](./04-plaid-activation.md) | HIGH — automatic bank sync, the category-defining feature | M | MED | HIGH | 03 |
| 05 | [Docs truth pass (CLAUDE.md et al.)](./05-docs-truth-pass.md) | MED — compounds across every future agent session | S | LOW | HIGH | — |
| 06 | [Notification fan-out cost fix](./06-notification-fanout-cost.md) | MED — 4 hourly full-collection scans; cost/scale correctness | M | MED | HIGH | — |
| 07 | [E2E money-path suite](./07-e2e-money-paths.md) | MED — safety net under 03/04; today only one smoke spec | M | LOW | HIGH | — |
| 08 | [FirebaseHouseholdContext decomposition](./08-context-decomposition.md) | MED — 4,861-line file, still growing; pure mechanical split | L | MED | MED | best after 03 |
| 09 | [Dormant-feature activation runbook (Kid Mode, Stripe)](./09-dormant-activation-runbook.md) | MED — ships finished work; mostly human go/no-go | S | LOW | HIGH | 02 (for Stripe) |

**Suggested execution sequence:** 01 → 05 (both trivial, immediate) → 07 → 02 → 03 → 04 → 06 → 08,
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
