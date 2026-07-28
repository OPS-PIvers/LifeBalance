import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';

interface AccountPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen account id. When `editableAmount` is set, the
   *  second arg carries the (possibly tweaked) amount the user confirmed.
   *  The caller closes the picker. */
  onSelect: (accountId: string, amount?: number) => void;
  /** When set, an "Amount" field is shown above the account list, pre-filled
   *  with this value and editable — so a variable bill can be paid with what
   *  was actually charged without a detour through the calendar editor. */
  editableAmount?: number;
  /**
   * Include CREDIT accounts in the list. Default `false`, which is correct for
   * the bill-pay flow this picker was built for (`payCalendarItem` pays a bill
   * FROM checking/savings — a credit card is not a source of funds there).
   *
   * The settle flow ("this charge IS that bill") is the opposite case: the
   * charge has ALREADY happened and the question is which account it hit, which
   * may well be a card — `settleBillWithTransaction` routes a credit-tagged row
   * through `effectiveAccountImpact` and signs it as card debt. Excluding cards
   * there silently debited CHECKING for a card-charged bill.
   */
  includeCredit?: boolean;
  title?: string;
  description?: string;
  /** Optional highlighted first row rendered ABOVE the account list — used by
   *  the Action Queue's bulk approve for "Smart assign (recommended)", where
   *  each item gets its own history-suggested account instead of one shared
   *  override. The caller closes the picker. */
  topAction?: {
    label: string;
    description?: string;
    onSelect: () => void;
  };
}

/**
 * Bottom-sheet picker of accounts — non-credit (checking/savings) by default,
 * or every account when `includeCredit` is set. Shared by the Home and Money
 * "Confirm Payment" flows, which were previously duplicated, near-verbatim
 * hand-rolled centered cards. Pulls accounts + currency formatting internally so
 * call sites stay tiny.
 */
export const AccountPicker: React.FC<AccountPickerProps> = ({
  isOpen,
  onClose,
  onSelect,
  editableAmount,
  includeCredit = false,
  title = 'Confirm payment',
  description = 'Select which account to deduct this payment from.',
  topAction,
}) => {
  const { accounts } = useFinance();
  const fmt = useFormatCurrency();
  const payable = includeCredit ? accounts : accounts.filter(a => a.type !== 'credit');

  // Amount is kept as the raw input string so partial entries ("12.") don't
  // fight the user; re-seeded on each open transition (render-time derived
  // state — the React-sanctioned alternative to setState-in-effect).
  const [amountInput, setAmountInput] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen && editableAmount !== undefined) setAmountInput(String(editableAmount));
  }

  const parsedAmount = parseFloat(amountInput);
  const amountValid = editableAmount === undefined || (Number.isFinite(parsedAmount) && parsedAmount > 0);
  const confirm = (accountId: string) => {
    if (!amountValid) return;
    onSelect(accountId, editableAmount !== undefined ? parsedAmount : undefined);
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={title}>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-4 leading-relaxed">{description}</p>
      {editableAmount !== undefined && (
        <div className="mb-4">
          <label
            htmlFor="account-picker-amount"
            className="block text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-1.5"
          >
            Amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-brand-400 dark:text-brand-450">
              $
            </span>
            <input
              id="account-picker-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amountInput}
              onChange={e => setAmountInput(e.target.value)}
              className="w-full pl-7 pr-3 py-2.5 font-mono tabular-nums text-sm font-semibold rounded-card border border-brand-200 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
            />
          </div>
          {!amountValid && (
            <p className="mt-1 text-xs text-money-neg dark:text-money-negDark">Enter an amount above $0.</p>
          )}
          {amountValid && parsedAmount !== editableAmount && (
            <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
              Scheduled for {fmt(editableAmount)} — paying {fmt(parsedAmount)}.
            </p>
          )}
        </div>
      )}
      <div className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
        {topAction && (
          <button
            onClick={topAction.onSelect}
            className="w-full px-4 py-3.5 flex items-center gap-3 bg-accent-50 dark:bg-accent-800/30 hairline-divider hover:bg-accent-100 dark:hover:bg-accent-800/50 transition-colors duration-(--duration-fast) ease-(--ease-standard) text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            <Sparkles size={16} className="text-accent-600 dark:text-accent-300 shrink-0" />
            <span className="min-w-0">
              <span className="block font-semibold text-sm text-accent-700 dark:text-accent-200">
                {topAction.label}
              </span>
              {topAction.description && (
                <span className="block text-xs text-accent-600/80 dark:text-accent-300/80">
                  {topAction.description}
                </span>
              )}
            </span>
          </button>
        )}
        {payable.map(acc => (
          <button
            key={acc.id}
            onClick={() => confirm(acc.id)}
            className="w-full px-4 py-3.5 flex justify-between items-center bg-white dark:bg-brand-800 hairline-divider hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            <span className="font-semibold text-sm text-brand-700 dark:text-brand-200 group-hover:text-brand-900 dark:group-hover:text-brand-100">
              {acc.name}
            </span>
            <span className="font-mono text-xs tabular-nums text-brand-500 dark:text-brand-400">
              {fmt(acc.balance)}
            </span>
          </button>
        ))}
        {payable.length === 0 && (
          <div className="px-4 py-6 text-sm text-center text-brand-400 dark:text-brand-450">
            {includeCredit ? 'No accounts available.' : 'No checking or savings accounts available.'}
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default AccountPicker;
