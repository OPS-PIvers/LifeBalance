
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Type, Loader2, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { analyzeReceipt, parseBankStatement, ReceiptData } from '../../services/geminiService';
import { Transaction } from '../../types/schema';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalView = 'menu' | 'camera' | 'upload' | 'manual' | 'processing' | 'review';

interface ParsedTransaction {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  date: string;
  selected: boolean;
}

const CaptureModal: React.FC<CaptureModalProps> = ({ isOpen, onClose }) => {
  const { addTransaction, buckets } = useHousehold();
  const [view, setView] = useState<ModalView>('menu');
  const [processingMessage, setProcessingMessage] = useState('Processing...');

  // Dynamic Categories from buckets
  const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];

  // Form State for Manual Entry
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);

  // Camera Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // File Upload Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parsed transactions from bank statement
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([]);

  // Track source for scanned transactions
  const [scanSource, setScanSource] = useState<'camera' | 'upload' | null>(null);

  // Initialize Category default when modal opens or buckets change
  useEffect(() => {
    if (isOpen && !category && dynamicCategories.length > 0) {
      setCategory(dynamicCategories[0]);
    }
  }, [isOpen, dynamicCategories, category]);

  // Reset state when closing
  const handleClose = () => {
    stopCamera();
    setView('menu');
    setAmount('');
    setMerchant('');
    if (dynamicCategories.length > 0) setCategory(dynamicCategories[0]);
    setIsRecurring(false);
    setParsedTransactions([]);
    setScanSource(null);
    onClose();
  };

  const startCamera = async () => {
    try {
      setView('camera');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      setCameraStream(stream);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
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

  // Smart category matching helper
  const matchCategory = (suggestedCategory: string): string => {
    if (!suggestedCategory) return dynamicCategories[0] || '';

    // Exact match
    if (dynamicCategories.includes(suggestedCategory)) {
      return suggestedCategory;
    }

    // Case-insensitive match
    const match = dynamicCategories.find(
      c => c.toLowerCase() === suggestedCategory.toLowerCase()
    );
    if (match) return match;

    // Partial match
    const partialMatch = dynamicCategories.find(
      c => c.toLowerCase().includes(suggestedCategory.toLowerCase()) ||
           suggestedCategory.toLowerCase().includes(c.toLowerCase())
    );
    if (partialMatch) return partialMatch;

    return dynamicCategories[0] || '';
  };

  // Camera capture - creates pending_review transaction
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
      setScanSource('camera');

      try {
        const data: ReceiptData = await analyzeReceipt(base64Image, dynamicCategories);

        // Create transaction with pending_review status (goes to action queue)
        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount: Math.abs(data.amount),
          merchant: data.merchant,
          category: matchCategory(data.category),
          date: data.date || new Date().toISOString().split('T')[0],
          status: 'pending_review', // Shows in action queue
          isRecurring: false,
          source: 'camera-scan',
          autoCategorized: true
        };

        await addTransaction(newTransaction);
        toast.success("Receipt scanned! Check your Action Queue to review.");
        handleClose();
      } catch (error) {
        toast.error("Failed to analyze receipt. Try manual entry.");
        setView('manual');
      }
    }
  }, [cameraStream, dynamicCategories, addTransaction]);

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    setView('processing');
    setProcessingMessage('Analyzing image...');
    setScanSource('upload');

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Determine if it's a single receipt or bank statement
      // For now, we'll try bank statement parsing which handles both
      setProcessingMessage('Extracting transactions...');

      const transactions = await parseBankStatement(base64, dynamicCategories);

      if (transactions.length === 0) {
        // Fallback to single receipt analysis
        setProcessingMessage('Trying receipt analysis...');
        const receipt = await analyzeReceipt(base64, dynamicCategories);

        setParsedTransactions([{
          id: crypto.randomUUID(),
          merchant: receipt.merchant,
          amount: Math.abs(receipt.amount),
          category: matchCategory(receipt.category),
          date: receipt.date || new Date().toISOString().split('T')[0],
          selected: true
        }]);
      } else {
        setParsedTransactions(transactions.map(tx => ({
          id: crypto.randomUUID(),
          merchant: tx.merchant,
          amount: Math.abs(tx.amount),
          category: matchCategory(tx.category),
          date: tx.date,
          selected: true
        })));
      }

      setView('review');
      toast.success(`Found ${transactions.length || 1} transaction(s)`);
    } catch (error) {
      console.error('Upload processing error:', error);
      toast.error('Failed to process image. Try manual entry.');
      setView('manual');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Toggle transaction selection
  const toggleTransaction = (id: string) => {
    setParsedTransactions(prev =>
      prev.map(tx =>
        tx.id === id ? { ...tx, selected: !tx.selected } : tx
      )
    );
  };

  // Update parsed transaction category
  const updateParsedCategory = (id: string, newCategory: string) => {
    setParsedTransactions(prev =>
      prev.map(tx =>
        tx.id === id ? { ...tx, category: newCategory } : tx
      )
    );
  };

  // Submit parsed transactions to action queue
  const submitParsedTransactions = async () => {
    const selectedTx = parsedTransactions.filter(tx => tx.selected);

    if (selectedTx.length === 0) {
      toast.error('Please select at least one transaction');
      return;
    }

    setView('processing');
    setProcessingMessage(`Adding ${selectedTx.length} transaction(s)...`);

    try {
      // Use Promise.all for parallel transaction addition (performance improvement)
      await Promise.all(
        selectedTx.map(tx => {
          const newTransaction: Transaction = {
            id: tx.id,
            amount: tx.amount,
            merchant: tx.merchant,
            category: tx.category,
            date: tx.date,
            status: 'pending_review', // Goes to action queue for review
            isRecurring: false,
            source: 'file-upload',
            autoCategorized: true
          };
          return addTransaction(newTransaction);
        })
      );

      toast.success(`${selectedTx.length} transaction(s) added to Action Queue!`);
      handleClose();
    } catch (error) {
      console.error('Error adding transactions:', error);
      toast.error('Failed to add some transactions');
      setView('review');
    }
  };

  // Manual entry - creates verified transaction (immediate budget update)
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

    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      amount: parsedAmount,
      merchant,
      category,
      date: new Date().toISOString().split('T')[0],
      status: 'verified', // Immediately reflected in budget
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 shrink-0">
          <h2 className="text-xl font-bold text-brand-800">
            {view === 'menu' && 'Add Transaction'}
            {view === 'camera' && 'Scan Receipt'}
            {view === 'upload' && 'Upload Image'}
            {view === 'manual' && 'Manual Entry'}
            {view === 'processing' && 'Processing'}
            {view === 'review' && 'Review Transactions'}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 bg-brand-100 rounded-full text-brand-600 hover:bg-brand-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* Processing View */}
          {view === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-12 h-12 text-brand-600 animate-spin" />
              <p className="text-brand-500 font-medium">{processingMessage}</p>
            </div>
          )}

          {/* Menu View - 3 Options */}
          {view === 'menu' && (
            <div className="space-y-4">
              {/* Camera Option */}
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

              {/* Upload Option */}
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

              {/* Manual Entry Option */}
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

              {/* Hidden file input */}
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
                  className="w-16 h-16 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
                >
                  <div className="w-12 h-12 bg-white rounded-full" />
                </button>
              </div>
            </div>
          )}

          {/* Review Parsed Transactions View */}
          {view === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-brand-500">
                  {parsedTransactions.filter(t => t.selected).length} of {parsedTransactions.length} selected
                </p>
                <button
                  onClick={() => {
                    const allSelected = parsedTransactions.every(t => t.selected);
                    setParsedTransactions(prev =>
                      prev.map(t => ({ ...t, selected: !allSelected }))
                    );
                  }}
                  className="text-xs font-bold text-brand-600 hover:text-brand-800"
                >
                  {parsedTransactions.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                {parsedTransactions.map(tx => (
                  <div
                    key={tx.id}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      tx.selected
                        ? 'border-brand-400 bg-brand-50'
                        : 'border-brand-100 bg-white opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleTransaction(tx.id)}
                        className={`mt-1 w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                          tx.selected
                            ? 'bg-brand-800 text-white'
                            : 'border-2 border-brand-300'
                        }`}
                      >
                        {tx.selected && <CheckCircle2 size={14} />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-brand-700 truncate">{tx.merchant}</p>
                          <span className="font-mono font-bold text-brand-800 shrink-0">
                            ${tx.amount.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-xs text-brand-400 mb-2">{tx.date}</p>

                        {/* Category selector */}
                        <div className="flex gap-1.5 flex-wrap">
                          {dynamicCategories.slice(0, 4).map(cat => (
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
                  These will be added to your Action Queue for final review before affecting your budget.
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
              {/* Amount Input */}
              <div className="flex justify-center">
                <div className="relative">
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-brand-400">$</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Prevent negative values - only allow positive numbers
                      if (value === '' || parseFloat(value) >= 0) {
                        setAmount(value);
                      }
                    }}
                    placeholder="0.00"
                    autoFocus
                    step="0.01"
                    min="0"
                    className="w-full pl-8 text-4xl font-mono font-bold text-brand-800 placeholder:text-brand-200 outline-none text-center bg-transparent"
                  />
                </div>
              </div>

              {/* Merchant Input */}
              <div>
                <label className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-1">Merchant</label>
                <input
                  type="text"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g. Starbucks"
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-800 outline-none font-medium"
                />
              </div>

              {/* Category Selector */}
              <div>
                <label className="block text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">Category</label>
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
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

              {/* Recurring Toggle */}
              <div className="flex items-center justify-between p-4 bg-brand-50 rounded-xl border border-brand-100">
                <span className="text-sm font-medium text-brand-700">Recurring Transaction</span>
                <button
                  onClick={() => setIsRecurring(!isRecurring)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${isRecurring ? 'bg-money-pos' : 'bg-brand-300'}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isRecurring ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Info Banner */}
              <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200">
                <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                <p className="text-xs text-green-700">
                  Manual entries update your budget immediately without review.
                </p>
              </div>

              {/* Save Button */}
              <button
                onClick={handleManualSave}
                className="w-full py-4 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-brand-700"
              >
                Save Transaction
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaptureModal;
