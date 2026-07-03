import React from 'react';
import { Sparkles } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';

interface AccountPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen account id. The caller closes the picker. */
  onSelect: (accountId: string) => void;
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
 * Bottom-sheet picker of non-credit (checking/savings) accounts. Shared by the
 * Home and Money "Confirm Payment" flows, which were previously duplicated,
 * near-verbatim hand-rolled centered cards. Pulls accounts + currency formatting
 * internally so call sites stay tiny.
 */
export const AccountPicker: React.FC<AccountPickerProps> = ({
  isOpen,
  onClose,
  onSelect,
  title = 'Confirm payment',
  description = 'Select which account to deduct this payment from.',
  topAction,
}) => {
  const { accounts } = useFinance();
  const fmt = useFormatCurrency();
  const payable = accounts.filter(a => a.type !== 'credit');

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={title}>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-4 leading-relaxed">{description}</p>
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
            onClick={() => onSelect(acc.id)}
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
          <div className="px-4 py-6 text-sm text-center text-brand-400 dark:text-brand-500">
            No checking or savings accounts available.
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default AccountPicker;
