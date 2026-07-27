import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { ParsedTransaction } from '@/types/ui';
import { Store, Account } from '@/types/schema';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

interface CaptureTransactionReviewProps {
  parsedTransactions: ParsedTransaction[];
  onUpdateTransaction: (id: string, updates: Partial<ParsedTransaction>) => void;
  onToggleSelection: (id: string) => void;
  onToggleAll: () => void;
  dynamicCategories: string[];
  stores: Store[];
  accounts: Account[];
}

export const CaptureTransactionReview: React.FC<CaptureTransactionReviewProps> = ({
  parsedTransactions,
  onUpdateTransaction,
  onToggleSelection,
  onToggleAll,
  dynamicCategories,
  stores,
  accounts
}) => {
  const fmt = useFormatCurrency();
  const selectedCount = parsedTransactions.filter(t => t.selected).length;
  const allSelected = parsedTransactions.every(t => t.selected) && parsedTransactions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-500 dark:text-brand-400">
          {selectedCount} of {parsedTransactions.length} selected
        </p>
        <button
          onClick={onToggleAll}
          className="text-xs font-bold text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-100"
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      <div className="space-y-3 max-h-[35vh] min-h-[120px] scroll-contain-y">
        {parsedTransactions.map(tx => (
          <div
            key={tx.id}
            className={`p-3 rounded-xl border transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
              tx.selected ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20' : 'border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 opacity-60'
            }`}
          >
            <div className="flex items-start gap-3">
              <button
                onClick={() => onToggleSelection(tx.id)}
                aria-label={tx.selected ? "Deselect transaction" : "Select transaction"}
                className={`mt-1 w-5 h-5 rounded flex items-center justify-center shrink-0 focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 ${
                  tx.selected ? 'bg-accent-600 dark:bg-accent-500 text-white' : 'border-2 border-brand-300 dark:border-brand-600'
                }`}
              >
                {tx.selected && <Check size={14} />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-brand-700 dark:text-brand-200 truncate">{tx.merchant}</p>
                  <span className="font-mono font-bold text-lg text-brand-800 dark:text-brand-100 shrink-0">
                    {fmt(tx.amount)}
                  </span>
                </div>
                <p className="text-xs text-brand-400 dark:text-brand-400 mb-2">{tx.date}</p>
                {/* Category doesn't apply when the tagged account is a credit
                    card — the submit path coerces it to CREDIT_CARD_CATEGORY.
                    The parsed category is kept, so switching back restores it. */}
                {accounts.find(a => a.id === tx.accountId)?.type !== 'credit' && (
                <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Category selection">
                  {dynamicCategories.slice(0, 4).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => onUpdateTransaction(tx.id, { category: cat })}
                      className={`px-2 py-1 rounded-btn text-xxs font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                        tx.category === cat
                          ? 'bg-accent-600 dark:bg-accent-500 text-white'
                          : 'bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-700'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                  {dynamicCategories.length > 4 && (
                    <select
                      value={tx.category}
                      onChange={(e) => onUpdateTransaction(tx.id, { category: e.target.value })}
                      className="px-2 py-1 rounded-lg text-xxs font-bold bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 border-none outline-hidden"
                    >
                      {dynamicCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  )}
                </div>
                )}

                <div className="grid grid-cols-2 gap-2 mt-2">
                  {/* Store Select */}
                  <div>
                    <CompactSelect
                      value={tx.store || ''}
                      onChange={(value) => onUpdateTransaction(tx.id, { store: value || undefined })}
                      options={stores.map(s => ({ id: s.name, label: s.name }))}
                      placeholder="Store..."
                    />
                  </div>

                  {/* Account Select */}
                  <div>
                    <CompactSelect
                      value={tx.accountId || ''}
                      onChange={(value) => onUpdateTransaction(tx.id, { accountId: value || undefined, creditPayment: undefined })}
                      options={accounts.map(a => ({ id: a.id, label: a.name }))}
                      placeholder="Account..."
                    />
                  </div>

                  {/* Charge / Payment — only for a credit account */}
                  {accounts.find(a => a.id === tx.accountId)?.type === 'credit' && (
                    <div>
                      <CompactSelect
                        value={tx.creditPayment ? 'payment' : 'charge'}
                        onChange={(value) => onUpdateTransaction(tx.id, { creditPayment: value === 'payment' ? true : undefined })}
                        options={[{ id: 'charge', label: 'Charge to card' }, { id: 'payment', label: 'Payment toward card' }]}
                        placeholder="Charge to card"
                        aria-label="Charge or payment"
                      />
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 bg-warm-50 dark:bg-warm-900/20 rounded-xl border border-warm-200 dark:border-warm-800/60">
        <AlertCircle size={16} className="text-warm-600 dark:text-warm-300 shrink-0" />
        <p className="text-xs text-warm-700 dark:text-warm-300">
          These will be added to your Action Queue for final review.
        </p>
      </div>

      {/* The "Add N to Action Queue" button used to sit here, at the bottom of
          a list that can run to a dozen scanned rows — so on a phone it was
          always a scroll away. It now lives in the Drawer's fixed footer
          (CaptureModal owns it, and reads the same selected count), matching
          every other capture view. */}
    </div>
  );
};
