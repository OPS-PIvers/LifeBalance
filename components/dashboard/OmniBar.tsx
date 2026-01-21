import React, { useState, useRef } from 'react';
import { Sparkles, Loader2, Send, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { GROCERY_CATEGORIES } from '../../data/groceryCategories';

// Helper to get local date string
const getLocalDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const OmniBar: React.FC = () => {
  const {
    householdId,
    buckets,
    addTransaction,
    addToDo,
    addShoppingItem,
  } = useHousehold();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dynamic Categories from buckets for context
  const dynamicCategories = buckets.map(b => b.name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!householdId) {
      toast.error("Household not found");
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading('Horizon is thinking...');

    try {
      // Dynamic import to respect code splitting
      const { parseMagicAction } = await import('../../services/geminiService');

      const context = {
        categories: dynamicCategories,
        groceryCategories: GROCERY_CATEGORIES,
        todayDate: getLocalDateString()
      };

      const result = await parseMagicAction(householdId, input, context);

      // --- EXECUTE ACTION ---
      if (result.type === 'transaction') {
        if (!result.data.amount) throw new Error("Could not detect amount");

        await addTransaction({
          id: crypto.randomUUID(),
          amount: result.data.amount,
          merchant: result.data.merchant || 'Unknown',
          category: result.data.category || 'Uncategorized',
          date: result.data.date || getLocalDateString(),
          status: 'verified', // Assume verified if entered via OmniBar (direct intent)
          isRecurring: false,
          source: 'manual', // or 'omnibar' if we had that type
          autoCategorized: true
        });

        toast.success(`Logged $${result.data.amount} at ${result.data.merchant || 'Merchant'}`, { id: toastId });
      }
      else if (result.type === 'todo') {
        if (!result.data.text) throw new Error("Could not detect task");

        await addToDo({
          text: result.data.text,
          completeByDate: result.data.completeByDate || getLocalDateString(),
          assignedTo: '', // Default to unassigned or handle in context
          isCompleted: false
        });

        toast.success('Task added to your list', { id: toastId });
      }
      else if (result.type === 'shopping') {
        if (!result.data.item) throw new Error("Could not detect item");

        // Fix for Type 'string' is not assignable to parameter of type ...
        // We cast GROCERY_CATEGORIES to unknown then string[] to allow .includes(string)
        // Or simply iterate.
        const isValidCategory = (GROCERY_CATEGORIES as unknown as string[]).includes(result.data.category || '');

        await addShoppingItem({
          name: result.data.item,
          quantity: result.data.quantity,
          category: (result.data.category && isValidCategory)
            ? result.data.category
            : 'Uncategorized',
          store: result.data.store,
          isPurchased: false
        });

        toast.success(`Added ${result.data.item} to shopping list`, { id: toastId });
      }
      else {
        toast.error("I didn't quite catch that. Try 'Buy milk' or 'Spent $20'", { id: toastId });
      }

      setInput('');
      // Blur input on success to dismiss keyboard
      inputRef.current?.blur();

    } catch (error) {
      console.error('OmniBar Error:', error);
      const message = error instanceof Error ? error.message : "Something went wrong";
      toast.error(message, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`fixed bottom-20 left-4 right-4 z-40 transition-all duration-300 ${isFocused ? 'scale-105 bottom-24' : ''}`}>
      <form
        onSubmit={handleSubmit}
        className={`relative flex items-center bg-white/90 backdrop-blur-xl border border-white/50 shadow-lg shadow-brand-900/10 rounded-2xl overflow-hidden transition-all duration-300 ring-offset-2 ring-brand-500 ${isFocused ? 'ring-2 bg-white' : ''}`}
      >
        <div className="pl-4 pr-2 text-brand-400">
          {isLoading ? (
            <Loader2 size={20} className="animate-spin text-violet-500" />
          ) : (
            <Sparkles size={20} className={`text-violet-500 ${input.length > 0 ? 'animate-pulse' : ''}`} />
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Ask Horizon to log expenses, tasks, or items..."
          className="flex-1 py-4 bg-transparent border-none outline-none text-brand-800 placeholder:text-brand-300 text-sm font-medium"
          disabled={isLoading}
        />

        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="mr-2 p-2 rounded-xl text-brand-400 hover:text-brand-600 disabled:opacity-0 transition-all active:scale-95"
        >
          {input.trim() ? <Send size={20} className="text-violet-600" /> : <ArrowRight size={20} className="opacity-0" />}
        </button>

        {/* Gradient Border Overlay */}
        <div className="absolute inset-0 rounded-2xl border border-transparent pointer-events-none bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 opacity-50" />
      </form>
    </div>
  );
};
