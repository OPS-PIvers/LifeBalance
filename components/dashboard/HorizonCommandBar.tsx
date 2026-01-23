import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';

export const HorizonCommandBar: React.FC = () => {
  const {
    householdId,
    currentUser,
    buckets,
    groceryCategories,
    addTransaction,
    addToDo,
    addShoppingItem
  } = useHousehold();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !householdId) return;

    setIsLoading(true);
    // Unique ID for toast to allow updating
    const toastId = toast.loading('Consulting the oracle...');

    try {
      // Dynamic import to avoid bundle bloat
      const { parseMagicAction } = await import('@/services/geminiService');

      const today = new Date().toISOString().split('T')[0];

      const result = await parseMagicAction(
        householdId,
        input,
        {
          categories: buckets.map(b => b.name),
          groceryCategories: groceryCategories.length > 0 ? groceryCategories : GROCERY_CATEGORIES,
          todayDate: today
        }
      );

      if (result.type === 'transaction' && result.data.amount) {
        await addTransaction({
          id: 'temp', // Ignored by creation logic
          amount: result.data.amount,
          merchant: result.data.merchant || 'Unknown',
          category: result.data.category || 'Uncategorized',
          date: result.data.date || today,
          status: 'verified',
          isRecurring: false,
          source: 'manual',
          autoCategorized: true
        });
        toast.success(`Expense logged: $${result.data.amount} at ${result.data.merchant}`, { id: toastId });
        setInput('');
      } else if (result.type === 'todo' && result.data.text) {
        await addToDo({
          text: result.data.text,
          completeByDate: result.data.completeByDate || today,
          priority: 'medium',
          isCompleted: false,
          assignedTo: currentUser?.uid || '',
          source: 'voice' // Using 'voice' as it's structurally similar to voice commands
        });
        toast.success('Task added to your list', { id: toastId });
        setInput('');
      } else if (result.type === 'shopping' && result.data.item) {
        await addShoppingItem({
          name: result.data.item,
          quantity: result.data.quantity || '1',
          category: result.data.category || 'Uncategorized',
          isPurchased: false,
          store: result.data.store
        });
        toast.success(`Added ${result.data.item} to shopping list`, { id: toastId });
        setInput('');
      } else {
        toast.error('Could not understand that command', { id: toastId });
      }

    } catch (error) {
      console.error('Horizon Command Bar Error:', error);
      toast.error('Something went wrong', { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative animate-in fade-in slide-in-from-top-4 duration-700">
      {/* Glow Effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400 rounded-2xl blur opacity-20 pointer-events-none"></div>

      <form
        onSubmit={handleSubmit}
        className="relative bg-white rounded-2xl shadow-sm border border-brand-100 p-1 pl-3 flex items-center gap-2 focus-within:ring-2 focus-within:ring-violet-100 transition-all"
      >
        <Sparkles className="text-violet-500 shrink-0" size={20} />

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          className="flex-1 bg-transparent border-none focus:ring-0 text-brand-800 placeholder-brand-300 font-medium py-3 text-sm md:text-base"
          placeholder="What's on your mind? (e.g. 'Spent $20 on lunch')"
        />

        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="p-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all shadow-sm"
          aria-label="Submit Command"
        >
          {isLoading ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <ArrowRight size={20} />
          )}
        </button>
      </form>
    </div>
  );
};
