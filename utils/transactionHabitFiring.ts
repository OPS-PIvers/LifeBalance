import { Habit, Transaction } from '@/types/schema';
import { findMatchingHabits } from '@/utils/habitKeywordMatch';
import { attributionString } from '@/utils/habitTriggers';

/**
 * Habit Automations (PRD #1065) — transaction-keyword firing selection.
 *
 * Glue between the pure foundation utils (`habitKeywordMatch`, `habitTriggers`)
 * and the transaction-review surfaces. All pure — no Firestore, no clock, no
 * side effects — so the review-card chip pre-check, the swipe-approve path, and
 * `updateTransactionCategory`'s dedup all agree on exactly which habits fire.
 */

/**
 * The habit ids whose keywords match a transaction's merchant/title or notes —
 * the set pre-checked as "Also logs: …" chips on the review card. Order follows
 * the input `habits` array. Excludes archived habits (an archived habit should
 * never be auto-suggested).
 */
export function keywordMatchedHabitIds(
  habits: Habit[],
  transaction: Pick<Transaction, 'merchant' | 'notes'>,
): string[] {
  return findMatchingHabits(
    habits.filter(h => !h.archivedAt),
    { merchant: transaction.merchant, notes: transaction.notes },
  ).map(h => h.id);
}

/**
 * Given the habit ids a review/approve wants to fire and the ids this
 * transaction has ALREADY fired, return the ids that should fire NOW (the
 * dedup — each transaction fires a given habit at most once) alongside the
 * next persisted fired-ledger (the union). Preserves the order of
 * `requestedHabitIds` and de-duplicates repeats within it.
 */
export function selectHabitsToFire(
  requestedHabitIds: readonly string[],
  alreadyFiredHabitIds: readonly string[],
): { toFire: string[]; nextFired: string[] } {
  const already = new Set(alreadyFiredHabitIds);
  const seen = new Set<string>();
  const toFire: string[] = [];
  for (const id of requestedHabitIds) {
    if (already.has(id) || seen.has(id)) continue;
    seen.add(id);
    toFire.push(id);
  }
  return { toFire, nextFired: [...alreadyFiredHabitIds, ...toFire] };
}

/**
 * The attribution string for a transaction-fired habit, e.g.
 * "via transaction: TARGET T-1234". Falls back to a bare label for an
 * empty/absent merchant so the toast/activity tag is never a dangling prefix.
 */
export function transactionAttribution(merchant: string | undefined): string {
  const label = (merchant ?? '').trim() || 'transaction';
  return attributionString({ type: 'transaction', transactionId: '', habitId: '', label }) ?? `via transaction: ${label}`;
}
