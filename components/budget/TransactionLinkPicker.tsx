import React, { useMemo, useState } from 'react';
import { Link2, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { getTransactionLinkCandidates } from '@/utils/transactionLinkCandidates';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';

export interface TransactionLinkPickerProps {
  /** The bill occurrence's due date (`yyyy-MM-dd`) — the candidate sort anchor. */
  anchorDate: string;
  /** Called with the chosen transaction id. The picker closes itself first. */
  onSelect: (transactionId: string) => void;
  /** A settle is in flight — keeps the trigger from firing a second one. */
  busy?: boolean;
  label?: string;
  helperText?: string;
}

/**
 * Searchable picker of existing transactions, for the Edit Event drawer's
 * "this bill IS that charge" affordance (TODO.md 2E / 2H(a)). The calendar-side
 * twin of the transaction-side "Is this a planned bill?" flow — both call the
 * same `settleBillWithTransaction` mutation.
 *
 * There is no combobox/typeahead primitive in this repo (the existing "Link to
 * bill" list in `TransactionReviewForm` is an unfiltered button list), and a
 * household's transaction list is long enough that an unfiltered list is
 * unusable — so this is modelled structurally on
 * `components/habits/HabitMultiSelect.tsx`: trigger button, `height="tall"`
 * Drawer, search pinned in the Drawer `header`, action in its `footer`, and
 * deliberately NO autofocus on the search input (see that file's docblock for
 * the iOS keyboard/zoom reasoning). It stays in `components/budget/` rather
 * than being promoted to `components/ui/` — one consumer, no shared contract.
 *
 * Matching goes through `useMerchantRules().searchTermsFor`, so a row a
 * household merchant rule renamed ("Gas bill") is still findable by the raw
 * bank descriptor the statement actually showed ("CPENERGY MNGCO").
 */
export const TransactionLinkPicker: React.FC<TransactionLinkPickerProps> = ({
  anchorDate,
  onSelect,
  busy = false,
  label = 'Already paid? Link a transaction',
  helperText,
}) => {
  const { transactions } = useFinance();
  const { displayNameFor, searchTermsFor } = useMerchantRules();
  const fmt = useFormatCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const candidates = useMemo(
    () => (isOpen ? getTransactionLinkCandidates(transactions, { anchorDate, query, searchTermsFor }) : []),
    [isOpen, transactions, anchorDate, query, searchTermsFor],
  );

  const handleClose = () => {
    setIsOpen(false);
    setQuery('');
  };

  const handlePick = (transactionId: string) => {
    handleClose();
    onSelect(transactionId);
  };

  return (
    <div className="space-y-2">
      <Eyebrow as="p">{label}</Eyebrow>
      {helperText && (
        <p className="text-xs text-brand-400 dark:text-brand-450">{helperText}</p>
      )}

      <Button
        variant="outline"
        size="md"
        disabled={busy}
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="w-full min-h-11 justify-start gap-2 bg-white font-normal dark:bg-brand-700/50"
        leftIcon={<Link2 size={14} className="shrink-0" />}
      >
        {busy ? 'Linking…' : 'Pick the transaction that paid this'}
      </Button>

      <Drawer
        isOpen={isOpen}
        onClose={handleClose}
        title="Link a transaction"
        height="tall"
        header={
          <div className="px-4 pb-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-450" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search transactions…"
                aria-label="Search transactions"
                className="w-full min-h-11 pl-9 pr-3 py-2 rounded-xl border border-brand-200 bg-white text-base text-brand-800 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-100 outline-hidden focus:border-accent-500"
              />
            </div>
          </div>
        }
        footer={
          <div className="px-4 pt-3 pb-1 border-t border-brand-200 dark:border-brand-700">
            <Button variant="secondary" size="md" className="w-full" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="space-y-1.5">
          <p className="px-1 pb-1 text-xs text-brand-400 dark:text-brand-450">
            Closest to this bill&rsquo;s date first. Picking one marks the bill paid at that
            amount — no second transaction is created.
          </p>
          {candidates.length === 0 && (
            <p className="px-1 py-2 text-xs italic text-brand-400 dark:text-brand-450">
              {query.trim()
                ? `No transactions match “${query.trim()}”.`
                : 'No transactions available to link.'}
            </p>
          )}
          {candidates.map(tx => (
            <Button
              key={tx.id}
              variant="outline"
              size="md"
              disabled={busy}
              onClick={() => handlePick(tx.id)}
              className="w-full min-h-11 justify-between gap-2 bg-white text-left font-normal dark:bg-brand-700/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-brand-800 dark:text-brand-100">
                  {displayNameFor(tx)}
                </span>
                <span className="block text-xs text-brand-400 dark:text-brand-450">
                  {format(parseISO(tx.date), 'MMM d, yyyy')}
                  {tx.status === 'pending_review' ? ' · Awaiting review' : ''}
                </span>
              </span>
              <span className="shrink-0 font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50">
                {fmt(tx.amount)}
              </span>
            </Button>
          ))}
        </div>
      </Drawer>
    </div>
  );
};

export default TransactionLinkPicker;
