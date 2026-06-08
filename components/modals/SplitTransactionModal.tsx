import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Loader2, AlertCircle, Scissors } from 'lucide-react';
import { Transaction } from '@/types/schema';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { sumMoney, subtractMoney } from '@/utils/money';
import { Drawer } from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import toast from 'react-hot-toast';

interface SplitTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

interface SplitItem {
  id: string;
  amount: string;
  merchant: string;
  category: string;
}

const SplitTransactionModal: React.FC<SplitTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { splitTransaction, buckets } = useFinance();
  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dynamic Categories from buckets
  const dynamicCategories = useMemo(() =>
    [...buckets.map(b => b.name), 'Budgeted in Calendar'].sort(),
  [buckets]);

  // Initialize splits when transaction changes or modal opens
  useEffect(() => {
    if (transaction && isOpen) {
      setSplits([
        {
          id: crypto.randomUUID(),
          amount: transaction.amount.toString(),
          merchant: transaction.merchant,
          category: transaction.category
        },
        {
          id: crypto.randomUUID(),
          amount: '0',
          merchant: transaction.merchant, // Default to same merchant
          category: ''
        }
      ]);
    }
  }, [transaction, isOpen]);

  // Calculate totals
  const totalAmount = transaction?.amount || 0;
  const currentTotal = sumMoney(splits.map(item => parseFloat(item.amount) || 0));
  const remaining = subtractMoney(totalAmount, currentTotal);
  const isValidTotal = Math.abs(remaining) < 0.01;

  const handleAddSplit = () => {
    setSplits(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        amount: '0',
        merchant: transaction?.merchant || '',
        category: ''
      }
    ]);
  };

  const handleRemoveSplit = (id: string) => {
    if (splits.length <= 2) {
      toast.error('Must have at least 2 splits');
      return;
    }
    setSplits(prev => prev.filter(s => s.id !== id));
  };

  const updateSplit = (id: string, field: keyof SplitItem, value: string) => {
    setSplits(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleSplit = async () => {
    if (!transaction || isProcessing) return;

    if (!isValidTotal) {
      toast.error(`Total must equal $${totalAmount.toFixed(2)}`);
      return;
    }

    // Validate fields
    for (const split of splits) {
      const amt = parseFloat(split.amount);
      if (isNaN(amt) || amt <= 0) {
        toast.error('All amounts must be positive');
        return;
      }
      if (!split.merchant.trim()) {
        toast.error('All items must have a merchant name');
        return;
      }
      if (!split.category) {
        toast.error('All items must have a category');
        return;
      }
    }

    setIsProcessing(true);
    try {
      const newTransactions = splits.map((split): Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'> => ({
        amount: parseFloat(split.amount),
        merchant: split.merchant.trim(),
        category: split.category,
        date: transaction.date,
        status: 'verified', // Auto-verify splits as they are explicit user actions
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        relatedHabitIds: [], // Don't carry over habit links
      }));

      await splitTransaction(transaction.id, newTransactions);
      onClose();
    } catch (error) {
      console.error('Failed to split transaction:', error);
      // Context already handles error toast
    } finally {
      setIsProcessing(false);
    }
  };

  if (!transaction) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Split Transaction"
      disableClose={isProcessing}
      noPadding={true}
    >
      <div className="p-4 bg-brand-50 dark:bg-slate-700/50 border-b border-brand-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-bold text-brand-600 dark:text-slate-300">Original Transaction</span>
          <span className="text-lg font-bold text-brand-800 dark:text-slate-100">${totalAmount.toFixed(2)}</span>
        </div>
        <div className="text-xs text-brand-400 dark:text-slate-400">
          {transaction.merchant} • {transaction.date}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {splits.map((split, index) => (
          <div key={split.id} className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-brand-200 dark:border-slate-700 shadow-sm relative group">
            <div className="absolute top-2 left-2 text-xs font-bold text-brand-300 dark:text-slate-500">
              Split #{index + 1}
            </div>

            {splits.length > 2 && (
              <button
                onClick={() => handleRemoveSplit(split.id)}
                className="absolute top-2 right-2 text-gray-300 dark:text-slate-600 hover:text-money-neg p-1 hover:bg-rose-50 dark:hover:bg-rose-500/20 rounded transition-colors"
                title="Remove split"
                aria-label={`Remove split ${index + 1}`}
              >
                <Trash2 size={16} />
              </button>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mt-4">
               {/* Amount */}
              <div className="sm:col-span-3">
                <Input
                  id={`split-amount-${split.id}`}
                  label="Amount"
                  type="number"
                  step="0.01"
                  value={split.amount}
                  onChange={(e) => updateSplit(split.id, 'amount', e.target.value)}
                  placeholder="0.00"
                  icon={<span>$</span>}
                  disabled={isProcessing}
                />
              </div>

              {/* Merchant */}
              <div className="sm:col-span-5">
                <Input
                  id={`split-merchant-${split.id}`}
                  label="Merchant / Description"
                  type="text"
                  value={split.merchant}
                  onChange={(e) => updateSplit(split.id, 'merchant', e.target.value)}
                  placeholder="Store name"
                  disabled={isProcessing}
                />
              </div>

              {/* Category */}
              <div className="sm:col-span-4">
                <Select
                  id={`split-category-${split.id}`}
                  label="Category"
                  value={split.category}
                  onChange={(e) => updateSplit(split.id, 'category', e.target.value)}
                  disabled={isProcessing}
                >
                  <option value="">Select Category</option>
                  {dynamicCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        ))}

        <button
          onClick={handleAddSplit}
          disabled={isProcessing}
          className="w-full py-3 border-2 border-dashed border-brand-200 dark:border-slate-700 rounded-xl text-brand-400 dark:text-slate-400 font-bold text-sm hover:border-brand-400 dark:hover:border-slate-500 hover:text-brand-600 dark:hover:text-slate-300 hover:bg-brand-50 dark:hover:bg-slate-700/50 transition-all flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Add Another Split
        </button>
      </div>

      <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-brand-100 dark:border-slate-700 p-4 space-y-3">
        {/* Validation Status */}
        <div className={`flex items-center justify-between text-sm font-bold px-1 ${isValidTotal ? 'text-emerald-600 dark:text-emerald-300' : 'text-money-neg'}`}>
          <div className="flex items-center gap-2">
            {!isValidTotal && <AlertCircle size={16} />}
            <span>{isValidTotal ? 'Total Matches' : 'Total Mismatch'}</span>
          </div>
          <div className="text-right">
             <div>Total: ${currentTotal.toFixed(2)}</div>
             {!isValidTotal && (
               <div className="text-xs opacity-80">
                 {remaining > 0 ? `Remaining: $${remaining.toFixed(2)}` : `Over: $${Math.abs(remaining).toFixed(2)}`}
               </div>
             )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 py-3 bg-brand-100 dark:bg-slate-700/50 text-brand-600 dark:text-slate-300 font-bold rounded-xl hover:bg-brand-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSplit}
            disabled={isProcessing || !isValidTotal}
            className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Splitting...</span>
              </>
            ) : (
              <>
                <Scissors size={18} />
                <span>Split Transaction</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Drawer>
  );
};

export default SplitTransactionModal;
