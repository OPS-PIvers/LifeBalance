import React, { useState, useRef, useEffect } from 'react';
import {
  X, ChevronLeft, Loader2, Wallet, CheckSquare, ShoppingBag
} from 'lucide-react';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { useFinance, useGamification, useHouseholdCore, useShopping, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ReceiptData } from '@/services/geminiService.types';
import { Transaction, CREDIT_CARD_CATEGORY } from '@/types/schema';
import { ParsedTransaction } from '@/types/ui';
import { useStoreResolver } from '@/hooks/useStoreResolver';
import { getLocalDateString } from '@/utils/dateHelpers';
import { normalizeStoreName } from '@/utils/storeMatch';
import { track } from '@/services/analytics';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { findMatchingPendingTransaction, buildReceiptMergeUpdates } from '@/utils/transactionMatch';
import { buildLineItemTransactions, shouldSplitReceipt, groupLineItemsByCategory } from '@/utils/receiptLineItems';
import { sumMoney } from '@/utils/money';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { Button } from '@/components/ui/Button';
import { SegmentedControl, SegmentedControlOption } from '@/components/ui/SegmentedControl';
import { CaptureShoppingTab } from './CaptureShoppingTab';
import { CaptureTodoTab } from './CaptureTodoTab';
import { CaptureTransactionManual } from './CaptureTransactionManual';
import { CaptureTransactionReview } from './CaptureTransactionReview';
import { CaptureMenu } from './CaptureMenu';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, the modal opens straight into the manual transaction form
   *  pre-filled with this data (e.g. the dashboard "Pay down" quick action
   *  passes a credit account + creditPayment). */
  initialManualData?: ManualInitialData;
}

type ModalView = 'menu' | 'manual' | 'processing' | 'review';
type ModalTab = 'transaction' | 'todo' | 'shopping';

// Paper cut 2G.3 — the two previously-separate "Scan Receipt" (embedded
// getUserMedia camera) and "Upload image" (file input) entries are merged
// into one "Add from image" entry that hands the browser a plain
// `<input type="file" accept="image/*">`; on mobile this opens the native OS
// sheet offering "Take Photo" or "Choose from Library", so a single code path
// now covers both a fresh snap and an existing screenshot. Both historical
// input methods are represented by this one source value going forward (see
// `Transaction.source` for the retained legacy values).
const IMAGE_CAPTURE_SOURCE = 'image-capture' as const;

/**
 * Plan 090 (capture cascade) — the canonical capture-tab order plus the module
 * each tab belongs to. A tab is only shown when its destination is reachable:
 * Expense→money; To-Do→todos and Shop→shopping are gated by the Plan page too
 * (isPlanTabVisible), so we never capture into a page the household has hidden
 * (there is no Meals capture tab).
 */
const CAPTURE_TAB_ORDER: readonly ModalTab[] = ['transaction', 'todo', 'shopping'] as const;
const CAPTURE_TAB_MODULE: Record<ModalTab, 'money' | 'todos' | 'shopping'> = {
  transaction: 'money',
  todo: 'todos',
  shopping: 'shopping',
};

interface ManualInitialData {
  amount?: string;
  merchant?: string;
  category?: string;
  date?: string;
  store?: string;
  accountId?: string;
  creditPayment?: boolean;
}

