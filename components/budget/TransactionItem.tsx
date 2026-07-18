import { memo } from 'react';
import { History, FileText, ArrowUpRight, ArrowDownLeft, Edit, Trash2, CheckSquare, Copy, Scissors, MoreVertical, MessageSquare } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Transaction, INCOME_CATEGORY } from '@/types/schema';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Row } from '@/components/ui/Section';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

// --- Helper Functions ---

const getSourceIcon = (source: string, isRecurring: boolean) => {
  if (isRecurring) return <History size={12} className="text-warm-500" />;
  if (source === 'camera-scan' || source === 'file-upload') return <FileText size={12} className="text-habit-blue" />;
  return null;
};

const getSanitizedLabel = (name: string, action: string) => {
  // Replace all non-alphanumeric chars (except spaces) with nothing
  // Then replace multiple spaces with single space
  const sanitizedName = name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const truncatedName = sanitizedName.length > 30 ? `${sanitizedName.slice(0, 30)}...` : sanitizedName;
  return `${action} transaction from ${truncatedName}`;
};

// --- Memoized Transaction Item Component ---

export interface TransactionItemProps {
  transaction: Transaction;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onDuplicate: (tx: Transaction) => void;
  onSplit: (tx: Transaction) => void;
  onMore?: (tx: Transaction) => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
}

/**
 * A single hairline-divided row inside the virtualized `TransactionMasterList`.
 * Renders as a `Row` (no per-item border/bg-white/rounded-card) so 90+ stacked
 * transactions read as one flat list, not 90 stacked cards. The virtualizer
 * measures the height of the ABSOLUTE-positioned wrapper `TransactionMasterList`
 * renders around this component, so row-height behavior stays unchanged.
 */
