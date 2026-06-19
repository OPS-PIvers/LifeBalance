import React, { useState, useRef, useEffect } from 'react';
import {
  X, Loader2, Wallet, CheckSquare, ShoppingBag
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinance, useGamification, useHouseholdCore, useShopping, useTodos } from '@/contexts/FirebaseHouseholdContext';
import type { ReceiptData, MagicActionResponse } from '@/services/geminiService.types';
import { Transaction } from '@/types/schema';
import { ParsedTransaction } from '@/types/ui';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { Drawer } from '@/components/ui/Drawer';
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
}

type ModalView = 'menu' | 'camera' | 'upload' | 'manual' | 'processing' | 'review';
type ModalTab = 'transaction' | 'todo' | 'shopping';

interface ManualInitialData {
  amount?: string;
  merchant?: string;
  category?: string;
  date?: string;
  subBucketId?: string;
  store?: string;
  accountId?: string;
}

/**
 * Returns today's date in YYYY-MM-DD format using local timezone
 */
const getLocalDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const CaptureModal: React.FC<CaptureModalProps> = ({ isOpen, onClose }) => {
  const { addTransaction, buckets, transactions, accounts } = useFinance();
  const { habits } = useGamification();
  const { currentUser, members, householdId } = useHouseholdCore();
  const { addToDo } = useTodos();
  const { addShoppingItem, stores } = useShopping();

  const [activeTab, setActiveTab] = useState<ModalTab>('transaction');

  // --- Transaction State ---
  const [view, setView] = useState<ModalView>('menu');
  const [processingMessage, setProcessingMessage] = useState('Processing...');

  // Manual Entry State
  const [manualInitialData, setManualInitialData] = useState<ManualInitialData | undefined>(undefined);

  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

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

  // Reset state when closing
  const handleClose = () => {
    stopCamera();
    setView('menu');
    setActiveTab('transaction');

    // Reset Transaction State
    setManualInitialData(undefined);
    setParsedTransactions([]);

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

        const data: ReceiptData = await analyzeReceipt(householdId, base64Image, dynamicCategories, habitTitles, subBucketsMap);
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

      const transactions = await parseBankStatement(householdId, base64, dynamicCategories, habitTitles);
      if (transactions.length === 0) {
        setProcessingMessage('Trying receipt analysis...');
        const receipt = await analyzeReceipt(householdId, base64, dynamicCategories, habitTitles, subBucketsMap);
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
    const results = await Promise.allSettled(
      selectedTx.map(tx => {
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
          store: tx.store,
          accountId: tx.accountId
        };
        return addTransaction(newTransaction);
      })
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    if (succeeded > 0) toast.success(`${succeeded} transaction(s) added to Action Queue!`);
    else toast.error('Failed to add transactions');
    handleClose();
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
      await addShoppingItem({
        name: shoppingName.trim(),
        category: shoppingCategory,
        quantity: shoppingQuantity.trim() || undefined,
        store: shoppingStore.trim() || undefined,
        isPurchased: false
      });
      toast.success('Added to list');
      handleClose();
    } catch {
      toast.error('Failed to add item');
    }
  };

  const tabOptions: SegmentedControlOption<ModalTab>[] = [
    {
      value: 'transaction',
      label: (
        <div className="flex items-center justify-center gap-2">
          <Wallet size={16} />
          <span>Expense</span>
        </div>
      )
    },
    {
      value: 'todo',
      label: (
        <div className="flex items-center justify-center gap-2">
          <CheckSquare size={16} />
          <span>To-Do</span>
        </div>
      )
    },
    {
      value: 'shopping',
      label: (
        <div className="flex items-center justify-center gap-2">
          <ShoppingBag size={16} />
          <span>Shop</span>
        </div>
      )
    }
  ];

  const headerContent = (
    <div className="flex flex-col border-b border-brand-100 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div className="flex items-center justify-between px-6 py-4">
        <h2 id="capture-drawer-title" className="text-xl font-bold text-brand-800 dark:text-slate-100">
          {activeTab === 'transaction' && (
            view === 'menu' ? 'Add Transaction' :
            view === 'camera' ? 'Scan Receipt' :
            view === 'upload' ? 'Upload Image' :
            view === 'manual' ? 'Manual Entry' :
            view === 'processing' ? 'Processing' : 'Review'
          )}
          {activeTab === 'todo' && 'New Task'}
          {activeTab === 'shopping' && 'Add Item'}
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

      {/* Tab Switcher - Only show if not in deep transaction flow */}
      {view === 'menu' && (
        <div className="px-6 pb-4">
          <SegmentedControl<ModalTab>
            options={tabOptions}
            value={activeTab}
            onChange={setActiveTab}
            name="Capture type"
          />
        </div>
      )}
    </div>
  );

  return (
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

        {/* 1. TRANSACTION TAB */}
        {activeTab === 'transaction' && (
            <>
              {/* Processing View */}
              {view === 'processing' && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 className="w-12 h-12 text-brand-600 dark:text-slate-300 animate-spin" />
                  <p className="text-brand-500 dark:text-slate-400 font-medium">{processingMessage}</p>
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
                      className="w-16 h-16 rounded-full border-4 border-white bg-white/20 backdrop-blur-xs flex items-center justify-center active:scale-90 transition-transform focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                    >
                      <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-full" />
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
          {activeTab === 'todo' && (
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
          {activeTab === 'shopping' && (
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
  );
};

export default CaptureModal;
