import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { Transaction, CREDIT_CARD_CATEGORY, INCOME_CATEGORY } from '@/types/schema';
import { suggestHabitsForTransaction } from '@/utils/habitSuggestions';
import { suggestAccountIdForTransaction, suggestCategoryForTransaction } from '@/utils/actionQueueSmart';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { roundMoney } from '@/utils/money';
import { pickKeeper } from '@/utils/transactionMerge';
import { useFinance, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Eyebrow from '@/components/ui/Eyebrow';

interface SelectableChipProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Small pulsing dot hinting a high-confidence suggestion (unselected state only). */
  showSuggestionDot?: boolean;
}

/**
 * A single unified selection-chip treatment, shared by the habit-suggestion
 * chips and the budget-category chips below. Moved here from ActionQueueItem so
 * both review surfaces (the Action Queue drawer and the on-open review drawer)
 * share one chip language.
 */
const SelectableChip: React.FC<SelectableChipProps> = ({ selected, onClick, children, showSuggestionDot }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'relative px-3 py-1.5 rounded-btn text-xs font-semibold transition-colors duration-(--duration-fast) ease-(--ease-standard) inline-flex items-center gap-1',
      selected
        ? 'bg-accent-600 text-white'
        : 'bg-white border border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-700'
    )}
  >
    {selected && <Check size={12} strokeWidth={3} />}
    {children}
    {!selected && showSuggestionDot && (
      <span className="absolute -top-1 -right-1 w-2 h-2 bg-warm-500 rounded-full motion-safe:animate-pulse" aria-hidden="true" />
    )}
  </button>
);

export interface TransactionReviewFormProps {
  /** The pending transaction being reviewed. */
  transaction: Transaction;
  /** Called after a successful approve (or a delete when no `onDeleted`). */
  onDone: () => void;
  /** Called after a successful delete; falls back to `onDone` when omitted. */
  onDeleted?: () => void;
}

/**
 * The single shared transaction-review form, mounted by BOTH the Action Queue
 * drawer and the on-open review drawer. It only ever renders inside an open
 * Drawer, so consuming context directly (rather than taking large collections
 * as props) has no list-render cost.
 *
 * Layout is mobile-first, top → bottom: merchant, a hero $ amount field, a
 * Date + Account grid, budget-category chips, habit chips, then the approve CTA
 * and a secondary delete row. There is no separate "edit" sub-mode — every
 * field is editable inline, so a single Approve verifies + categorises + tags
 * the account + credits habits in ONE atomic context call.
 */