const CaptureModal: React.FC<CaptureModalProps> = ({ isOpen, onClose, initialManualData }) => {
  const { addTransaction, addTransactions, updateTransaction, addCalendarItem, buckets, transactions, accounts } = useFinance();
  const { habits } = useGamification();
  const { currentUser, members, householdId } = useHouseholdCore();
  const { addToDo, todoCategories, updateTodoCategories } = useTodos();
  const { addShoppingItem, stores } = useShopping();
  // Resolve AI-returned store names to existing stores, creating new ones only
  // when they're certainly not duplicates.
  const { ensureStores } = useStoreResolver();
  // Plan 090 — only show capture tabs whose destination is reachable for this
  // household (To-Do/Shop also require the Plan page to be on).
  const { isModuleEnabled, isPlanTabVisible } = useModuleVisibility();

  // `activeTab` is the user's PREFERENCE; the tab actually shown (`effectiveTab`)
  // is derived in render so a disabled preference falls back to the first enabled
  // tab WITHOUT a setState-in-effect (mirrors ListsPage from PR1).
  const [activeTab, setActiveTab] = useState<ModalTab>('transaction');

  // The capture tabs this household has enabled, in canonical order. The money
  // tab follows its top-level flag; todo/shopping follow the derived plan-tab
  // visibility (Plan master + the sub-tab) so they vanish whenever their
  // destination page would be unreachable.
  const isCaptureTabVisible = (tab: ModalTab): boolean => {
    const moduleKey = CAPTURE_TAB_MODULE[tab];
    return moduleKey === 'money' ? isModuleEnabled('money') : isPlanTabVisible(moduleKey);
  };
  const enabledTabs = CAPTURE_TAB_ORDER.filter(isCaptureTabVisible);
  // Effective tab: the preference if it's enabled, else the first enabled tab.
  // `null` only when every capture module is off (extreme — the FAB is hidden in
  // that case), handled by the empty-state guard in the render body.
  const effectiveTab: ModalTab | null = enabledTabs.includes(activeTab)
    ? activeTab
    : enabledTabs[0] ?? null;

  // --- Transaction State ---
  const [view, setView] = useState<ModalView>('menu');
  const [processingMessage, setProcessingMessage] = useState('Processing...');

  // Manual Entry State
  const [manualInitialData, setManualInitialData] = useState<ManualInitialData | undefined>(undefined);

  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([]);

  // Receipt → pending-tx link prompt. When a scanned image looks like a
  // duplicate of an existing pending_review transaction (e.g. an Apple Pay $0
  // stub already in the Action Queue), we HOLD the built receipt transaction
  // here instead of writing it, until the user chooses Link vs Keep separate.
  const [pendingMatch, setPendingMatch] = useState<{
    receiptTx: Transaction;   // the transaction we WOULD have added
    candidate: Transaction;   // the existing pending tx to merge into (best match)
  } | null>(null);
  const [isResolvingMatch, setIsResolvingMatch] = useState(false);

  // Dynamic Categories from buckets (Transaction)
  const dynamicCategories = buildTransactionCategoryOptions(buckets);
  const habitTitles = habits.map(h => h.title);

  // --- To-Do State ---
  const [todoText, setTodoText] = useState('');
  const [todoDate, setTodoDate] = useState('');
  const [todoAssignee, setTodoAssignee] = useState('');
  // F-TODO-16 — optional category. `undefined` (never '') is the canonical
  // "Uncategorized" value, so it is only put on the payload when set.
  const [todoCategory, setTodoCategory] = useState<string | undefined>(undefined);

  // --- Shopping List State ---
  const [shoppingName, setShoppingName] = useState('');
  const [shoppingCategory, setShoppingCategory] = useState('Uncategorized');
  const [shoppingQuantity, setShoppingQuantity] = useState('');
  const [shoppingStore, setShoppingStore] = useState('');

  // Initialize Defaults when modal opens
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (isOpen && !hasInitialized.current) {
      // To-Do defaults — only set if not already populated (functional
      // updaters read the latest state without needing them as deps).
      setTodoDate(prev => prev || getLocalDateString());
      // Default assignee to current user or first member
      setTodoAssignee(prev =>
        prev || (currentUser?.uid ?? (members.length > 0 ? members[0]!.uid : ''))
      );

      hasInitialized.current = true;
    }

    // Reset flag when modal closes
    if (!isOpen) {
      hasInitialized.current = false;
    }
  }, [isOpen, currentUser, members]);

  // Caller-supplied prefill (e.g. dashboard "Pay down"): jump straight to the
  // manual transaction form with the account/payment pre-tagged. Done during
  // render on the open edge (rather than in an effect) to match the codebase's
  // no-setState-in-effect rule; the prev-tracker fires the prefill exactly once
  // per open and resets when the modal closes.
  const [prefilledForOpen, setPrefilledForOpen] = useState(false);
  if (isOpen && initialManualData && !prefilledForOpen) {
    setPrefilledForOpen(true);
    setActiveTab('transaction');
    setManualInitialData(initialManualData);
    setView('manual');
  }
  if (!isOpen && prefilledForOpen) {
    setPrefilledForOpen(false);
  }

  // Reset state when closing. CaptureModal renders inside LazyMount (mounts on
  // first open, stays mounted forever after — see CLAUDE.md Code-Splitting),
  // so this is the ENTIRE state-reset mechanism; anything back() clears must
  // be cleared here too.
  const handleClose = () => {
    setView('menu');
    setActiveTab('transaction');
    setProcessingMessage('Processing...');

    // Reset Transaction State
    setManualInitialData(undefined);
    setParsedTransactions([]);
    setPendingMatch(null);
    setIsResolvingMatch(false);

    // Reset To-Do State
    setTodoText('');
    setTodoDate(getLocalDateString());
    setTodoAssignee(currentUser?.uid ?? '');
    setTodoCategory(undefined);

    // Reset Shopping List State
    setShoppingName('');
    setShoppingCategory('Uncategorized');
    setShoppingQuantity('');
    setShoppingStore('');

    onClose();
  };

  // Back to the capture-type menu from any sub-view (manual/processing/review).
  // In-progress manual entry is discarded because CaptureTransactionManual
  // unmounts when `view` stops being 'manual' — lifting its form state to
  // survive a back navigation is deliberately out of scope (paper cut 2G.3).
  const handleBack = () => {
    setManualInitialData(undefined);
    setParsedTransactions([]);
    setView('menu');
  };

  // --- Transaction Logic ---
  const matchCategory = (suggestedCategory: string): string => {
    if (!suggestedCategory) return dynamicCategories[0] || '';
    if (dynamicCategories.includes(suggestedCategory)) return suggestedCategory;

    const match = dynamicCategories.find(c => c.toLowerCase() === suggestedCategory.toLowerCase());
    if (match) return match;

    const partialMatch = dynamicCategories.find(
      c => c.toLowerCase().includes(suggestedCategory.toLowerCase()) ||
           suggestedCategory.toLowerCase().includes(c.toLowerCase())
    );
    if (partialMatch) return partialMatch;

    return dynamicCategories[0] || '';
  };

  const matchHabits = (suggestedHabits?: string[]): string[] => {
    if (!suggestedHabits || suggestedHabits.length === 0) return [];
    return habits
      .filter(h => {
        const habitTitleLower = h.title.toLowerCase();
        return suggestedHabits.some(sh => sh.toLowerCase() === habitTitleLower);
      })
      .map(h => h.id);
  };

  // Paper cut 2G.3 — "Add from image" merges the old camera-scan and
  // upload-image entries into one flow. It runs the itemized receipt parser
  // FIRST (it handles both a mixed-category receipt split and a
  // single-category receipt, with duplicate detection against existing
  // pending rows) and only falls back to bank-statement parsing when the
  // image has no itemized products — the reverse of the old upload cascade,
  // which tried the statement parser first and never got line items or
  // duplicate detection out of a receipt photo.
  const handleImageSelect = async (file: File) => {
    setView('processing');
    setProcessingMessage('Reading image...');
    let base64: string;
    try {
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    } catch (error) {
      console.error('File read error:', error);
      toast.error('Failed to read image.');
      setView('menu');
      return;
    }

    setProcessingMessage('Scanning image...');
    try {
      if (!householdId) throw new Error("Household ID not found");
      const { parseReceiptLineItems, parseBankStatement } = await import('@/services/geminiService');

      const data = await parseReceiptLineItems(householdId, base64, dynamicCategories, stores.map(s => s.name), habitTitles);

      // The itemized-receipt parser won: it found at least one product line.
      if (data.items.length > 0) {
        track('receipt_scanned');

        // Multiple category groups → review-and-split flow (reuses the
        // existing multi-transaction review UI). Each row shares one
        // receiptGroupId and the receipt-level habit suggestions.
        if (shouldSplitReceipt(data)) {
          const groupId = crypto.randomUUID();
          const relatedHabitIds = matchHabits(data.suggestedHabits);
          const rows = buildLineItemTransactions(data, groupId).map(r => ({
            ...r,
            category: matchCategory(r.category),
            relatedHabitIds,
          }));
          setParsedTransactions(rows);
          track('receipt_line_split', { count: rows.length });
          setView('review');
          toast.success(`Split into ${rows.length} categories — review below`);
          return;
        }

        // Single category (or a receipt with no itemized products): fall back to
        // the whole-receipt single-transaction path, preserving the duplicate
        // match against existing pending rows.
        const groups = groupLineItemsByCategory(data.items);
        const total = groups.length > 0
          ? (groups[0]?.amount ?? 0)
          : sumMoney(data.items.map(i => i.amount));
        const category = matchCategory(groups[0]?.category ?? data.items[0]?.category ?? '');
        const receiptLike: ReceiptData = {
          merchant: data.merchant,
          amount: total,
          category,
          date: data.date,
          store: data.store,
        };

        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount: total,
          merchant: data.merchant,
          category,
          date: data.date || getLocalDateString(),
          status: 'pending_review',
          isRecurring: false,
          source: IMAGE_CAPTURE_SOURCE,
          autoCategorized: true,
          store: data.store,
          relatedHabitIds: matchHabits(data.suggestedHabits),
        };
        // Before writing, see if this receipt likely duplicates an existing
        // pending transaction (e.g. an Apple Pay $0 stub or another pending row
        // for the same store within ~3 days). If so, hold it and ask whether to
        // link/merge instead of creating a duplicate.
        const candidate = findMatchingPendingTransaction(receiptLike, transactions);
        if (candidate) {
          setPendingMatch({ receiptTx: newTransaction, candidate });
          // Park the body on the menu view (re-enables normal Drawer close) and
          // let the ConfirmDialog overlay it — do NOT handleClose() here.
          setView('menu');
          return;
        }

        await addTransaction(newTransaction);
        toast.success("Receipt scanned! Check your Action Queue.");
        handleClose();
        return;
      }

      // No itemized products — this isn't a single receipt (e.g. it's a bank
      // statement or transaction-list screenshot). Fall back to extracting a
      // list of transactions instead.
      setProcessingMessage('Extracting transactions...');
      const bankTransactions = await parseBankStatement(householdId, base64, dynamicCategories, habitTitles, stores.map(s => s.name));
      if (bankTransactions.length === 0) {
        toast.error("Couldn't find any transactions in that image. Try manual entry.");
        setView('manual');
        return;
      }
      setParsedTransactions(bankTransactions.map(tx => ({
        id: crypto.randomUUID(),
        merchant: tx.merchant,
        amount: tx.amount,
        category: matchCategory(tx.category),
        date: tx.date || getLocalDateString(),
        selected: true,
        relatedHabitIds: matchHabits(tx.suggestedHabits),
        store: tx.store,
      })));
      track('statement_scanned', { count: bankTransactions.length });
      setView('review');
      toast.success(`Found ${bankTransactions.length} transaction(s)`);
    } catch (error) {
      console.error('AI processing error:', error);
      toast.error(describeError(error, 'analyze the image', 'read'));
      setView('manual');
    }
  };

  const handleToggleSelection = (id: string) => {
    setParsedTransactions(prev => prev.map(tx => tx.id === id ? { ...tx, selected: !tx.selected } : tx));
  };

  const handleToggleAll = () => {
    setParsedTransactions(prev => {
      const allSelected = prev.every(t => t.selected);
      return prev.map(t => ({ ...t, selected: !allSelected }));
    });
  };

  const handleUpdateTransaction = (id: string, updates: Partial<ParsedTransaction>) => {
    setParsedTransactions(prev => prev.map(tx => tx.id === id ? { ...tx, ...updates } : tx));
  };

  const submitParsedTransactions = async () => {
    const selectedTx = parsedTransactions.filter(tx => tx.selected);
    if (selectedTx.length === 0) {
      toast.error('Please select at least one transaction');
      return;
    }
    setView('processing');
    setProcessingMessage(`Adding ${selectedTx.length} transaction(s)...`);
    // Resolve AI store names to canonical stores (creating non-duplicates once)
    // before writing, so each transaction references a real household store.
    const storeMap = await ensureStores(selectedTx.map(tx => tx.store));
    // A receipt split carries a shared receiptGroupId on every row; a bank
    // statement scan does not. The split MUST commit atomically (owner note:
    // all resulting transactions in one writeBatch) so a partial receipt can
    // never land, while statement rows stay independent (one bad row shouldn't
    // fail the rest).
    const isReceiptSplit = selectedTx.some(tx => tx.receiptGroupId);
    const buildPayload = (tx: typeof selectedTx[number]): Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'> => {
      const resolvedStore = tx.store ? (storeMap.get(normalizeStoreName(tx.store)) ?? tx.store) : tx.store;
      // Credit-tagged rows carry the sentinel instead of a bucket category
      // (credit spend never counts toward buckets); the AI-parsed category is
      // only used for asset-account rows.
      const isCredit = accounts.find(a => a.id === tx.accountId)?.type === 'credit';
      return {
        amount: tx.amount,
        merchant: tx.merchant,
        category: isCredit ? CREDIT_CARD_CATEGORY : tx.category,
        date: tx.date,
        status: 'pending_review',
        isRecurring: false,
        source: IMAGE_CAPTURE_SOURCE,
        autoCategorized: true,
        relatedHabitIds: tx.relatedHabitIds,
        store: resolvedStore,
        accountId: tx.accountId,
        creditPayment: tx.creditPayment,
        receiptGroupId: tx.receiptGroupId,
      };
    };

    if (isReceiptSplit) {
      try {
        await addTransactions(selectedTx.map(buildPayload));
        toast.success(`${selectedTx.length} transaction(s) added to Action Queue!`);
      } catch (error) {
        toast.error(describeError(error, 'add the transactions'));
      }
      handleClose();
      return;
    }

    const results = await Promise.allSettled(selectedTx.map(tx => addTransaction(buildPayload(tx))));
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    if (succeeded > 0) toast.success(`${succeeded} transaction(s) added to Action Queue!`);
    else {
      const firstRejection = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      toast.error(describeError(firstRejection?.reason, 'add the transactions'));
    }
    handleClose();
  };

  // Link the scanned receipt INTO the matched pending transaction (merge) rather
  // than creating a duplicate. We go through updateTransaction; the merge keeps
  // the row `pending_review`, so under the verified-only balance model (Plan 015)
  // it does NOT move the checking balance — the merged spend stays reflected via
  // Safe-to-Spend's pendingSpend term and debits only when the row is later
  // verified. (Mirrors the review flow's promote-the-existing-stub pattern.)
  const handleConfirmLink = async () => {
    if (!pendingMatch) return;
    setIsResolvingMatch(true);
    try {
      const { receiptTx, candidate } = pendingMatch;
      // buildReceiptMergeUpdates only sends `amount` when it changes (delta-safe)
      // and clears needsAmount for a stub; status stays pending_review.
      await updateTransaction(candidate.id, buildReceiptMergeUpdates(receiptTx, candidate));
      setPendingMatch(null);
      handleClose();
    } catch {
      // updateTransaction already toasts on failure; keep the prompt open to retry.
    } finally {
      setIsResolvingMatch(false);
    }
  };

  // Keep the scanned receipt as its own new transaction (no merge). Also the
  // dismiss path for the prompt (Escape/backdrop): a scan you took should still
  // be recorded rather than silently discarded.
  const handleKeepSeparate = async () => {
    if (!pendingMatch) return;
    setIsResolvingMatch(true);
    try {
      await addTransaction(pendingMatch.receiptTx);
      toast.success('Receipt scanned! Check your Action Queue.');
      setPendingMatch(null);
      handleClose();
    } catch (error) {
      toast.error(describeError(error, 'add the transaction'));
    } finally {
      setIsResolvingMatch(false);
    }
  };

  // --- To-Do Logic ---
  // F-TODO-16 — mint a new category from the capture form. Callers pass the
  // WHOLE next vocabulary to updateTodoCategories (see the mutation's contract).
  const handleAddTodoCategory = async (name: string) => {
    await updateTodoCategories([...todoCategories, name]);
  };

  const handleToDoSubmit = async () => {
    if (members.length === 0) {
      toast.error('No household members available.');
      return;
    }
    if (!todoText.trim() || !todoDate) {
      toast.error('Please fill in required fields');
      return;
    }

    // Default to unassigned if current selection is invalid? Or block?
    // User logic: Block if invalid.
    const isValidAssignee = members.some(m => m.uid === todoAssignee);
    if (!isValidAssignee && todoAssignee) {
      toast.error('Invalid assignee selected');
      return;
    }
    if (!todoAssignee && members.length > 0) {
       // Should force selection? Or default to first?
       // Currently state init defaults to currentUser or first member.
       // If empty here, something is wrong.
       toast.error('Please select an assignee');
       return;
    }

    try {
      const trimmedCategory = todoCategory?.trim();
      await addToDo({
        text: todoText.trim(),
        completeByDate: todoDate,
        assignedTo: todoAssignee,
        isCompleted: false,
        // Absent (not '') is the canonical "Uncategorized" value — see ToDo.category.
        ...(trimmedCategory ? { category: trimmedCategory } : {})
      });
      toast.success('Task added');
      handleClose();
    } catch (error) {
      toast.error(describeError(error, 'add the task'));
    }
  };

  // --- Shopping List Logic ---
  const handleShoppingSubmit = async () => {
    if (!shoppingName.trim()) {
      toast.error('Please enter an item name');
      return;
    }
    try {
      // Resolve the store to an existing one, or create it if it's certainly new.
      const storeMap = await ensureStores([shoppingStore]);
      const resolvedStore = shoppingStore.trim()
        ? storeMap.get(normalizeStoreName(shoppingStore))
        : undefined;
      await addShoppingItem({
        name: shoppingName.trim(),
        category: shoppingCategory,
        quantity: shoppingQuantity.trim() || undefined,
        store: resolvedStore || undefined,
        isPurchased: false
      });
      toast.success('Added to list');
      handleClose();
    } catch (error) {
      toast.error(describeError(error, 'add the item'));
    }
  };

  // Tab definitions keyed by value; the visible list is filtered to enabled
  // modules below, preserving the canonical order.
  const TAB_LABELS: Record<ModalTab, React.ReactNode> = {
    transaction: (
      <div className="flex items-center justify-center gap-2">
        <Wallet size={16} />
        <span>Expense</span>
      </div>
    ),
    todo: (
      <div className="flex items-center justify-center gap-2">
        <CheckSquare size={16} />
        <span>To-Do</span>
      </div>
    ),
    shopping: (
      <div className="flex items-center justify-center gap-2">
        <ShoppingBag size={16} />
        <span>Shop</span>
      </div>
    ),
  };

  const tabOptions: SegmentedControlOption<ModalTab>[] = enabledTabs.map((tab) => ({
    value: tab,
    label: TAB_LABELS[tab],
  }));

  const headerContent = (
    <div className="flex flex-col border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-1 min-w-0">
          {/* Back affordance — every sub-view (manual/processing/review) used
              to have no way out short of closing the whole drawer, wiping
              everything entered. Back always returns to the capture-type
              menu (paper cut 2G.3). */}
          {view !== 'menu' && (
            <Button
              variant="subtle"
              size="icon"
              className="rounded-full -ml-2 shrink-0"
              onClick={handleBack}
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </Button>
          )}
          <h2 id="capture-drawer-title" className="font-display text-xl font-semibold text-brand-800 dark:text-brand-100 truncate">
            {view === 'menu' && tabOptions.length > 1 ? (
              // While the type selector below offers every capture kind, a
              // type-specific title ("Add Transaction") contradicted the FAB's
              // "transaction, task, or item" promise (round-3 critique). The
              // title specializes once a specific flow is entered.
              'Capture'
            ) : (
              <>
                {effectiveTab === 'transaction' && (
                  view === 'menu' ? 'Add Transaction' :
                  view === 'manual' ? 'Manual Entry' :
                  view === 'processing' ? 'Processing' : 'Review'
                )}
                {effectiveTab === 'todo' && 'New Task'}
                {effectiveTab === 'shopping' && 'Add Item'}
                {effectiveTab === null && 'Capture'}
              </>
            )}
          </h2>
        </div>
        <Button
          variant="subtle"
          size="icon"
          className="rounded-full shrink-0"
          onClick={handleClose}
          aria-label="Close drawer"
        >
          <X size={20} />
        </Button>
      </div>

      {/* Tab Switcher - only show in the menu view, and only when more than one
          capture tab is enabled (nothing to switch between otherwise). */}
      {view === 'menu' && tabOptions.length > 1 && effectiveTab !== null && (
        <div className="px-6 pb-4">
          <SegmentedControl<ModalTab>
            options={tabOptions}
            value={effectiveTab}
            onChange={setActiveTab}
            name="Capture type"
          />
        </div>
      )}
    </div>
  );

  return (
    <>
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      header={headerContent}
      ariaLabelledBy="capture-drawer-title"
      noPadding={true}
      height="tall"
      disableClose={view === 'processing'}
    >
      {/* Body Content */}
      <div className="p-6">

        {/* Empty-state guard: every capture module is disabled. The FAB that
            opens this modal is hidden in that case, so this is defensive only. */}
        {effectiveTab === null && (
          <p className="py-12 text-center text-brand-500 dark:text-brand-400">
            No capture types are enabled. Turn on Money, To-Dos, or Shopping in Settings.
          </p>
        )}

        {/* 1. TRANSACTION TAB */}
        {effectiveTab === 'transaction' && (
            <>
              {/* Processing View */}
              {view === 'processing' && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 className="w-12 h-12 text-accent-600 dark:text-accent-300 animate-spin" />
                  <p className="text-brand-500 dark:text-brand-400 font-medium">{processingMessage}</p>
                </div>
              )}

              {/* Menu View */}
              {view === 'menu' && (
                <CaptureMenu
                  onSelectImage={handleImageSelect}
                  onManual={() => setView('manual')}
                />
              )}

              {/* Review View */}
              {view === 'review' && (
                <CaptureTransactionReview
                  parsedTransactions={parsedTransactions}
                  onUpdateTransaction={handleUpdateTransaction}
                  onToggleSelection={handleToggleSelection}
                  onToggleAll={handleToggleAll}
                  onSubmit={submitParsedTransactions}
                  dynamicCategories={dynamicCategories}
                  stores={stores}
                  accounts={accounts}
                />
              )}

              {/* Manual Form View */}
              {view === 'manual' && (
                <CaptureTransactionManual
                  initialData={manualInitialData}
                  onAddTransaction={addTransaction}
                  onAddCalendarItem={addCalendarItem}
                  onClose={handleClose}
                  dynamicCategories={dynamicCategories}
                  habits={habits}
                  transactions={transactions}
                  stores={stores}
                  accounts={accounts}
                />
              )}
            </>
          )}

          {/* 2. TO-DO TAB */}
          {effectiveTab === 'todo' && (
            <CaptureTodoTab
              text={todoText}
              setText={setTodoText}
              date={todoDate}
              setDate={setTodoDate}
              assignee={todoAssignee}
              setAssignee={setTodoAssignee}
              members={members}
              categories={todoCategories}
              category={todoCategory}
              setCategory={setTodoCategory}
              onAddCategory={handleAddTodoCategory}
              onSubmit={handleToDoSubmit}
            />
          )}

          {/* 3. SHOPPING TAB */}
          {effectiveTab === 'shopping' && (
            <CaptureShoppingTab
              name={shoppingName}
              setName={setShoppingName}
              category={shoppingCategory}
              setCategory={setShoppingCategory}
              quantity={shoppingQuantity}
              setQuantity={setShoppingQuantity}
              store={shoppingStore}
              setStore={setShoppingStore}
              onSubmit={handleShoppingSubmit}
            />
          )}

      </div>
    </Drawer>

    {/* Receipt → pending-transaction link prompt. ConfirmDialog is Modal-based
        (its own portal at z-modal), so it overlays the Capture Drawer cleanly.
        Cancel ("Keep separate") and Escape/backdrop both add the receipt as a
        new transaction so a scan is never silently discarded. */}
    {pendingMatch && (
      <ConfirmDialog
        isOpen={!!pendingMatch}
        onClose={handleKeepSeparate}
        onConfirm={handleConfirmLink}
        title="Link this receipt?"
        message={`Link this receipt to the ${pendingMatch.candidate.merchant} transaction from ${pendingMatch.candidate.date}? We'll update that pending transaction instead of adding a duplicate.`}
        confirmLabel="Link"
        cancelLabel="Keep separate"
        confirmVariant="primary"
        isConfirming={isResolvingMatch}
      />
    )}
    </>
  );
};

export default CaptureModal;
