import React, { useState, useRef, useEffect } from 'react';
import {
  X, Loader2, Wallet, CheckSquare, ShoppingBag
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinance, useGamification, useHouseholdCore, useShopping, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ReceiptData, MagicActionResponse } from '@/services/geminiService.types';
import { Transaction } from '@/types/schema';
import { ParsedTransaction } from '@/types/ui';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useStoreResolver } from '@/hooks/useStoreResolver';
import { getLocalDateString } from '@/utils/dateHelpers';
import { normalizeStoreName } from '@/utils/storeMatch';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { findMatchingPendingTransaction, buildReceiptMergeUpdates } from '@/utils/transactionMatch';
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

type ModalView = 'menu' | 'camera' | 'upload' | 'manual' | 'processing' | 'review';
type ModalTab = 'transaction' | 'todo' | 'shopping';

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
  subBucketId?: string;
  store?: string;
  accountId?: string;
  creditPayment?: boolean;
}

const CaptureModal: React.FC<CaptureModalProps> = ({ isOpen, onClose, initialManualData }) => {
  const { addTransaction, updateTransaction, buckets, transactions, accounts } = useFinance();
  const { habits } = useGamification();
  const { currentUser, members, householdId } = useHouseholdCore();
  const { addToDo } = useTodos();
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

  // Receipt → pending-tx link prompt. When a camera scan looks like a duplicate
  // of an existing pending_review transaction (e.g. an Apple Pay $0 stub already
  // in the Action Queue), we HOLD the built receipt transaction here instead of
  // writing it, until the user chooses Link vs Keep separate.
  const [pendingMatch, setPendingMatch] = useState<{
    receiptTx: Transaction;   // the transaction we WOULD have added
    candidate: Transaction;   // the existing pending tx to merge into (best match)
  } | null>(null);
  const [isResolvingMatch, setIsResolvingMatch] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  // Tracks whether the component is still mounted, so an in-flight getUserMedia()
  // that resolves AFTER unmount can release its stream instead of leaking (the
  // cleanup effect can't catch it — cameraStream was still null at unmount).
  const isMounted = useRef(true);

  // Dynamic Categories from buckets (Transaction)
  const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];
  const habitTitles = habits.map(h => h.title);

  // --- To-Do State ---
  const [todoText, setTodoText] = useState('');
  const [todoDate, setTodoDate] = useState('');
  const [todoAssignee, setTodoAssignee] = useState('');

  // --- Shopping List State ---
  const [shoppingName, setShoppingName] = useState('');
  const [shoppingCategory, setShoppingCategory] = useState('Uncategorized');
  const [shoppingQuantity, setShoppingQuantity] = useState('');
  const [shoppingStore, setShoppingStore] = useState('');

  const handleMagicSuccess = (result: MagicActionResponse) => {
      if (result.type === 'transaction') {
        setActiveTab('transaction');
        setManualInitialData({
          amount: result.data.amount?.toString(),
          merchant: result.data.merchant,
          category: result.data.category ? matchCategory(result.data.category) : undefined,
          date: result.data.date
        });
        setView('manual');
        toast.success("Transaction details found!");
      } else if (result.type === 'todo') {
        setActiveTab('todo');
        if (result.data.text) setTodoText(result.data.text);
        if (result.data.completeByDate) setTodoDate(result.data.completeByDate);
        toast.success("Task details found!");
      } else if (result.type === 'shopping') {
        setActiveTab('shopping');
        if (result.data.item) setShoppingName(result.data.item);
        if (result.data.quantity) setShoppingQuantity(result.data.quantity);
        if (result.data.category && (GROCERY_CATEGORIES as readonly string[]).includes(result.data.category)) {
          setShoppingCategory(result.data.category);
        }
        if (result.data.store) setShoppingStore(result.data.store);
        toast.success("Item details found!");
      } else {
        toast.error("Couldn't understand that. Try being more specific.");
      }
  };

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

  // Reset state when closing
  const handleClose = () => {
    stopCamera();
    setView('menu');
    setActiveTab('transaction');

    // Reset Transaction State
    setManualInitialData(undefined);
    setParsedTransactions([]);
    setPendingMatch(null);
    setIsResolvingMatch(false);

    // Reset To-Do State
    setTodoText('');
    setTodoDate(getLocalDateString());
    setTodoAssignee(currentUser?.uid ?? '');

    // Reset Shopping State
    setShoppingName('');
    setShoppingCategory('Uncategorized');
    setShoppingQuantity('');
    setShoppingStore('');

    onClose();
  };

  // --- Transaction Logic ---
  const startCamera = async () => {
    try {
      setView('camera');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      // If we unmounted while getUserMedia was in flight, the cleanup effect
      // already ran (with cameraStream still null) and won't run again — so this
      // freshly-acquired stream would leak. Stop it and bail without setState.
      if (!isMounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      toast.error("Could not access camera.");
      console.error(err);
      setView('menu');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  // Release the live MediaStream regardless of how the component leaves the
  // screen. stopCamera() only fires from handleClose()/capturePhoto(); if the
  // component UNMOUNTS while the camera is open (e.g. sign-out → ProtectedRoute
  // unmounts MainLayout and the LazyMount-ed CaptureModal without routing
  // through handleClose), the device camera would otherwise stay active until a
  // full page reload. Keying on `cameraStream` also stops a stream when it's
  // replaced; stopping an already-stopped track is a harmless no-op, so this
  // never fights stopCamera().
  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraStream]);

  // Flip the mounted flag on teardown so a late-resolving startCamera() can
  // detect it unmounted mid-await (see startCamera). Runs once for the lifetime.
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

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

  const matchSubBucket = (category: string, suggestedSubBucket?: string): string | undefined => {
    if (!suggestedSubBucket) return undefined;
    const bucket = buckets.find(b => b.name === category);
    if (!bucket?.subBuckets) return undefined;

    const exact = bucket.subBuckets.find(sb => sb.name.toLowerCase() === suggestedSubBucket.toLowerCase());
    if (exact) return exact.id;

    const loose = bucket.subBuckets.find(sb => sb.name.toLowerCase().includes(suggestedSubBucket.toLowerCase()));
    if (loose) return loose.id;

    return undefined;
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Image = canvas.toDataURL('image/jpeg', 0.8);
      stopCamera();
      setView('processing');
      setProcessingMessage('Scanning receipt...');
      try {
        if (!householdId) throw new Error("Household ID not found");
        const { analyzeReceipt } = await import('@/services/geminiService');

        const subBucketsMap: Record<string, string[]> = {};
        buckets.forEach(b => {
          if (b.subBuckets && b.subBuckets.length > 0) {
            subBucketsMap[b.name] = b.subBuckets.map(sb => sb.name);
          }
        });

        const data: ReceiptData = await analyzeReceipt(householdId, base64Image, dynamicCategories, habitTitles, subBucketsMap, stores.map(s => s.name));
        const category = matchCategory(data.category);

        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount: data.amount,
          merchant: data.merchant,
          category,
          date: data.date || getLocalDateString(),
          status: 'pending_review',
          isRecurring: false,
          source: 'camera-scan',
          autoCategorized: true,
          relatedHabitIds: matchHabits(data.suggestedHabits),
          subBucketId: matchSubBucket(category, data.subBucket),
          store: data.store
        };
        // Before writing, see if this receipt likely duplicates an existing
        // pending transaction (e.g. an Apple Pay $0 stub or another pending row
        // for the same store within ~3 days). If so, hold it and ask whether to
        // link/merge instead of creating a duplicate.
        const candidate = findMatchingPendingTransaction(data, transactions);
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
      } catch {
        toast.error("Failed to analyze receipt. Try manual entry.");
        setView('manual');
      }
    }
  };

  const handleFileSelect = async (file: File) => {
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

    setProcessingMessage('Extracting transactions...');
    try {
      if (!householdId) throw new Error("Household ID not found");
      const { parseBankStatement, analyzeReceipt } = await import('@/services/geminiService');

      const subBucketsMap: Record<string, string[]> = {};
      buckets.forEach(b => {
        if (b.subBuckets && b.subBuckets.length > 0) {
          subBucketsMap[b.name] = b.subBuckets.map(sb => sb.name);
        }
      });

      const transactions = await parseBankStatement(householdId, base64, dynamicCategories, habitTitles, subBucketsMap);
      if (transactions.length === 0) {
        setProcessingMessage('Trying receipt analysis...');
        const receipt = await analyzeReceipt(householdId, base64, dynamicCategories, habitTitles, subBucketsMap, stores.map(s => s.name));
        const category = matchCategory(receipt.category);
        setParsedTransactions([{
          id: crypto.randomUUID(),
          merchant: receipt.merchant,
          amount: receipt.amount,
          category,
          date: receipt.date || getLocalDateString(),
          selected: true,
          relatedHabitIds: matchHabits(receipt.suggestedHabits),
          subBucketId: matchSubBucket(category, receipt.subBucket),
          store: receipt.store
        }]);
      } else {
        setParsedTransactions(transactions.map(tx => {
          const category = matchCategory(tx.category);
          return {
            id: crypto.randomUUID(),
            merchant: tx.merchant,
            amount: tx.amount,
            category,
            date: tx.date || getLocalDateString(),
            selected: true,
            relatedHabitIds: matchHabits(tx.suggestedHabits),
            subBucketId: matchSubBucket(category, tx.subBucket)
          };
        }));
      }
      setView('review');
      toast.success(`Found ${transactions.length || 1} transaction(s)`);
    } catch (error) {
      console.error('AI processing error:', error);
      toast.error(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const results = await Promise.allSettled(
      selectedTx.map(tx => {
        const resolvedStore = tx.store ? (storeMap.get(normalizeStoreName(tx.store)) ?? tx.store) : tx.store;
        const newTransaction: Transaction = {
          id: tx.id,
          amount: tx.amount,
          merchant: tx.merchant,
          category: tx.category,
          date: tx.date,
          status: 'pending_review',
          isRecurring: false,
          source: 'file-upload',
          autoCategorized: true,
          relatedHabitIds: tx.relatedHabitIds,
          subBucketId: tx.subBucketId,
          store: resolvedStore,
          accountId: tx.accountId,
          creditPayment: tx.creditPayment
        };
        return addTransaction(newTransaction);
      })
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    if (succeeded > 0) toast.success(`${succeeded} transaction(s) added to Action Queue!`);
    else toast.error('Failed to add transactions');
    handleClose();
  };

  // Link the scanned receipt INTO the matched pending transaction (merge) rather
  // than creating a duplicate. We go through updateTransaction; the merge keeps
  // the row `pending_review`, so under the verified-only balance model (Plan 015)
  // it does NOT move the checking balance — the merged spend stays reflected via
  // Safe-to-Spend's pendingSpend term and debits only when the row is later
  // verified. (Mirrors AwaitingAmountDrawer's promote-the-existing-stub pattern.)
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
    } catch {
      toast.error('Failed to add transaction');
    } finally {
      setIsResolvingMatch(false);
    }
  };

  // --- To-Do Logic ---
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
      await addToDo({
        text: todoText.trim(),
        completeByDate: todoDate,
        assignedTo: todoAssignee,
        isCompleted: false
      });
      toast.success('Task added');
      handleClose();
    } catch {
      toast.error('Failed to add task');
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
    } catch {
      toast.error('Failed to add item');
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
        <h2 id="capture-drawer-title" className="font-display text-xl font-semibold text-brand-800 dark:text-brand-100">
          {effectiveTab === 'transaction' && (
            view === 'menu' ? 'Add Transaction' :
            view === 'camera' ? 'Scan Receipt' :
            view === 'upload' ? 'Upload Image' :
            view === 'manual' ? 'Manual Entry' :
            view === 'processing' ? 'Processing' : 'Review'
          )}
          {effectiveTab === 'todo' && 'New Task'}
          {effectiveTab === 'shopping' && 'Add Item'}
          {effectiveTab === null && 'Capture'}
        </h2>
        <Button
          variant="subtle"
          size="icon"
          className="rounded-full"
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
                  onScan={startCamera}
                  onFileSelect={handleFileSelect}
                  onManual={() => setView('manual')}
                  householdId={householdId || ''}
                  dynamicCategories={dynamicCategories}
                  onMagicSuccess={handleMagicSuccess}
                />
              )}

              {/* Camera View */}
              {view === 'camera' && (
                <div className="relative bg-black rounded-xl overflow-hidden aspect-3/4">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                    <button
                      onClick={capturePhoto}
                      aria-label="Capture photo"
                      className="w-16 h-16 rounded-full border-4 border-white bg-white/20 flex items-center justify-center active:scale-90 transition-transform focus:outline-hidden focus:ring-2 focus:ring-white"
                    >
                      <div className="w-12 h-12 bg-white rounded-full" />
                    </button>
                  </div>
                </div>
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
                  buckets={buckets}
                  stores={stores}
                  accounts={accounts}
                />
              )}

              {/* Manual Form View */}
              {view === 'manual' && (
                <CaptureTransactionManual
                  initialData={manualInitialData}
                  onAddTransaction={addTransaction}
                  onClose={handleClose}
                  dynamicCategories={dynamicCategories}
                  habits={habits}
                  transactions={transactions}
                  buckets={buckets}
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
