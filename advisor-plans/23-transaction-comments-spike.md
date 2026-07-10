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

- [x] Spike notes + draft rules diff appended
- [x] Converter/mutations/UI + tests green; Mock parity done
- [x] Sequencing decision recorded (ship UI dark — see Spike notes §5)
- [ ] `advisor-plans/README.md` row updated — SKIPPED per operator amendment (orchestrator will handle)

## STOP conditions

- Applying any change to `firestore.rules` yourself — draft only; the human-watched rules PR is a separate step.
- The detail surfaces turn out to be virtualized rows with no stable detail view (would change the design) — report.
- Anything requiring a standing listener per transaction — refuse; on-demand fetch is a load-bearing constraint.

## Maintenance notes

- v2 candidates, in order: comment push notification (piggyback existing FCM prefs with a new preference key), per-user unread tracking, todo comments.
- Reviewer scrutiny: the batch (comment + count) — count drift would show phantom badges; and the length cap enforced BOTH client-side and in the rules draft.

## Spike notes (executor, 2026-07-10, commit `advisor/23-transaction-comments`)

**Drift check**: `git diff --stat fce26e4..HEAD -- types/schema.ts firestore.rules utils/firestoreConverters.ts contexts/household/listeners contexts/household/mutations` shows only an unrelated `subBucketId` removal in `transactionMutations.ts` (8 lines) and an unrelated `gamificationMutations.ts`/`schema.ts` reshuffle (freeze-bank Plan 25 work). Nothing touches the transaction/comment surface area described in "Current state". Proceeding.

### 1. Rules diff (DRAFT — NOT applied; ships as its own human-watched PR)

Mirrors the existing `transactions/{transactionId}` block style (`firestore.rules:341-371`) and nests one level deeper. Author-only create; no update (v1 has no edit — simpler, per the plan's own suggestion); author-only delete. `isValidString`/`isValidOptionalString`/`isMemberOf` helpers already exist (`firestore.rules:11-14,32-39`) and are reused as-is.

```
      // Transaction comments (Plan 23) — nested one level under a transaction.
      // Read: any household member. Create: author-only, 500-char cap. No
      // update in v1 (simpler than partial-edit rules). Delete: author-only.
      match /transactions/{transactionId}/comments/{commentId} {
        allow read: if isMemberOf(householdId);
        allow create: if isMemberOf(householdId) &&
                      request.resource.data.authorUid == request.auth.uid &&
                      isValidString(request.resource.data.text, 500) &&
                      isValidString(request.resource.data.createdAt, 30);
        allow delete: if isMemberOf(householdId) &&
                      resource.data.authorUid == request.auth.uid;
      }
```

Also required in the SAME rules PR: the parent `transactions/{transactionId}` `allow create, update` validator (`firestore.rules:344-368`) must accept the new optional `commentCount` field, e.g. add
`isValidOptionalNumber(request.resource.data.get('commentCount', null)) &&`
to its condition list — otherwise the batched `commentCount` increment on the transaction doc is rejected by the existing SENTINEL validator once rules deploy. (Today, with NO rule for the subcollection, `allow create` on the parent still runs but Firestore rejects the whole batch if we ever add a real rules check on `commentCount`'s type — noted for the rules-PR author.)

### 2. Detail surfaces (Step A.2)

Only **one** stable, revisitable detail view exists for a transaction: `components/modals/EditTransactionModal.tsx` (opened by clicking a row's Edit affordance in `TransactionMasterList` → `TransactionItem`, `components/budget/TransactionItem.tsx:125`). It renders inside a `Drawer` and stays keyed to a single `transaction` prop across opens — a legitimate "detail" surface.

`components/transactions/TransactionReviewForm.tsx` (rendered inside `ReviewPendingDrawer`) is NOT a comparable detail surface — it's a one-shot approve/categorize flow for `pending_review` rows (`onDone`/`onDeleted` callbacks that close and advance to the next pending item; `components/transactions/TransactionReviewForm.tsx:53-60`). A user doesn't return to it to re-read a conversation. **Decision: comment thread ships in `EditTransactionModal` only for v1**; `TransactionReviewForm` is out of scope (noted as a v2 candidate below, not in the original list — added).

Both surfaces consume `useFinance()` (`updateTransaction`, `buckets`, `accounts`) — the new fetch/add/delete comment methods are added to the same slice.

### 3. CountBadge (Step A.3)

`components/ui/CountBadge.tsx` exists but is purpose-built as an **absolute-positioned overlay** on top of an icon (`absolute -top-1.5 -right-2 ... ring-2`, `aria-hidden`), used today only by `BottomNav`/`TopToolbar` nav icons. It is NOT a fit for an inline row indicator next to merchant/date/category text — reusing it would require a `relative` wrapper and its ring/pill styling reads as a notification dot, not a content count. **Decision: do not reuse `CountBadge`; add a small inline `MessageSquare` icon + number, styled like the existing inline date/category/store metadata row** (`components/budget/TransactionItem.tsx:89-99`, the `·`-separated secondary line), rendered only when `commentCount > 0`. This is more consistent with how the row already surfaces secondary metadata (recurring icon, store chip) than bolting on a notification-style badge.

### 4. Composer + empty state (Step A.4)

Composer is a plain inline `Input` + `Button` (send), NOT `QuickAddBar` — `QuickAddBar` (`components/ui/QuickAddBar.tsx`) is shopping-list-specific (multi-quick-list dropdown target) and has no analog need here; a transaction has exactly one comment thread. Empty-state copy: **"No comments yet. Add one if you want to flag or explain this transaction."** Composer disabled while `isSaving`/posting, matching `EditTransactionModal`'s existing `isSaving` gating pattern.

### 5. Sequencing decision (Step B note)

**Ship the UI dark**, not gated behind the rules PR landing first: the comment thread section always renders inside `EditTransactionModal` (list + composer), but until the rules PR deploys, any `getDocs`/`addDoc`/`deleteDoc` call against `transactions/{id}/comments` will reject with `permission-denied` (no rule = default deny) — expected per the operator amendment, NOT a UI hide. Rationale: hiding the composer behind a flag would need its own flag/env plumbing that has to be un-done again the moment rules ship, for a code path that fails safely (caught, toasted, no data corruption) in the interim. Test Mode (`MockHouseholdContext`) fully implements comments in-memory so the orchestrator can visually verify the whole feature NOW, independent of prod rules. `commentCount` badge itself is read-only display and un-gated (reads `Transaction.commentCount`, which is `undefined`/0 until the first comment is ever written — harmless pre-rules).

### STOP conditions — none triggered

- Did not touch `firestore.rules`.
- `EditTransactionModal` is a stable, non-virtualized detail view — no STOP.
- No standing listener added — `getTransactionComments`/`addTransactionComment`/`deleteTransactionComment` are `getDocs`/`addDoc`(via batch)/`deleteDoc`(via batch) one-shot calls, mirroring `getHabitSubmissions` (`hooks/useHabitActions.tsx:494-524`).
