# LifeBalance — Backlog (single source of truth)

**Open work only.** A finished item is deleted from this file, not archived in it — the PR is the
record (`git log --oneline --grep '#1128'`). Decisions already argued to a conclusion, and traps that
outlived the task that found them, live in **[docs/DECISIONS.md](docs/DECISIONS.md)** — check there
before re-filing something that looks like a bug.

**Sibling backlogs — check both before concluding something isn't tracked:**

- **`FEATURES_ROADMAP.md`** — features only (36 open candidate briefs; catalogued 2026-07-13, audited
  and pruned 2026-08-04 when 62 of the original 98 were verified shipped). Nothing greenlit. The
  split is enforced in both directions: an idea overlapping this file was dropped there with a
  cross-reference instead.
- **`docs/plans/phase-2b-deterministic-nl-quickadd.md`** — execution detail for §2A's Phase 2b, the
  only surviving doc from the old `plans/` tree. Status *planned / not started*.

**Conventions for executors:** pnpm only; `@/` imports; money is stored in **decimal dollars**
(`utils/money.ts` sums in integer cents internally — never write cents to Firestore); "today" via
`getLocalDateString()`; no lint/type suppressions. Any `firestore.rules` / `firestore.indexes.json`
change ships in **its own human-watched PR** (tagged **[rules]** / **[index]** — atomic deploy, no
staging). See `CLAUDE.md`.

---

## 1. Blocked on a human — launch & ops gates

Needs a person: secrets, flag flips, legal review, or a watched deploy. Step-by-step procedures live
in the runbooks; this is the index.

| # | Item | Risk | Runbook |
|---|------|------|---------|
| 1.1 | **Admin custom claim → retire the hardcoded super-admin UID.** Provision `admin:true` via the Admin SDK (nothing in the repo sets a claim today), then drop the UID fallback from `firestore.rules` `isSuperAdmin()`, demote `contexts/AuthContext.tsx` + `pages/Settings.tsx` to `getIdTokenResult()`, and remove `VITE_ADMIN_UID` from `deploy.yml`, `.env.local.example`, `vite-env.d.ts`. **Blocks open signup and paid launch.** | HIGH — admin lockout if mis-ordered | `docs/DEPLOY_CHECKLIST.md` §1 |
| 1.2 | **Open public signup (legal-gated).** Fill 8 `[PLACEHOLDER]`s (18 occurrences) in `PrivacyPolicy.tsx` + `TermsOfService.tsx` → counsel → PR removing the DRAFT banner. Bumping `CONSENT_VERSION` affects **new signups only** (nothing compares a stored `consentVersion`; no re-consent flow exists). Then add the prod origin to Auth authorized domains and flip `openSignup=true`. **⚠️ Sub-gate:** the Gemini-terms placeholder is the app's **only** AI data-handling disclosure since the in-app PII banner was deleted on the grounds that the policy carried it — until it ships, the app discloses AI handling **nowhere**. Do not flip `openSignup` first. | LOW | `docs/PRELAUNCH_CHECKLIST.md` |
| 1.3 | **Activate Stripe billing.** Code first: export `createcheckoutsession` + `stripewebhook` from `functions/src/index.ts` (deliberately unexported), add an emulator subscription-write test, verify entitlements in Test Mode. The secrets must exist **before** CI can deploy secret-bound functions. Then Stripe account/product → secrets/webhook → flip `billingEnabled`. ⚠️ That flip drops the free AI cap for alpha users — sequence with comms. Member/kid cap enforcement is already live. | MED | `docs/STRIPE_SETUP_RUNBOOK.md` |
| 1.4 | **Reveal Kid Mode.** Test-Mode kid-loop walkthrough (add kid → switch → dashboard → chore → points → reward → approval → exit PIN), fix breakage, flip `kidModeEnabled`. Code-complete and deployed dormant. | LOW | — |
| 1.5 | **Populate the `VITE_SENTRY_DSN` GitHub Actions secret.** Wiring already shipped; error tracking stays dark until the real DSN is set. | LOW | — |
| 1.6 | **CSP: promote Report-Only → enforcing** in `firebase.json`, after reviewing violation telemetry and an authed-path verify. Mistuned `connect-src`/`script-src` breaks the Firebase SDK/PWA. | MED | — |
| 1.7 | **Verify the first real `deleteHousehold`** on a throwaway household before relying on it. | LOW | — |

---

## 2. Actionable now — code-only (executor-ready)

No human gate; ship as normal PRs to `main`. Rules/index changes still ship in their own
human-watched PR.

### 2A. Performance & scale

- [ ] **Split the `calendarItems` listener** (`contexts/household/listeners/financeListeners.ts:108`)
  into an *unbounded recurring-templates* listener + a *date-windowed instances* listener. The last of
  the three unbounded listeners (grocery catalog and meals are done). **[index]** ships first —
  composite index, human watches it reach *Enabled* — then the query change; verify Safe-to-Spend and
  upcoming-bills values are unchanged. **L / HIGH.**