const TransactionReviewForm: React.FC<TransactionReviewFormProps> = ({ transaction, onDone, onDeleted }) => {
  const {
    accounts, buckets, transactions,
    updateTransactionCategory, deleteTransaction,
    mergeTransactions, keepBothTransactions,
  } = useFinance();
  const { habits } = useGamification();

  // Plan 03 PR-3: a flagged possible duplicate of another existing row.
  // Resolved by id (not trusted blindly) so a stale/deleted reference never
  // renders a broken notice.
  const possibleDuplicate = transaction.possibleDuplicateOf
    ? transactions.find(t => t.id === transaction.possibleDuplicateOf)
    : undefined;
  const [isMerging, setIsMerging] = useState(false);

  // An income transaction (e.g. a Venmo/paycheck deposit) has no budget bucket,
  // so `buildTransactionCategoryOptions` never contains INCOME_CATEGORY. Prepend
  // an 'Income' chip for income transactions so its category can be preserved on
  // approve — otherwise it would fall through to an expense bucket and flip the
  // balance sign (crediting → debiting checking).
  const isIncome = transaction.category === INCOME_CATEGORY;
  const categoryOptions = useMemo(() => {
    const options = buildTransactionCategoryOptions(buckets);
    return isIncome ? [INCOME_CATEGORY, ...options] : options;
  }, [buckets, isIncome]);

  const [merchant, setMerchant] = useState(() => transaction.merchant);
  // $0 "awaiting amount" stubs open blank so the user must enter the real charge
  // (the approve CTA stays disabled until amount > 0); everything else prefills.
  const [amount, setAmount] = useState(() => (transaction.needsAmount ? '' : String(transaction.amount)));
  const [date, setDate] = useState(() => transaction.date);
  const [accountId, setAccountId] = useState(
    () => transaction.accountId ?? suggestAccountIdForTransaction(transaction, accounts, transactions) ?? ''
  );
  const [selectedCategory, setSelectedCategory] = useState(() => {
    // Never consult the expense-biased suggester for an income transaction —
    // preserve INCOME_CATEGORY directly so approving keeps it a credit.
    if (isIncome) return INCOME_CATEGORY;
    if (transaction.category && categoryOptions.includes(transaction.category)) return transaction.category;
    return suggestCategoryForTransaction(transaction, buckets, transactions) ?? '';
  });
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>(() => transaction.relatedHabitIds ?? []);
  const [showAllHabits, setShowAllHabits] = useState(false);
  const [creditPayment, setCreditPayment] = useState(() => transaction.creditPayment ?? false);

  // Credit-tagged transactions carry no budget category (credit spend is
  // tracked on the card, not against buckets), so the category chips hide and
  // the Charge/Payment toggle shows instead.
  const isSelectedAccountCredit = useMemo(
    () => accounts.find(a => a.id === accountId)?.type === 'credit',
    [accounts, accountId]
  );

  // Smart habit suggestions follow the live merchant field (so editing the
  // merchant re-scores suggestions, matching the manual-capture path).
  const suggestedHabits = useMemo(
    () => (merchant.trim() ? suggestHabitsForTransaction(merchant, habits, transactions, 5) : []),
    [merchant, habits, transactions]
  );
  const lowConfidenceHabits = suggestedHabits.filter(s => s.confidence === 'low');
  const remainingLowConfidenceHabits = lowConfidenceHabits.filter(s => !selectedHabitIds.includes(s.habit.id));

  // Round to whole cents up front so a sub-cent entry (e.g. 0.004 on a $0 stub)
  // can't slip past the approve gate and verify an effectively-$0 transaction.
  // roundMoney(NaN) is NaN, so a blank/invalid field keeps canApprove false.
  const parsedAmount = roundMoney(parseFloat(amount));
  const canApprove = parsedAmount > 0 && merchant.trim() !== '' && (isSelectedAccountCredit || selectedCategory !== '');
  const approveLabel = transaction.needsAmount && !amount.trim() ? 'Add amount & approve' : 'Approve Transaction';

  const handleApprove = async () => {
    const trimmedMerchant = merchant.trim();
    if (!(parsedAmount > 0)) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (!trimmedMerchant) {
      toast.error('Merchant name is required');
      return;
    }
    if (!isSelectedAccountCredit && !selectedCategory) {
      toast.error('Please select a category');
      return;
    }

    // Only send the fields that actually changed. Passing `overrides.amount`
    // makes the context use it (not the stale local amount, which is 0 for a
    // stub) for the checking-balance delta, so the entered amount debits once.
    const overrides: { amount?: number; merchant?: string; date?: string; clearNeedsAmount?: boolean; creditPayment?: boolean } = {};
    if (transaction.needsAmount || parsedAmount !== transaction.amount) overrides.amount = parsedAmount;
    if (trimmedMerchant !== transaction.merchant) overrides.merchant = trimmedMerchant;
    // Only send a date override for a real, non-empty change — an emptied date
    // field must NOT overwrite the stored date (and the context guards against
    // writing an undefined payPeriodId for a blank date).
    if (date && date !== transaction.date) overrides.date = date;
    if (transaction.needsAmount) overrides.clearNeedsAmount = true;
    // Charge/Payment only applies on a credit account (re-tagging to a
    // checking account clears any stored flag). Sent only on a real change so
    // the common case stays a minimal write.
    const desiredCreditPayment = isSelectedAccountCredit && creditPayment;
    if (desiredCreditPayment !== (transaction.creditPayment ?? false)) overrides.creditPayment = desiredCreditPayment;
    const hasOverrides = Object.keys(overrides).length > 0;

    // Selecting "No account" on a previously-tagged transaction is an EXPLICIT
    // clear (sentinel `null`), not a no-op — otherwise the stale tag lingers.
    const accountIdArg = accountId === '' && transaction.accountId ? null : (accountId || undefined);

    try {
      await updateTransactionCategory(
        transaction.id,
        isSelectedAccountCredit ? CREDIT_CARD_CATEGORY : selectedCategory,
        selectedHabitIds,
        accountIdArg,
        hasOverrides ? overrides : undefined
      );
      // Success toast is emitted by the context mutation.
      onDone();
    } catch (error) {
      console.error('Failed to approve transaction:', error);
      toast.error('Failed to approve transaction');
    }
  };

  const handleDelete = () => {
    showDeleteConfirmation(async () => {
      await deleteTransaction(transaction.id);
      (onDeleted ?? onDone)();
    });
  };

  const handleMergeDuplicate = async () => {
    if (!possibleDuplicate) return;
    setIsMerging(true);
    try {
      const { keeper, dupe } = pickKeeper(transaction, possibleDuplicate);
      await mergeTransactions(keeper.id, dupe.id);
      onDone();
    } catch (error) {
      console.error('Failed to merge duplicate transaction:', error);
      toast.error('Failed to merge transactions');
    } finally {
      setIsMerging(false);
    }
  };

  const handleKeepBothDuplicate = async () => {
    try {
      await keepBothTransactions(transaction.id);
    } catch (error) {
      console.error('Failed to dismiss duplicate flag:', error);
      toast.error('Failed to update transaction');
    }
  };

  return (
    <div className="space-y-4">
      {possibleDuplicate && (
        <div className="rounded-card border border-warm-200 bg-warm-50 px-3 py-2.5 space-y-2 dark:border-warm-700 dark:bg-warm-900/20">
          <div className="flex items-start gap-2">
            <Copy size={14} className="mt-0.5 shrink-0 text-warm-600 dark:text-warm-400" />
            <p className="text-xs text-warm-700 dark:text-warm-300">
              Possible duplicate of <span className="font-semibold">{possibleDuplicate.merchant}</span>
              {' — '}${possibleDuplicate.amount.toFixed(2)} on {possibleDuplicate.date}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="warning"
              size="sm"
              className="flex-1 text-xs"
              onClick={handleMergeDuplicate}
              disabled={isMerging}
            >
              Merge
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 text-xs"
              onClick={handleKeepBothDuplicate}
              disabled={isMerging}
            >
              Keep both
            </Button>
          </div>
        </div>
      )}

      <Input
        label="Merchant"
        type="text"
        value={merchant}
        onChange={e => setMerchant(e.target.value)}
        placeholder="e.g. Starbucks"
      />

      {/* Hero amount field — the primary action for an "awaiting amount" stub. */}
      <div className="flex justify-center py-1">
        <div className="relative">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-brand-400 dark:text-brand-400">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            aria-label="Amount"
            autoFocus={transaction.needsAmount}
            onChange={e => {
              const value = e.target.value;
              if (value === '' || parseFloat(value) >= 0) setAmount(value);
            }}
            onKeyDown={e => {
              if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
            }}
            placeholder="0.00"
            step="0.01"
            min="0"
            className="w-full pl-8 text-4xl font-mono font-bold text-brand-800 dark:text-brand-100 placeholder:text-brand-200 outline-hidden text-center bg-transparent"
          />
        </div>
      </div>

      {/* [&>*]:min-w-0 — native date/select controls report a min-content width
          that otherwise overflows the grid on narrow phones. */}
      <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <Select
          label="Account"
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
        >
          <option value="">No account</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </div>

      {/* Budget category — hidden for a credit account: credit spend is
          tracked on the card, not against budget buckets. The Charge/Payment
          toggle takes its place (same treatment as manual capture / edit). */}
      {!isSelectedAccountCredit && (
        <Select
          label="Budget Category"
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
        >
          <option value="">Select category…</option>
          {categoryOptions.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </Select>
      )}

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
        </div>
      )}

      {/* Connect habits — smart suggestions */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Eyebrow as="p" className="text-xxs">Connect Habits</Eyebrow>
          {suggestedHabits.some(s => s.confidence !== 'low') && (
            <Sparkles size={10} className="text-warm-500" />
          )}
        </div>
        {habits.length === 0 && (
          <p className="text-xs text-brand-400 dark:text-brand-500 italic">No habits found. Create some in Habits tab.</p>
        )}

        {habits.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {/* High/medium-confidence suggestions first */}
            {suggestedHabits
              .filter(s => s.confidence === 'high' || s.confidence === 'medium')
              .map(({ habit, confidence }) => {
                const isSelected = selectedHabitIds.includes(habit.id);
                return (
                  <SelectableChip
                    key={habit.id}
                    selected={isSelected}
                    showSuggestionDot={confidence === 'high'}
                    onClick={() => {
                      setSelectedHabitIds(prev =>
                        isSelected ? prev.filter(id => id !== habit.id) : [...prev, habit.id]
                      );
                    }}
                  >
                    {habit.title}
                  </SelectableChip>
                );
              })}

            {/* Already-selected low-confidence habits stay visible when collapsed. */}
            {lowConfidenceHabits
              .filter(s => selectedHabitIds.includes(s.habit.id))
              .map(({ habit }) => (
                <SelectableChip
                  key={habit.id}
                  selected
                  onClick={() => setSelectedHabitIds(prev => prev.filter(id => id !== habit.id))}
                >
                  {habit.title}
                </SelectableChip>
              ))}

            {/* Remaining low-confidence habits, revealed via a plain toggle. */}
            {showAllHabits && remainingLowConfidenceHabits.map(({ habit }) => (
              <SelectableChip
                key={habit.id}
                selected={false}
                onClick={() => setSelectedHabitIds(prev => [...prev, habit.id])}
              >
                {habit.title}
              </SelectableChip>
            ))}

            {remainingLowConfidenceHabits.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllHabits(prev => !prev)}
                aria-expanded={showAllHabits}
                className="px-3 py-1.5 rounded-btn text-xs font-semibold bg-white border border-brand-200 text-brand-500 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-400 dark:hover:bg-brand-700 inline-flex items-center gap-1"
              >
                {showAllHabits ? 'Show less' : `+ More (${remainingLowConfidenceHabits.length})`}
                <ChevronDown
                  size={12}
                  className={cn('transition-transform duration-(--duration-fast) ease-(--ease-standard)', showAllHabits && 'rotate-180')}
                />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Approve CTA */}
      <Button
        variant="success"
        size="lg"
        onClick={handleApprove}
        disabled={!canApprove}
        className="w-full py-3"
        leftIcon={<Check size={18} strokeWidth={3} />}
      >
        {approveLabel}
      </Button>

      {/* Secondary delete row */}
      <div className="flex pt-1 border-t border-brand-200 dark:border-brand-700 mt-2">
        <Button
          variant="ghost-danger"
          size="sm"
          className="flex-1 text-xs"
          leftIcon={<Trash2 size={14} />}
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
};

export default TransactionReviewForm;
