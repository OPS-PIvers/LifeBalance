import React, { memo } from 'react';
import { History, FileText, ArrowUpRight, ArrowDownLeft, Edit, Trash2, CheckSquare, Copy, Scissors, MoreVertical } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Transaction, INCOME_CATEGORY } from '../../types/schema';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

// --- Helper Functions ---

const getSourceIcon = (source: string, isRecurring: boolean) => {
  if (isRecurring) return <History size={12} className="text-purple-500" />;
  if (source === 'camera-scan' || source === 'file-upload') return <FileText size={12} className="text-blue-500" />;
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

export const TransactionItem = memo(({ transaction: tx, onEdit, onDelete, onDuplicate, onSplit, onMore, isSelectionMode, isSelected, onToggleSelection }: TransactionItemProps) => {
  return (
    <div
      onClick={() => isSelectionMode && onToggleSelection(tx.id)}
      className={`p-4 rounded-2xl border shadow-sm flex items-center justify-between transition-all group cursor-pointer ${
        isSelected
          ? 'bg-slate-50 border-slate-300 ring-1 ring-slate-300'
          : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-4 overflow-hidden">
        {/* Selection Checkbox */}
        {isSelectionMode && (
          <div className={`shrink-0 transition-colors ${isSelected ? 'text-slate-900' : 'text-slate-300'}`}>
            {isSelected ? <CheckSquare size={20} /> : <div className="w-5 h-5 border-2 border-current rounded-md" />}
          </div>
        )}

        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
           tx.category === INCOME_CATEGORY ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-500'
        }`}>
          {tx.category === INCOME_CATEGORY ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900 truncate text-base">{tx.merchant}</p>
            {getSourceIcon(tx.source, tx.isRecurring)}
          </div>
          <p className="text-xs text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
            {format(parseISO(tx.date), 'MMM d, yyyy')}
            <span className="w-1 h-1 rounded-full bg-slate-300" />
            <span className="font-medium text-slate-600">{tx.category}</span>
            {tx.store && (
              <>
                <span className="w-1 h-1 rounded-full bg-slate-300" />
                <span className="font-medium text-slate-600">{tx.store}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 pl-2">
        <div className="text-right">
          <p className={`font-mono font-semibold text-base ${
            tx.category === INCOME_CATEGORY ? 'text-emerald-600' : 'text-slate-900'
          }`}>
            {tx.category === INCOME_CATEGORY ? '+' : ''}${tx.amount.toFixed(2)}
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
            <div className="hidden sm:flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
                className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                aria-label={getSanitizedLabel(tx.merchant, 'Edit')}
              >
                <Edit size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onDuplicate(tx); }}
                className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                aria-label={getSanitizedLabel(tx.merchant, 'Duplicate')}
              >
                <Copy size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onSplit(tx); }}
                className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                aria-label={getSanitizedLabel(tx.merchant, 'Split')}
              >
                <Scissors size={16} />
              </Button>
              <Button
                variant="ghost-destructive"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onDelete(tx); }}
                className="text-brand-400 hover:text-money-neg hover:bg-rose-50 rounded-lg"
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
                  className="text-brand-400 active:bg-brand-100 rounded-lg"
                  aria-label={getSanitizedLabel(tx.merchant, 'More options')}
                >
                  <MoreVertical size={20} />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
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
