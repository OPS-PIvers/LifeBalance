import React from 'react';
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
}) => {
  const { accounts } = useFinance();
  const fmt = useFormatCurrency();
  const payable = accounts.filter(a => a.type !== 'credit');

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={title}>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-4 leading-relaxed">{description}</p>
      <div className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
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
