import { Account, Transaction, INCOME_CATEGORY } from '@/types/schema';

/**
 * The minimal transaction shape needed to compute a balance impact. Accepting a
 * structural type (rather than a full `Transaction`) lets callers compute the
 * impact of a *prospective* transaction (e.g. mid-edit) without constructing one.
 */
export interface ImpactTransaction {
  amount: number;
  category: string;
  creditPayment?: boolean;
}

/**
 * Signed balance impact of a transaction ON A SPECIFIC ACCOUNT.
 *
 * Asset accounts (checking/savings) and an UNTAGGED transaction (account
 * `undefined` ⇒ defaults to checking/asset semantics): income credits
 * (+amount), expense debits (−amount). This is the legacy whole-app rule.
 *
 * Credit accounts (liability; balance is debt owed, stored POSITIVE):
 *   - a charge (`creditPayment !== true`) INCREASES the debt (+amount)
 *   - a payment (`creditPayment === true`) DECREASES the debt (−amount)
 *   `INCOME_CATEGORY` is irrelevant on a credit account (a card cannot receive a
 *   paycheck); such a transaction is treated as a charge.
 */
export function accountImpactOf(
  tx: ImpactTransaction,
  account: Pick<Account, 'type'> | undefined
): number {
  if (account?.type === 'credit') {
    return tx.creditPayment === true ? -tx.amount : tx.amount;
  }
  // Asset account or untagged → legacy checking semantics.
  return tx.category === INCOME_CATEGORY ? tx.amount : -tx.amount;
}

/**
 * {@link accountImpactOf} gated on `verified` status: a `pending_review`
 * transaction has not yet touched any balance, so its effective impact is 0.
 */
export function effectiveAccountImpact(
  tx: ImpactTransaction & { status: Transaction['status'] },
  account: Pick<Account, 'type'> | undefined
): number {
  return tx.status === 'verified' ? accountImpactOf(tx, account) : 0;
}

/**
 * A row written by the nightly bank-email sync (bankEmailSync Cloud Function).
 * Matches the FilterControls "Bank Sync" arm convention: `source === 'bank-sync'`
 * OR a `bankRef` present (the sync also stamps `bankRef` onto rows it
 * fills/confirms that were originally created by another source).
 *
 * WHY IT MATTERS FOR BALANCES: bank-sync rows are born `verified`, but their
 * account balance was NOT accumulated from the row — the sync sets the account
 * balance authoritatively to the bank email's ENDING BALANCE, which already
 * reflects the transaction. So client-side balance bookkeeping (the
 * reverse/apply deltas on delete, amount edit, merge, and trash restore) must
 * SKIP these rows entirely: deleting one doesn't make the money reappear at the
 * bank, and editing its amount doesn't change what the bank said the balance
 * is. The bank's stated balance stays correct either way.
 */
export function isBankSyncTransaction(
  tx: Pick<Transaction, 'source'> & { bankRef?: string }
): boolean {
  // Truthy check (not `!== undefined`) so a malformed empty-string bankRef
  // doesn't classify a row as bank-sync.
  return tx.source === 'bank-sync' || !!tx.bankRef;
}

/**
 * The account whose balance is currently AUTHORITATIVE for a bank-sync row —
 * i.e. the account the nightly sync's ending-balance write applies to. Not a
 * per-account property: it travels with the ROW, and only the account that
 * matched it AT THE TIME OF ITS FIRST CLIENT EDIT is exempt from delta
 * bookkeeping; a subsequent re-tag to a different (manual) account is
 * ordinary bookkeeping on that account like any other transaction.
 *
 * Returns `undefined` for a non-bank-sync row (nothing is exempt). For a
 * bank-sync row, returns the persisted `bankSyncAccountId` when the row has
 * already been stamped (see `types/schema.ts`), else falls back to
 * `fallbackAccountId` — the caller passes the row's CURRENTLY-resolved
 * account id, which is correct for an as-yet-unstamped/unretagged row (the
 * bank account itself) and is also what a mutation should stamp onto the doc
 * the first time it edits such a row.
 */
export function bankSyncHomeAccountId(
  tx: Pick<Transaction, 'source' | 'bankSyncAccountId'> & { bankRef?: string },
  fallbackAccountId: string | undefined
): string | undefined {
  if (!isBankSyncTransaction(tx)) return undefined;
  return tx.bankSyncAccountId ?? fallbackAccountId;
}

/**
 * Whether a balance delta destined for `targetAccountId` must be SKIPPED
 * because that account is the bank-sync row's authoritative home (its
 * balance already reflects the row via the nightly email sync — see
 * `isBankSyncTransaction`). Any OTHER account (a manual re-tag destination)
 * is ordinary client-accumulated bookkeeping and must receive its delta
 * normally — this is the per-target (not per-row) skip that fixes the
 * under-count where re-tagging a bank-sync row to a different account used
 * to silently drop its impact everywhere.
 */
export function shouldSkipBankSyncDelta(
  tx: Pick<Transaction, 'source' | 'bankSyncAccountId'> & { bankRef?: string },
  targetAccountId: string | undefined,
  fallbackHomeAccountId: string | undefined
): boolean {
  if (!targetAccountId) return false;
  const homeId = bankSyncHomeAccountId(tx, fallbackHomeAccountId);
  return homeId !== undefined && homeId === targetAccountId;
}

/**
 * Resolve the account a transaction's balance impact lands on: the tagged
 * account when it exists, otherwise the household's default account, otherwise
 * the checking account (backward compatible with untagged transactions). When a
 * transaction is tagged to an account that has since been deleted, the impact
 * also falls back the same way so the delta still lands somewhere sane.
 *
 * `defaultAccountId` is `Household.defaultAccountId` — optional and absent for
 * every legacy household, in which case this behaves exactly as it always has.
 * A default pointing at a deleted account is ignored (checking fallback).
 */
export function resolveTargetAccount(
  accountId: string | undefined,
  accounts: Account[],
  defaultAccountId?: string
): Account | undefined {
  if (accountId) {
    const tagged = accounts.find(a => a.id === accountId);
    if (tagged) return tagged;
    // Tagged account was deleted: fall through to the default/checking.
  }
  if (defaultAccountId) {
    const preferred = accounts.find(a => a.id === defaultAccountId);
    if (preferred) return preferred;
  }
  return accounts.find(a => a.type === 'checking');
}
