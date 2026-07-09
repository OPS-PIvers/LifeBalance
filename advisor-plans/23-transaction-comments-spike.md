# Plan 23: Comments on transactions — design spike + rules-gated build

> **Executor instructions**: This plan is TWO deliverables in sequence: (A) a design
> spike appended to this file, then (B) the code build — EXCLUDING the
> `firestore.rules` change, which ships as its own separately-reviewed, human-watched
> PR (repo rule). Do not write rules yourself beyond drafting the diff in the spike
> notes. Update the status row in `advisor-plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- types/schema.ts firestore.rules utils/firestoreConverters.ts contexts/household/listeners contexts/household/mutations`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P3 (Phase 6)
- **Effort**: M (build) + the human-watched rules PR
- **Risk**: MED — new subcollection + rules change + potential notification fan-out
- **Depends on**: none (but sequence the rules PR with a human available)
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

"What was this $80 charge?" is the canonical couple money-conflict, and the app's positioning is literally "stay on the same page about money" — yet `Transaction.notes` is a single-author string one partner can silently overwrite and the other never sees in context. A lightweight comment thread on a transaction turns silent edits into a conversation. No mainstream budgeting competitor (YNAB/Monarch/Copilot) has shared per-transaction comments; for a two-person household app this is a genuine wedge feature.

## Design (v1 boundaries — decided)

- **Entity**: `TransactionComment { id, authorUid, text (≤500 chars), createdAt (ISO) }` in a subcollection `households/{hid}/transactions/{txnId}/comments` — a subcollection (not an array) so two partners can't clobber each other and rules can enforce author-only writes.
- **Read model**: comments load ON DEMAND when a transaction's detail/review surface opens (a `getDocs` fetch, NOT a standing listener — no new always-on listeners; this repo bounds listener count deliberately).
- **Unread signal v1**: a denormalized `commentCount` on the transaction doc, bumped in the same batch as the comment write; rows render a small count badge (reuse `components/ui/CountBadge`). Per-user read-tracking is explicitly OUT of v1.
- **Notifications**: OUT of v1 (would need fan-out design; note as v2).
- **Scope of entities**: transactions only in v1 (todos later if it earns it).

## Current state (verified 2026-07-09)

- `types/schema.ts` — `Transaction.notes` exists (~`:182`); no comment/thread entity anywhere.
- Converters: one typed `FirestoreDataConverter<T>` per major collection in `utils/firestoreConverters.ts`, each unit-tested (well-formed + partial doc) — the new `transactionCommentConverter` must follow this pattern.
- Mutations live in `contexts/household/mutations/` as factory modules (e.g. `transactionMutations.ts`); multi-doc money-adjacent writes use `writeBatch` (CLAUDE.md Atomicity section). The comment write + `commentCount` bump is one batch.
- **Rules**: `firestore.rules` currently has NO rule for a `transactions/{id}/comments` subcollection → all access denied by default. The rules PR must add: member-read; create where `authorUid == request.auth.uid` and text length-capped; update/delete author-only (or disallow edits in v1 — simpler). Rules changes in this repo ship in their OWN PR behind the emulator rules tests (`pnpm test:rules`, CI-only on Windows) with a human watching the deploy.
- UI surfaces where a transaction opens in detail: find the review form (`components/transactions/`, `TransactionReviewForm` per the analytics dictionary) and `EditTransactionModal` — the thread renders there.
- `MockHouseholdContext` must gain parity methods (repo rule).

## Steps

### Step A: Design spike (append "## Spike notes" here)

1. Enumerate the exact rules diff (draft it in the notes, do not apply): match the style of an existing subcollection block in `firestore.rules`; confirm whether transactions themselves are a subcollection with rules you can mirror.
2. Locate the two (or more) detail surfaces and the exact insertion point for a thread section; confirm which context slice they consume.
3. Confirm `CountBadge` exists and how rows in the pending-review list are composed (for the count badge placement).
4. Decide (and record) the empty-state copy + whether the composer is an inline input or reuses `QuickAddBar`.

**Verify**: Spike notes appended with file:line evidence + the draft rules diff.

### Step B: Build (code only; rules PR is separate)

1. Schema + converter + converter tests.
2. `commentMutations.ts` factory: `addTransactionComment(txnId, text)` (batch: comment doc + `commentCount` increment), optional `deleteTransactionComment` (author-only, decrements count). Wire into the transaction slice; MockHouseholdContext parity.
3. Thread UI in the detail surfaces: on-open fetch, list (author avatar/name via existing member rendering), composer, count badge on rows.
4. Tests: converter, mutation batch shape, component render with mock comments.

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0. NOTE: until the rules PR deploys, the feature errors in prod — gate the UI behind the build being merged AFTER the rules PR, or ship the UI dark (feature reads `commentCount` only, composer hidden) and flip in a follow-up. Record which sequencing was chosen.

## Done criteria

- [ ] Spike notes + draft rules diff appended
- [ ] Converter/mutations/UI + tests green; Mock parity done
- [ ] Sequencing decision recorded (rules PR first, human-watched)
- [ ] `advisor-plans/README.md` row updated

## STOP conditions

- Applying any change to `firestore.rules` yourself — draft only; the human-watched rules PR is a separate step.
- The detail surfaces turn out to be virtualized rows with no stable detail view (would change the design) — report.
- Anything requiring a standing listener per transaction — refuse; on-demand fetch is a load-bearing constraint.

## Maintenance notes

- v2 candidates, in order: comment push notification (piggyback existing FCM prefs with a new preference key), per-user unread tracking, todo comments.
- Reviewer scrutiny: the batch (comment + count) — count drift would show phantom badges; and the length cap enforced BOTH client-side and in the rules draft.
