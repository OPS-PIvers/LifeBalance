import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { ParsedTransaction } from '../../types/ui';
import { BudgetBucket, Store, Account } from '../../types/schema';

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
  const selectedCount = parsedTransactions.filter(t => t.selected).length;
  const allSelected = parsedTransactions.every(t => t.selected) && parsedTransactions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-500">
          {selectedCount} of {parsedTransactions.length} selected
        </p>
        <button
          onClick={onToggleAll}
          className="text-xs font-bold text-brand-600 hover:text-brand-800"
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      <div className="space-y-3 max-h-[35vh] min-h-[120px] overflow-y-auto">
        {parsedTransactions.map(tx => (
          <div
            key={tx.id}
            className={`p-3 rounded-xl border-2 transition-all ${
              tx.selected ? 'border-brand-400 bg-brand-50' : 'border-brand-100 bg-white opacity-60'
            }`}
          >
            <div className="flex items-start gap-3">
              <button
                onClick={() => onToggleSelection(tx.id)}
                aria-label={tx.selected ? "Deselect transaction" : "Select transaction"}
                className={`mt-1 w-5 h-5 rounded flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                  tx.selected ? 'bg-brand-800 text-white' : 'border-2 border-brand-300'
                }`}
              >
                {tx.selected && <Check size={14} />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-brand-700 truncate">{tx.merchant}</p>
                  <span className="font-mono font-bold text-brand-800 shrink-0">
                    ${tx.amount.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-brand-400 mb-2">{tx.date}</p>
                <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Category selection">
                  {dynamicCategories.slice(0, 4).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => onUpdateTransaction(tx.id, { category: cat, subBucketId: undefined })}
                      className={`px-2 py-1 rounded-lg text-xxs font-bold transition-colors ${
                        tx.category === cat
                          ? 'bg-brand-800 text-white'
                          : 'bg-brand-100 text-brand-600 hover:bg-brand-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                  {dynamicCategories.length > 4 && (
                    <select
                      value={tx.category}
                      onChange={(e) => onUpdateTransaction(tx.id, { category: e.target.value, subBucketId: undefined })}
                      className="px-2 py-1 rounded-lg text-xxs font-bold bg-brand-100 text-brand-600 border-none outline-none"
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
                          <select
                            value={tx.subBucketId || ''}
                            onChange={(e) => onUpdateTransaction(tx.id, { subBucketId: e.target.value || undefined })}
                            className="px-2 py-1 rounded-lg text-xxs font-bold bg-brand-50 border border-brand-200 text-brand-600 outline-none w-full"
                          >
                            <option value="">Sub-Category...</option>
                            {selectedBucket.subBuckets.map(sb => (
                              <option key={sb.id} value={sb.id}>{sb.name}</option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Store Select */}
                  <div>
                    <select
                      value={tx.store || ''}
                      onChange={(e) => onUpdateTransaction(tx.id, { store: e.target.value || undefined })}
                      className="px-2 py-1 rounded-lg text-xxs font-bold bg-brand-50 border border-brand-200 text-brand-600 outline-none w-full"
                    >
                      <option value="">Store...</option>
                      {stores.map(s => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Account Select */}
                  <div>
                    <select
                      value={tx.accountId || ''}
                      onChange={(e) => onUpdateTransaction(tx.id, { accountId: e.target.value || undefined })}
                      className="px-2 py-1 rounded-lg text-xxs font-bold bg-brand-50 border border-brand-200 text-brand-600 outline-none w-full"
                    >
                      <option value="">Account...</option>
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
        <AlertCircle size={16} className="text-amber-600 shrink-0" />
        <p className="text-xs text-amber-700">
          These will be added to your Action Queue for final review.
        </p>
      </div>

      <button
        onClick={onSubmit}
        disabled={selectedCount === 0}
        className="w-full py-4 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Add {selectedCount} to Action Queue
      </button>
    </div>
  );
};
