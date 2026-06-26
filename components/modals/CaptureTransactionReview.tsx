import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { ParsedTransaction } from '@/types/ui';
import { BudgetBucket, Store, Account } from '@/types/schema';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

interface CaptureTransactionReviewProps {
  parsedTransactions: ParsedTransaction[];
  onUpdateTransaction: (id: string, updates: Partial<ParsedTransaction>) => void;
  onToggleSelection: (id: string) => void;
  onToggleAll: () => void;
  onSubmit: () => void;
  dynamicCategories: string[];
  buckets: BudgetBucket[];
  stores: Store[];
  accounts: Account[];
}

export const CaptureTransactionReview: React.FC<CaptureTransactionReviewProps> = ({
  parsedTransactions,
  onUpdateTransaction,
  onToggleSelection,
  onToggleAll,
  onSubmit,
  dynamicCategories,
  buckets,
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
                  <span className="font-mono font-bold text-brand-800 dark:text-brand-100 shrink-0">
                    {fmt(tx.amount)}
                  </span>
                </div>
                <p className="text-xs text-brand-400 dark:text-brand-400 mb-2">{tx.date}</p>
                <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Category selection">
                  {dynamicCategories.slice(0, 4).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => onUpdateTransaction(tx.id, { category: cat, subBucketId: undefined })}
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
                      onChange={(e) => onUpdateTransaction(tx.id, { category: e.target.value, subBucketId: undefined })}
                      className="px-2 py-1 rounded-lg text-xxs font-bold bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 border-none outline-hidden"
                    >
                      {dynamicCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  {/* Sub-Bucket Select */}
                  {(() => {
                    const selectedBucket = buckets.find(b => b.name === tx.category);
                    if (selectedBucket?.subBuckets && selectedBucket.subBuckets.length > 0) {
                      return (
                        <div>
                          <CompactSelect
                            value={tx.subBucketId || ''}
                            onChange={(value) => onUpdateTransaction(tx.id, { subBucketId: value || undefined })}
                            options={selectedBucket.subBuckets.map(sb => ({ id: sb.id, label: sb.name }))}
                            placeholder="Sub-Category..."
                          />
                        </div>
                      );
                    }
                    return null;
                  })()}

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
                      onChange={(value) => onUpdateTransaction(tx.id, { accountId: value || undefined })}
                      options={accounts.map(a => ({ id: a.id, label: a.name }))}
                      placeholder="Account..."
                    />
                  </div>
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

      <button
        onClick={onSubmit}
        disabled={selectedCount === 0}
        className="w-full py-4 bg-accent-600 dark:bg-accent-500 text-white font-semibold rounded-btn shadow-btn-primary active:scale-[0.98] transition-all duration-(--duration-fast) ease-(--ease-standard) hover:bg-accent-700 dark:hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
      >
        Add {selectedCount} to Action Queue
      </button>
    </div>
  );
};
