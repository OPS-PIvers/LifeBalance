import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { subMonths, addMonths, parseISO, format as formatDate } from 'date-fns';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { Transaction, CREDIT_CARD_CATEGORY, INCOME_CATEGORY } from '@/types/schema';
import { Switch } from '@/components/ui/Switch';
import { getAutoSelectedHabitIds } from '@/utils/habitSuggestions';
import {
  isWithinBackdateWindow,
  keywordMatchedHabitIds,
  suppressAlreadyLoggedHabitIds,
} from '@/utils/transactionHabitFiring';
import { getLocalDateString } from '@/utils/dateHelpers';
import { suggestAccountIdForTransaction, suggestCategoryForTransaction } from '@/utils/actionQueueSmart';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { getBillLinkCandidates } from '@/utils/billLinkCandidates';
import { roundMoney } from '@/utils/money';
import { pickKeeper } from '@/utils/transactionMerge';
import { useFinance, useGamification, useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import InlineMerchantRename from '@/components/transactions/InlineMerchantRename';
import SettleBillSection from '@/components/transactions/SettleBillSection';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { HabitMultiSelect } from '@/components/habits/HabitMultiSelect';

export interface TransactionReviewFormProps {
  /** The pending transaction being reviewed. */
  transaction: Transaction;
  /** Called after a successful approve (or a delete when no `onDeleted`). */
  onDone: () => void;
  /** Called after a successful delete; falls back to `onDone` when omitted. */
  onDeleted?: () => void;
  /**
   * The unpaid bill the Action Queue RECOGNISED this charge as paying
   * (`useActionQueue`'s `matchedBills`). Only pre-selects the "This IS that
   * bill" affordance below — the affordance itself is offered on every
   * non-bank-sync row regardless, because the variable-amount utility case that
   * motivated it never matches.
   */
  matchedBill?: { id: string; title: string };
  /**
   * Optional DOM node — a host `Drawer`'s fixed footer bar — to render the
   * approve + delete actions into. This is a POSITION change only: the very
   * same elements are portalled there, so `canApprove` and `handleApprove`
   * stay owned by this component and are never lifted, mirrored, or
   * re-implemented by a host. The two drawer hosts pass their footer slot so
   * the money CTA can't be scrolled past on the app's longest review body.
   *
   * Omitted (or `null` before the host's slot ref attaches) ⇒ the actions
   * render at the bottom of the form body exactly as they always have, which
   * is what keeps a non-Drawer / inline mount working unchanged.
   */
  actionsContainer?: HTMLElement | null;
}

/**
 * The single shared transaction-review form, mounted by BOTH the Action Queue
 * drawer and the on-open review drawer. It only ever renders inside an open
 * Drawer, so consuming context directly (rather than taking large collections
 * as props) has no list-render cost.
 *
 * Layout is mobile-first, top → bottom: merchant, a hero $ amount field, a
 * Date + Account grid, budget-category select, habit chips, then the approve CTA
 * and a secondary delete row — the last two portalled into the host drawer's
 * sticky footer when it offers an `actionsContainer`. There is no separate
 * "edit" sub-mode — every field is editable inline, so a single Approve
 * verifies + categorises + tags the account + credits habits in ONE atomic
 * context call.
 */
const TransactionReviewForm: React.FC<TransactionReviewFormProps> = ({ transaction, onDone, onDeleted, matchedBill, actionsContainer }) => {
  const {
    accounts, buckets, transactions,
    updateTransactionCategory, deleteTransaction, addCalendarItem,
    mergeTransactions, keepBothTransactions, linkBankTransactionToBill,
  } = useFinance();
  const { habits } = useGamification();
  const { displayNameFor, ruleFor, rules: merchantRules } = useMerchantRules();

  // Is a household merchant rule relabelling this row? Keyed to the STORED
  // descriptor + amount (not the live merchant field) so the disclosure below
  // can't flicker in and out while the field is being typed. A rule that
  // contributes no `name` (category-only / bill-only) renames nothing, so there
  // is nothing to disclose.
  const storedMerchantRule = ruleFor({ merchant: transaction.merchant, amount: transaction.amount });
  const renamedFromDescriptor = storedMerchantRule?.name?.trim() ? transaction.merchant : null;

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
    // F-MONEY-14: keyword matching sees the friendly name as well as the raw
    // descriptor, so a habit keyed on a name the household chose ("Coffee run")
    // still pre-selects for a row the bank called "SQ *BLUE BOTTLE". `amount` is
    // passed so an amount-qualified rule can resolve; it comes from the live
    // field, matching `merchant`, so a mid-edit row suggests against what the
    // user is actually entering. This is the same set the Dashboard's
    // swipe-approve path fires — they must not diverge.
    //
    // Guard on Number.isFinite, NOT truthiness: `0` is a legitimate qualifier
    // (an Apple Pay $0 pre-auth stub), and `parseFloat('0') || undefined` would
    // silently discard it. An empty or unparseable field yields NaN → undefined,
    // which correctly means "no amount to offer" rather than "amount is zero".
    const parsedAmount = parseFloat(amount);
    return keywordMatchedHabitIds(
      habits,
      { merchant, notes, amount: Number.isFinite(parsedAmount) ? parsedAmount : undefined },
      merchantRules,
    ).filter(id => !alreadyFired.has(id));
  }, [habits, merchant, notes, amount, merchantRules, transaction.firedHabitIds]);
  // The habits a fire would credit are back-dated to the transaction's date, so
  // the dedup and window checks below are both keyed to that date, not to today.
  const fireDate = transaction.date;
  // CROSS-SOURCE DEDUP (PRD #1065): keyword matches whose habit ALREADY has a
  // completion in the fire date's period are dropped from the pre-selection —
  // you tapped "Order from Amazon" by hand on Monday, and the overnight sync's
  // Monday charge shouldn't log it a second time. Advisory, not a block: the
  // habit stays in the picker, so ticking it is the override for a genuine
  // second purchase that day. See suppressAlreadyLoggedHabitIds.
  // One pass over the whole set — the survivors are what still fires, and the
  // rest are what to explain in the helper text.
  const firableKeywordHabitIds = useMemo(
    () => suppressAlreadyLoggedHabitIds(habits, keywordHabitIds, fireDate),
    [habits, keywordHabitIds, fireDate]
  );
  const suppressedHabitIds = useMemo(
    () => keywordHabitIds.filter(id => !firableKeywordHabitIds.includes(id)),
    [keywordHabitIds, firableKeywordHabitIds]
  );
  // Beyond the back-date window nothing fires at all, however it's selected —
  // the mutation hard-blocks it (an out-of-window write would rewrite settled
  // history, or worse, future-date a completion). Say so rather than letting a
  // tick be a silent no-op.
  const outsideBackdateWindow = !isWithinBackdateWindow(fireDate, getLocalDateString());
  // The pre-selected baseline follows the live merchant/notes fields: history
  // auto-selection (or explicit prior tags) unioned with the keyword matches.
  const preselectIds = useMemo(() => {
    const base = hasExplicitTags ? (transaction.relatedHabitIds ?? []) : autoSelectedIds;
    // Only the NON-suppressed keyword matches pre-select. An explicit prior tag
    // still wins — the user asked for that one by hand.
    return Array.from(new Set([...base, ...firableKeywordHabitIds]));
  }, [hasExplicitTags, transaction.relatedHabitIds, autoSelectedIds, firableKeywordHabitIds]);
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
  // One line, most-specific-first: a hard block beats a suppression note, which
  // beats the ordinary "these were pre-selected" explainer. Declared after
  // `selectedHabitIds` because the fallback branch reads it.
  const habitHelperText = useMemo(() => {
    const dateLabel = formatDate(parseISO(fireDate), 'MMM d');
    if (outsideBackdateWindow && keywordHabitIds.length > 0) {
      return `This transaction is dated ${dateLabel} — too far back to log habits, so selections here are recorded as links only.`;
    }
    if (suppressedHabitIds.length > 0) {
      const titles = suppressedHabitIds
        .map(id => habits.find(h => h.id === id)?.title)
        .filter((t): t is string => !!t);
      const named = titles.length > 0 ? titles.join(', ') : 'A matching habit';
      return `${named} was already logged for ${dateLabel}, so it won’t log again — select it to add a second one.`;
    }
    if (autoSelectedIds.some(id => selectedHabitIds.includes(id)) || keywordHabitIds.length > 0) {
      return 'Pre-selected from your history and habit keyword matches — tap a chip to remove, or open the picker to adjust.';
    }
    return undefined;
  }, [
    fireDate, outsideBackdateWindow, keywordHabitIds, suppressedHabitIds, habits,
    autoSelectedIds, selectedHabitIds,
  ]);
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

  // The approve CTA + its inline secondary delete, defined ONCE. They render at
  // the bottom of the body by default and are portalled — same elements, same
  // handlers, same `canApprove` gate — into the host drawer's sticky footer
  // when one is offered. Nothing about approving changes with the position.
  const actions = (
    <div className="flex items-center gap-2">
      {/* Approve CTA — takes the row's remaining width. `px-4` trims size="lg"'s
          px-6 so the longest label ("Add amount & approve") still sits on one
          line beside Delete on a 375px (and narrower) phone. */}
      <Button
        variant="success"
        size="lg"
        onClick={handleApprove}
        disabled={!canApprove}
        className="flex-1 py-3 px-4"
        leftIcon={<Check size={18} strokeWidth={3} />}
      >
        {approveLabel}
      </Button>

      {/* Delete, inline beside Approve. Icon-only — the word does not fit next
          to the longest approve label at 375px — so the accessible name comes
          from aria-label rather than from the (absent) text. */}
      <Button
        variant="ghost-danger"
        size="icon"
        aria-label="Delete"
        onClick={handleDelete}
      >
        <Trash2 size={18} />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {possibleDuplicate && !duplicateDismissed && (
        <div className="rounded-card border border-warm-200 bg-warm-50 px-3 py-2.5 space-y-2 dark:border-warm-700 dark:bg-warm-900/20">
          <div className="flex items-start gap-2">
            <Copy size={14} className="mt-0.5 shrink-0 text-warm-600 dark:text-warm-400" />
            <p className="text-xs text-warm-700 dark:text-warm-300">
              Possible duplicate of <span className="font-semibold">{displayNameFor(possibleDuplicate)}</span>
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

      {/* TODO.md 2H(a): the OTHER road a charge takes in. `canLinkToBill`
          above covers a bank-synced row (no balance delta — its balance is
          already authoritative); this covers everything else, notably the
          `pending_review` screenshot imports, and DOES move the balance. The
          two are mutually exclusive so a row never offers both. Hidden wherever
          the mutation would refuse anyway rather than offering a dead tap: a row
          that already settled a bill (`paidCalendarItemId`), income (a credit
          cannot pay an expense), and a non-positive amount.

          The amount gate is the LIVE `parsedAmount`, matching the mutation's own
          `roundMoney(amount) <= 0` refusal exactly — gating on
          `!transaction.needsAmount` instead offered a button that always failed
          on a stored-$0 row that never carried the stub flag, while hiding it on
          a stub the user had just typed a real amount into. */}
      {!canLinkToBill && !transaction.paidCalendarItemId && !isIncome && parsedAmount > 0 && (
        <SettleBillSection
          transaction={transaction}
          matchedBill={matchedBill}
          liveAmount={parsedAmount}
          onSettled={onDone}
        />
      )}

      <Input
        label="Merchant"
        type="text"
        value={merchant}
        onChange={e => setMerchant(e.target.value)}
        placeholder="e.g. Starbucks"
      />

      {/* The bank's own words, always in reach. The field above holds the RAW
          stored merchant (editing it edits the row, not the rule), so this
          quiet caption is what ties the friendlier name shown everywhere else
          back to what actually appeared on the statement. */}
      {renamedFromDescriptor && (
        <p className="-mt-2 text-xxs text-brand-450">
          Your bank calls this <span className="font-mono">{renamedFromDescriptor}</span>
        </p>
      )}

      {/* Offered on any MACHINE-captured row (see MACHINE_CAPTURE_SOURCES) —
          reviewing a charge is where you actually notice the name a scan or a
          bank feed chose for it, so it's where renaming it should be one tap
          away. Keyed on the STORED descriptor, not the edited field above: the
          rule matches what the bank sends next month, not what this row is
          retitled to. */}
      <InlineMerchantRename
        merchant={transaction.merchant}
        source={transaction.source}
        amount={transaction.amount}
      />

      <Input
        label="What was it? (Optional)"
        type="text"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="e.g. Minecraft, dog food"
      />

      {/* Hero amount field — the primary action for an "awaiting amount" stub.
          The "$" is a plain baseline-aligned sibling (not absolutely positioned
          and box-centred), and the field — which is MONOSPACE — is sized in `ch`
          to exactly its content, so the mark and the figures read as one number
          and the pair stays snug and centred at any length. The floor of 4
          matches the "0.00" placeholder. The "$" stays a size down: a currency
          mark taller than its own figures looks wrong.
          text-5xl lives on the WRAPPER, not just the input: index.css's iOS
          anti-zoom rule (`@media (pointer: coarse) input { font-size:
          max(1rem, 1em) }`) is unlayered so it beats any utility class on the
          input itself — `1em` must inherit the hero size from here or the
          figures collapse to 16px on every phone while the "$" stays 4xl.
          Spinners are stripped because a `ch`-exact box has no room to spare. */}
      <div className="flex items-baseline justify-center gap-1 py-1 text-5xl">
        <span className="text-4xl font-bold text-brand-400 dark:text-brand-400">$</span>
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
          style={{ width: `${Math.max(4, amount.length)}ch` }}
          className="text-5xl font-mono font-bold text-brand-800 dark:text-brand-100 placeholder:text-brand-200 outline-hidden bg-transparent appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
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

      {/* Connect habits — searchable multi-select drawer (replaces the old
          chip wall, which was unscannable past ~20 habits). Keyword-matched
          "Also logs" automations (PRD #1065) and merchant-history matches are
          pre-selected via `preselectIds` and simply badged with a sparkle in
          the picker list rather than getting a separate banner. */}
      <HabitMultiSelect
        habits={habits}
        selectedHabitIds={selectedHabitIds}
        onChange={(ids) => {
          setHabitsTouched(true);
          setSelectedHabitIds(ids);
        }}
        automationHabitIds={keywordHabitIds}
        helperText={habitHelperText}
      />

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

      {actionsContainer ? createPortal(actions, actionsContainer) : actions}
    </div>
  );
};

export default TransactionReviewForm;
