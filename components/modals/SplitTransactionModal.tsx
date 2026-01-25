import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Loader2, AlertCircle, Scissors } from 'lucide-react';
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
  amount: string;
  merchant: string;
  category: string;
}

const SplitTransactionModal: React.FC<SplitTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { addTransaction, deleteTransaction, buckets } = useHousehold();
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
  const currentTotal = splits.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const remaining = totalAmount - currentTotal;
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
      // 1. Create new transactions
      const promises = splits.map(split =>
        addTransaction({
          amount: parseFloat(split.amount),
          merchant: split.merchant.trim(),
          category: split.category,
          date: transaction.date,
          status: 'verified', // Auto-verify splits as they are explicit user actions
          isRecurring: false,
          source: 'manual',
          autoCategorized: false,
          // Explicitly do not inherit IDs or timestamps
        } as unknown as Transaction)
      );

      await Promise.all(promises);

      // 2. Delete original transaction
      await deleteTransaction(transaction.id);

      toast.success('Transaction split successfully');
      onClose();
    } catch (error) {
      console.error('Failed to split transaction:', error);
      toast.error('Failed to split transaction');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="split-transaction-title"
      disableBackdropClose={isProcessing}
      maxWidth="max-w-2xl"
    >
      <div className="sticky top-0 bg-white border-b border-brand-100 p-4 flex justify-between items-center shrink-0 z-10">
        <div className="flex items-center gap-2">
          <Scissors className="text-brand-600" size={20} />
          <h2 id="split-transaction-title" className="text-lg font-bold text-brand-800">
            Split Transaction
          </h2>
        </div>
        <button
          onClick={onClose}
          disabled={isProcessing}
          className="text-brand-400 hover:text-brand-600 p-1 hover:bg-brand-50 rounded-lg transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="p-4 bg-brand-50 border-b border-brand-100">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-bold text-brand-600">Original Transaction</span>
          <span className="text-lg font-bold text-brand-800">${totalAmount.toFixed(2)}</span>
        </div>
        <div className="text-xs text-brand-400">
          {transaction.merchant} • {transaction.date}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[60vh]">
        {splits.map((split, index) => (
          <div key={split.id} className="p-4 bg-white rounded-xl border border-brand-200 shadow-sm relative group">
            <div className="absolute top-2 left-2 text-xs font-bold text-brand-300">
              Split #{index + 1}
            </div>

            {splits.length > 2 && (
              <button
                onClick={() => handleRemoveSplit(split.id)}
                className="absolute top-2 right-2 text-gray-300 hover:text-money-neg p-1 hover:bg-rose-50 rounded transition-colors"
                title="Remove split"
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
          className="w-full py-3 border-2 border-dashed border-brand-200 rounded-xl text-brand-400 font-bold text-sm hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-all flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Add Another Split
        </button>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-brand-100 p-4 space-y-3">
        {/* Validation Status */}
        <div className={`flex items-center justify-between text-sm font-bold px-1 ${isValidTotal ? 'text-emerald-600' : 'text-money-neg'}`}>
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
            className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50"
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
    </Modal>
  );
};

export default SplitTransactionModal;
