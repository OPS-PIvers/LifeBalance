# firestore.rules hand-off — plans 23 & 24

These two `firestore.rules` changes were **deliberately NOT applied** in the app
PRs (#861 comments, #862 savings goals), per this repo's rule that any
`firestore.rules` change ships in its own human-watched PR with the emulator
tests and a watched atomic deploy. Apply them as **one** rules PR when ready.

## Urgency

| Plan | Feature works before this rules PR? | Why |
|------|-------------------------------------|-----|
| 23 — transaction comments | **NO — required** | Comments live at `households/{hid}/transactions/{tid}/comments/{cid}` (4 levels deep). The household catch-all `match /{subcollection}/{document}` is only 2 levels and `transactions` is on its exclusion list, so the comments path is **default-denied**. Until this rules PR deploys, the comment UI renders but every fetch/post/delete is denied and toasts a failure (by design). |
| 24 — savings goals | **YES — hardening only** | `savingsGoals` is NOT on the catch-all exclusion list, so members can already read/write it today (no field validation). This diff *tightens* it to per-field validation and adds it to the exclusion list so the validated block is the sole path. Not launch-blocking. |

## Deploy steps

1. Branch from `main`, edit `firestore.rules` with both diffs below.
2. Run the emulator rules tests (`pnpm test:rules` — CI-only per the repo's
   Windows-loopback constraint; let CI run them).
3. Open the PR, watch the atomic deploy, verify: post a comment on a
   transaction (should succeed now) and confirm a >500-char comment or a
   non-author delete is rejected; create/contribute to a savings goal and
   confirm a malformed write (negative `targetAmount`) is rejected.

---

## Plan 23 diff (transaction comments)

Insert a nested match block under the existing
`households/{householdId}/transactions/{transactionId}` block (after its closing
`}`), reusing the existing `isMemberOf` / `isValidString` helpers:

```
      // Transaction comments (Plan 23) — nested one level under a transaction.
      // Read: any household member. Create: author-only, 500-char cap. No
      // update in v1. Delete: author-only.
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

Also extend the parent `transactions/{transactionId}` `allow create, update`
validator to accept the new optional `commentCount` field (the client
batch-bumps it alongside each comment write), e.g. add to its condition list:

```
   isValidOptionalNumber(request.resource.data.get('commentCount', null)) &&
```

(`isValidOptionalNumber` already exists.) Without this, once/if the parent rule
is tightened to a field whitelist, the `commentCount` increment would be
rejected.

---

## Plan 24 diff (savings goals)

The full drafted block (explicit `savingsGoals` match with create/update-diff
validation mirroring accounts/buckets, plus adding `savingsGoals` to the
catch-all write-exclusion list) is in the plan-24 executor report. Key points
for the rules author:

- New `match /savingsGoals/{goalId}` with `isValidSavingsGoalCreate` /
  `isValidSavingsGoalUpdate` helpers: `name` (≤100), `targetAmount`/`savedAmount`
  non-negative numbers, optional `dueDate`/`ownerId`/`color`, immutable
  `createdAt`, optional `completedAt`.
- Add `subcollection != 'savingsGoals' &&` to the catch-all `allow write` list
  (line ~818, next to `rewards`) so the explicit validated block is the only
  write path.
- This constrains an already-writable collection; it does not newly open it.
