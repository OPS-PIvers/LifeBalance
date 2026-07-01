import React, { useState, useMemo } from 'react';
import { Check, CheckCircle2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { getLocalDateString } from '@/utils/dateHelpers';
import { Transaction, Habit, BudgetBucket, Store, Account } from '@/types/schema';
import { suggestHabitsForTransaction } from '@/utils/habitSuggestions';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';

interface CaptureTransactionManualProps {
  initialData?: {
    amount?: string;
    merchant?: string;
    category?: string;
    date?: string;
    subBucketId?: string;
    store?: string;
    accountId?: string;
    creditPayment?: boolean;
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
  const [creditPayment, setCreditPayment] = useState(() => initialData?.creditPayment ?? false);

  // Whether the chosen account is a credit card — only then is the
  // Charge/Payment toggle meaningful (a payment pays the card DOWN).
  const isSelectedAccountCredit = useMemo(
    () => accounts.find(a => a.id === accountId)?.type === 'credit',
    [accounts, accountId]
  );

  const [isRecurring, setIsRecurring] = useState(false);
  const [transactionDate, setTransactionDate] = useState(() => initialData?.date || getLocalDateString());
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Focus the amount field on desktop; never on touch (avoids iOS keyboard pop).
  const amountInputRef = useAutoFocus<HTMLInputElement>();

  // Get current bucket and its sub-buckets
  const currentBucket = useMemo(() => buckets.find(b => b.name === category), [buckets, category]);
  const availableSubBuckets = useMemo(() => currentBucket?.subBuckets || [], [currentBucket]);

  // Compute validated subBucketId (only valid if it exists in current bucket)
  const validatedSubBucketId = useMemo(() => {
    if (!subBucketId) return undefined;
    return availableSubBuckets.find(sb => sb.id === subBucketId)?.id;
  }, [subBucketId, availableSubBuckets]);

  // Default category update (if dynamicCategories loads late). Done during
  // render on the dynamicCategories-change edge rather than in an effect so it
  // doesn't trigger a cascading render. The lazy initializer above already
  // covers the case where categories are present at mount; this handles them
  // arriving asynchronously afterwards.
  const [prevDynamicCategories, setPrevDynamicCategories] = useState(dynamicCategories);
  if (prevDynamicCategories !== dynamicCategories) {
    setPrevDynamicCategories(dynamicCategories);
    if (!category && dynamicCategories.length > 0) {
      setCategory(dynamicCategories[0]);
    }
  }

  // Smart habit suggestions for manual entry (based on merchant name)
  const suggestedHabits = useMemo(() => {
    if (!merchant.trim() || habits.length === 0) return [];
    return suggestHabitsForTransaction(merchant, habits, transactions, 5);
  }, [merchant, habits, transactions]);

  const handleManualSave = async () => {
    if (!amount || !merchant) {
      const msg = "Please fill in required fields";
      setFormError(msg);
      toast.error(msg);
      return;
    }

    // Validate merchant is not just whitespace
    const trimmedMerchant = merchant.trim();
    if (!trimmedMerchant) {
      const msg = "Please enter a merchant name";
      setFormError(msg);
      toast.error(msg);
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      const msg = "Please enter a valid amount";
      setFormError(msg);
      toast.error(msg);
      return;
    }
    if (!transactionDate) {
      const msg = "Please select a date";
      setFormError(msg);
      toast.error(msg);
      return;
    }
    // Future dates are allowed - logic sets status to pending_review if future
    const today = getLocalDateString();
    const isFuture = transactionDate > today;

    if (!category || !dynamicCategories.includes(category)) {
      const msg = "Please select a valid category";
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setFormError('');
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
      accountId: accountId || undefined,
      // Only meaningful for a credit account; a charge (false) raises the card's
      // balance, a payment (true) pays it down. Undefined for asset accounts.
      creditPayment: isSelectedAccountCredit && creditPayment ? true : undefined
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
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-brand-400 dark:text-brand-400">$</span>
          <input
            ref={amountInputRef}
            type="number"
            inputMode="decimal"
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
            step="0.01"
            min="0"
            className="w-full pl-8 text-4xl font-mono font-bold text-brand-800 dark:text-brand-100 placeholder:text-brand-200 outline-hidden text-center bg-transparent"
          />
        </div>
      </div>

      <Input
        label="Merchant"
        type="text"
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder="e.g. Starbucks"
      />

      <Input
        label="Date"
        type="date"
        value={transactionDate}
        onChange={(e) => setTransactionDate(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Store (Optional)"
          value={store}
          onChange={(e) => setStore(e.target.value)}
        >
          <option value="">Select Store...</option>
          {stores.map(s => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </Select>

        <Select
          label="Account (Optional)"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Select Account...</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </div>

      {isSelectedAccountCredit && (
        <div className="flex items-center justify-between p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-100 dark:border-brand-700">
          <div>
            <span id="credit-payment-label" className="text-sm font-medium text-brand-700 dark:text-brand-200">
              {creditPayment ? 'Payment toward card' : 'Charge to card'}
            </span>
            <p className="text-xs text-brand-400 dark:text-brand-400 mt-0.5">
              {creditPayment
                ? 'Lowers this card’s balance (paying it down).'
                : 'Raises this card’s balance; never affects Safe-to-Spend.'}
            </p>
          </div>
          <Switch
            checked={creditPayment}
            onCheckedChange={setCreditPayment}
            aria-labelledby="credit-payment-label"
          />
        </div>
      )}

      <div>
        <label id="manual-category-label" className="block text-xs font-semibold text-brand-400 dark:text-brand-400 uppercase tracking-wider mb-2">Category</label>
        <div
          className="flex gap-2 overflow-x-auto pb-2 no-scrollbar"
          role="radiogroup"
          aria-labelledby="manual-category-label"
        >
          {dynamicCategories.length === 0 && <span className="text-sm text-brand-400 dark:text-brand-400">No buckets found.</span>}
          {dynamicCategories.map(cat => (
            <button
              key={cat}
              role="radio"
              aria-checked={category === cat}
              onClick={() => { setCategory(cat); setSubBucketId(undefined); }}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                category === cat
                  ? 'bg-accent-600 dark:bg-accent-500 text-white'
                  : 'bg-brand-50 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-700 hover:bg-brand-100 dark:hover:bg-brand-700/50'
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
          <label id="manual-subbucket-label" className="block text-xs font-semibold text-brand-400 dark:text-brand-400 uppercase tracking-wider mb-2">
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
                  ? 'bg-accent-600 dark:bg-accent-500 text-white'
                  : 'bg-brand-50 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-700 hover:bg-brand-100 dark:hover:bg-brand-700/50'
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
                    ? 'bg-accent-600 dark:bg-accent-500 text-white'
                    : 'bg-brand-50 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-700 hover:bg-brand-100 dark:hover:bg-brand-700/50'
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
            <label className="block text-xs font-semibold text-brand-400 dark:text-brand-400 uppercase tracking-wider">
              Connect Habits (Optional)
            </label>
            {suggestedHabits.some(s => s.confidence !== 'low') && (
              <Sparkles size={12} className="text-warm-500 dark:text-warm-300" />
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
                    className={`px-3 py-1.5 rounded-btn text-xs font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center gap-1 relative ${
                      isSelected
                        ? 'bg-money-pos text-white'
                        : confidence === 'high'
                        ? 'bg-warm-50 dark:bg-warm-900/30 border border-warm-300 dark:border-warm-700 text-warm-700 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-900/50'
                        : 'bg-habit-blue/10 dark:bg-habit-blue/20 border border-habit-blue/30 text-habit-blue hover:bg-habit-blue/20'
                    }`}
                  >
                    {isSelected && <Check size={12} strokeWidth={3} />}
                    {habit.title}
                    {!isSelected && confidence === 'high' && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-warm-500 rounded-full motion-safe:animate-pulse" />
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
                  className="px-3 py-1.5 rounded-btn text-xs font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center gap-1 bg-money-pos text-white"
                >
                  <Check size={12} strokeWidth={3} />
                  {habit.title}
                </button>
              ))}

            {/* "More" button to show all habits */}
            {suggestedHabits.filter(s => s.confidence === 'low' && !selectedHabitIds.includes(s.habit.id)).length > 0 && (
              <details className="inline">
                <summary className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700/50 cursor-pointer inline-flex items-center gap-1">
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
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700/50"
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

      <div className="flex items-center justify-between p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-100 dark:border-brand-700">
        <span id="recurring-label" className="text-sm font-medium text-brand-700 dark:text-brand-200">Recurring Transaction</span>
        <Switch
          checked={isRecurring}
          onCheckedChange={setIsRecurring}
          aria-label="Recurring Transaction"
        />
      </div>

      <div className="flex items-center gap-2 p-3 bg-money-bgPos dark:bg-money-pos/15 rounded-xl border border-money-pos/30">
        <CheckCircle2 size={16} className="text-money-pos shrink-0" />
        <p className="text-xs text-money-pos">
          Manual entries update your budget immediately without review.
        </p>
      </div>

      {formError && (
        <p role="alert" aria-live="assertive" className="text-sm font-medium text-money-neg">
          {formError}
        </p>
      )}

      <Button
        onClick={handleManualSave}
        isLoading={isSubmitting}
        className="w-full py-4"
      >
        Save Transaction
      </Button>
    </div>
  );
};
