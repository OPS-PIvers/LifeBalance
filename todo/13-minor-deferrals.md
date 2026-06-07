# 13 — Minor deferrals (low impact, batch in any cleanup PR)

These are small, low-risk items identified during the optimization pass but left out
to keep the wave PRs focused. None change user-visible behavior.

## 13a — Migration effects re-run on every `householdSettings` write
`contexts/FirebaseHouseholdContext.tsx`: the bucket-migration and paycheck-migration
effects depend on the whole `householdSettings` object, which changes on every habit
toggle (points are written to the household doc), so `needsMigration(...)` is
re-evaluated far more often than necessary. The habit-migration effect already uses a
`useRef` run-once guard — apply the same pattern to the other two, and drop the unused
`transactions` dependency from the bucket-migration effect (its body only reads
`buckets`).
- **Acceptance:** each migration check runs at most once per session; no behavior
  change; tests green.

## 13b — Voice-command shopping writes are not batched
`contexts/FirebaseHouseholdContext.tsx` `handleShoppingItems` (voice command path):
after `getDocs` of unpurchased items it issues one `updateDoc`/`addDoc` per parsed
item sequentially. Collect them into a single `writeBatch` (≤500 ops; voice commands
produce far fewer) for atomicity + fewer round-trips.
- **Acceptance:** parsed items are applied in one batch; behavior identical; tests
  green.
