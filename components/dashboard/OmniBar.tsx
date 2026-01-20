import React, { useState, useRef, useEffect } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { parseMagicAction, MagicActionResponse } from '@/services/geminiService';
import { Sparkles, Send, Loader2, X, Check, ShoppingCart, DollarSign, CheckSquare, Search, Wallet, Package } from 'lucide-react';
import { Transaction } from '@/types/schema';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export const OmniBar: React.FC = () => {
  const {
    householdId,
    buckets,
    groceryCategories,
    addTransaction,
    addToDo,
    addShoppingItem,
    safeToSpend,
    pantry,
  } = useHousehold();

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<MagicActionResponse | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleAnalyze = async () => {
    if (!input.trim() || !householdId) return;

    setIsAnalyzing(true);
    setResult(null);
    setFeedback(null);

    try {
      const response = await parseMagicAction(
        householdId,
        input,
        {
          categories: buckets.map(b => b.name),
          groceryCategories: groceryCategories.length > 0 ? groceryCategories : GROCERY_CATEGORIES,
          todayDate: format(new Date(), 'yyyy-MM-dd')
        }
      );

      setResult(response);

      // Handle Queries immediately
      if (response.type === 'query') {
        if (response.data.queryType === 'budget_check') {
          // Simple logic: If safeToSpend > 0, probably yes.
          // Ideally, we'd extract an amount from the query if present, but for now just general check.
          const amountMatch = input.match(/\$?(\d+(\.\d{2})?)/);
          const queryAmount = amountMatch ? parseFloat(amountMatch[1]) : 0;

          if (queryAmount > 0) {
            if (safeToSpend >= queryAmount) {
              setFeedback(`Yes, you can afford it. Safe-to-Spend is $${safeToSpend.toFixed(2)}.`);
            } else {
              setFeedback(`Careful. That exceeds your Safe-to-Spend of $${safeToSpend.toFixed(2)}.`);
            }
          } else {
             setFeedback(`Your current Safe-to-Spend is $${safeToSpend.toFixed(2)}.`);
          }
        } else if (response.data.queryType === 'pantry_check' && response.data.target) {
           const target = response.data.target.toLowerCase();
           const matches = pantry.filter(p => p.name.toLowerCase().includes(target));
           if (matches.length > 0) {
             const itemsStr = matches.map(m => `${m.quantity} ${m.name}`).join(', ');
             setFeedback(`Yes, you have: ${itemsStr}.`);
           } else {
             setFeedback(`I couldn't find "${response.data.target}" in your pantry.`);
           }
        } else {
            setFeedback("I'm not sure how to answer that yet.");
        }
      }

    } catch (error) {
      console.error('OmniBar Analysis Error:', error);
      toast.error('Failed to understand command.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirm = async () => {
    if (!result) return;

    try {
      switch (result.type) {
        case 'transaction':
          if (result.data.amount && result.data.merchant) {
            await addTransaction({
              amount: result.data.amount,
              merchant: result.data.merchant,
              category: result.data.category || 'Uncategorized',
              date: result.data.date || format(new Date(), 'yyyy-MM-dd'),
              status: 'verified',
              isRecurring: false,
              source: 'manual', // or 'ai-omni'
              autoCategorized: true,
            } as unknown as Transaction); // Cast because we omit id and force Transaction type to bypass strict linting. addTransaction adds the ID.
            toast.success('Expense logged!');
          }
          break;
        case 'todo':
          if (result.data.text) {
            await addToDo({
              text: result.data.text,
              completeByDate: result.data.completeByDate || format(new Date(), 'yyyy-MM-dd'),
              isCompleted: false,
              priority: 'medium', // Default
              assignedTo: '', // Will be assigned to current user in context if empty
            });
            toast.success('Task added!');
          }
          break;
        case 'shopping':
          if (result.data.item) {
            await addShoppingItem({
              name: result.data.item,
              quantity: result.data.quantity || '1',
              category: result.data.category || 'Uncategorized',
              isPurchased: false,
            });
            toast.success('Added to shopping list!');
          }
          break;
      }
      handleClose();
    } catch (error) {
      console.error('Action Failed:', error);
      toast.error('Action failed.');
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setInput('');
    setResult(null);
    setFeedback(null);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 md:bottom-8 md:right-8 p-4 bg-brand-900 text-white rounded-full shadow-lg hover:bg-brand-800 transition-all active:scale-95 z-40 flex items-center gap-2 group"
        aria-label="Open Command Center"
      >
        <Sparkles className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap text-sm font-bold">
          Ask Horizon
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-10 zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input Area */}
        <div className="p-4 flex items-center gap-3 border-b border-gray-100">
          <Sparkles className="text-brand-500 w-6 h-6 animate-pulse" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            placeholder="Type 'Add milk', 'Spent $20', or 'Can I afford...'"
            className="flex-1 text-lg font-medium outline-none text-gray-800 placeholder:text-gray-400"
            disabled={isAnalyzing}
          />
          {input && (
            <button
              onClick={() => { setInput(''); setResult(null); setFeedback(null); }}
              className="p-1 text-gray-300 hover:text-gray-500"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Content Area */}
        <div className="bg-gray-50 min-h-[100px] max-h-[60vh] overflow-y-auto p-4">

          {/* Default State */}
          {!isAnalyzing && !result && !feedback && (
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-500">
              <div className="p-3 bg-white rounded-xl border border-gray-100 flex items-center gap-2 cursor-pointer hover:border-brand-200 hover:text-brand-600 transition-colors" onClick={() => setInput("Add to shopping list ")}>
                <ShoppingCart size={16} /> Add item
              </div>
              <div className="p-3 bg-white rounded-xl border border-gray-100 flex items-center gap-2 cursor-pointer hover:border-brand-200 hover:text-brand-600 transition-colors" onClick={() => setInput("Spent $")}>
                <DollarSign size={16} /> Log expense
              </div>
              <div className="p-3 bg-white rounded-xl border border-gray-100 flex items-center gap-2 cursor-pointer hover:border-brand-200 hover:text-brand-600 transition-colors" onClick={() => setInput("Remind me to ")}>
                <CheckSquare size={16} /> Add task
              </div>
              <div className="p-3 bg-white rounded-xl border border-gray-100 flex items-center gap-2 cursor-pointer hover:border-brand-200 hover:text-brand-600 transition-colors" onClick={() => setInput("Can I afford ")}>
                <Search size={16} /> Budget check
              </div>
            </div>
          )}

          {/* Loading State */}
          {isAnalyzing && (
            <div className="flex flex-col items-center justify-center py-8 text-brand-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm font-medium animate-pulse">Analyzing intent...</p>
            </div>
          )}

          {/* Result Confirmation State */}
          {!isAnalyzing && result && result.type !== 'query' && result.type !== 'unknown' && (
            <div className="bg-white rounded-xl p-4 border border-brand-100 shadow-sm">
              <div className="flex items-center gap-2 text-brand-800 font-bold mb-3 pb-2 border-b border-gray-100">
                {result.type === 'transaction' && <DollarSign className="w-5 h-5" />}
                {result.type === 'todo' && <CheckSquare className="w-5 h-5" />}
                {result.type === 'shopping' && <ShoppingCart className="w-5 h-5" />}
                Confirm {result.type === 'todo' ? 'Task' : result.type === 'shopping' ? 'Item' : 'Transaction'}
              </div>

              <div className="space-y-2 text-sm text-gray-700">
                {result.type === 'transaction' && (
                  <>
                    <div className="flex justify-between"><span>Merchant:</span> <span className="font-bold">{result.data.merchant}</span></div>
                    <div className="flex justify-between"><span>Amount:</span> <span className="font-bold">${result.data.amount}</span></div>
                    <div className="flex justify-between"><span>Category:</span> <span className="font-bold">{result.data.category}</span></div>
                  </>
                )}
                {result.type === 'shopping' && (
                   <>
                    <div className="flex justify-between"><span>Item:</span> <span className="font-bold">{result.data.item}</span></div>
                    <div className="flex justify-between"><span>Qty:</span> <span className="font-bold">{result.data.quantity}</span></div>
                   </>
                )}
                 {result.type === 'todo' && (
                   <>
                    <div className="flex justify-between"><span>Task:</span> <span className="font-bold">{result.data.text}</span></div>
                    <div className="flex justify-between"><span>Due:</span> <span className="font-bold">{result.data.completeByDate}</span></div>
                   </>
                )}
              </div>
            </div>
          )}

          {/* Query Feedback State */}
          {!isAnalyzing && feedback && (
             <div className="bg-brand-50 rounded-xl p-4 border border-brand-100 text-brand-800 flex gap-3">
                {result?.data.queryType === 'budget_check' ? <Wallet className="w-6 h-6 shrink-0" /> : <Package className="w-6 h-6 shrink-0" />}
                <p className="font-medium">{feedback}</p>
             </div>
          )}

          {/* Unknown Intent State */}
           {!isAnalyzing && result?.type === 'unknown' && (
            <div className="text-center py-4 text-gray-500">
              <p>I didn&apos;t understand that command. Try being more specific.</p>
            </div>
           )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg transition-colors"
          >
            {feedback ? 'Close' : 'Cancel'}
          </button>

          {/* Show Execute button only for actionable intents */}
          {result && result.type !== 'query' && result.type !== 'unknown' && (
             <button
             onClick={handleConfirm}
             className="px-6 py-2 bg-brand-900 text-white font-bold rounded-lg hover:bg-brand-800 transition-colors flex items-center gap-2"
           >
             <Check size={18} /> Execute
           </button>
          )}

          {/* If no result yet, show Analyze button */}
          {!result && !feedback && (
             <button
             onClick={handleAnalyze}
             disabled={!input.trim() || isAnalyzing}
             className="px-6 py-2 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700 transition-colors flex items-center gap-2 disabled:opacity-50"
           >
             <Send size={18} />
           </button>
          )}
        </div>
      </div>
    </div>
  );
};
