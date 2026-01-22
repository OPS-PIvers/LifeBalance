import React, { useState, useEffect } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { getSuggestedActions, SuggestedAction } from '../../utils/predictiveEngine';
import { SuggestedActionChip } from './SuggestedActionChip';
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';

const getLocalDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const HorizonCommandBar: React.FC = () => {
  const {
    transactions,
    habits,
    householdId,
    buckets,
    addTransaction,
    toggleHabit,
    addToDo,
    addShoppingItem,
    currentUser
  } = useHousehold();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedAction[]>([]);

  // Calculate suggestions
  useEffect(() => {
    const today = getLocalDateString();
    const actions = getSuggestedActions(transactions, habits, today);
    setSuggestions(actions);
  }, [transactions, habits]);

  const handleAction = async (action: SuggestedAction) => {
    if (action.type === 'transaction') {
      // Cast data to known shape since we checked type
      const data = action.data as { merchant: string; amount: number; category: string; date: string };
      try {
        await addTransaction({
            id: crypto.randomUUID(),
            ...data,
            status: 'verified', // Auto-verify predictive actions? Or pending? Let's say verified for speed.
            source: 'manual',
            isRecurring: false,
            autoCategorized: true
        });
        toast.success(`Added ${action.title} - ${action.subtitle}`);
      } catch {
        toast.error('Failed to add transaction');
      }
    } else if (action.type === 'habit') {
      const data = action.data as { habitId: string; direction: 'up' | 'down' };
      try {
        await toggleHabit(data.habitId, data.direction);
        // Toast is handled by toggleHabit
      } catch {
        toast.error('Failed to update habit');
      }
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !householdId) return;

    setIsLoading(true);
    try {
      const { parseMagicAction } = await import('../../services/geminiService');
      const context = {
        categories: buckets.map(b => b.name),
        groceryCategories: GROCERY_CATEGORIES,
        todayDate: getLocalDateString()
      };

      const result = await parseMagicAction(householdId, input, context);

      if (result.type === 'transaction') {
        await addTransaction({
            id: crypto.randomUUID(),
            amount: result.data.amount || 0,
            merchant: result.data.merchant || 'Unknown',
            category: result.data.category || 'Uncategorized',
            date: result.data.date || getLocalDateString(),
            status: 'verified',
            source: 'manual',
            isRecurring: false,
            autoCategorized: true
        });
        toast.success(`Tracked: ${result.data.merchant} $${result.data.amount}`);
      } else if (result.type === 'todo') {
        await addToDo({
            text: result.data.text || input,
            completeByDate: result.data.completeByDate || getLocalDateString(),
            isCompleted: false,
            priority: 'medium',
            assignedTo: currentUser?.uid || ''
        });
        toast.success('Task added');
      } else if (result.type === 'shopping') {
         await addShoppingItem({
             name: result.data.item || input,
             category: result.data.category || 'Uncategorized',
             quantity: result.data.quantity,
             store: result.data.store,
             isPurchased: false
         });
         toast.success('Added to list');
      } else {
        toast('Thinking...', { icon: '🤔' });
        // Maybe generate an insight if unknown? For now just say confusing.
        toast.error("I didn't quite catch that.");
      }

      setInput('');
    } catch (error) {
      console.error(error);
      toast.error('Horizon stumbled.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
      {/* Omni-Input */}
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-2xl blur opacity-20 group-hover:opacity-30 transition-opacity"></div>
        <form onSubmit={handleSubmit} className="relative bg-white rounded-2xl shadow-sm border border-brand-100 flex items-center p-1.5 transition-shadow group-hover:shadow-md">
          <div className="pl-3 pr-2 text-violet-500">
            <Sparkles size={20} className={isLoading ? "animate-spin" : ""} />
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Horizon or track anything..."
            className="flex-1 bg-transparent border-none outline-none text-brand-800 placeholder:text-brand-300 font-medium h-10"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2 bg-brand-50 hover:bg-violet-50 text-brand-400 hover:text-violet-600 rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={20} />}
          </button>
        </form>
      </div>

      {/* Predictive Chips */}
      {suggestions.length > 0 && !input && (
        <div className="overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          <div className="flex gap-3 w-max">
            {suggestions.map(action => (
              <SuggestedActionChip key={action.id} action={action} onAction={handleAction} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
