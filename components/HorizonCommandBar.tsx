import React, { useState, useEffect, useRef } from 'react';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { Loader2, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Transaction } from '@/types/schema';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';

export const HorizonCommandBar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    householdId,
    addTransaction,
    addToDo,
    addShoppingItem,
    toggleHabit,
    buckets,
    habits,
  } = useHousehold();

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow animation/mounting
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setInput('');
      setIsLoading(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !householdId) return;

    setIsLoading(true);
    try {
      // Dynamic import to avoid heavy loading if not used
      const { parseMagicAction } = await import('../services/geminiService');

      const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];
      const todayDate = new Date().toISOString().split('T')[0];

      const result = await parseMagicAction(householdId, input, {
        categories: dynamicCategories,
        groceryCategories: GROCERY_CATEGORIES,
        todayDate,
        habits: habits.map(h => ({ id: h.id, title: h.title }))
      });

      if (result.type === 'transaction') {
        if (!result.data.amount) throw new Error("Could not detect amount.");

        const newTransaction: Transaction = {
          id: crypto.randomUUID(),
          amount: result.data.amount,
          merchant: result.data.merchant || 'Unknown',
          category: result.data.category || 'Uncategorized',
          date: result.data.date || todayDate,
          status: 'verified', // Assume verified if coming from command bar
          isRecurring: false,
          source: 'manual',
          autoCategorized: true
        };

        await addTransaction(newTransaction);
        toast.success(`Logged: $${result.data.amount} at ${result.data.merchant}`);

      } else if (result.type === 'todo') {
        if (!result.data.text) throw new Error("Could not detect task.");

        await addToDo({
          text: result.data.text,
          completeByDate: result.data.completeByDate || todayDate,
          assignedTo: '', // Unassigned by default
          isCompleted: false
        });
        toast.success(`Task added: ${result.data.text}`);

      } else if (result.type === 'shopping') {
        if (!result.data.item) throw new Error("Could not detect item.");

        await addShoppingItem({
          name: result.data.item,
          category: result.data.category || 'Uncategorized',
          quantity: result.data.quantity,
          store: result.data.store,
          isPurchased: false
        });
        toast.success(`Added to list: ${result.data.item}`);

      } else if (result.type === 'habit') {
        if (!result.data.habitId) throw new Error("Could not match habit.");

        await toggleHabit(result.data.habitId, 'up');
        // toggleHabit handles its own toast

      } else {
        toast.error("Sorry, I didn't understand that.");
        setIsLoading(false);
        return; // Don't close if error
      }

      setIsOpen(false);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200"
          >
            <div className="flex items-center p-4 gap-3 bg-white/80 backdrop-blur-xl">
              {isLoading ? (
                <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
              ) : (
                <Sparkles className="w-6 h-6 text-brand-500" />
              )}

              <form onSubmit={handleSubmit} className="flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="What would you like to do? (e.g. 'Spent $50 at Target', 'Buy Milk', 'Drank Water')..."
                  className="w-full text-lg text-slate-800 placeholder:text-slate-400 bg-transparent border-none outline-none font-medium"
                  autoComplete="off"
                  disabled={isLoading}
                />
              </form>

              <div className="flex items-center gap-2">
                <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs text-slate-500 font-sans font-medium">
                  esc
                </kbd>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-slate-100 rounded-full text-slate-400 transition-colors sm:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Suggestions / Context */}
            <div className="bg-slate-50 px-4 py-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
               <div className="flex gap-4">
                 <span>✨ AI Powered</span>
                 <span>Enter natural language</span>
               </div>
               <div className="hidden sm:flex items-center gap-2">
                 <span>Press</span>
                 <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded shadow-sm font-sans">↵</kbd>
                 <span>to submit</span>
               </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
