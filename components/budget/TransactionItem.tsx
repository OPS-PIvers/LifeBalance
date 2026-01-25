import React, { memo } from 'react';
import { History, FileText, ArrowUpRight, ArrowDownLeft, Edit, Trash2, CheckSquare, Copy, Scissors } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Transaction } from '../../types/schema';

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
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
}

export const TransactionItem = memo(({ transaction: tx, onEdit, onDelete, onDuplicate, onSplit, isSelectionMode, isSelected, onToggleSelection }: TransactionItemProps) => {
  return (
    <div
      onClick={() => isSelectionMode && onToggleSelection(tx.id)}
      className={`p-3 rounded-xl border shadow-sm flex items-center justify-between transition-colors group cursor-pointer ${
        isSelected
          ? 'bg-brand-50 border-brand-300'
          : 'bg-white border-brand-100 hover:border-brand-300'
      }`}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        {/* Selection Checkbox */}
        {isSelectionMode && (
          <div className={`shrink-0 transition-colors ${isSelected ? 'text-brand-600' : 'text-brand-200'}`}>
            {isSelected ? <CheckSquare size={20} /> : <div className="w-5 h-5 border-2 border-current rounded" />}
          </div>
        )}

        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
           tx.category === 'Income' ? 'bg-green-100 text-green-600' : 'bg-brand-100 text-brand-600'
        }`}>
          {tx.category === 'Income' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-brand-800 truncate">{tx.merchant}</p>
            {getSourceIcon(tx.source, tx.isRecurring)}
          </div>
          <p className="text-xs text-brand-500 truncate flex items-center gap-1">
            {format(parseISO(tx.date), 'MMM d, yyyy')}
            <span className="w-1 h-1 rounded-full bg-brand-300" />
            <span className="font-medium text-brand-600">{tx.category}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 pl-2">
        <div className="text-right">
          <p className={`font-mono font-bold ${
            tx.category === 'Income' ? 'text-green-600' : 'text-brand-800'
          }`}>
            {tx.category === 'Income' ? '+' : ''}${tx.amount.toFixed(2)}
          </p>
          {tx.status === 'pending_review' && (
            <p className="text-xxs text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded-full inline-block">
              Pending
            </p>
          )}
        </div>

        {/* Actions (visible on mobile, enhanced on hover for desktop) - HIDDEN IN SELECTION MODE */}
        {!isSelectionMode && (
          <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
              className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              aria-label={getSanitizedLabel(tx.merchant, 'Edit')}
            >
              <Edit size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(tx); }}
              className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              aria-label={getSanitizedLabel(tx.merchant, 'Duplicate')}
            >
              <Copy size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSplit(tx); }}
              className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              aria-label={getSanitizedLabel(tx.merchant, 'Split')}
            >
              <Scissors size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(tx); }}
              className="p-2 text-brand-400 hover:text-money-neg hover:bg-rose-50 rounded-lg transition-colors"
              aria-label={getSanitizedLabel(tx.merchant, 'Delete')}
            >
              <Trash2 size={16} />
            </button>
          </div>
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
    p.autoCategorized === n.autoCategorized &&
    p.payPeriodId === n.payPeriodId &&
    // Shallow check for relatedHabitIds since they are typically replaced not mutated in Firestore
    p.relatedHabitIds === n.relatedHabitIds &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onDuplicate === nextProps.onDuplicate &&
    prevProps.onSplit === nextProps.onSplit &&
    prevProps.isSelectionMode === nextProps.isSelectionMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onToggleSelection === nextProps.onToggleSelection
  );
});

TransactionItem.displayName = 'TransactionItem';
