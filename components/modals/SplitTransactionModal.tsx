import React, { useState, useMemo } from 'react';
import { Plus, Trash2, AlertCircle, Scissors } from 'lucide-react';
import { Transaction } from '@/types/schema';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { sumMoney, subtractMoney } from '@/utils/money';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { SurfaceList, Row } from '@/components/ui/Section';
import { buildTransactionCategoryOptions } from '@/utils/categories';
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
  const fmt = useFormatCurrency();
  // Friendly name for the read-only "Original Transaction" summary only. The
  // seeded split rows below deliberately keep the RAW merchant: those values are
  // written to new transactions, and a display label must never become stored data.
  const { displayNameFor } = useMerchantRules();
  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dynamic Categories from buckets. Previously this list was fully
  // alphabetized (including the "Budgeted in Calendar" sentinel), which
  // diverged from every other category picker in the app. Standardized here
  // on the shared helper's order — buckets in stored order, sentinel always
  // last — so Split matches Edit/Capture/Review.
  const dynamicCategories = useMemo(() =>
    buildTransactionCategoryOptions(buckets),
  [buckets]);

  // Initialize splits when the transaction changes or the modal opens. Done
  // during render on that change edge rather than in an effect so it doesn't
  // trigger a cascading render. The tracker starts null so this also runs on
  // the first render, mirroring the previous effect (keyed on
  // `[transaction, isOpen]`) which ran on mount and on every change.
  const [prevKey, setPrevKey] = useState<{ transaction: Transaction | null; isOpen: boolean } | null>(null);
  if (prevKey === null || prevKey.transaction !== transaction || prevKey.isOpen !== isOpen) {
    setPrevKey({ transaction, isOpen });
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
  }

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
      toast.error(`Total must equal ${fmt(totalAmount)}`);
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
      footer={
        <div className="bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4 space-y-3">
          {/* Validation Status */}
          <div className={`flex items-center justify-between text-sm font-bold px-1 ${isValidTotal ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'}`}>
            <div className="flex items-center gap-2">
              {!isValidTotal && <AlertCircle size={16} />}
              <span>{isValidTotal ? 'Total Matches' : 'Total Mismatch'}</span>
            </div>
            <div className="text-right">
               <div>Total: {fmt(currentTotal)}</div>
               {!isValidTotal && (
                 <div className="text-xs opacity-80">
                   {remaining > 0 ? `Remaining: ${fmt(remaining)}` : `Over: ${fmt(Math.abs(remaining))}`}
                 </div>
               )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="lg"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              size="lg"
              onClick={handleSplit}
              disabled={!isValidTotal}
              isLoading={isProcessing}
              leftIcon={<Scissors size={18} />}
              className="flex-1"
            >
              <span>Split Transaction</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-4 bg-brand-50 dark:bg-brand-700/50 border-b border-brand-200 dark:border-brand-700">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-300">Original Transaction</span>
          <span className="text-lg font-bold text-brand-800 dark:text-brand-100">{fmt(totalAmount)}</span>
        </div>
        <div className="text-xs text-brand-400 dark:text-brand-400">
          {displayNameFor(transaction)} • {transaction.date}
        </div>
      </div>

      <div className="p-4 space-y-4">
        <SurfaceList>
          {splits.map((split, index) => (
            <Row key={split.id} className="flex-col items-stretch gap-3 py-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-brand-400 dark:text-brand-450">
                  Split #{index + 1}
                </span>

                {splits.length > 2 && (
                  <Button
                    variant="ghost-destructive"
                    size="icon-sm"
                    onClick={() => handleRemoveSplit(split.id)}
                    title="Remove split"
                    aria-label={`Remove split ${index + 1}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                 {/* Amount */}
                <div className="sm:col-span-3">
                  <Input
                    id={`split-amount-${split.id}`}
                    label="Amount"
                    type="number"
                    inputMode="decimal"
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
            </Row>
          ))}
        </SurfaceList>

        <Button
          variant="dashed"
          onClick={handleAddSplit}
          disabled={isProcessing}
          leftIcon={<Plus size={16} />}
          className="w-full"
        >
          Add Another Split
        </Button>
      </div>
    </Drawer>
  );
};

export default SplitTransactionModal;
