
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Type, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { analyzeReceipt, ReceiptData } from '../../services/geminiService';
import { Transaction } from '../../types/schema';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalView = 'menu' | 'camera' | 'manual';

const CaptureModal: React.FC<CaptureModalProps> = ({ isOpen, onClose }) => {
  const { addTransaction, buckets } = useHousehold();
  const [view, setView] = useState<ModalView>('menu');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Dynamic Categories
  const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];
  
  // Form State
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  
  // Camera Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

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
    // Reset category to first available
    if (dynamicCategories.length > 0) setCategory(dynamicCategories[0]);
    setIsRecurring(false);
    onClose();
  };

  const startCamera = async () => {
    try {
      setView('camera');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setCameraStream(stream);
      // Small delay to ensure video element is mounted
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
      setIsProcessing(true);
      
      try {
        const data: ReceiptData = await analyzeReceipt(base64Image);
        setAmount(data.amount.toString());
        setMerchant(data.merchant);
        
        // Smart Category Matching
        if (data.category) {
          // 1. Exact Match
          if (dynamicCategories.includes(data.category)) {
            setCategory(data.category);
          } else {
            // 2. Case Insensitive Match
            const match = dynamicCategories.find(c => c.toLowerCase() === data.category.toLowerCase());
            if (match) {
              setCategory(match);
            }
            // 3. Fallback to default (already set)
          }
        }
        
        setView('manual'); // Go to form to verify/edit
        toast.success("Receipt scanned!");
      } catch (error) {
        toast.error("Failed to analyze receipt.");
        setView('manual'); // Fallback
      } finally {
        setIsProcessing(false);
      }
    }
  }, [cameraStream, dynamicCategories]);

  const handleSave = () => {
    if (!amount || !merchant) {
      toast.error("Please fill in required fields");
      return;
    }

    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      amount: parseFloat(amount),
      merchant,
      category,
      date: new Date().toISOString().split('T')[0],
      status: 'verified',
      isRecurring,
      source: view === 'camera' ? 'manual' : 'manual', // technically it was scanned then manually saved
      autoCategorized: false
    };

    addTransaction(newTransaction);
    toast.success("Transaction Saved!");
    handleClose();
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
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100">
          <h2 className="text-xl font-bold text-brand-800">
            {view === 'menu' ? 'Add Transaction' : view === 'camera' ? 'Scan Receipt' : 'Transaction Details'}
          </h2>
          <button 
            onClick={handleClose}
            className="p-2 bg-brand-100 rounded-full text-brand-600 hover:bg-brand-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6">
          
          {isProcessing ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-12 h-12 text-brand-600 animate-spin" />
              <p className="text-brand-500 font-medium">Processing Receipt...</p>
            </div>
          ) : view === 'menu' ? (
            /* Menu View */
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={startCamera}
                  className="flex flex-col items-center justify-center p-6 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-95"
                >
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 mb-3">
                    <Camera size={24} />
                  </div>
                  <span className="font-bold text-brand-700">Scan Receipt</span>
                </button>

                <button 
                  onClick={() => setView('manual')}
                  className="flex flex-col items-center justify-center p-6 bg-brand-50 border-2 border-brand-100 rounded-2xl hover:border-brand-300 hover:bg-brand-100 transition-all active:scale-95"
                >
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-money-bgPos text-money-pos mb-3">
                    <Type size={24} />
                  </div>
                  <span className="font-bold text-brand-700">Manual Entry</span>
                </button>
              </div>
              
              <div className="text-center">
                <p className="text-xs text-brand-400">
                  Tip: You can also text the Telegram bot for instant capture.
                </p>
              </div>
            </div>
          ) : view === 'camera' ? (
            /* Camera View */
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
          ) : (
            /* Manual Form View */
            <div className="space-y-6">
              {/* Amount Input */}
              <div className="flex justify-center">
                <div className="relative">
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-brand-400">$</span>
                  <input 
                    type="number" 
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    autoFocus
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

              {/* Save Button */}
              <button 
                onClick={handleSave}
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