export const TransactionItem = memo(({ transaction: tx, onEdit, onDelete, onDuplicate, onSplit, onMore, isSelectionMode, isSelected, onToggleSelection }: TransactionItemProps) => {
  const fmt = useFormatCurrency();
  return (
    <Row
      interactive
      onClick={() => isSelectionMode && onToggleSelection(tx.id)}
      role={isSelectionMode ? 'checkbox' : undefined}
      aria-checked={isSelectionMode ? isSelected : undefined}
      tabIndex={isSelectionMode ? 0 : undefined}
      onKeyDown={isSelectionMode ? (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggleSelection(tx.id);
        }
      } : undefined}
      className={`justify-between group ${isSelected ? 'bg-brand-50 dark:bg-brand-700/40' : ''}`}
    >
      <div className="flex items-center gap-4 overflow-hidden">
        {/* Selection Checkbox */}
        {isSelectionMode && (
          <div
            aria-label="Select transaction"
            aria-hidden="true"
            className={`shrink-0 transition-colors ${isSelected ? 'text-accent-700 dark:text-accent-300' : 'text-brand-300 dark:text-brand-500'}`}
          >
            {isSelected ? <CheckSquare size={20} /> : <div className="w-5 h-5 border-2 border-current rounded-md" />}
          </div>
        )}

        <div className={`w-11 h-11 rounded-card flex items-center justify-center shrink-0 border ${
           tx.category === INCOME_CATEGORY
            ? 'bg-money-bgPos dark:bg-money-pos/15 border-money-pos/20 text-money-pos dark:text-money-posDark'
            : 'bg-brand-100 dark:bg-brand-700/50 border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-400'
        }`}>
          {tx.category === INCOME_CATEGORY ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold tracking-tight text-brand-900 dark:text-brand-100 truncate text-base">{tx.merchant}</p>
            {getSourceIcon(tx.source, tx.isRecurring)}
          </div>
          {/* Meta line — `truncate` on a flex CONTAINER can't ellipsize: the
              flex children just clipped mid-word ("Grocer", "Utiliti") at
              narrow widths. At 375px the date alone fills the column, so below
              `sm` the line WRAPS and the category/store drop whole onto a
              second line instead of chopping; from `sm` up it stays one line
              with each shrinkable segment (`truncate min-w-0`) ellipsizing
              itself. Row heights may grow a line on mobile — fine, the
              virtualizer measures rows dynamically via measureElement. */}
          <p className="text-xs font-medium text-brand-500 dark:text-brand-400 min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
            <span className="shrink-0 whitespace-nowrap">{format(parseISO(tx.date), 'MMM d, yyyy')}</span>
            <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
            <span className="truncate min-w-0 font-medium text-brand-600 dark:text-brand-300">{tx.category}</span>
            {tx.store && (
              <>
                <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                <span className="truncate min-w-0 font-medium text-brand-600 dark:text-brand-300">{tx.store}</span>
              </>
            )}
            {/* F-DASH-04: this row is one slice of a receipt split into several
                categorized transactions — a purely visual grouping cue. */}
            {tx.receiptGroupId && (
              <>
                <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                <span
                  className="shrink-0 inline-flex items-center gap-0.5 font-medium text-brand-600 dark:text-brand-300"
                  aria-label="Part of a split receipt"
                  title="Part of a split receipt"
                >
                  <Scissors size={11} />
                  Split
                </span>
              </>
            )}
            {/* Plan 23: denormalized comment count, read-only — bumped by
                addTransactionComment/deleteTransactionComment. */}
            {!!tx.commentCount && tx.commentCount > 0 && (
              <>
                <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                <span
                  className="shrink-0 inline-flex items-center gap-0.5 font-medium text-brand-600 dark:text-brand-300"
                  aria-label={`${tx.commentCount} comment${tx.commentCount === 1 ? '' : 's'}`}
                >
                  <MessageSquare size={11} />
                  {tx.commentCount}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 pl-2">
        <div className="text-right">
          <p className={`font-mono font-bold tabular-nums tracking-tight text-base ${
            tx.category === INCOME_CATEGORY ? 'text-money-pos dark:text-money-posDark' : 'text-brand-900 dark:text-brand-100'
          }`}>
            {tx.category === INCOME_CATEGORY ? '+' : ''}{fmt(tx.amount)}
          </p>
          {tx.status === 'pending_review' && (
            <Badge variant="warning" size="sm">
              Pending
            </Badge>
          )}
        </div>

        {/* Actions - HIDDEN IN SELECTION MODE */}
        {!isSelectionMode && (
          <>
            {/* Desktop: Hover Actions */}
            <div className="hidden sm:flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-btn"
                aria-label={getSanitizedLabel(tx.merchant, 'Edit')}
              >
                <Edit size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onDuplicate(tx); }}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-btn"
                aria-label={getSanitizedLabel(tx.merchant, 'Duplicate')}
              >
                <Copy size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onSplit(tx); }}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-btn"
                aria-label={getSanitizedLabel(tx.merchant, 'Split')}
              >
                <Scissors size={16} />
              </Button>
              <Button
                variant="ghost-destructive"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onDelete(tx); }}
                className="text-brand-400 dark:text-brand-450 hover:text-money-neg dark:hover:text-money-negDark hover:bg-money-bgNeg dark:hover:bg-money-neg/15 rounded-btn"
                aria-label={getSanitizedLabel(tx.merchant, 'Delete')}
              >
                <Trash2 size={16} />
              </Button>
            </div>

            {/* Mobile: More Button */}
            {onMore && (
              <div className="flex sm:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => { e.stopPropagation(); onMore(tx); }}
                  className="text-brand-400 dark:text-brand-450 active:bg-brand-100 dark:active:bg-brand-700/50 rounded-btn"
                  aria-label={getSanitizedLabel(tx.merchant, 'More options')}
                >
                  <MoreVertical size={20} />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Row>
  );
}, (prevProps, nextProps) => {
  // Custom comparator to handle reference instability from Firestore
  const p = prevProps.transaction;
  const n = nextProps.transaction;

  return (
    p.id === n.id &&
    p.amount === n.amount &&
    p.merchant === n.merchant &&
    p.category === n.category &&
    p.date === n.date &&
    p.status === n.status &&
    p.source === n.source &&
    p.isRecurring === n.isRecurring &&
    p.store === n.store &&
    p.commentCount === n.commentCount &&
    p.receiptGroupId === n.receiptGroupId &&
    // Ignored props: payPeriodId, autoCategorized, relatedHabitIds
    // These fields do not affect the rendering of this component.
    // Excluding them prevents unnecessary re-renders when backend-only fields change
    // or when Firestore returns new array references for relatedHabitIds.
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onDuplicate === nextProps.onDuplicate &&
    prevProps.onSplit === nextProps.onSplit &&
    prevProps.onMore === nextProps.onMore &&
    prevProps.isSelectionMode === nextProps.isSelectionMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onToggleSelection === nextProps.onToggleSelection
  );
});

TransactionItem.displayName = 'TransactionItem';
