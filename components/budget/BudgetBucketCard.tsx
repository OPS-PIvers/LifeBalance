import React, { useState, memo } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronDown, Pencil, Check, AlertTriangle, Edit, Trash2 } from 'lucide-react';
import { BudgetBucket, Transaction } from '@/types/schema';
import { Button } from '@/components/ui/Button';
import { Row } from '@/components/ui/Section';
import { Badge } from '@/components/ui/Badge';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import ProgressBar from '@/components/ui/ProgressBar';
import { bucketColorClass } from '@/data/bucketColors';
import { getBucketOverspend } from '@/utils/bucketOverspend';
import { cn } from '@/utils/cn';

interface BudgetBucketCardProps {
  bucket: BudgetBucket;
  spent: { verified: number; pending: number };
  /**
   * The bucket's current-period transactions (newest first), grouped by the
   * parent with the SAME matching rules as `bucketSpentMap`, so the expanded
   * list exactly explains the spent figure. Must be referentially stable
   * across unrelated renders (the memo comparator relies on it).
   */
  transactions: Transaction[];
  /** Whether the inline transactions list is currently expanded. */
  isExpanded: boolean;
  isEditingLimit: boolean;
  onExpand: (id: string) => void;
  onEditBucket: (bucket: BudgetBucket) => void;
  onStartEditingLimit: (id: string) => void;
  onSaveLimit: (id: string, limit: number) => void;
  onCancelEdit: () => void;
  onReallocate: (targetId: string) => void;
  onEditTransaction: (transaction: Transaction) => void;
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
    prev.transactions === next.transactions &&
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

/**
 * A single grouped-flat row for one budget bucket — lives inside the page-level
 * `SurfaceList` in `BudgetBuckets`. Tapping the name/chevron expands the row
 * inline (disclosure pattern, same as `CreditCardActivityWidget`) to list the
 * transactions that hit this bucket in the current period. The limit edit and
 * the bucket edit (pencil) keep their own dedicated affordances, so expanding
 * never collides with editing.
 */
export const BudgetBucketCard: React.FC<BudgetBucketCardProps> = memo(({
  bucket,
  spent,
  transactions,
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
  const fmt = useFormatCurrency();
  const { isOverspent, overage, percent } = getBucketOverspend(spent, bucket.limit);
  const transactionCount = transactions.length;
  const detailId = `bucket-transactions-${bucket.id}`;

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
    <Row className="flex-col items-stretch gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onExpand(bucket.id)}
          className="flex items-center gap-3 min-w-0 flex-1 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-btn"
          aria-expanded={isExpanded}
          aria-controls={detailId}
          aria-label={`View ${transactionCount} transactions for ${bucket.name}`}
        >
          <span className={`w-3 h-3 rounded-full shrink-0 ${bucketColorClass(bucket.color)}`} aria-hidden="true" />
          <span className="font-semibold tracking-tight text-brand-900 dark:text-brand-100 text-base truncate">{bucket.name}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-brand-300 dark:text-brand-500 transition-transform duration-(--duration-base) ease-(--ease-standard)',
              isExpanded && 'rotate-180'
            )}
          />
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-sm font-medium flex flex-col items-end">
            <div className={`flex items-center gap-1 ${isOverspent ? 'text-money-neg dark:text-money-negDark font-bold' : 'text-brand-700 dark:text-brand-200'}`}>
              <span className="font-mono tabular-nums tracking-tight font-bold" aria-label={`Verified spending: ${fmt(spent.verified)}`}>{fmt(spent.verified)}</span>
              {spent.pending > 0 && (
                <span className="text-brand-400 dark:text-brand-450 font-mono text-xs">
                  +{fmt(spent.pending)}
                </span>
              )}
              <span className="text-brand-300 dark:text-brand-500 font-light">/</span>

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
                    className="text-money-pos dark:text-money-posDark hover:bg-money-bgPos dark:hover:bg-money-pos/15"
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
                  className="font-mono tabular-nums text-brand-400 dark:text-brand-450 border-b border-dashed border-brand-300 dark:border-brand-600 cursor-pointer hover:text-brand-600 dark:hover:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-xs"
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

          {/* Edit Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEditBucket(bucket)}
            className="min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 text-brand-300 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300"
            aria-label={`Edit ${bucket.name} bucket`}
          >
            <Pencil size={14} />
          </Button>
        </div>
      </div>

      {/* Progress Bar — an overspent bucket gets a distinct treatment: the whole
          track tints into the negative-money zone (not just the fill) so the bar
          reads as "past the line" at a glance, no side-stripe or boxed alert. */}
      <ProgressBar
        value={percent}
        barClassName={isOverspent ? 'bg-money-neg' : bucketColorClass(bucket.color)}
        ariaLabel={
          isOverspent
            ? `${bucket.name} spending: ${fmt(overage)} over the ${fmt(bucket.limit, { decimals: 0 })} limit`
            : `${bucket.name} spending: ${Math.round(percent)}% of ${fmt(bucket.limit, { decimals: 0 })} limit`
        }
        className={cn(
          'h-2',
          isOverspent ? 'bg-money-bgNeg dark:bg-money-neg/20' : 'bg-brand-100 dark:bg-brand-700'
        )}
      />

      {/* Inline transactions disclosure — the current-period transactions that
          make up this bucket's spent figure, hairline-divided. */}
      {isExpanded && (
        <div
          id={detailId}
          className="animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
        >
          {transactionCount === 0 ? (
            <p className="py-1 text-xs text-brand-400 dark:text-brand-450">
              No transactions yet this period
            </p>
          ) : (
            <>
              <p className="mb-1 text-xxs font-semibold text-brand-400 dark:text-brand-450 uppercase tracking-wider">
                {transactionCount} transaction{transactionCount === 1 ? '' : 's'}
              </p>
              <ul className="divide-y divide-brand-100 dark:divide-brand-700/60">
                {transactions.map(tx => (
                  <li key={tx.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-900 dark:text-brand-100 truncate text-sm">{tx.merchant}</p>
                      <p className="text-xs text-brand-500 dark:text-brand-400 flex items-center gap-2 mt-0.5">
                        {format(parseISO(tx.date), 'MMM d')}
                        {tx.status === 'pending_review' && (
                          <Badge variant="warning" size="sm">Pending</Badge>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`font-mono tabular-nums font-bold text-sm mr-1 ${
                        tx.status === 'pending_review' ? 'text-brand-400 dark:text-brand-450' : 'text-brand-900 dark:text-brand-100'
                      }`}>
                        {fmt(tx.amount)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onEditTransaction(tx)}
                        className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300"
                        title="Edit transaction"
                        aria-label={`Edit transaction: ${tx.merchant || 'Unnamed'}`}
                      >
                        <Edit size={14} />
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() => onDeleteTransaction(tx.id)}
                        className="text-brand-400 dark:text-brand-450 hover:text-money-neg dark:hover:text-money-negDark"
                        title="Delete transaction"
                        aria-label={`Delete transaction: ${tx.merchant || 'Unnamed'}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Overspend line — plain typography, no boxed alert. States the overage
          in dollars so the consequence is felt, not just a maxed bar. */}
      {isOverspent && (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-money-neg dark:text-money-negDark text-xs font-bold">
            <AlertTriangle size={14} />
            {fmt(overage)} over budget
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReallocate(bucket.id)}
            className="text-money-neg dark:text-money-negDark border-money-neg/30 dark:border-money-neg/30 hover:bg-money-bgNeg dark:hover:bg-money-neg/15 text-xs py-1 rounded-btn"
          >
            Fix
          </Button>
        </div>
      )}
    </Row>
  );
}, arePropsEqual);

BudgetBucketCard.displayName = 'BudgetBucketCard';
