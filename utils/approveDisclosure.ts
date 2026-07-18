/**
 * Pre-commit disclosure for the Action Queue's one-swipe approve (Nielsen #5,
 * error prevention): a swipe-approve commits real money against a
 * smart-guessed account, so the approve rail (and the post-approve toast)
 * must say WHAT will be committed — amount and target account — instead of a
 * bare check icon.
 *
 * Pure + dependency-light like `utils/actionQueueSmart.ts`: data in, label
 * out. Currency formatting is the caller's job (`useFormatCurrency`), so
 * these helpers take an already-formatted amount label.
 */
import type { Account, CalendarItem, Transaction } from '@/types/schema';
import { suggestAccountForCalendarItem, suggestAccountIdForTransaction } from '@/utils/actionQueueSmart';
import { resolveTargetAccount } from '@/utils/accountImpact';

/**
 * The account a swipe-approved pending TRANSACTION's balance impact will land
 * on — mirrors `handleSwipeApprove` + `updateTransactionCategory` exactly:
 * the smart suggestion fills a missing tag, an existing tag is kept, and an
 * untagged transaction falls back to checking via `resolveTargetAccount`.
 * `undefined` only when no checking account exists either.
 */
export function approveTargetAccountForTransaction(
  tx: Pick<Transaction, 'merchant' | 'store' | 'accountId'>,
  accounts: Account[],
  transactions: readonly Transaction[]
): Account | undefined {
  const suggestedId = suggestAccountIdForTransaction(tx, accounts, transactions);
  return resolveTargetAccount(suggestedId ?? tx.accountId, accounts);
}

/**
 * Join an amount label and an account name into the rail/toast disclosure:
 * `"$12.40 → Joint Checking"` (transactions/income) or
 * `"$12.40 from Joint Checking"` (bills paid out of an account). With no
 * resolvable account the amount stands alone — still more reassuring than a
 * bare check icon.
 */
export function approveDetailLabel(
  amountLabel: string,
  accountName: string | undefined,
  direction: 'to' | 'from' = 'to'
): string {
  if (!accountName) return amountLabel;
  return direction === 'from'
    ? `${amountLabel} from ${accountName}`
    : `${amountLabel} → ${accountName}`;
}

/**
 * The rail disclosure for a swipe-approvable calendar BILL/income: the amount
 * plus the account `suggestAccountForCalendarItem` will pay it from (expenses
 * read "from", income reads "→").
 */
export function calendarApproveDetail(
  item: Pick<CalendarItem, 'title' | 'accountId' | 'type'> & { amount: number },
  accounts: Account[],
  transactions: readonly Transaction[],
  amountLabel: string
): string {
  const account = suggestAccountForCalendarItem(item, accounts, transactions);
  return approveDetailLabel(amountLabel, account?.name, item.type === 'expense' ? 'from' : 'to');
}

/** Post-approve toast body: `"Approved $12.40 → Joint Checking"`. */
export function approvedToastMessage(amountLabel: string, accountName: string | undefined): string {
  return `Approved ${approveDetailLabel(amountLabel, accountName)}`;
}
