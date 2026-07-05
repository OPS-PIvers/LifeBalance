/**
 * Merge policy for two transactions flagged as likely the SAME real-world
 * purchase (`Transaction.possibleDuplicateOf`, set at ingestion time by
 * `utils/transactionIdentity.ts`'s `isLikelyDuplicate` returning `'possible'`
 * — see advisor-plans/03-transaction-identity-reconciliation.md section B).
 *
 * Pure + dependency-light on purpose (mirrors `utils/transactionMatch.ts`):
 * no Firestore, no React — data in, decision out. The context method
 * (`mergeTransactions` in FirebaseHouseholdContext) is the only caller that
 * touches Firestore, applying these updates + the dupe delete + any balance
 * reversal in a single `writeBatch`.
 */
import type { Transaction } from '@/types/schema';

/**
 * Choose which of the two flagged transactions should survive the merge
 * ("keeper") and which should be deleted ("dupe").
 *
 * Precedence (highest first):
 *  1. A user-edited/verified row wins over a still-pending one — `verified`
 *     means a human already confirmed it, so a pending twin should never
 *     displace it.
 *  2. Otherwise, the "richer" row wins — the one carrying more identifying
 *     detail (a tagged `accountId` and/or a non-empty `store`).
 *  3. Otherwise, the earlier-created row wins (stable, since `createdAt` is
 *     set at write time and rarely ties in practice).
 *
 * Deterministic and side-effect-free so the review UI can call it directly to
 * preview which row `mergeTransactions` will keep.
 */
export function pickKeeper(a: Transaction, b: Transaction): { keeper: Transaction; dupe: Transaction } {
  if (a.status !== b.status) {
    return a.status === 'verified' ? { keeper: a, dupe: b } : { keeper: b, dupe: a };
  }

  const richness = (t: Transaction): number => (t.accountId ? 1 : 0) + (t.store ? 1 : 0);
  const richA = richness(a);
  const richB = richness(b);
  if (richA !== richB) {
    return richA > richB ? { keeper: a, dupe: b } : { keeper: b, dupe: a };
  }

  const aCreated = a.createdAt ?? '';
  const bCreated = b.createdAt ?? '';
  if (aCreated && bCreated && aCreated !== bCreated) {
    return aCreated < bCreated ? { keeper: a, dupe: b } : { keeper: b, dupe: a };
  }

  // Fully tied (or no createdAt to compare) — keep `a` for stability.
  return { keeper: a, dupe: b };
}

/**
 * Field-level winner set for merging `dupe` into `keeper`.
 *
 * Returns the Firestore `updateDoc` patch to apply to the KEEPER (the dupe is
 * deleted by the caller in the same batch — this function never deletes).
 * Only fields that need to change are included (Firestore-safe: never writes
 * `undefined`).
 *
 * Union rules (never let the merge silently drop information):
 *  - `plaidTransactionId`: keeper's own value wins; otherwise inherit the
 *    dupe's, so a future Plaid sync still recognizes this row.
 *  - `payPeriodId` / `bucketId` (via `subBucketId`) / receipt linkage
 *    (`store`): keeper's own non-empty value wins; otherwise inherit dupe's.
 *  - `relatedHabitIds`: union of both (deduped), since either row may carry
 *    habit links entered independently.
 *
 * Does NOT include `possibleDuplicateOf` — Firestore rejects a plain
 * `undefined` field value, so the caller (the context's `mergeTransactions`
 * mutation) always clears it separately with the `deleteField()` sentinel
 * rather than through this pure patch.
 */
export function mergeTransactions(keeper: Transaction, dupe: Transaction): Partial<Transaction> {
  const updates: Partial<Transaction> = {};

  if (!keeper.plaidTransactionId && dupe.plaidTransactionId) {
    updates.plaidTransactionId = dupe.plaidTransactionId;
  }
  if (!keeper.payPeriodId && dupe.payPeriodId) {
    updates.payPeriodId = dupe.payPeriodId;
  }
  if (!keeper.subBucketId && dupe.subBucketId) {
    updates.subBucketId = dupe.subBucketId;
  }
  if (!keeper.store && dupe.store) {
    updates.store = dupe.store;
  }
  if (!keeper.accountId && dupe.accountId) {
    updates.accountId = dupe.accountId;
  }
  if (!keeper.notes && dupe.notes) {
    updates.notes = dupe.notes;
  }

  const keeperHabits = keeper.relatedHabitIds ?? [];
  const dupeHabits = dupe.relatedHabitIds ?? [];
  if (dupeHabits.some(id => !keeperHabits.includes(id))) {
    updates.relatedHabitIds = Array.from(new Set([...keeperHabits, ...dupeHabits]));
  }

  return updates;
}
