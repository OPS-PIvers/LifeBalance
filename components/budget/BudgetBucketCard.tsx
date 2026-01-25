import React, { useState, useEffect, memo, useMemo } from 'react';
import { ChevronDown, ChevronUp, Pencil, Check, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { BudgetBucket, Transaction } from '../../types/schema';

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
    prev.onDeleteTransaction === next.onDeleteTransaction
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
}) => {
  const totalCommitted = spent.verified + spent.pending;
  const percent = Math.min(100, (totalCommitted / bucket.limit) * 100);
  const isOverspent = totalCommitted > bucket.limit;

  // Local state for limit editing to prevent parent re-renders on keystroke
  // We initialize it directly from props so it has a valid value immediately
  const [localLimit, setLocalLimit] = useState(bucket.limit.toString());
  const [expandedSubBucketId, setExpandedSubBucketId] = useState<string | null>(null);

  // Group transactions by sub-bucket
  const subBucketGroups = useMemo(() => {
    if (!bucket.subBuckets || bucket.subBuckets.length === 0) return null;

    const groups: Record<string, { transactions: Transaction[]; total: number }> = {};
    const generalTransactions: Transaction[] = [];

    // Initialize groups
    bucket.subBuckets.forEach(sb => {
      groups[sb.id] = { transactions: [], total: 0 };
    });

    bucketTransactions.forEach(tx => {
      if (tx.subBucketId && groups[tx.subBucketId]) {
        groups[tx.subBucketId].transactions.push(tx);
        groups[tx.subBucketId].total += tx.amount;
      } else {
        generalTransactions.push(tx);
      }
    });

    return { groups, generalTransactions };
  }, [bucket.subBuckets, bucketTransactions]);

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
    <div className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm relative group">
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
          <span className="font-bold text-brand-800">{bucket.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm font-mono flex flex-col items-end">
            <div className={`flex items-center gap-1 ${isOverspent ? 'text-money-neg font-bold' : 'text-brand-600'}`}>
              <span>${spent.verified.toFixed(2)}</span>
              {spent.pending > 0 && (
                <span className="text-brand-400">
                  +${spent.pending.toFixed(2)}*
                </span>
              )}
              <span className="text-brand-300">/</span>

              {isEditingLimit ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={localLimit}
                    onChange={e => setLocalLimit(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-16 p-1 bg-brand-50 border border-brand-200 rounded text-right font-bold"
                    autoFocus
                    aria-label={`Edit limit for ${bucket.name}`}
                  />
                  <button
                    onClick={handleSaveLimit}
                    className="text-money-pos"
                    aria-label="Save limit"
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEditingLimit(bucket.id);
                  }}
                  className="text-brand-400 border-b border-dashed border-brand-200 cursor-pointer hover:text-brand-600"
                >
                  ${bucket.limit}
                </span>
              )}
            </div>
            {spent.pending > 0 && (
              <span className="text-xxs text-brand-400">
                *pending review
              </span>
            )}
          </div>

          {/* Expand Indicator */}
          {bucketTransactions.length > 0 && (
            <div className="text-brand-400 p-1" aria-hidden="true">
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          )}

          {/* Edit Button */}
          <button
            onClick={(e) => { e.stopPropagation(); onEditBucket(bucket); }}
            className="text-brand-300 hover:text-brand-600 p-1"
            aria-label={`Edit ${bucket.name} bucket`}
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-3 w-full bg-brand-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isOverspent ? 'bg-money-neg' : bucket.color}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Expandable Transaction List */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-brand-100 space-y-2 animate-in fade-in slide-in-from-top-2">

          {/* Sub-Buckets View */}
          {subBucketGroups && bucket.subBuckets && (
            <div className="space-y-2 mb-3">
              {bucket.subBuckets.map(sb => {
                const group = subBucketGroups.groups[sb.id];
                const isSubExpanded = expandedSubBucketId === sb.id;
                // Calculate percentage relative to bucket limit to show impact
                // If limit is 0 (unlikely), avoid NaN
                const subPercent = bucket.limit > 0
                  ? Math.min(100, (group.total / bucket.limit) * 100)
                  : 0;

                return (
                  <div key={sb.id} className="bg-brand-50 rounded-xl overflow-hidden border border-brand-100">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-brand-100 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSubBucketId(prev => (prev === sb.id ? null : sb.id));
                      }}
                    >
                      <div className="flex flex-col gap-1 w-full mr-4">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-sm text-brand-700">{sb.name}</span>
                          <span className="font-mono text-xs font-bold text-brand-600">${group.total.toFixed(2)}</span>
                        </div>
                        {/* Mini Meter */}
                        <div className="h-1.5 w-full bg-brand-200 rounded-full overflow-hidden">
                           <div className="h-full bg-brand-400 rounded-full" style={{ width: `${subPercent}%` }} />
                        </div>
                      </div>
                      <ChevronDown size={14} className={`text-brand-400 shrink-0 transition-transform ${isSubExpanded ? 'rotate-180' : ''}`} />
                    </div>

                    {/* Sub-Bucket Transactions */}
                    {isSubExpanded && (
                      <div className="p-2 space-y-1 bg-white border-t border-brand-100 max-h-40 overflow-y-auto">
                        {group.transactions.length === 0 ? (
                          <p className="text-xs text-brand-400 text-center py-2">No transactions</p>
                        ) : (
                          group.transactions.map(tx => (
                            <TransactionRow
                              key={tx.id}
                              tx={tx}
                              onEdit={onEditTransaction}
                              onDelete={onDeleteTransaction}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {subBucketGroups.generalTransactions.length > 0 && (
                <p className="text-xs font-bold text-brand-400 uppercase mt-4 mb-2 pl-1">
                  General Transactions ({subBucketGroups.generalTransactions.length})
                </p>
              )}
            </div>
          )}

          {/* Transaction List (General or All) */}
          {(!subBucketGroups || subBucketGroups.generalTransactions.length > 0) && (
            <>
              {!subBucketGroups && (
                <p className="text-xs font-bold text-brand-400 uppercase mb-2">
                  Transactions This Period ({bucketTransactions.length})
                </p>
              )}
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(subBucketGroups ? subBucketGroups.generalTransactions : bucketTransactions).map(tx => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    onEdit={onEditTransaction}
                    onDelete={onDeleteTransaction}
                  />
                ))}
                {subBucketGroups && subBucketGroups.generalTransactions.length === 0 && bucketTransactions.length === 0 && (
                   <p className="text-xs text-brand-400 text-center py-4">No transactions yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Overspend Action */}
      {isOverspent && (
        <div className="mt-3 bg-money-bgNeg p-3 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-money-neg text-xs font-bold">
            <AlertTriangle size={14} />
            <span>Over by ${(totalCommitted - bucket.limit).toFixed(2)}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onReallocate(bucket.id); }}
            className="bg-white text-money-neg text-xs font-bold px-3 py-1.5 rounded-lg border border-rose-200 shadow-sm active:scale-95 transition-transform"
          >
            Fix
          </button>
        </div>
      )}
    </div>
  );
}, arePropsEqual);

interface TransactionRowProps {
  tx: Transaction;
  onEdit: (tx: Transaction) => void;
  onDelete: (id: string) => void;
}

const TransactionRow: React.FC<TransactionRowProps> = ({ tx, onEdit, onDelete }) => (
  <div
    className="flex justify-between items-center text-sm py-2 px-3 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors group"
  >
    <div className="flex-1">
      <p className="font-medium text-brand-800">{tx.merchant}</p>
      <p className="text-xs text-brand-400">
        {format(parseISO(tx.date), 'MMM d, yyyy')}
        {tx.status === 'pending_review' && (
          <span className="ml-2 text-amber-600">• Pending</span>
        )}
      </p>
    </div>
    <div className="flex items-center gap-2">
      <span className={`font-mono font-bold ${
        tx.status === 'pending_review' ? 'text-brand-400' : 'text-brand-800'
      }`}>
        ${tx.amount}
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => onEdit(tx)}
          className="text-brand-400 hover:text-brand-600 p-1"
          title="Edit transaction"
        >
          <Edit size={14} />
        </button>
        <button
          onClick={() => onDelete(tx.id)}
          className="text-brand-400 hover:text-money-neg p-1"
          title="Delete transaction"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  </div>
);

BudgetBucketCard.displayName = 'BudgetBucketCard';
