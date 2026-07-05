/**
 * Pure helper for the Plaid advisory-balance affordance (plan 04, section B).
 *
 * The app's manual `Account.balance` stays authoritative — a linked account
 * additionally carries `plaidBalanceCurrent`/`plaidBalanceAvailable`/
 * `plaidBalanceUpdatedAt` (written server-side by `plaidsynctransactions`; see
 * CLAUDE.md Atomicity notes — this never touches the manual field). The
 * budget account card offers a one-tap "Update to bank balance" chip only
 * when the two values have actually diverged by a meaningful amount, so
 * pennies of Plaid-vs-manual rounding noise doesn't nag the user constantly.
 */
import { subtractMoney } from '@/utils/money';
import type { Account } from '@/types/schema';

/** Minimum dollar difference between the manual and Plaid balances before the
 *  "Update to bank balance" affordance is offered. */
export const PLAID_BALANCE_DIVERGENCE_THRESHOLD = 1;

/**
 * Whether the advisory "Update to bank balance $X" chip should render for
 * this account: it must carry a Plaid current-balance reading, and that
 * reading must differ from the manual balance by more than the threshold.
 */
export function shouldOfferBalanceAdoption(account: Account): boolean {
  if (typeof account.plaidBalanceCurrent !== 'number') return false;
  const diff = Math.abs(subtractMoney(account.plaidBalanceCurrent, account.balance));
  return diff > PLAID_BALANCE_DIVERGENCE_THRESHOLD;
}
