/* eslint-disable */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Camera, Type, Loader2, Upload, Check, CheckCircle2, AlertCircle,
  Wallet, CheckSquare, ShoppingBag, Calendar, User, Store, ChevronDown, Shield
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { analyzeReceipt, parseBankStatement, ReceiptData } from '../../services/geminiService';
import { Transaction, HouseholdMember } from '../../types/schema';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { Modal } from '../ui/Modal';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalView = 'menu' | 'camera' | 'upload' | 'manual' | 'processing' | 'review';
type ModalTab = 'transaction' | 'todo' | 'shopping';

interface ParsedTransaction {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  date: string;
  selected: boolean;
  relatedHabitIds?: string[];
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
  const {
    addTransaction, buckets, habits,
    addToDo, members, currentUser,
    addShoppingItem, householdId
  } = useHousehold();

  const [activeTab, setActiveTab] = useState<ModalTab>('transaction');

  // --- Transaction State ---
  const [view, setView] = useState<ModalView>('menu');
  const [processingMessage, setProcessingMessage] = useState('Processing...');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [transactionDate, setTransactionDate] = useState('');
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Initialize Defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      // Transaction defaults
      if (!category && dynamicCategories.length > 0) {
        setCategory(dynamicCategories[0]);
      }
      if (!transactionDate) {
        setTransactionDate(getLocalDateString());
      }

