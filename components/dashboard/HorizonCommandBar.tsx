import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { parseMagicAction } from '@/services/geminiService';
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export const HorizonCommandBar: React.FC = () => {
  const {
    householdId,
    buckets,
    groceryCategories,
    addTransaction,
    addShoppingItem,
    addToDo
  } = useHousehold();

  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !householdId) return;

    setIsProcessing(true);
    const originalInput = input;
    setInput(''); // Optimistic clear

    try {
      const today = new Date().toISOString().split('T')[0];
      const categoryNames = buckets.map(b => b.name);

      const result = await parseMagicAction(
        householdId,
        originalInput,
        {
          categories: categoryNames,
          groceryCategories: groceryCategories || [],
          todayDate: today
        }
      );

      if (result.type === 'unknown') {
        toast.error("I'm not sure what you mean. Try 'Buy milk' or 'Spent $20 on gas'.");
        setInput(originalInput); // Restore input
        return;
      }

      if (result.type === 'transaction') {
        if (!result.data.amount || !result.data.merchant || !result.data.category) {
            throw new Error("Missing transaction details");
        }
        await addTransaction({
            id: '', // Firestore will generate
            amount: result.data.amount,
            merchant: result.data.merchant,
            category: result.data.category,
            date: result.data.date || today,
            status: 'verified', // Explicit user input is trusted
            isRecurring: false,
            source: 'manual', // or 'magic' if we add that type later
            autoCategorized: true
        });
        toast.success(`Tracked: $${result.data.amount} at ${result.data.merchant}`);
      }
      else if (result.type === 'shopping') {
          if (!result.data.item || !result.data.category) {
              throw new Error("Missing item details");
          }
          await addShoppingItem({
              name: result.data.item,
              category: result.data.category,
              quantity: result.data.quantity,
              store: result.data.store,
              isPurchased: false
          });
          toast.success(`Added to list: ${result.data.item}`);
      }
      else if (result.type === 'todo') {
          if (!result.data.text) {
              throw new Error("Missing task details");
          }
          await addToDo({
              text: result.data.text,
              completeByDate: result.data.completeByDate || today,
              isCompleted: false,
              priority: 'medium', // Default
              assignedTo: '', // Unassigned by default
              source: 'voice' // Using 'voice' as proxy for natural language input
          });
          toast.success(`Task added: ${result.data.text}`);
      }

    } catch (error) {
      console.error("Magic Action Failed:", error);
      toast.error("Something went wrong. Please try again.");
      setInput(originalInput); // Restore input on error
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-brand-100 p-1">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 relative">
        <div className="pl-3 text-brand-400">
          <Sparkles size={18} />
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isProcessing}
          placeholder="Ask Horizon... (e.g., 'Spent $50 on gas', 'Buy milk')"
          className="flex-1 py-3 bg-transparent border-none focus:ring-0 text-brand-800 placeholder-brand-300 text-sm font-medium disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || isProcessing}
          className="p-2 mr-1 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
        </button>
      </form>
    </div>
  );
};
