import React, { useState, memo } from 'react';
import { ChevronDown, ChevronUp, Pencil, Check, Edit, Trash2, AlertTriangle, MoreVertical } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { BudgetBucket, Transaction } from '@/types/schema';
import { Button } from '@/components/ui/Button';

interface BudgetBucketCardProps {
  bucket: BudgetBucket;
  spent: { verified: number; pending: number };
  bucketTransactions: Transaction[];
  isExpanded: boolean;
  isEditingLimit: boolean;
  onExpand: (id: string) => void;
  onEditBucket: (bucket: BudgetBucket) => void;
  onStartEditingLimit: (id: string) => void;
  onSaveLimit: (id: string, limit: number) => void;
  onCancelEdit: () => void;
  onReallocate: (targetId: string) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onOpenTransactionActions: (tx: Transaction) => void;
}

const arePropsEqual = (prev: BudgetBucketCardProps, next: BudgetBucketCardProps) => {
  return (
    prev.bucket.id === next.bucket.id &&
    prev.bucket.limit === next.bucket.limit &&
    prev.bucket.name === next.bucket.name &&
    prev.bucket.color === next.bucket.color &&
    prev.spent.verified === next.spent.verified &&
    prev.spent.pending === next.spent.pending &&
    prev.bucketTransactions === next.bucketTransactions &&
    prev.isExpanded === next.isExpanded &&
    prev.isEditingLimit === next.isEditingLimit &&
    prev.onExpand === next.onExpand &&
    prev.onEditBucket === next.onEditBucket &&
    prev.onStartEditingLimit === next.onStartEditingLimit &&
    prev.onSaveLimit === next.onSaveLimit &&
    prev.onCancelEdit === next.onCancelEdit &&
    prev.onReallocate === next.onReallocate &&
    prev.onEditTransaction === next.onEditTransaction &&
    prev.onDeleteTransaction === next.onDeleteTransaction &&
    prev.onOpenTransactionActions === next.onOpenTransactionActions
  );
};

