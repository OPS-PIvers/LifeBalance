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
 * Resolve the account a transaction's balance impact lands on: the tagged
 * account when it exists, otherwise the checking account (backward compatible
 * with untagged transactions). When a transaction is tagged to an account that
 * has since been deleted, the impact also falls back to checking so the delta
 * still lands somewhere sane.
 */
export function resolveTargetAccount(
  accountId: string | undefined,
  accounts: Account[]
): Account | undefined {
  if (accountId) {
    const tagged = accounts.find(a => a.id === accountId);
    if (tagged) return tagged;
    // Tagged account was deleted: fall through to checking.
  }
  return accounts.find(a => a.type === 'checking');
}