- [ ] **Merge the 4 hourly notification crons into one dispatcher** (`functions/src/index.ts`:
  `sendhabitreminders` / `sendactionqueuereminders` / `sendstreakwarnings` / `sendbillreminders`). The
  full-collection-*scan* cost is already fixed; this is the remaining invocation-count reduction.
  **M / LOW-MED.**
- [ ] **Phase 2b — deterministic NL quick-add.** `quickAddNaturalLanguage` parks raw text in
  `pendingItems` and the **client** drains it through Gemini on next app open. Replace with
  deterministic server-side parsing, demoting Gemini to an opt-in "✨ Clean up with AI" for genuinely
  ambiguous input; the capture-review drawer (#1062) is the safety net that makes heuristic parsing
  acceptable. Full spec — including the "what already exists, REUSE don't rebuild" inventory — in
  `docs/plans/phase-2b-deterministic-nl-quickadd.md`. **L / MED.**

### 2B. Security hardening — all **[rules]**, all from the 2026-06 audit

- [ ] **SEC-06 — missing audit-log rule.** Add an explicit `firestore.rules` match for
  `logs/api_calls/requests` (only `logs/ai_usage/requests` is covered). **S / LOW.**
- [ ] **SEC-10 — catch-all subcollection write rule** (`firestore.rules` ~1242-1271) is
  exclusion-list-permits. Change to deny-by-default after grepping every `.collection()` usage so
  nothing untracked breaks. **S / LOW-MED.**
- [ ] **Sub-bucket field cleanup.** Drop the dead `subBucketId` / `subBuckets` references from
  `firestore.rules` (~568, 684, 699, 708) — the app code was removed; rules just permit an unused
  field. Bundle with the next rules PR. **S / LOW.**

### 2C. Money-path follow-ups (from the settled-bill work, #1134 / 2H)

> Background on why the guard behaves as it does: `docs/DECISIONS.md` → *Settled bills*.

- [ ] **Batch-update toasts over-report when the settled-bill guard skips a row.** The guard refuses by
  toasting and returning *normally*, so `TransactionMasterList`'s `handleBatchCategorize` /
  `executeBatchVerify` — which `Promise.allSettled` over the selection — see a **fulfilled** promise
  for a refused row and report "Updated N transactions" when one was skipped. Fix is a distinguishable
  return value from the guarded mutations, or filtering settled rows out of the selection. Report-only;
  no money moves wrongly. **S / LOW.**
- [ ] **Settle flow ignores an untouched-vs-edited Account select.** The live *amount* is plumbed into
  `settleBillWithTransaction`; the Account select is not. For an untagged row that select is pre-filled
  with a *suggestion* (`suggestAccountIdForTransaction`), so forwarding it blindly would skip the
  `AccountPicker` confirmation the code deliberately requires. Needs a "user actually touched this
  field" signal the form doesn't track. Until then, changing the Account select without saving has no
  effect on a settle. **S / LOW.**
- [ ] **Full unlink for a settled bill.** A real "unlink" on the transaction side would clear
  `paidCalendarItemId`, un-pay the occurrence and reverse the delta in one batch. Today the transaction
  keeps its stamp and stays verified even after the paid calendar doc is deleted. **M / MED.**

### 2D. Small / hygiene

- [ ] **`components/habits/ReflectionDrawer.tsx` is built but never mounted.** A complete quick
  note/mood drawer that nothing imports — the F-HABITS-06 reflection UI shipped inside
  `HabitSubmissionLogModal` instead. Wire it in or delete it. **XS.**
- [ ] **`payCalendarItem` atomicity test flake under heavy parallel load** —
  `checkPointsReset`'s 100ms midnight-scheduler timer can add a second batch to the test's capture. Fix
  is to reset/filter `batches` in that test (`contexts/FirebaseHouseholdContext.test.tsx`), not the
  code. **XS.**
- [ ] **Verify whether `moduleVisibility.todos` is `false` for this household** — it was turned off
  believing it was per-member, which hid to-dos (and their Action Queue cards) for **both** members.
  One Firestore read. **XS.**

---

## 3. Needs a product decision before planning

### 3A. Plaid privacy (2026-08-02 review)

Neither is a defect while `plaidEnabled` is off and no account has ever been linked; both want
counsel's input, which the policy does not yet have.

- **No webhook handler for Item expiry or bank-revoked consent.** Banks and Plaid can invalidate an
  Item (re-auth required, consent withdrawn, `ITEM_ERROR`). Nothing listens, so a dead connection stays
  listed as active and `plaidsynctransactions` keeps failing silently. Decide what the user sees — a
  passive "reconnect" banner, a push, or nothing — before wiring the endpoint. **M / MED.**
- **Terms of Service may need a Plaid acknowledgement.** The Privacy Policy names Plaid as a processor;
  Plaid's developer agreement also calls for referencing Plaid in end-user terms, and
  `pages/TermsOfService.tsx` has zero mentions. Belongs in the counsel pass alongside §1.2's
  placeholders. **S / HIGH before any non-alpha signup.**
- **No retention policy for synced bank transaction data.** Plaid-imported transactions live in
  `households/{id}/transactions` indefinitely, indistinguishable after the fact except by
  `plaidTransactionId`. Disconnecting stops the sync but keeps everything imported. Decide whether
  disconnect should offer to purge, and whether any age-based expiry applies. **S / MED.**

### 3B. Per-member habit points follow-ups

From the 2026-07-30 six-stage ship (#1152–#1158); spec in `.claude/PER_MEMBER_POINTS_HANDOFF.md`.
Accepted trade-offs from that review are in `docs/DECISIONS.md`, not here.

- **TWO of the three automated-completion paths still carry NO per-member attribution.**
  Transaction-fired habits were fixed by #1210 (ATTR-1): `contexts/household/mutations/transactionMutations.ts`
  resolves the card's owner via `utils/habitCardAttribution.ts` and writes `completedBy` + `attributedTo`
  — falling back to unattributed household credit only for a chore, an untagged card, or a uid off the
  roster. Still unattributed: the **to-do-fired** trigger (`fireLinkedHabitInBatch` in
  `contexts/household/mutations/todoMutations.ts`, which writes points only to the habit's `assignedTo`
  or the household doc) and the **Cloud Functions quickAdd** habit endpoint
  (`functions/src/quickAdd/index.ts`, which increments `households/{id}.points.*` only). Both credit the
  household at the legacy habit-level multiplier and count toward nobody's personal score, so a
  household leaning on automations under-counts personal scores. `noSpendFire` is deliberately
  unattributed — a household-wide fact, pinned by `cardOwnerAttributionParity.test.ts`, not a gap.
  **Decide WHO gets credit for the remaining two** — the Shortcut key's owner? the to-do's assignee? —
  before wiring. **M / MED.**
- **Reversal never rescores surviving periods whose streak multiplier the clear changed.** Clearing
  period A shifts the multiplier of *later* periods that survive it, and neither
  `attributionReversalForDates` branch scores those dates (`periodPointsMove` is period-scoped by
  construction). Probed: a daily threshold habit on a 7-day streak, clearing day 1, moves
  `{daily: 0, weekly: -10, total: -10}` against a truth of `{daily: -5, weekly: -20, total: -20}`.
  Daily/weekly self-heal on the next corrective sync; the under-debited `total` is permanent.
  Pre-existing and branch-agnostic — verified byte-identical pre-#1167. Only reachable via **back-dated
  clears** (`resetHabitDay` alone since #1172), never a same-day reset. **Decide the rescoring scope
  before coding. S.**

### 3C. Product scope (2026-07-09 audit — grounded, not greenlit)

- **Meals/grocery spend → Groceries budget-bucket linkage** — flagged the highest-value net-new
  differentiator; needs a matching-logic decision. Per-meal cost tracking now exists
  (`utils/mealCost.ts`) but is deliberately informational — never wired into `safeToSpendCalculator.ts`
  or bucket math. That wiring is the open decision. **M / MED.**
- **AI Weekly Planner: full save-back to the calendar/meal-plan** (today it only writes the shopping
  list). **M / LOW-MED.**
- **G1** — full shared family calendar (beyond the bills-only ICS feed).
- **G8** — generalized email-in inbox (per-household inbound address → existing parser).
- **G9** — printable "fridge" views (`@media print` + `/print` route). Distinct from the shipped
  "Print week for the fridge" action in `MealPlanTab` (`utils/printWeekHtml.ts`), which is tab-scoped
  and meal-plan/shopping only; G9 is the app-wide print surface. **S.**
- **G10** — receipt-image persistence / document shelf (`firebase/storage` + a new rules surface).
- **G12** — Alexa/Google Home shopping entry (skill + platform certification).
- **Marketing/landing page + waitlist capture** (DIR-08) — needs a hosting/domain decision + copy.
- **Deferred pre-traction by the roadmap:** referral/invite rewards, achievements/badges layer,
  monthly/annual recap payloads ("year in review"), i18n, multi-household switching, TWA/app-store
  wrap, re-consent flow for post-launch policy changes.

---

## Reference docs

- `docs/DECISIONS.md` — decisions not to re-litigate + standing traps (**read before re-filing a bug**)
- `FEATURES_ROADMAP.md` — the sibling backlog: features only, 36 open briefs, none greenlit
- `docs/plans/phase-2b-deterministic-nl-quickadd.md` — execution detail for §2A's Phase 2b
- `docs/PRODUCT_ROADMAP.md` — product strategy + the analytics event dictionary (Part 7)
- `docs/PRELAUNCH_CHECKLIST.md` — the ordered public-launch gate (legal → open signup)
- `docs/DEPLOY_CHECKLIST.md` — gated ops/security actions requiring console/Admin-SDK access
- `docs/STRIPE_SETUP_RUNBOOK.md` · `docs/PLAID_SETUP_RUNBOOK.md` — external-service activation
- `docs/REPO_CLEANUP_RUNBOOK.md` — branch/worktree cleanup procedure
- `docs/ADR-bucket-color-keys.md` — architecture decision record
- `docs/integrations/*.md` — import/export integration guides
- `SECURITY_MODEL.md` · `NOTIFICATIONS.md` — living reference
- `CLAUDE.md` · `DESIGN.md` · `LINT_SUPPRESSIONS.md` — agent/design/quality guidance
