import { Store } from '@/types/schema';

/**
 * The shared "does this merchant name refer to a known store?" rule, extracted
 * from EditTransactionModal and CaptureTransactionManual so both surfaces agree.
 *
 * A trimmed, case-insensitive EXACT match against a known store's name snaps to
 * that store's canonical (stored-cased) name — so the TransactionMasterList
 * store filter keeps working — otherwise `undefined`. Callers layer their own
 * fallback on top (e.g. preserving an existing `Transaction.store`).
 */
export function resolveStoreName(
  stores: ReadonlyArray<Pick<Store, 'name'>>,
  merchantValue: string,
): string | undefined {
  const trimmed = merchantValue.trim().toLowerCase();
  if (!trimmed) return undefined;
  return stores.find(s => s.name.trim().toLowerCase() === trimmed)?.name;
}
