import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Link2, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { subMonths, addMonths, parseISO, format as formatDate } from 'date-fns';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { Transaction, CREDIT_CARD_CATEGORY, INCOME_CATEGORY } from '@/types/schema';
import { Switch } from '@/components/ui/Switch';
import { getAutoSelectedHabitIds, suggestHabitsForTransaction } from '@/utils/habitSuggestions';
import { keywordMatchedHabitIds } from '@/utils/transactionHabitFiring';
import { suggestAccountIdForTransaction, suggestCategoryForTransaction } from '@/utils/actionQueueSmart';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { getBillLinkCandidates } from '@/utils/billLinkCandidates';
import { roundMoney } from '@/utils/money';
import { pickKeeper } from '@/utils/transactionMerge';
import { useFinance, useGamification, useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
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
 * A single unified selection-chip treatment for the habit-suggestion chips
 * (multi-select tagging — the one legitimate chip form role per DESIGN.md §6's
 * picker rule; the pick-one budget category is a `Select`). Moved here from
 * ActionQueueItem so both review surfaces (the Action Queue drawer and the
 * on-open review drawer) share one chip language.
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
 * Date + Account grid, budget-category select, habit chips, then the approve CTA
 * and a secondary delete row. There is no separate "edit" sub-mode — every
 * field is editable inline, so a single Approve verifies + categorises + tags
 * the account + credits habits in ONE atomic context call.
 */
const TransactionReviewForm: React.FC<TransactionReviewFormProps> = ({ transaction, onDone, onDeleted }) => {
  const {
    accounts, buckets, transactions,
    updateTransactionCategory, deleteTransaction, addCalendarItem,
    mergeTransactions, keepBothTransactions, linkBankTransactionToBill,
  } = useFinance();
  const { habits } = useGamification();

  // "Link to bill" (bank-sync reconcile) — only offered for a bank-synced row
  // still awaiting categorization (see needsReview in useActionQueue.ts). The
  // candidate list is expanded ~1 month back to ~1 month ahead so a slightly
  // early/late bank post still finds its bill.
  const canLinkToBill = !!transaction.bankRef && transaction.status === 'verified' && transaction.needsCategory === true;
  const [showBillPicker, setShowBillPicker] = useState(false);
  const [isLinkingBill, setIsLinkingBill] = useState(false);
  // Anchored on the TRANSACTION's own date (not "today") so a bank-post from
  // weeks ago still finds the bill it was actually due against. Rows that can
  // never show the picker (canLinkToBill false) get a degenerate same-instant
  // window instead of skipping the hook — hooks can't be conditional — which
  // keeps the expansion trivially cheap (empty range) for the common case.
  const billWindowStart = useMemo(
    () => (canLinkToBill ? subMonths(parseISO(transaction.date), 1) : parseISO(transaction.date)),
    [canLinkToBill, transaction.date]
  );
  const billWindowEnd = useMemo(
    () => (canLinkToBill ? addMonths(parseISO(transaction.date), 1) : parseISO(transaction.date)),
    [canLinkToBill, transaction.date]
  );
  const expandedForBillLink = useExpandedCalendarItems(billWindowStart, billWindowEnd);
  const billCandidates = useMemo(
    () => (canLinkToBill && showBillPicker ? getBillLinkCandidates(expandedForBillLink) : []),
    [canLinkToBill, showBillPicker, expandedForBillLink]
  );

  const handleLinkToBill = async (calendarItemId: string) => {
    setIsLinkingBill(true);
    try {
      const linked = await linkBankTransactionToBill(transaction.id, calendarItemId);
      if (linked) onDone();
    } catch (error) {
      console.error('Failed to link transaction to bill:', error);
      toast.error('Failed to link transaction to bill');
    } finally {
      setIsLinkingBill(false);
    }
  };

  // Plan 03 PR-3: a flagged possible duplicate of another existing row.
  // Resolved by id (not trusted blindly) so a stale/deleted reference never
  // renders a broken notice.
  const possibleDuplicate = transaction.possibleDuplicateOf
    ? transactions.find(t => t.id === transaction.possibleDuplicateOf)
    : undefined;
  const [isMerging, setIsMerging] = useState(false);
  // "Keep both" clears the flag in Firestore, but the host drawer passes a
  // SNAPSHOT transaction (deliberately — stable cycle indices), so the prop
  // never updates. Hide the banner locally after a successful dismiss.
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);

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
  // Optional free-text "what was bought" note (Transaction.notes).
  const [notes, setNotes] = useState(() => transaction.notes ?? '');
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
  // Habits: an explicit prior tag always wins; otherwise pre-select the habits
  // this household consistently tags for this merchant (fuzzy history match) —
  // automated pending imports (quickAdd email, Apple Pay stubs, Plaid) arrive
  // untagged, so a recurring "Starbucks" charge opens with its usual habit
  // already selected. The auto-select set follows the live merchant field, but
  // NEVER overrides a manual chip choice: once the user touches the chips,
  // pre-selection stops following. Applied during render on the
  // set-change edge (same pattern as CaptureTransactionManual) — no effect.
  const hasExplicitTags = (transaction.relatedHabitIds?.length ?? 0) > 0;
  const autoSelectedIds = useMemo(
    () => (hasExplicitTags ? [] : getAutoSelectedHabitIds(merchant, habits, transactions)),
    [hasExplicitTags, merchant, habits, transactions]
  );
  // Habit Automations (PRD #1065): habits whose configured keywords match the
  // (live) merchant or notes fire on approve. They appear as pre-checked "Also
  // logs: …" chips below — unticking vetoes. Exclude any this transaction has
  // already fired (dedup) so an undo→re-review doesn't re-suggest them.
  const keywordHabitIds = useMemo(() => {
    const alreadyFired = new Set(transaction.firedHabitIds ?? []);
    return keywordMatchedHabitIds(habits, { merchant, notes }).filter(id => !alreadyFired.has(id));
  }, [habits, merchant, notes, transaction.firedHabitIds]);
  const keywordHabits = useMemo(
    () => keywordHabitIds.map(id => habits.find(h => h.id === id)).filter((h): h is typeof habits[number] => !!h),
    [keywordHabitIds, habits]
  );
  // The pre-selected baseline follows the live merchant/notes fields: history
  // auto-selection (or explicit prior tags) unioned with the keyword matches.
  const preselectIds = useMemo(() => {
    const base = hasExplicitTags ? (transaction.relatedHabitIds ?? []) : autoSelectedIds;
    return Array.from(new Set([...base, ...keywordHabitIds]));
  }, [hasExplicitTags, transaction.relatedHabitIds, autoSelectedIds, keywordHabitIds]);
  const [habitsTouched, setHabitsTouched] = useState(false);
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>(() => preselectIds);
  // Re-seed the selection whenever the pre-select baseline changes (merchant /
  // notes edit re-scores both history AND keyword matches), unless the user has
  // manually touched the chips — then pre-selection stops following.
  const autoSelectKey = preselectIds.join('|');
  const [prevAutoSelectKey, setPrevAutoSelectKey] = useState(autoSelectKey);
  if (prevAutoSelectKey !== autoSelectKey) {
    setPrevAutoSelectKey(autoSelectKey);
    if (!habitsTouched) setSelectedHabitIds(preselectIds);
  }
  const [showAllHabits, setShowAllHabits] = useState(false);
  const [creditPayment, setCreditPayment] = useState(() => transaction.creditPayment ?? false);
  // Recurring toggle — defaults OFF; the host drawer remounts the form per
  // transaction (keyed), so it resets between review items. When ON, a nested
  // subscription switch (default ON, preserving prior behavior) decides
  // whether the created CalendarItem lands on the Subscriptions tab or is a
  // plain recurring bill (F-MONEY-05: recurring alone ≠ subscription).
  const [isRecurring, setIsRecurring] = useState(false);
  const [isSubscription, setIsSubscription] = useState(true);

  // Credit-tagged transactions carry no budget category (credit spend is
  // tracked on the card, not against buckets), so the category select hides and
  // the Charge/Payment toggle shows instead.
  const isSelectedAccountCredit = useMemo(
    () => accounts.find(a => a.id === accountId)?.type === 'credit',
    [accounts, accountId]
  );

  // A credit-card PAYMENT is a transfer, not recurring spend — the Recurring
  // (subscription) toggle is hidden/ignored in that mode (same rationale as
  // the manual-capture form).
  const isCreditPaymentMode = isSelectedAccountCredit && creditPayment;

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
    const overrides: { amount?: number; merchant?: string; date?: string; notes?: string; clearNeedsAmount?: boolean; creditPayment?: boolean; isRecurring?: boolean } = {};
    if (transaction.needsAmount || parsedAmount !== transaction.amount) overrides.amount = parsedAmount;
    if (trimmedMerchant !== transaction.merchant) overrides.merchant = trimmedMerchant;
    // Sent only on a real change; an emptied field clears stored notes (the
    // context turns '' into a deleteField()).
    const trimmedNotes = notes.trim();
    if (trimmedNotes !== (transaction.notes ?? '')) overrides.notes = trimmedNotes;
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
    // Recurring ON flags the transaction itself; the subscription CalendarItem
    // is created after a successful approve (below). Never for a credit-card
    // payment — that's a transfer, not a subscription.
    const markRecurring = isRecurring && !isCreditPaymentMode;
    if (markRecurring) overrides.isRecurring = true;
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

      // Recurring ON ⇒ also create a monthly recurring expense on the calendar,
      // flagged as a subscription so it appears on the Subscriptions tab. Uses
      // the (possibly user-edited) merchant/amount/date/account values, so a
      // noisy bank-alert merchant can be cleaned up before it becomes the title.
      if (markRecurring) {
        try {
          await addCalendarItem({
            id: crypto.randomUUID(),
            title: trimmedMerchant,
            amount: parsedAmount,
            date: date || transaction.date,
            type: 'expense',
            isPaid: false,
            isRecurring: true,
            frequency: 'monthly',
            // Explicit false when the nested switch is off — a recurring bill
            // that is NOT a subscription (F-MONEY-05).
            isSubscription,
            ...(accountId ? { accountId } : {}),
          });
        } catch (calendarError) {
          // The approve itself succeeded — surface the partial failure without
          // blocking the advance (mirrors the manual-capture form).
          console.error('Failed to create recurring subscription entry:', calendarError);
          toast.error('Approved, but the recurring subscription entry failed.');
        }
      }

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
      setDuplicateDismissed(true);
    } catch (error) {
      console.error('Failed to dismiss duplicate flag:', error);
      toast.error('Failed to update transaction');
    }
  };

  return (
    <div className="space-y-4">
      {possibleDuplicate && !duplicateDismissed && (
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

      {canLinkToBill && (
        <div className="rounded-card border border-accent-200 bg-accent-50 px-3 py-2.5 space-y-2 dark:border-accent-700 dark:bg-accent-800/20">
          {!showBillPicker ? (
            <Button
              variant="link"
              size="md"
              onClick={() => setShowBillPicker(true)}
              className="w-full justify-start gap-2 text-xs font-semibold text-accent-700 no-underline hover:no-underline dark:text-accent-200"
              leftIcon={<Link2 size={14} className="shrink-0" />}
            >
              Is this a bill payment? Link it to a bill
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-accent-700 dark:text-accent-200 flex items-center gap-1.5">
                  <Link2 size={14} className="shrink-0" />
                  Pick the bill this pays
                </p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setShowBillPicker(false)}
                  className="text-xs text-brand-500 no-underline hover:no-underline dark:text-brand-400"
                >
                  Cancel
                </Button>
              </div>
              {billCandidates.length === 0 ? (
                <p className="text-xs text-brand-500 dark:text-brand-400">
                  No unpaid bills found in the last/next month.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {billCandidates.map(bill => (
                    <Button
                      key={bill.id}
                      variant="outline"
                      size="md"
                      disabled={isLinkingBill}
                      onClick={() => handleLinkToBill(bill.id)}
                      className="w-full min-h-11 justify-between gap-2 bg-white text-left font-normal dark:bg-brand-700/50"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-brand-800 dark:text-brand-100 truncate">
                          {bill.title}
                        </span>
                        <span className="block text-xs text-brand-400 dark:text-brand-450">
                          {formatDate(parseISO(bill.date), 'MMM d, yyyy')}
                        </span>
                      </span>
                      <span className="font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50 shrink-0">
                        ${bill.amount.toFixed(2)}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Input
        label="Merchant"
        type="text"
        value={merchant}
        onChange={e => setMerchant(e.target.value)}
        placeholder="e.g. Starbucks"
      />

      <Input
        label="What was it? (Optional)"
        type="text"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="e.g. Minecraft, dog food"
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

      {/* Also logs — keyword-triggered habits (PRD #1065). Pre-checked; approving
          fires every ticked one. Untick to veto a false match. Only shown when at
          least one habit's keyword matches this merchant/notes. */}
      {keywordHabits.length > 0 && (
        <div className="space-y-2 rounded-card border border-warm-200 bg-warm-50/70 dark:border-warm-800 dark:bg-warm-900/20 p-3">
          <div className="flex items-center gap-1.5">
            <Sparkles size={12} className="text-warm-500" aria-hidden="true" />
            <Eyebrow as="p" className="text-xxs">Also logs</Eyebrow>
          </div>
          <p className="text-xs text-brand-500 dark:text-brand-400">
            Matched your habit keywords — approving logs these. Untick any that don’t belong.
          </p>
          <div className="flex flex-wrap gap-2">
            {keywordHabits.map(habit => {
              const isSelected = selectedHabitIds.includes(habit.id);
              return (
                <SelectableChip
                  key={habit.id}
                  selected={isSelected}
                  onClick={() => {
                    setHabitsTouched(true);
                    setSelectedHabitIds(prev =>
                      isSelected ? prev.filter(id => id !== habit.id) : [...prev, habit.id]
                    );
                  }}
                >
                  {habit.title}
                </SelectableChip>
              );
            })}
          </div>
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
          <p className="text-xs text-brand-400 dark:text-brand-450 italic">No habits found. Create some in Habits tab.</p>
        )}
        {autoSelectedIds.some(id => selectedHabitIds.includes(id)) && (
          <p className="text-xs text-brand-400 dark:text-brand-450">
            Pre-selected from your history with this merchant — tap a chip to remove.
          </p>
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
                      setHabitsTouched(true);
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
                  onClick={() => {
                    setHabitsTouched(true);
                    setSelectedHabitIds(prev => prev.filter(id => id !== habit.id));
                  }}
                >
                  {habit.title}
                </SelectableChip>
              ))}

            {/* Remaining low-confidence habits, revealed via a plain toggle. */}
            {showAllHabits && remainingLowConfidenceHabits.map(({ habit }) => (
              <SelectableChip
                key={habit.id}
                selected={false}
                onClick={() => {
                  setHabitsTouched(true);
                  setSelectedHabitIds(prev => [...prev, habit.id]);
                }}
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

      {/* Recurring (subscription) toggle — hidden for a credit-card PAYMENT,
          that's a transfer, not subscription-style recurring spend. */}
      {!isCreditPaymentMode && (
        <div className="p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-100 dark:border-brand-700 space-y-1.5">
          <div className="flex items-center justify-between">
            <span id="review-recurring-label" className="text-sm font-medium text-brand-700 dark:text-brand-200">Recurring Transaction</span>
            <Switch
              checked={isRecurring}
              onCheckedChange={setIsRecurring}
              aria-labelledby="review-recurring-label"
            />
          </div>
          {isRecurring && (
            <div className="flex items-center justify-between pt-1">
              <span id="review-subscription-label" className="text-sm font-medium text-brand-700 dark:text-brand-200">This is a subscription</span>
              <Switch
                checked={isSubscription}
                onCheckedChange={setIsSubscription}
                aria-labelledby="review-subscription-label"
              />
            </div>
          )}
          <p className="text-xs text-brand-400 dark:text-brand-400">
            {isRecurring && !isSubscription
              ? 'Creates a monthly bill on your calendar.'
              : 'Creates a monthly entry on your Subscriptions tab.'}
          </p>
        </div>
      )}

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
