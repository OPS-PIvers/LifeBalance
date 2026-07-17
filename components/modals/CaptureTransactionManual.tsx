import React, { useId, useState, useMemo } from 'react';
import { Check, CheckCircle2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { getLocalDateString } from '@/utils/dateHelpers';
import { Transaction, Habit, Store, Account, CalendarItem, CREDIT_CARD_CATEGORY } from '@/types/schema';
import { suggestHabitsForTransaction } from '@/utils/habitSuggestions';
import { resolveStoreName } from '@/utils/stores';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

/** Per-field validation messages, set on a failed submit attempt and cleared
 *  field-by-field as the user fixes each input. */
interface FieldErrors {
  amount?: string;
  merchant?: string;
  date?: string;
}

interface CaptureTransactionManualProps {
  initialData?: {
    amount?: string;
    merchant?: string;
    category?: string;
    date?: string;
    store?: string;
    accountId?: string;
    creditPayment?: boolean;
  };
  onAddTransaction: (transaction: Transaction) => Promise<void>;
  /** When provided, saving with "Recurring" ON also creates a monthly
   *  recurring expense CalendarItem flagged `isSubscription: true`, so the
   *  entry shows up on the Subscriptions tab. */
  onAddCalendarItem?: (item: CalendarItem) => Promise<void>;
  onClose: () => void;
  dynamicCategories: string[];
  habits: Habit[];
  transactions: Transaction[];
  stores: Store[];
  accounts: Account[];
}

export const CaptureTransactionManual: React.FC<CaptureTransactionManualProps> = ({
  initialData,
  onAddTransaction,
  onAddCalendarItem,
  onClose,
  dynamicCategories,
  habits,
  transactions,
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

  const [accountId, setAccountId] = useState(() => initialData?.accountId || '');
  const [creditPayment, setCreditPayment] = useState(() => initialData?.creditPayment ?? false);

  // Datalist id for the Merchant field's store-name autocomplete (see below).
  const storeListId = useId();

  // Whether the chosen account is a credit card — only then is the
  // Charge/Payment toggle meaningful (a payment pays the card DOWN).
  const isSelectedAccountCredit = useMemo(
    () => accounts.find(a => a.id === accountId)?.type === 'credit',
    [accounts, accountId]
  );

  const [isRecurring, setIsRecurring] = useState(false);

  // Fix: credit-card payment funded FROM an asset account (full transfer).
  // Only meaningful when the selected account is a credit card AND the kind is
  // Payment; cleared implicitly on save when those don't hold.
  const [fundingAccountId, setFundingAccountId] = useState('');
  const nonCreditAccounts = useMemo(
    () => accounts.filter(a => a.type !== 'credit'),
    [accounts]
  );

  // A credit-card PAYMENT is a transfer, not recurring spend — the Recurring
  // (subscription) toggle is hidden/ignored in that mode.
  const isCreditPaymentMode = isSelectedAccountCredit && creditPayment;
  const [transactionDate, setTransactionDate] = useState(() => initialData?.date || getLocalDateString());
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Error-message element id for the bare Amount input (the shared <Input>
  // primitive wires its own aria-describedby; Amount is a custom control).
  const amountErrorId = useId();

  // Builds the summary alert text from the currently-invalid fields.
  const summarizeErrors = (errors: FieldErrors) => {
    const missing = [
      errors.amount && 'Amount',
      errors.merchant && 'Merchant',
      errors.date && 'Date',
    ].filter((label): label is string => Boolean(label));
    return missing.length > 0 ? `Please fix: ${missing.join(', ')}` : '';
  };

  // Clears one field's error once the user has fixed it, narrowing the
  // summary alert to the remaining invalid fields (and dropping it entirely
  // when none remain).
  const clearFieldError = (field: keyof FieldErrors) => {
    if (!fieldErrors[field]) return;
    const next = { ...fieldErrors };
    delete next[field];
    setFieldErrors(next);
    setFormError(summarizeErrors(next));
  };

  // Focus the amount field on desktop; never on touch (avoids iOS keyboard pop).
  const amountInputRef = useAutoFocus<HTMLInputElement>();

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

  // Pre-select the habits this household consistently tags for the typed
  // merchant (fuzzy history match), but NEVER override a manual chip choice:
  // once the user touches the habit chips, auto-selection stops following the
  // merchant field. Applied during render on the auto-select-set-change edge
  // (same pattern as prevDynamicCategories above) rather than in an effect.
  const [habitsTouched, setHabitsTouched] = useState(false);
  const autoSelectKey = useMemo(
    () => suggestedHabits.filter(s => s.autoSelect).map(s => s.habit.id).join('|'),
    [suggestedHabits]
  );
  const [prevAutoSelectKey, setPrevAutoSelectKey] = useState('');
  if (prevAutoSelectKey !== autoSelectKey) {
    setPrevAutoSelectKey(autoSelectKey);
    if (!habitsTouched) {
      setSelectedHabitIds(autoSelectKey === '' ? [] : autoSelectKey.split('|'));
    }
  }

  // Habit picker chip sets. The section previously gated its label on
  // `habits.length` but rendered chips only from high/medium suggestions, so
  // the label could sit above an empty row. Now: primary chips are the
  // high/medium suggestions, any OTHER selected habit renders as a selected
  // chip, and EVERY remaining habit is reachable behind the "+ More"
  // disclosure — so the user can always optionally tag any habit, and the
  // label never renders above nothing (when habits exist, "+ More" or chips
  // are always present; with no habits the whole section is omitted).
  const primaryChips = suggestedHabits.filter(s => s.confidence === 'high' || s.confidence === 'medium');
  const primaryChipIds = new Set(primaryChips.map(s => s.habit.id));
  const selectedExtraHabits = habits.filter(h => selectedHabitIds.includes(h.id) && !primaryChipIds.has(h.id));
  const moreHabits = habits.filter(h => !primaryChipIds.has(h.id) && !selectedHabitIds.includes(h.id));

  // Merchant now doubles as the Store field (a separate lower-cased "store"
  // dropdown was redundant with the free-text merchant name). A native
  // <datalist> on the Merchant input still offers known store names for
  // autocomplete. The shared `resolveStoreName` helper derives
  // `Transaction.store` at submit time: an exact (case-insensitive, trimmed)
  // match against a known store snaps to that store's canonical name so the
  // TransactionMasterList store filter keeps working; anything else omits the
  // field (there's no prior transaction to preserve a store from).

  const handleManualSave = async () => {
    // Validate every required field at once so a failed submit flags each
    // offending input (red border + aria-invalid + inline message) instead of
    // surfacing one generic error at a time.
    const trimmedMerchant = merchant.trim();
    const parsedAmount = parseFloat(amount);
    const errors: FieldErrors = {};
    if (!amount) {
      errors.amount = 'Enter an amount';
    } else if (isNaN(parsedAmount) || parsedAmount <= 0) {
      errors.amount = 'Enter an amount greater than zero';
    }
    if (!trimmedMerchant) {
      errors.merchant = 'Enter a merchant';
    }
    if (!transactionDate) {
      errors.date = 'Select a date';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const msg = summarizeErrors(errors);
      setFormError(msg);
      toast.error(msg);
      return;
    }
    setFieldErrors({});
    // Future dates are allowed - logic sets status to pending_review if future
    const today = getLocalDateString();
    const isFuture = transactionDate > today;

    // A credit-tagged transaction carries the CREDIT_CARD_CATEGORY sentinel
    // instead of a bucket category (credit spend never counts toward buckets).
    const finalCategory = isSelectedAccountCredit ? CREDIT_CARD_CATEGORY : category;
    if (!finalCategory || (!isSelectedAccountCredit && !dynamicCategories.includes(finalCategory))) {
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
      category: finalCategory,
      date: transactionDate,
      status: isFuture ? 'pending_review' : 'verified',
      isRecurring: isCreditPaymentMode ? false : isRecurring,
      source: 'manual',
      autoCategorized: false,
      relatedHabitIds: selectedHabitIds.length > 0 ? selectedHabitIds : undefined,
      store: resolveStoreName(stores, merchant),
      accountId: accountId || undefined,
      // Only meaningful for a credit account; a charge (false) raises the card's
      // balance, a payment (true) pays it down. Undefined for asset accounts.
      creditPayment: isSelectedAccountCredit && creditPayment ? true : undefined,
      // Optional funding (asset) account for a credit-card payment — makes the
      // payment a full transfer (card credited AND funding account debited in
      // one batch, see makeAddTransaction). Omitted otherwise.
      fundingAccountId: isCreditPaymentMode && fundingAccountId ? fundingAccountId : undefined
    };

    try {
      await onAddTransaction(newTransaction);

      // Recurring ON ⇒ also create a monthly recurring expense on the calendar,
      // flagged as a subscription so it appears on the Subscriptions tab.
      // Never for a credit-card payment (that's a transfer, not a subscription).
      if (isRecurring && !isCreditPaymentMode && onAddCalendarItem) {
        try {
          await onAddCalendarItem({
            id: crypto.randomUUID(),
            title: trimmedMerchant,
            amount: parsedAmount,
            date: transactionDate,
            type: 'expense',
            isPaid: false,
            isRecurring: true,
            frequency: 'monthly',
            isSubscription: true,
            ...(accountId ? { accountId } : {}),
          });
        } catch (calendarError) {
          // The transaction itself saved — surface the partial failure without
          // blocking the close.
          console.error('Failed to create recurring subscription entry:', calendarError);
          toast.error('Saved, but the recurring subscription entry failed.');
        }
      }

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
    // A real <form> so Enter in Amount/Merchant submits (round-3 critique:
    // keyboard users had to reach for the Save button). Every non-submit
    // button inside is explicitly type="button".
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void handleManualSave();
      }}
      noValidate
    >
      <div>
        <div className="flex justify-center">
          <div className="relative">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-brand-400 dark:text-brand-400">$</span>
            <input
              ref={amountInputRef}
              type="number"
              inputMode="decimal"
              value={amount}
              aria-label="Amount"
              required
              aria-invalid={!!fieldErrors.amount}
              aria-describedby={fieldErrors.amount ? amountErrorId : undefined}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '' || parseFloat(value) >= 0) setAmount(value);
                if (value && parseFloat(value) > 0) clearFieldError('amount');
              }}
              onKeyDown={(e) => {
                if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
              }}
              placeholder="0.00"
              step="0.01"
              min="0"
              className={`w-full min-h-11 pl-8 text-4xl font-mono font-bold text-brand-800 dark:text-brand-100 placeholder:text-brand-200 outline-hidden text-center bg-transparent border-b-2 ${
                fieldErrors.amount ? 'border-money-neg dark:border-money-negDark' : 'border-transparent'
              }`}
            />
          </div>
        </div>
        {fieldErrors.amount && (
          <p id={amountErrorId} className="mt-1 text-sm text-money-neg dark:text-money-negDark font-medium text-center">
            {fieldErrors.amount}
          </p>
        )}
      </div>

      <Input
        label="Merchant"
        type="text"
        value={merchant}
        required
        error={fieldErrors.merchant}
        onChange={(e) => {
          setMerchant(e.target.value);
          if (e.target.value.trim()) clearFieldError('merchant');
        }}
        placeholder="e.g. Starbucks"
        list={storeListId}
        autoComplete="off"
      />
      {/* Known store names, offered as autocomplete on the Merchant field
          above. Typing (or picking) an exact match resolves the transaction's
          store to that canonical name on submit; see resolveStoreName(). */}
      <datalist id={storeListId}>
        {stores.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>

      <Input
        label="Date"
        type="date"
        value={transactionDate}
        required
        error={fieldErrors.date}
        onChange={(e) => {
          setTransactionDate(e.target.value);
          if (e.target.value) clearFieldError('date');
        }}
      />

      {/* Category doesn't apply to credit-card charges — hidden when the
          (collapsed-section) account choice is a credit card. */}
      {!isSelectedAccountCredit && (
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {dynamicCategories.length === 0 && <option value="">No buckets found</option>}
          {dynamicCategories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </Select>
      )}

      {/*
        Everything below is secondary to the quick-entry path (Amount/Merchant/
        Date/Category). Collapsing it is purely visual — all of this state lives
        at the top level regardless of open/closed, so a value set then collapsed
        still submits with the transaction (existing behavior for the conditional
        credit-card field is unchanged).
      */}
      <CollapsibleSection
        title="Add details"
        subtitle="Account, habits & recurring"
        defaultOpen={false}
      >
        <div className="space-y-6">
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

          {isSelectedAccountCredit && (
            <div className="p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-100 dark:border-brand-700 space-y-2">
              <SegmentedControl
                options={[
                  { value: 'charge', label: 'Charge' },
                  { value: 'payment', label: 'Payment' },
                ]}
                value={creditPayment ? 'payment' : 'charge'}
                onChange={(v) => setCreditPayment(v === 'payment')}
                name="Credit card transaction type"
                size="sm"
              />
              <p className="text-xs text-brand-400 dark:text-brand-400">
                {creditPayment
                  ? 'Lowers this card’s balance (paying it down).'
                  : 'Raises this card’s balance; never affects Safe-to-Spend.'}
              </p>
              {creditPayment && nonCreditAccounts.length > 0 && (
                <div className="pt-1 space-y-1">
                  <Select
                    label="From account (Optional)"
                    value={fundingAccountId}
                    onChange={(e) => setFundingAccountId(e.target.value)}
                  >
                    <option value="">No source account</option>
                    {nonCreditAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </Select>
                  <p className="text-xs text-brand-400 dark:text-brand-400">
                    Also deducts the payment from this account, like a transfer.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Habit Tagging Section */}
          {habits.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <label className="block text-xs font-semibold text-brand-400 dark:text-brand-400 uppercase tracking-wider">
                  Connect Habits (Optional)
                </label>
                {primaryChips.length > 0 && (
                  <Sparkles size={12} className="text-warm-500 dark:text-warm-300" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Show suggested habits first */}
                {primaryChips
                  .map(({ habit, confidence }) => {
                    const isSelected = selectedHabitIds.includes(habit.id);
                    return (
                      <button
                        key={habit.id}
                        type="button"
                        onClick={() => {
                          setHabitsTouched(true);
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

                {/* Show any selected habit that isn't already a suggestion chip */}
                {selectedExtraHabits
                  .map((habit) => (
                    <button
                      key={habit.id}
                      type="button"
                      onClick={() => {
                        setHabitsTouched(true);
                        setSelectedHabitIds(prev => prev.filter(id => id !== habit.id));
                      }}
                      className="px-3 py-1.5 rounded-btn text-xs font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center gap-1 bg-money-pos text-white"
                    >
                      <Check size={12} strokeWidth={3} />
                      {habit.title}
                    </button>
                  ))}

                {/* Disclosure listing EVERY remaining habit, so any habit can be
                    tagged even with no merchant-based suggestions. */}
                {moreHabits.length > 0 && (
                  <details className="inline">
                    <summary className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700/50 cursor-pointer inline-flex items-center gap-1">
                      {primaryChips.length > 0 ? `+ More (${moreHabits.length})` : `Choose a habit (${moreHabits.length})`}
                    </summary>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {moreHabits
                        .map((habit) => (
                          <button
                            key={habit.id}
                            type="button"
                            onClick={() => {
                              setHabitsTouched(true);
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

          {/* Hidden for a credit-card PAYMENT — that's a transfer, not a
              subscription-style recurring spend. */}
          {!isCreditPaymentMode && (
            <div className="p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-100 dark:border-brand-700 space-y-1.5">
              <div className="flex items-center justify-between">
                <span id="recurring-label" className="text-sm font-medium text-brand-700 dark:text-brand-200">Recurring Transaction</span>
                <Switch
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                  aria-labelledby="recurring-label"
                />
              </div>
              <p className="text-xs text-brand-400 dark:text-brand-400">
                Creates a monthly entry on your Subscriptions tab.
              </p>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <div className="flex items-center gap-2 p-3 bg-money-bgPos dark:bg-money-pos/15 rounded-xl border border-money-pos/30">
        <CheckCircle2 size={16} className="text-money-pos dark:text-money-posDark shrink-0" />
        <p className="text-xs text-money-pos dark:text-money-posDark">
          Manual entries update your budget immediately without review.
        </p>
      </div>

      {formError && (
        <p role="alert" aria-live="assertive" className="text-sm font-medium text-money-neg dark:text-money-negDark">
          {formError}
        </p>
      )}

      <Button
        type="submit"
        isLoading={isSubmitting}
        className="w-full py-4"
      >
        Save Transaction
      </Button>
    </form>
  );
};
