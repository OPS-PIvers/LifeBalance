import React, { useState, useEffect, memo } from 'react';
import { ChevronDown, ChevronUp, Pencil, Check, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { BudgetBucket, Transaction } from '../../types/schema';
import { Button } from '../ui/Button';

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
}

const arePropsEqual = (prev: BudgetBucketCardProps, next: BudgetBucketCardProps) => {
  // Check primitive and cheap props first
  if (
    prev.bucket.id !== next.bucket.id ||
    prev.bucket.limit !== next.bucket.limit ||
    prev.bucket.name !== next.bucket.name ||
    prev.bucket.color !== next.bucket.color ||
    prev.spent.verified !== next.spent.verified ||
    prev.spent.pending !== next.spent.pending ||
    prev.isExpanded !== next.isExpanded ||
    prev.isEditingLimit !== next.isEditingLimit
  ) {
    return false;
  }

  // Check function references (assumed stable via useCallback from parent)
  if (
    prev.onExpand !== next.onExpand ||
    prev.onEditBucket !== next.onEditBucket ||
    prev.onStartEditingLimit !== next.onStartEditingLimit ||
    prev.onSaveLimit !== next.onSaveLimit ||
    prev.onCancelEdit !== next.onCancelEdit ||
    prev.onReallocate !== next.onReallocate ||
    prev.onEditTransaction !== next.onEditTransaction ||
    prev.onDeleteTransaction !== next.onDeleteTransaction
  ) {
    return false;
  }

  // Handle transactions optimization
  // If exact reference match, we are good.
  if (prev.bucketTransactions === next.bucketTransactions) {
    return true;
  }

  // If refs are different, check if we can skip re-render based on visibility.
  // When collapsed, we only care about length (for Chevron and aria-label).
  // If length matches, the visual output is identical despite content changes.
  if (!prev.isExpanded && !next.isExpanded) {
    return prev.bucketTransactions.length === next.bucketTransactions.length;
  }

  // If expanded and refs differ, we must re-render to show updated list.
  return false;
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
}) => {
  const totalCommitted = spent.verified + spent.pending;
  const percent = Math.min(100, (totalCommitted / bucket.limit) * 100);
  const isOverspent = totalCommitted > bucket.limit;

  // Local state for limit editing to prevent parent re-renders on keystroke
  // We initialize it directly from props so it has a valid value immediately
  const [localLimit, setLocalLimit] = useState(bucket.limit.toString());

  // To avoid the "setState in effect" warning while correctly syncing state:
  // We use a pattern where we key the state initialization off the editing mode.
  useEffect(() => {
    if (isEditingLimit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalLimit(bucket.limit.toString());
    }
  }, [isEditingLimit, bucket.limit]);

  const handleSaveLimit = () => {
    const val = parseFloat(localLimit);
    if (!isNaN(val)) {
      onSaveLimit(bucket.id, val);
    } else {
      // If invalid, revert/cancel
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
    <div className="bg-white/80 backdrop-blur-xl p-5 rounded-2xl ring-1 ring-black/5 shadow-glass relative group">
      {/* Header - Clickable for toggle */}
      <div
        className="flex items-center justify-between mb-3 cursor-pointer"
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
          <div className={`w-3 h-3 rounded-full ${bucket.color}`} />
          <span className="font-semibold tracking-tight text-slate-900">{bucket.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm font-mono flex flex-col items-end">
            <div className={`flex items-center gap-1 ${isOverspent ? 'text-money-neg font-bold' : 'text-slate-600'}`}>
              <span>${spent.verified.toFixed(2)}</span>
              {spent.pending > 0 && (
                <span className="text-slate-400">
                  +${spent.pending.toFixed(2)}*
                </span>
              )}
              <span className="text-slate-300">/</span>

              {isEditingLimit ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={localLimit}
                    onChange={e => setLocalLimit(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-16 p-1 bg-slate-50 border border-slate-200 rounded text-right font-bold"
                    autoFocus
                    aria-label={`Edit limit for ${bucket.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleSaveLimit}
                    className="text-money-pos hover:bg-emerald-50"
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
                  className="text-slate-400 border-b border-dashed border-slate-200 cursor-pointer hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-sm"
                >
                  ${bucket.limit}
                </span>
              )}
            </div>
            {spent.pending > 0 && (
              <span className="text-xxs text-slate-400">
                *pending review
              </span>
            )}
          </div>

          {/* Expand Indicator */}
          {bucketTransactions.length > 0 && (
            <div className="text-slate-400 p-1" aria-hidden="true">
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          )}

          {/* Edit Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onEditBucket(bucket); }}
            className="text-slate-300 hover:text-slate-600"
            aria-label={`Edit ${bucket.name} bucket`}
          >
            <Pencil size={14} />
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isOverspent ? 'bg-money-neg' : bucket.color}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Expandable Transaction List */}
      {isExpanded && bucketTransactions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 animate-in fade-in slide-in-from-top-2">
          <p className="text-xs font-bold text-slate-400 uppercase mb-2">
            Transactions This Period ({bucketTransactions.length})
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {bucketTransactions.map(tx => (
              <div
                key={tx.id}
                className="flex justify-between items-center text-sm py-2 px-3 bg-slate-50/50 rounded-lg hover:bg-slate-100 transition-colors group"
              >
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{tx.merchant}</p>
                  <p className="text-xs text-slate-400">
                    {format(parseISO(tx.date), 'MMM d, yyyy')}
                    {tx.status === 'pending_review' && (
                      <span className="ml-2 text-amber-600">• Pending</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono font-bold ${
                    tx.status === 'pending_review' ? 'text-slate-400' : 'text-slate-800'
                  }`}>
                    ${tx.amount}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEditTransaction(tx)}
                      className="text-slate-400 hover:text-slate-600"
                      title="Edit transaction"
                    >
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="ghost-destructive"
                      size="icon-sm"
                      onClick={() => onDeleteTransaction(tx.id)}
                      className="text-slate-400 hover:text-money-neg"
                      title="Delete transaction"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overspend Action */}
      {isOverspent && (
        <div className="mt-3 bg-money-bgNeg p-3 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-money-neg text-xs font-bold">
            <AlertTriangle size={14} />
            <span>Over by ${(totalCommitted - bucket.limit).toFixed(2)}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onReallocate(bucket.id); }}
            className="bg-white text-money-neg border-rose-200 hover:bg-rose-50 text-xs py-1.5 rounded-lg"
          >
            Fix
          </Button>
        </div>
      )}
    </div>
  );
}, arePropsEqual);

BudgetBucketCard.displayName = 'BudgetBucketCard';