      // To-Do defaults
      if (!todoDate) {
        setTodoDate(getLocalDateString());
      }
      // Default assignee to current user or first member
      if (!todoAssignee) {
         setTodoAssignee(currentUser?.uid ?? (members.length > 0 ? members[0].uid : ''));
      }
    }
  }, [isOpen, dynamicCategories, category, transactionDate, todoDate, todoAssignee, currentUser, members]);

  // Reset state when closing
  const handleClose = () => {
    stopCamera();
    setView('menu');
    setActiveTab('transaction'); // Reset tab to default? Maybe better to keep user pref? Sticking to default for now.

    // Reset Transaction State
    setAmount('');
    setMerchant('');
    if (dynamicCategories.length > 0) setCategory(dynamicCategories[0]);
    setIsRecurring(false);
    setTransactionDate('');
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

  const capturePhoto = useCallback(async () => {
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
        const data: ReceiptData = await analyzeReceipt(householdId, base64Image, dynamicCategories, habitTitles);
        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount: data.amount,
          merchant: data.merchant,
          category: matchCategory(data.category),
          date: data.date || getLocalDateString(),
          status: 'pending_review',
          isRecurring: false,
          source: 'camera-scan',
          autoCategorized: true,
          relatedHabitIds: matchHabits(data.suggestedHabits)
        };
        await addTransaction(newTransaction);
        toast.success("Receipt scanned! Check your Action Queue.");
        handleClose();
      } catch (error) {
        toast.error("Failed to analyze receipt. Try manual entry.");
        setView('manual');
      }
    }
  }, [cameraStream, dynamicCategories, addTransaction, habitTitles, habits]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image too large (max 10MB)');
      return;
    }
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
      const transactions = await parseBankStatement(householdId, base64, dynamicCategories, habitTitles);
      if (transactions.length === 0) {
        setProcessingMessage('Trying receipt analysis...');
        const receipt = await analyzeReceipt(householdId, base64, dynamicCategories, habitTitles);
        setParsedTransactions([{
          id: crypto.randomUUID(),
          merchant: receipt.merchant,
          amount: receipt.amount,
          category: matchCategory(receipt.category),
          date: receipt.date || getLocalDateString(),
          selected: true,
          relatedHabitIds: matchHabits(receipt.suggestedHabits)
        }]);
      } else {
        setParsedTransactions(transactions.map(tx => ({
          id: crypto.randomUUID(),
          merchant: tx.merchant,
          amount: tx.amount,
          category: matchCategory(tx.category),
          date: tx.date || getLocalDateString(),
          selected: true,
          relatedHabitIds: matchHabits(tx.suggestedHabits)
        })));
      }
      setView('review');
      toast.success(`Found ${transactions.length || 1} transaction(s)`);
    } catch (error) {
      console.error('AI processing error:', error);
      toast.error(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setView('manual');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleTransaction = (id: string) => {
    setParsedTransactions(prev => prev.map(tx => tx.id === id ? { ...tx, selected: !tx.selected } : tx));
  };

  const updateParsedCategory = (id: string, newCategory: string) => {
    setParsedTransactions(prev => prev.map(tx => tx.id === id ? { ...tx, category: newCategory } : tx));
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
          relatedHabitIds: tx.relatedHabitIds
        };
        return addTransaction(newTransaction);
      })
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    if (succeeded > 0) toast.success(`${succeeded} transaction(s) added to Action Queue!`);
    else toast.error('Failed to add transactions');
    handleClose();
  };

  const handleManualSave = async () => {
    if (!amount || !merchant) {
      toast.error("Please fill in required fields");
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
    const isFuture = transactionDate > getLocalDateString();

    if (!category || !dynamicCategories.includes(category)) {
      toast.error("Please select a valid category");
      return;
    }

    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      amount: parsedAmount,
      merchant,
      category,
      date: transactionDate,
      status: isFuture ? 'pending_review' : 'verified',
      isRecurring,
      source: 'manual',
      autoCategorized: false
    };

    try {
      await addTransaction(newTransaction);
      toast.success("Transaction saved!");
      handleClose();
    } catch (error) {
      toast.error("Failed to save transaction");
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
    } catch (error) {
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
    } catch (error) {
      toast.error('Failed to add item');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-md"
      disableBackdropClose={view === 'processing'}
      ariaLabelledBy="capture-modal-title"
      backdropColor="bg-slate-900/90"
      className="shadow-2xl"
    >
      {/* Header */}
      <div className="flex flex-col border-b border-brand-100 shrink-0 bg-white z-10">
          <div className="flex items-center justify-between px-6 py-4">
              <h2 id="capture-modal-title" className="text-xl font-bold text-brand-800">
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
              <button
                  onClick={handleClose}
                  aria-label="Close modal"
                  className="p-2 bg-brand-100 rounded-full text-brand-600 hover:bg-brand-200 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                  <X size={20} />
              </button>
          </div>

          {/* Tab Switcher - Only show if not in deep transaction flow */}
          {view === 'menu' && (
              <div className="px-6 pb-4">
                  <div className="flex p-1 bg-brand-50 rounded-xl border border-brand-100">
                      <button
                          onClick={() => setActiveTab('transaction')}
                          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                              activeTab === 'transaction'
                              ? 'bg-white text-brand-800 shadow-sm ring-1 ring-black/5'
                              : 'text-brand-400 hover:text-brand-600'
                          }`}
                      >
                          <Wallet size={16} />
                          <span>Expense</span>
                      </button>
                      <button
                          onClick={() => setActiveTab('todo')}
                          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                              activeTab === 'todo'
                              ? 'bg-white text-brand-800 shadow-sm ring-1 ring-black/5'
                              : 'text-brand-400 hover:text-brand-600'
                          }`}
                      >
                          <CheckSquare size={16} />
                          <span>To-Do</span>
                      </button>
                      <button
                          onClick={() => setActiveTab('shopping')}
                          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                              activeTab === 'shopping'
                              ? 'bg-white text-brand-800 shadow-sm ring-1 ring-black/5'
                              : 'text-brand-400 hover:text-brand-600'
                          }`}
                      >
                          <ShoppingBag size={16} />
                          <span>Shop</span>
                      </button>
                  </div>
              </div>
          )}
      </div>

      {/* Body Content */}
      <div className="p-6 overflow-y-auto flex-1">

        {/* 1. TRANSACTION TAB */}
        {activeTab === 'transaction' && (
            <>
              {/* Processing View */}
              {view === 'processing' && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 className="w-12 h-12 text-brand-600 animate-spin" />
                  <p className="text-brand-500 font-medium">{processingMessage}</p>
                </div>
              )}

              {/* Menu View */}
              {view === 'menu' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex items-start gap-3">
                    <Shield size={16} className="text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <strong>AI Processing:</strong> Avoid capturing PII like full names or card numbers.
                    </p>
                  </div>

                  <button
                    onClick={startCamera}
                    className="w-full flex items-center gap-4 p-4 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600">
                      <Camera size={24} />
                    </div>
                    <div className="text-left flex-1">
                      <span className="font-bold text-brand-700 block">Scan Receipt</span>
                      <span className="text-xs text-brand-400">Take a photo of your receipt</span>
                    </div>
                    <div className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                      REVIEW
                    </div>
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-4 p-4 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100 text-purple-600">
                      <Upload size={24} />
                    </div>
                    <div className="text-left flex-1">
                      <span className="font-bold text-brand-700 block">Upload Image</span>
                      <span className="text-xs text-brand-400">Bank statement or receipt screenshot</span>
                    </div>
                    <div className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                      REVIEW
                    </div>
                  </button>

                  <button
                    onClick={() => setView('manual')}
                    className="w-full flex items-center gap-4 p-4 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-money-bgPos text-money-pos">
                      <Type size={24} />
                    </div>
                    <div className="text-left flex-1">
                      <span className="font-bold text-brand-700 block">Manual Entry</span>
                      <span className="text-xs text-brand-400">Enter transaction details directly</span>
                    </div>
                    <div className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
                      INSTANT
                    </div>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />

                  <div className="text-center pt-2">
                    <p className="text-xs text-brand-400">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                        Review = shows in Action Queue
                      </span>
                      <span className="mx-2">•</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-400"></span>
                        Instant = updates budget immediately
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {/* Camera View */}
              {view === 'camera' && (
                <div className="relative bg-black rounded-xl overflow-hidden aspect-[3/4]">
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
                      className="w-16 h-16 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <div className="w-12 h-12 bg-white rounded-full" />
                    </button>
                  </div>
                </div>
              )}

              {/* Review View */}
              {view === 'review' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-brand-500">
                      {parsedTransactions.filter(t => t.selected).length} of {parsedTransactions.length} selected
                    </p>
                    <button
                      onClick={() => {
                        const allSelected = parsedTransactions.every(t => t.selected);
                        setParsedTransactions(prev => prev.map(t => ({ ...t, selected: !allSelected })));
                      }}
                      className="text-xs font-bold text-brand-600 hover:text-brand-800"
                    >
                      {parsedTransactions.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[35vh] min-h-[120px] overflow-y-auto">
                    {parsedTransactions.map(tx => (
                      <div
                        key={tx.id}
                        className={`p-3 rounded-xl border-2 transition-all ${
                          tx.selected ? 'border-brand-400 bg-brand-50' : 'border-brand-100 bg-white opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggleTransaction(tx.id)}
                            aria-label={tx.selected ? "Deselect transaction" : "Select transaction"}
                            className={`mt-1 w-5 h-5 rounded flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                              tx.selected ? 'bg-brand-800 text-white' : 'border-2 border-brand-300'
                            }`}
                          >
                            {tx.selected && <Check size={14} />}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-bold text-brand-700 truncate">{tx.merchant}</p>
                              <span className="font-mono font-bold text-brand-800 shrink-0">
                                ${tx.amount.toFixed(2)}
                              </span>
                            </div>
                            <p className="text-xs text-brand-400 mb-2">{tx.date}</p>
                            <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Category selection">
                              {dynamicCategories.slice(0, 4).map((cat) => (
                                <button
                                  key={cat}
                                  onClick={() => updateParsedCategory(tx.id, cat)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                                    tx.category === cat
                                      ? 'bg-brand-800 text-white'
                                      : 'bg-brand-100 text-brand-600 hover:bg-brand-200'
                                  }`}
                                >
                                  {cat}
                                </button>
                              ))}
                              {dynamicCategories.length > 4 && (
                                <select
                                  value={tx.category}
                                  onChange={(e) => updateParsedCategory(tx.id, e.target.value)}
                                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-brand-100 text-brand-600 border-none outline-none"
                                >
                                  {dynamicCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
                    <AlertCircle size={16} className="text-amber-600 shrink-0" />
                    <p className="text-xs text-amber-700">
                      These will be added to your Action Queue for final review.
                    </p>
                  </div>

                  <button
                    onClick={submitParsedTransactions}
                    disabled={parsedTransactions.filter(t => t.selected).length === 0}
                    className="w-full py-4 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add {parsedTransactions.filter(t => t.selected).length} to Action Queue
                  </button>
                </div>
              )}

              {/* Manual Form View */}
              {view === 'manual' && (
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
                          onClick={() => setCategory(cat)}
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

                  <button
                    onClick={handleManualSave}
                    className="w-full py-4 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-brand-700"
                  >
                    Save Transaction
                  </button>
                </div>
              )}
            </>
          )}

          {/* 2. TO-DO TAB */}
          {activeTab === 'todo' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div>
                    <label htmlFor="task-input" className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
                        Task
                    </label>
                    <input
                        id="task-input"
                        type="text"
                        value={todoText}
                        onChange={(e) => setTodoText(e.target.value)}
                        placeholder="Enter task description"
                        className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                        autoFocus
                    />
                </div>

                <div>
                    <label htmlFor="due-date-input" className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
                        Due Date
                    </label>
                    <div className="relative w-full">
                        <input
                            id="due-date-input"
                            type="date"
                            value={todoDate}
                            onChange={(e) => setTodoDate(e.target.value)}
                            className="block w-full min-w-0 p-3 pl-10 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none appearance-none"
                            style={{ WebkitAppearance: 'none' }}
                        />
                        <Calendar size={18} className="absolute left-3 top-3.5 text-brand-400 pointer-events-none" />
                    </div>
                </div>

                <fieldset>
                    <legend className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
                        Assign To
                    </legend>
                    {members.length === 0 ? (
                        <div className="flex items-center gap-2 text-sm text-brand-400 py-2">
                            <AlertCircle size={16} className="flex-shrink-0" />
                            <span>No household members available.</span>
                        </div>
                    ) : (
                        <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Assign task to member">
                            {members.map(member => (
                                <button
                                    key={member.uid}
                                    type="button"
                                    onClick={() => setTodoAssignee(member.uid)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all whitespace-nowrap ${
                                        todoAssignee === member.uid
                                            ? 'bg-brand-800 text-white border-brand-800 shadow-md'
                                            : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50'
                                    }`}
                                >
                                    {member.photoURL ? (
                                        <img src={member.photoURL} alt="" className="w-5 h-5 rounded-full" />
                                    ) : (
                                        <div className="w-5 h-5 rounded-full bg-brand-200 flex items-center justify-center text-[10px] font-bold text-brand-600">
                                            {member.displayName?.charAt(0) ?? 'U'}
                                        </div>
                                    )}
                                    <span className="text-sm font-medium">{member.displayName?.split(' ')[0] ?? 'User'}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </fieldset>

                <button
                    onClick={handleToDoSubmit}
                    disabled={members.length === 0}
                    className={`w-full py-3.5 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all mt-4 ${
                        members.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-brand-900 active:scale-[0.98]'
                    }`}
                >
                    Create Task
                </button>
            </div>
          )}

          {/* 3. SHOPPING TAB */}
          {activeTab === 'shopping' && (
             <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div>
                    <label htmlFor="item-name" className="text-xs font-bold text-brand-400 uppercase">Item Name</label>
                    <input
                        id="item-name"
                        type="text"
                        value={shoppingName}
                        onChange={(e) => setShoppingName(e.target.value)}
                        placeholder="e.g. Milk, Eggs"
                        className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                        autoFocus
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="item-category" className="text-xs font-bold text-brand-400 uppercase">Category</label>
                        <div className="relative mt-1">
                             <select
                                id="item-category"
                                value={shoppingCategory}
                                onChange={(e) => setShoppingCategory(e.target.value)}
                                className="w-full appearance-none p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                            >
                                {GROCERY_CATEGORIES.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400 pointer-events-none" />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="item-quantity" className="text-xs font-bold text-brand-400 uppercase">Quantity</label>
                        <input
                            id="item-quantity"
                            type="text"
                            value={shoppingQuantity}
                            onChange={(e) => setShoppingQuantity(e.target.value)}
                            placeholder="e.g. 2, 500g"
                            className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                        />
                    </div>
                </div>

                <div>
                    <label htmlFor="item-store" className="text-xs font-bold text-brand-400 uppercase">Store (Optional)</label>
                    <div className="relative mt-1">
                        <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400" />
                        <input
                            id="item-store"
                            type="text"
                            value={shoppingStore}
                            onChange={(e) => setShoppingStore(e.target.value)}
                            placeholder="e.g. Costco, Trader Joe's"
                            className="w-full p-3 pl-10 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                        />
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        onClick={handleShoppingSubmit}
                        disabled={!shoppingName.trim()}
                        className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 hover:bg-brand-900"
                    >
                        Add to Shopping List
                    </button>
                </div>
             </div>
          )}

      </div>
    </Modal>
  );
};

export default CaptureModal;