export const BudgetBucketCard: React.FC<BudgetBucketCardProps> = memo(({
  bucket,
  spent,
  bucketTransactions,
  isExpanded,
  isEditingLimit,
  onExpand,
  onEditBucket,
  onStartEditingLimit,
  onSaveLimit,
  onCancelEdit,
  onReallocate,
  onEditTransaction,
  onDeleteTransaction,
  onOpenTransactionActions,
}) => {
  const totalCommitted = spent.verified + spent.pending;
  const percent = Math.min(100, (totalCommitted / bucket.limit) * 100);
  const isOverspent = totalCommitted > bucket.limit;

  // Local state for limit editing to prevent parent re-renders on keystroke.
  const [localLimit, setLocalLimit] = useState(() => bucket.limit.toString());

  // Reset the draft value whenever an edit session starts/ends or the persisted
  // limit changes — the standard "adjust state during render" pattern (no
  // effect). This also covers the case where the PARENT cancels editing
  // (e.g. backdrop click) without going through this component's handlers, so
  // reopening never shows a stale unsaved value.
  const [prevIsEditing, setPrevIsEditing] = useState(isEditingLimit);
  const [prevLimit, setPrevLimit] = useState(bucket.limit);
  if (isEditingLimit !== prevIsEditing || bucket.limit !== prevLimit) {
    setPrevIsEditing(isEditingLimit);
    setPrevLimit(bucket.limit);
    setLocalLimit(bucket.limit.toString());
  }

  const handleSaveLimit = () => {
    const val = parseFloat(localLimit);
    if (!isNaN(val)) {
      onSaveLimit(bucket.id, val);
    } else {
      // Invalid input: discard the draft (reset handled on reopen) and close.
      onCancelEdit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveLimit();
    } else if (e.key === 'Escape') {
      onCancelEdit();
    }
  };

  return (
    <div className="bg-white/90 dark:bg-slate-800/60 backdrop-blur-xl p-6 rounded-3xl ring-1 ring-black/5 shadow-glass-card border border-white/20 dark:border-white/5 relative group overflow-hidden transition-all duration-300 hover:shadow-[0_20px_40px_rgb(0,0,0,0.06)]">
      {/* Header - Clickable for toggle */}
      <div
        className="flex items-center justify-between mb-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 outline-none rounded-xl"
        onClick={() => onExpand(bucket.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onExpand(bucket.id);
          }
        }}
        aria-expanded={isExpanded}
        aria-label={`Toggle ${bucketTransactions.length} transactions for ${bucket.name} - currently ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full shadow-sm ${bucket.color}`} />
          <span className="font-bold tracking-tight text-slate-900 dark:text-slate-100 text-lg">{bucket.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm font-medium flex flex-col items-end">
            <div className={`flex items-center gap-1 ${isOverspent ? 'text-money-neg font-bold' : 'text-slate-700 dark:text-slate-200'}`}>
              <span className="font-mono tracking-tight font-bold" aria-label={`Verified spending: $${spent.verified.toFixed(2)}`}>${spent.verified.toFixed(2)}</span>
              {spent.pending > 0 && (
                <span className="text-slate-400 dark:text-slate-500 font-mono text-xs">
                  +${spent.pending.toFixed(2)}
                </span>
              )}
              <span className="text-slate-300 dark:text-slate-600 font-light">/</span>

              {isEditingLimit ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={localLimit}
                    onChange={e => setLocalLimit(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-16 p-1 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded text-right font-bold dark:text-slate-100"
                    autoFocus
                    aria-label={`Edit limit for ${bucket.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleSaveLimit}
                    className="text-money-pos hover:bg-emerald-50 dark:hover:bg-emerald-500/15"
                    aria-label="Save limit"
                  >
                    <Check size={14} />
                  </Button>
                </div>
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEditingLimit(bucket.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onStartEditingLimit(bucket.id);
                    }
                  }}
                  aria-label={`Edit limit for ${bucket.name}, currently $${bucket.limit}`}
                  className="text-slate-400 dark:text-slate-500 border-b border-dashed border-slate-200 dark:border-slate-700 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-sm"
                >
                  ${bucket.limit}
                </span>
              )}
            </div>
            {spent.pending > 0 && (
              <span className="text-xxs text-slate-400 dark:text-slate-500">
                *pending review
              </span>
            )}
          </div>

          {/* Expand Indicator */}
          {bucketTransactions.length > 0 && (
            <div className="text-slate-400 dark:text-slate-500 p-1" aria-hidden="true">
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          )}

          {/* Edit Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onEditBucket(bucket); }}
            className="text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label={`Edit ${bucket.name} bucket`}
          >
            <Pencil size={14} />
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        className="h-3 w-full bg-slate-100/80 dark:bg-slate-700/50 rounded-full overflow-hidden mb-4 ring-1 ring-black/5 shadow-inner"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={`${bucket.name} spending: ${Math.round(percent)}% of $${bucket.limit} limit`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 relative ${isOverspent ? 'bg-money-neg' : bucket.color}`}
          style={{ width: `${percent}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
        </div>
      </div>

      {/* Expandable Transaction List */}
      {isExpanded && bucketTransactions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100/50 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-2">
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
            Transactions ({bucketTransactions.length})
          </p>
          <div className="space-y-1 max-h-48 scroll-contain-y">
            {bucketTransactions.map(tx => (
              <div
                key={tx.id}
                className="flex justify-between items-center text-sm py-2.5 px-3 bg-slate-50/50 dark:bg-slate-700/50 hover:bg-white dark:hover:bg-slate-700 rounded-xl border border-transparent hover:border-slate-100 dark:hover:border-slate-600 hover:shadow-sm transition-all group"
              >
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{tx.merchant}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {format(parseISO(tx.date), 'MMM d')}
                    {tx.status === 'pending_review' && (
                      <span className="ml-2 text-amber-600 font-bold">• Pending</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono font-bold ${
                    tx.status === 'pending_review' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'
                  }`}>
                    ${tx.amount.toFixed(2)}
                  </span>

                  {/* Actions: Buttons on Desktop, More Menu on Mobile */}
                  <div className="flex items-center">
                    <div className="hidden sm:flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onEditTransaction(tx)}
                        className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                        title="Edit transaction"
                        aria-label={`Edit transaction: ${tx.merchant || 'Unnamed'}`}
                      >
                        <Edit size={14} />
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() => onDeleteTransaction(tx.id)}
                        className="text-slate-400 dark:text-slate-500 hover:text-money-neg"
                        title="Delete transaction"
                        aria-label={`Delete transaction: ${tx.merchant || 'Unnamed'}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>

                    <div className="flex sm:hidden">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenTransactionActions(tx)}
                        className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                        title="More options"
                        aria-label="More options"
                      >
                        <MoreVertical size={18} />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overspend Action */}
      {isOverspent && (
        <div className="mt-3 bg-money-bgNeg dark:bg-rose-500/15 p-3 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-money-neg text-xs font-bold">
            <AlertTriangle size={14} />
            <span>Over by ${(totalCommitted - bucket.limit).toFixed(2)}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onReallocate(bucket.id); }}
            className="bg-white dark:bg-slate-800 text-money-neg border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/15 text-xs py-1.5 rounded-lg"
          >
            Fix
          </Button>
        </div>
      )}
    </div>
  );
}, arePropsEqual);

BudgetBucketCard.displayName = 'BudgetBucketCard';
