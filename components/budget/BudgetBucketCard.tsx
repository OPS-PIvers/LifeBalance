import React, { useState, memo } from 'react';
import { ChevronDown, ChevronUp, Pencil, Check, Edit, Trash2, AlertTriangle, MoreVertical } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { BudgetBucket, Transaction } from '@/types/schema';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import ProgressBar from '@/components/ui/ProgressBar';
import { bucketColorClass } from '@/data/bucketColors';

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
  const fmt = useFormatCurrency();
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
    <div className="surface-section p-5 relative group overflow-hidden">
      {/* Header - Clickable for toggle */}
      <div
        className="flex items-center justify-between mb-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-800 outline-hidden rounded-card"
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
          <div className={`w-3 h-3 rounded-full ${bucketColorClass(bucket.color)}`} />
          <span className="font-semibold tracking-tight text-brand-900 dark:text-brand-100 text-base">{bucket.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm font-medium flex flex-col items-end">
            <div className={`flex items-center gap-1 ${isOverspent ? 'text-money-neg font-bold' : 'text-brand-700 dark:text-brand-200'}`}>
              <span className="font-mono tabular-nums tracking-tight font-bold" aria-label={`Verified spending: ${fmt(spent.verified)}`}>{fmt(spent.verified)}</span>
              {spent.pending > 0 && (
                <span className="text-brand-400 dark:text-brand-500 font-mono text-xs">
                  +{fmt(spent.pending)}
                </span>
              )}
              <span className="text-brand-300 dark:text-brand-600 font-light">/</span>

              {isEditingLimit ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={localLimit}
                    onChange={e => setLocalLimit(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-16 p-1 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-btn text-right font-mono font-bold dark:text-brand-100 outline-hidden focus:ring-2 focus:ring-accent-500/40"
                    autoFocus
                    aria-label={`Edit limit for ${bucket.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleSaveLimit}
                    className="text-money-pos hover:bg-money-bgPos dark:hover:bg-money-pos/15"
                    aria-label="Save limit"
                  >
                    <Check size={14} />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
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
                  aria-label={`Edit limit for ${bucket.name}, currently ${fmt(bucket.limit, { decimals: 0 })}`}
                  className="font-mono tabular-nums text-brand-400 dark:text-brand-500 border-b border-dashed border-brand-300 dark:border-brand-600 cursor-pointer hover:text-brand-600 dark:hover:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-xs"
                >
                  {fmt(bucket.limit, { decimals: 0 })}
                </button>
              )}
            </div>
            {spent.pending > 0 && (
              <span className="text-xxs text-warm-600 dark:text-warm-400">
                *pending review
              </span>
            )}
          </div>

          {/* Expand Indicator */}
          {bucketTransactions.length > 0 && (
            <div className="text-brand-400 dark:text-brand-500 p-1" aria-hidden="true">
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          )}

          {/* Edit Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onEditBucket(bucket); }}
            className="min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 text-brand-300 dark:text-brand-600 hover:text-brand-600 dark:hover:text-brand-300"
            aria-label={`Edit ${bucket.name} bucket`}
          >
            <Pencil size={14} />
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <ProgressBar
        value={percent}
        barClassName={isOverspent ? 'bg-money-neg' : bucketColorClass(bucket.color)}
        ariaLabel={`${bucket.name} spending: ${Math.round(percent)}% of ${fmt(bucket.limit, { decimals: 0 })} limit`}
        className="h-2 bg-brand-100 dark:bg-brand-700 mb-4"
      />

      {/* Expandable Transaction List */}
      {isExpanded && bucketTransactions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-brand-200 dark:border-brand-700 space-y-3 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)">
          <p className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider mb-2">
            Transactions ({bucketTransactions.length})
          </p>
          <div className="space-y-1 max-h-48 scroll-contain-y">
            {bucketTransactions.map(tx => (
              <div
                key={tx.id}
                className="flex justify-between items-center text-sm py-2.5 px-3 bg-brand-50 dark:bg-brand-700/40 hover:bg-brand-100 dark:hover:bg-brand-700 rounded-card border border-transparent hover:border-brand-200 dark:hover:border-brand-600 transition-colors duration-(--duration-fast) ease-(--ease-standard) group"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 truncate">{tx.merchant}</p>
                  <p className="text-xs text-brand-500 dark:text-brand-400 font-medium">
                    {format(parseISO(tx.date), 'MMM d')}
                    {tx.status === 'pending_review' && (
                      <Badge variant="warning" size="sm" className="ml-2">Pending</Badge>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono tabular-nums font-bold ${
                    tx.status === 'pending_review' ? 'text-brand-400 dark:text-brand-500' : 'text-brand-900 dark:text-brand-100'
                  }`}>
                    {fmt(tx.amount)}
                  </span>

                  {/* Actions: Buttons on Desktop, More Menu on Mobile */}
                  <div className="flex items-center">
                    <div className="hidden sm:flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onEditTransaction(tx)}
                        className="text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300"
                        title="Edit transaction"
                        aria-label={`Edit transaction: ${tx.merchant || 'Unnamed'}`}
                      >
                        <Edit size={14} />
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() => onDeleteTransaction(tx.id)}
                        className="text-brand-400 dark:text-brand-500 hover:text-money-neg"
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
                        className="text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300"
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
        <div className="mt-3 bg-money-bgNeg dark:bg-money-neg/15 p-3 rounded-card flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-(--duration-base)">
          <div className="flex items-center gap-2 text-money-neg text-xs font-bold">
            <AlertTriangle size={14} />
            <span>Over by {fmt(totalCommitted - bucket.limit)}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onReallocate(bucket.id); }}
            className="bg-white dark:bg-brand-800 text-money-neg border-money-neg/30 dark:border-money-neg/30 hover:bg-money-bgNeg dark:hover:bg-money-neg/15 text-xs py-1.5 rounded-btn"
          >
            Fix
          </Button>
        </div>
      )}
    </div>
  );
}, arePropsEqual);

BudgetBucketCard.displayName = 'BudgetBucketCard';
