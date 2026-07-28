import React, { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { addMonths, subMonths, parseISO, format as formatDate } from 'date-fns';

import type { Transaction } from '@/types/schema';
import { useExpandedCalendarItems, useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useSettleBill } from '@/hooks/useSettleBill';
import { getBillLinkCandidates } from '@/utils/billLinkCandidates';
import { suggestAccountForCalendarItem } from '@/utils/actionQueueSmart';
import { Button } from '@/components/ui/Button';
import AccountPicker from '@/components/budget/AccountPicker';

export interface SettleBillSectionProps {
  transaction: Transaction;
  /**
   * The unpaid bill this charge was RECOGNISED as paying — `useActionQueue`'s
   * `matchedBills` entry, when the shared descriptor matcher linked the two.
   * Pre-selects that bill so the common case is one tap. Absent for everything
   * else, which is most of the time: the motivating Centerpoint case does NOT
   * match (the alias tier sits behind a ±10%/±$25 amount guard a variable
   * utility bill fails), which is exactly why the picker below is offered on
   * ANY transaction rather than only on matched ones.
   */
  matchedBill?: { id: string; title: string };
  /** Called after a settle actually committed — the host closes its drawer. */
  onSettled: () => void;
}

/**
 * "This IS that bill" — the transaction-side entry point for
 * `settleBillWithTransaction` (TODO.md 2H(a)).
 *
 * Distinct from the sibling "Link to bill" card in `TransactionReviewForm`,
 * which drives `linkBankTransactionToBill`: that one writes NO balance delta and
 * is therefore only correct for a bank-synced row whose balance is already
 * authoritative. This one is for every OTHER row — notably the `pending_review`
 * screenshot imports that motivated the feature — and DOES move the balance. The
 * two are mutually exclusive by construction (see the `canLinkToBill` gate in
 * the host), so a row never offers both.
 */
export const SettleBillSection: React.FC<SettleBillSectionProps> = ({
  transaction,
  matchedBill,
  onSettled,
}) => {
  const { accounts, transactions } = useFinance();
  const fmt = useFormatCurrency();
  const [showPicker, setShowPicker] = useState(false);
  // The bill a settle is currently running for — kept only so the account
  // suggestion can key on the BILL's title ("the account you paid this bill
  // from last time"), the same signal payCalendarItem's swipe-approve uses.
  const [pendingBillTitle, setPendingBillTitle] = useState('');
  const { begin, busy, needsAccount, confirmAccount, cancel } = useSettleBill(onSettled);

  // Anchored on the TRANSACTION's own date (not "today") so a charge imported
  // weeks later still finds the bill it was actually due against. Collapsed, the
  // window is degenerate (a same-instant range expands nothing) — hooks can't be
  // conditional, and this keeps the common case free. Mirrors the sibling
  // "Link to bill" block's approach in TransactionReviewForm.
  const windowStart = useMemo(
    () => (showPicker ? subMonths(parseISO(transaction.date), 1) : parseISO(transaction.date)),
    [showPicker, transaction.date],
  );
  const windowEnd = useMemo(
    () => (showPicker ? addMonths(parseISO(transaction.date), 1) : parseISO(transaction.date)),
    [showPicker, transaction.date],
  );
  const expandedItems = useExpandedCalendarItems(windowStart, windowEnd);
  const billCandidates = useMemo(
    () => (showPicker ? getBillLinkCandidates(expandedItems) : []),
    [showPicker, expandedItems],
  );

  // Pre-selection for the AccountPicker: the bill's own tag, then the account a
  // same-titled bill was last paid from, then checking. The user still confirms
  // — this write moves real money, so it is a suggestion, never a silent guess.
  const suggestedAccount = useMemo(
    () => (needsAccount
      ? suggestAccountForCalendarItem(
          { title: pendingBillTitle || transaction.merchant },
          accounts,
          transactions,
        )
      : undefined),
    [needsAccount, pendingBillTitle, transaction.merchant, accounts, transactions],
  );

  const settle = (calendarItemId: string, billTitle: string) => {
    setShowPicker(false);
    setPendingBillTitle(billTitle);
    begin({ transactionId: transaction.id, calendarItemId });
  };

  return (
    <div className="rounded-card border border-accent-200 bg-accent-50 px-3 py-2.5 space-y-2 dark:border-accent-700 dark:bg-accent-800/20">
      {!showPicker ? (
        matchedBill ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs text-accent-700 dark:text-accent-200">
              <Link2 size={14} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                Looks like this pays <span className="font-semibold">{matchedBill.title}</span>.
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => settle(matchedBill.id, matchedBill.title)}
                className="flex-1 text-xs"
              >
                This IS that bill
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setShowPicker(true)}
                className="flex-1 text-xs"
              >
                Pick another
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="link"
            size="md"
            disabled={busy}
            onClick={() => setShowPicker(true)}
            className="w-full justify-start gap-2 text-xs font-semibold text-accent-700 no-underline hover:no-underline dark:text-accent-200"
            leftIcon={<Link2 size={14} className="shrink-0" aria-hidden="true" />}
          >
            Is this a planned bill? Mark it paid
          </Button>
        )
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-700 dark:text-accent-200">
              <Link2 size={14} className="shrink-0" aria-hidden="true" />
              Pick the bill this pays
            </p>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowPicker(false)}
              className="text-xs text-brand-500 no-underline hover:no-underline dark:text-brand-400"
            >
              Cancel
            </Button>
          </div>
          {billCandidates.length === 0 ? (
            <p className="text-xs text-brand-500 dark:text-brand-400">
              No unpaid bills found in the last/next month.
            </p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {billCandidates.map(bill => (
                <Button
                  key={bill.id}
                  variant="outline"
                  size="md"
                  disabled={busy}
                  onClick={() => settle(bill.id, bill.title)}
                  className="w-full min-h-11 justify-between gap-2 bg-white text-left font-normal dark:bg-brand-700/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-brand-800 dark:text-brand-100">
                      {bill.title}
                    </span>
                    <span className="block text-xs text-brand-400 dark:text-brand-450">
                      {formatDate(parseISO(bill.date), 'MMM d, yyyy')}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50">
                    {fmt(bill.amount)}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* This write moves real money out of an account, and an untagged
          transaction doesn't say which — so confirm rather than guess. */}
      <AccountPicker
        isOpen={needsAccount}
        onClose={cancel}
        onSelect={(accountId) => confirmAccount(accountId)}
        title="Which account paid this?"
        description="Marking the bill paid moves this charge out of an account. Pick the one it came from."
        topAction={suggestedAccount ? {
          label: `Use ${suggestedAccount.name}`,
          description: 'Suggested from how this bill was paid before.',
          onSelect: () => confirmAccount(suggestedAccount.id),
        } : undefined}
      />
    </div>
  );
};

export default SettleBillSection;
