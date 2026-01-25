import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Loader2, Scissors, Calculator, AlertCircle } from 'lucide-react';
import { Transaction } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Modal } from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import toast from 'react-hot-toast';

interface SplitTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

interface SplitItem {
  id: string;
  amount: string; // Keep as string for input handling
  merchant: string;
  category: string;
}

const SplitTransactionModal: React.FC<SplitTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { addTransaction, deleteTransaction, buckets } = useHousehold();
  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Dynamic Categories from buckets
  const dynamicCategories = useMemo(() =>
    [...buckets.map(b => b.name), 'Budgeted in Calendar'],
    [buckets]
  );

  // Initialize splits when transaction opens
  useEffect(() => {
    if (transaction && isOpen) {
      setSplits([
        {
          id: crypto.randomUUID(),
          amount: transaction.amount.toFixed(2),
          merchant: transaction.merchant,
          category: transaction.category,
        },
        {
          id: crypto.randomUUID(),
          amount: '0.00',
          merchant: transaction.merchant,
          category: dynamicCategories[0] || 'Uncategorized',
        }
      ]);
    }
  }, [transaction, isOpen, dynamicCategories]);

  // Calculations
  const totalAmount = transaction?.amount || 0;

  const allocatedAmount = useMemo(() => {
    return splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
  }, [splits]);

  const remainingAmount = totalAmount - allocatedAmount;
  const isBalanced = Math.abs(remainingAmount) < 0.01;

  const handleAddSplit = () => {
    setSplits(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        amount: Math.max(0, remainingAmount).toFixed(2),
        merchant: transaction?.merchant || '',
        category: dynamicCategories[0] || 'Uncategorized',
      }
    ]);
  };

  const handleRemoveSplit = (id: string) => {
    if (splits.length <= 2) {
      toast.error("Must have at least 2 splits");
      return;
    }
    setSplits(prev => prev.filter(s => s.id !== id));
  };

  const updateSplit = (id: string, field: keyof SplitItem, value: string) => {
    setSplits(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleSave = async () => {
    if (!transaction || isSaving) return;

    if (!isBalanced) {
      toast.error(`Amounts must equal $${totalAmount.toFixed(2)}`);
      return;
    }

    // Validate all splits have valid data
    const validSplits = splits.map(s => ({
      amount: parseFloat(s.amount),
      merchant: s.merchant.trim(),
      category: s.category
    }));

    if (validSplits.some(s => isNaN(s.amount) || s.amount <= 0)) {
      toast.error("All splits must have valid positive amounts");
      return;
    }
    if (validSplits.some(s => !s.merchant)) {
      toast.error("All splits must have a merchant name");
      return;
    }

    setIsSaving(true);
    try {
      // 1. Create new transactions
      const promises = validSplits.map(split =>
        addTransaction({
          amount: split.amount,
          merchant: split.merchant,
          category: split.category,
          date: transaction.date, // Keep original date
          status: 'verified', // Splits are verified by definition
          isRecurring: false,
          source: 'manual', // Explicitly manual since user created it
          autoCategorized: false,
          // payPeriodId will be auto-assigned by addTransaction logic
        } as unknown as Transaction)
      );

      await Promise.all(promises);

      // 2. Delete original transaction
      await deleteTransaction(transaction.id);

      toast.success(`Split into ${splits.length} transactions`);
      onClose();
    } catch (error) {
      console.error('Failed to split transaction:', error);
      toast.error('Failed to split transaction');
    } finally {
      setIsSaving(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="split-transaction-title"
      disableBackdropClose={isSaving}
    >
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-brand-100 p-4 flex justify-between items-center shrink-0 z-10">
        <div>
          <h2 id="split-transaction-title" className="text-lg font-bold text-brand-800 flex items-center gap-2">
            <Scissors size={20} className="text-brand-600" />
            Split Transaction
          </h2>
          <p className="text-xs text-brand-500">
            Original: <span className="font-bold text-brand-700">{transaction.merchant}</span> • ${transaction.amount.toFixed(2)}
          </p>
        </div>
        <button
          onClick={onClose}
          disabled={isSaving}
          className="text-brand-400 hover:text-brand-600 rounded-lg p-1"
        >
          <X size={20} />
        </button>
      </div>

      {/* Split List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {splits.map((split, index) => (
          <div key={split.id} className="bg-brand-50 p-3 rounded-xl border border-brand-200 relative animate-in slide-in-from-left-2 duration-300" style={{ animationDelay: `${index * 50}ms` }}>
            <div className="absolute -left-2 -top-2 w-6 h-6 bg-brand-200 text-brand-700 rounded-full flex items-center justify-center text-xs font-bold shadow-sm">
              {index + 1}
            </div>

            {splits.length > 2 && (
              <button
                onClick={() => handleRemoveSplit(split.id)}
                className="absolute top-2 right-2 text-brand-400 hover:text-money-neg transition-colors"
                title="Remove split"
              >
                <Trash2 size={16} />
              </button>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3 pt-2">
              <Input
                id={`split-amount-${index}`}
                label="Amount"
                type="number"
                value={split.amount}
                onChange={(e) => updateSplit(split.id, 'amount', e.target.value)}
                icon={<span>$</span>}
                placeholder="0.00"
              />
              <Select
                id={`split-category-${index}`}
                label="Category"
                value={split.category}
                onChange={(e) => updateSplit(split.id, 'category', e.target.value)}
              >
                {dynamicCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </Select>
            </div>
            <Input
              id={`split-merchant-${index}`}
              label="Merchant / Details"
              type="text"
              value={split.merchant}
              onChange={(e) => updateSplit(split.id, 'merchant', e.target.value)}
              placeholder="Merchant Name"
            />
          </div>
        ))}

        <button
          onClick={handleAddSplit}
          className="w-full py-3 border-2 border-dashed border-brand-200 text-brand-500 rounded-xl hover:bg-brand-50 hover:border-brand-300 transition-all flex items-center justify-center gap-2 font-medium"
        >
          <Plus size={18} />
          Add Another Split
        </button>
      </div>

      {/* Footer / Summary */}
      <div className="sticky bottom-0 bg-white border-t border-brand-100 p-4 space-y-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {/* Balance Indicator */}
        <div className="flex items-center justify-between text-sm">
           <div className="flex flex-col">
             <span className="text-brand-400 text-xs">Total</span>
             <span className="font-bold text-brand-800">${totalAmount.toFixed(2)}</span>
           </div>

           <div className="flex flex-col items-center">
             <span className="text-brand-400 text-xs">Allocated</span>
             <span className={`font-bold ${allocatedAmount > totalAmount ? 'text-money-neg' : 'text-brand-800'}`}>
               ${allocatedAmount.toFixed(2)}
             </span>
           </div>

           <div className="flex flex-col items-end">
             <span className="text-brand-400 text-xs">Remaining</span>
             <span className={`font-bold flex items-center gap-1 ${
               Math.abs(remainingAmount) < 0.01
                 ? 'text-money-safe'
                 : 'text-money-neg'
             }`}>
               {Math.abs(remainingAmount) < 0.01 ? <Calculator size={14} /> : <AlertCircle size={14} />}
               ${remainingAmount.toFixed(2)}
             </span>
           </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !isBalanced}
            className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-900/20"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <Scissors size={18} />
                <span>Split & Save</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SplitTransactionModal;
