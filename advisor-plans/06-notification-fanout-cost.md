# Plan 06 — Notification Fan-out Cost Fix

**Impact:** MED today, HIGH at any real user count (reads scale as
`households × members × 24/day × 3 jobs`) · **Effort:** M (2–3 days incl. migration)
· **Risk:** MED (data migration + deploy ordering on an atomic-deploy prod)
· **Confidence:** HIGH

## Verified current state (2026-07-04)

Four scheduled jobs in `functions/src/index.ts` each do a **full collection scan every
hour**: `db.collection("households").get()` at lines **183** (`sendhabitreminders`),
**235** (`sendactionqueuereminders`), **313** (`sendstreakwarnings`), **481**
(`sendbillreminders`) — then fetch every household's `members` subcollection and filter
in memory on `member.notificationPreferences` (see the loop at `:186-205`). Almost every
read is discarded: most members have the pref off, no tokens, or a non-matching hour.

Prior art (context, both unshipped): `todo/04-notification-scan.md` proposed a
denormalized UTC-hour timeslot (DST-unsafe); `plans/064-notification-scan-cost.md`
improved it to a boolean + collection-group query. This plan supersedes both — same core
idea, minimal field surface, DST handled where it's cheap (in the function, not the data).

## Design

### A. Denormalize one boolean per member: `anyNotificationsEnabled`

- `true` iff any of `habitReminders/actionQueueReminders/streakWarnings/billReminders`
  `.enabled` is true AND `fcmTokens` is non-empty.
- Maintained in exactly two writers: the Settings save path
  (`components/settings/NotificationSettings.tsx` → wherever `notificationPreferences` is
  persisted in `contexts/FirebaseHouseholdContext.tsx`) and the FCM token
  register/cleanup paths (`services/notificationService.ts` + the token-pruning code in
  `functions/src/index.ts`'s send helper). Compute it with one shared pure helper
  (client copy in `utils/`, server copy in `functions/src/` — the repo's established
  duplication pattern) so the writers can't drift.
- **Deliberately NOT a per-hour timeslot.** The DST bugs and the migration complexity of
  hour-encoding outweigh the savings: the boolean already eliminates the dominant waste
  (the all-households × all-members scan). Hour-matching stays in-function via the
  existing `isTimeToSend(prefs.X.time, prefs.timezone)` logic, which is already
  timezone-correct per member.

### B. Collection-group query in the four jobs

Replace each full scan with:

```ts
const snap = await db.collectionGroup("members")
  .where("anyNotificationsEnabled", "==", true).get();
// derive householdId from doc.ref.parent.parent, batch-load only those households
// (bill/streak jobs need household data; habit/action-queue jobs may need less — load lazily)
```

Requires a collection-group index on `members.anyNotificationsEnabled` — add to
`firestore.indexes.json`. Also verify `firestore.rules` — collection-group reads by the
Admin SDK bypass rules, so no rules change is needed; do not add one.

### C. Backfill migration

One-off callable (pattern: `utils/migrations/` client-side precedent, but this one is
server data → write it as a guarded callable or a temporary script under
`functions/src/migrations/`, admin-gated): iterate all members once, compute + write the
flag. Idempotent, logged, safe to re-run.

## Deploy ordering (the part that bites)

1. **PR-1:** field maintenance (both writers) + backfill callable + index in
   `firestore.indexes.json`. Deploy; **human runs the backfill and confirms** the index
   reached *Enabled* in the console (atomic deploys don't wait for index builds).
2. **PR-2:** switch the four jobs to the collection-group query. Deploy only after PR-1's
   backfill + index are verified. Keep a `FALLBACK_FULL_SCAN` env/flag branch for one
   release so a bad backfill degrades to current behavior, then remove it.

New-member docs created between PR-1 deploy and backfill get the flag from the writer
paths; members whose docs predate PR-1 and are never re-saved are covered by the backfill.
The failure mode to test explicitly: member with notifications enabled but flag missing →
must still receive reminders until backfill completes (hence the fallback branch).

## Verification & done criteria

- Unit: the shared `computeAnyNotificationsEnabled` helper (both copies) — pref
  combinations × token presence.
- Emulator: seed 3 households (one enabled member, one disabled, one token-less); run each
  job; only the enabled member is considered; reads counted via emulator logs.
- `pnpm lint:all && pnpm test` green; functions build clean.
- Post-deploy: compare Firestore read counts in the Cloud console for one hourly cycle
  before/after (expect ≥90% reduction with current data).
- `todo/04-notification-scan.md` and `plans/064-notification-scan-cost.md` bannered
  "superseded by advisor-plans/06".

## Out of scope

`sendbudgetalerts` (line 589 — it's a Firestore **trigger**, not a scan; already fine),
recap scheduling (Plan 02 should adopt the same collection-group pattern from day one),
per-hour timeslot optimization (revisit only if read costs matter again after this).
