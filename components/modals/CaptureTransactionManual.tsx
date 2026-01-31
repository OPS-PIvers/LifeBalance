import React, { useState, useEffect, useMemo } from 'react';
import { Check, CheckCircle2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Transaction, Habit, BudgetBucket, Store, Account } from '../../types/schema';
import { suggestHabitsForTransaction } from '../../utils/habitSuggestions';
import { Button } from '../ui/Button';

interface CaptureTransactionManualProps {
  initialData?: {
    amount?: string;
    merchant?: string;
    category?: string;
    date?: string;
    subBucketId?: string;
    store?: string;
    accountId?: string;
  };
  onAddTransaction: (transaction: Transaction) => Promise<void>;
  onClose: () => void;
  dynamicCategories: string[];
  habits: Habit[];
  transactions: Transaction[];
  buckets: BudgetBucket[];
  stores: Store[];
  accounts: Account[];
}

export const CaptureTransactionManual: React.FC<CaptureTransactionManualProps> = ({
  initialData,
  onAddTransaction,
  onClose,
  dynamicCategories,
  habits,
  transactions,
  buckets,
  stores,
  accounts
}) => {
  // State with lazy initialization
  const [amount, setAmount] = useState(() => initialData?.amount || '');
  const [merchant, setMerchant] = useState(() => initialData?.merchant || '');

  const [category, setCategory] = useState(() => {
    if (initialData?.category && dynamicCategories.includes(initialData.category)) {
      return initialData.category;
    }
    if (dynamicCategories.length > 0) {
      return dynamicCategories[0];
    }
    return '';
  });

  const [subBucketId, setSubBucketId] = useState<string | undefined>(() => initialData?.subBucketId);
  const [store, setStore] = useState(() => initialData?.store || '');
  const [accountId, setAccountId] = useState(() => initialData?.accountId || '');

  const [isRecurring, setIsRecurring] = useState(false);
  const [transactionDate, setTransactionDate] = useState(() => initialData?.date || format(new Date(), 'yyyy-MM-dd'));
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get current bucket and its sub-buckets
  const currentBucket = useMemo(() => buckets.find(b => b.name === category), [buckets, category]);
  const availableSubBuckets = useMemo(() => currentBucket?.subBuckets || [], [currentBucket]);

  // Compute validated subBucketId (only valid if it exists in current bucket)
  const validatedSubBucketId = useMemo(() => {
    if (!subBucketId) return undefined;
    return availableSubBuckets.find(sb => sb.id === subBucketId)?.id;
  }, [subBucketId, availableSubBuckets]);

  // Default category update (if dynamicCategories loads late)
  useEffect(() => {
    if (!category && dynamicCategories.length > 0) {
      setCategory(dynamicCategories[0]);
    }
  }, [dynamicCategories, category]);

  // Smart habit suggestions for manual entry (based on merchant name)
  const suggestedHabits = useMemo(() => {
    if (!merchant.trim() || habits.length === 0) return [];
    return suggestHabitsForTransaction(merchant, habits, transactions, 5);
  }, [merchant, habits, transactions]);

  const handleManualSave = async () => {
    if (!amount || !merchant) {
      toast.error("Please fill in required fields");
      return;
    }

    // Validate merchant is not just whitespace
    const trimmedMerchant = merchant.trim();
    if (!trimmedMerchant) {
      toast.error("Please enter a merchant name");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (!transactionDate) {
      toast.error("Please select a date");
      return;
    }
    // Future dates are allowed - logic sets status to pending_review if future
    const today = format(new Date(), 'yyyy-MM-dd');
    const isFuture = transactionDate > today;

    if (!category || !dynamicCategories.includes(category)) {
      toast.error("Please select a valid category");
      return;
    }

    setIsSubmitting(true);
    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      amount: parsedAmount,
      merchant: trimmedMerchant,
      category,
      date: transactionDate,
      status: isFuture ? 'pending_review' : 'verified',
      isRecurring: isRecurring,
      source: 'manual',
      autoCategorized: false,
      relatedHabitIds: selectedHabitIds.length > 0 ? selectedHabitIds : undefined,
      subBucketId: validatedSubBucketId,
      store: store || undefined,
      accountId: accountId || undefined
    };

    try {
      await onAddTransaction(newTransaction);
      toast.success("Transaction saved!");
      onClose();
    } catch (error) {
      console.error("Failed to save transaction:", error, newTransaction);
      let errorMsg = 'Unknown error';
      if (error instanceof Error) {
        errorMsg = error.message;
      }
      toast.error(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="relative">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-brand-400">$</span>
          <input
            type="number"
            value={amount}
            aria-label="Amount"
            onChange={(e) => {
              const value = e.target.value;
              if (value === '' || parseFloat(value) >= 0) setAmount(value);
            }}
            onKeyDown={(e) => {
              if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
            }}
            placeholder="0.00"
            autoFocus
            step="0.01"
            min="0"
            className="w-full pl-8 text-4xl font-mono font-bold text-brand-800 placeholder:text-brand-200 outline-none text-center bg-transparent"
          />
        </div>
      </div>

      <div>
        <label htmlFor="manual-merchant" className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-1">Merchant</label>
        <input
          id="manual-merchant"
          type="text"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="e.g. Starbucks"
          className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-800 outline-none font-medium"
        />
      </div>

      <div>
        <label htmlFor="manual-date" className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-1">Date</label>
        <input
          id="manual-date"
          type="date"
          value={transactionDate}
          onChange={(e) => setTransactionDate(e.target.value)}
          className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-800 outline-none font-medium"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="manual-store" className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-1">Store (Optional)</label>
          <select
            id="manual-store"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-800 outline-none font-medium appearance-none"
          >
            <option value="">Select Store...</option>
            {stores.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="manual-account" className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-1">Account (Optional)</label>
          <select
            id="manual-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-800 outline-none font-medium appearance-none"
          >
            <option value="">Select Account...</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label id="manual-category-label" className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">Category</label>
        <div
          className="flex gap-2 overflow-x-auto pb-2 no-scrollbar"
          role="radiogroup"
          aria-labelledby="manual-category-label"
        >
          {dynamicCategories.length === 0 && <span className="text-sm text-brand-400">No buckets found.</span>}
          {dynamicCategories.map(cat => (
            <button
              key={cat}
              role="radio"
              aria-checked={category === cat}
              onClick={() => { setCategory(cat); setSubBucketId(undefined); }}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                category === cat
                  ? 'bg-brand-800 text-white'
                  : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Bucket Selection */}
      {availableSubBuckets.length > 0 && (
        <div>
          <label id="manual-subbucket-label" className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">
            Sub-Category (Optional)
          </label>
          <div
            className="flex gap-2 overflow-x-auto pb-2 no-scrollbar"
            role="radiogroup"
            aria-labelledby="manual-subbucket-label"
          >
            <button
              onClick={() => setSubBucketId(undefined)}
              role="radio"
              aria-checked={!subBucketId}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                !subBucketId
                  ? 'bg-brand-800 text-white'
                  : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
              }`}
            >
              None
            </button>
            {availableSubBuckets.map(sb => (
              <button
                key={sb.id}
                role="radio"
                aria-checked={subBucketId === sb.id}
                onClick={() => setSubBucketId(sb.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  subBucketId === sb.id
                    ? 'bg-brand-800 text-white'
                    : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
                }`}
              >
                {sb.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Habit Tagging Section */}
      {habits.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <label className="block text-xs font-semibold text-brand-400 uppercase tracking-wider">
              Connect Habits (Optional)
            </label>
            {suggestedHabits.some(s => s.confidence !== 'low') && (
              <Sparkles size={12} className="text-violet-500" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Show suggested habits first */}
            {suggestedHabits
              .filter(s => s.confidence === 'high' || s.confidence === 'medium')
              .map(({ habit, confidence }) => {
                const isSelected = selectedHabitIds.includes(habit.id);
                return (
                  <button
                    key={habit.id}
                    type="button"
                    onClick={() => {
                      setSelectedHabitIds(prev =>
                        isSelected
                          ? prev.filter(id => id !== habit.id)
                          : [...prev, habit.id]
                      );
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 relative ${
                      isSelected
                        ? 'bg-habit-green text-white shadow-sm'
                        : confidence === 'high'
                        ? 'bg-violet-50 border-2 border-violet-300 text-violet-700 hover:bg-violet-100'
                        : 'bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    {isSelected && <Check size={12} strokeWidth={3} />}
                    {habit.title}
                    {!isSelected && confidence === 'high' && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                    )}
                  </button>
                );
              })}

            {/* Show selected non-suggested habits */}
            {suggestedHabits
              .filter(s => s.confidence === 'low' && selectedHabitIds.includes(s.habit.id))
              .map(({ habit }) => (
                <button
                  key={habit.id}
                  type="button"
                  onClick={() => {
                    setSelectedHabitIds(prev => prev.filter(id => id !== habit.id));
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 bg-habit-green text-white shadow-sm"
                >
                  <Check size={12} strokeWidth={3} />
                  {habit.title}
                </button>
              ))}

            {/* "More" button to show all habits */}
            {suggestedHabits.filter(s => s.confidence === 'low' && !selectedHabitIds.includes(s.habit.id)).length > 0 && (
              <details className="inline">
                <summary className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 border border-brand-200 text-brand-500 hover:bg-brand-100 cursor-pointer inline-flex items-center gap-1">
                  + More ({suggestedHabits.filter(s => s.confidence === 'low').length})
                </summary>
                <div className="flex flex-wrap gap-2 mt-2">
                  {suggestedHabits
                    .filter(s => s.confidence === 'low' && !selectedHabitIds.includes(s.habit.id))
                    .map(({ habit }) => (
                      <button
                        key={habit.id}
                        type="button"
                        onClick={() => {
                          setSelectedHabitIds(prev => [...prev, habit.id]);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors bg-brand-50 border border-brand-200 text-brand-500 hover:bg-brand-100"
                      >
                        {habit.title}
                      </button>
                    ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between p-4 bg-brand-50 rounded-xl border border-brand-100">
        <span id="recurring-label" className="text-sm font-medium text-brand-700">Recurring Transaction</span>
        <button
          role="switch"
          aria-checked={isRecurring}
          aria-labelledby="recurring-label"
          onClick={() => setIsRecurring(!isRecurring)}
          className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 ${isRecurring ? 'bg-money-pos' : 'bg-brand-300'}`}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isRecurring ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200">
        <CheckCircle2 size={16} className="text-green-600 shrink-0" />
        <p className="text-xs text-green-700">
          Manual entries update your budget immediately without review.
        </p>
      </div>

      <Button
        onClick={handleManualSave}
        isLoading={isSubmitting}
        className="w-full py-4 font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all"
      >
        Save Transaction
      </Button>
    </div>
  );
};
