import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowRight, Search, Zap, Loader2, ShoppingBag, CheckSquare, Wallet, Activity } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';

interface HorizonAction {
  type: 'transaction' | 'shopping' | 'todo' | 'habit' | 'ai';
  label: string;
  data?: any;
  confidence: number;
}

export const HorizonCommandBar: React.FC = () => {
  const {
    habits,
    buckets,
    addTransaction,
    addShoppingItem,
    addToDo,
    toggleHabit,
    householdId
  } = useHousehold();

  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [suggestion, setSuggestion] = useState<HorizonAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Heuristic Logic
  useEffect(() => {
    if (!inputValue.trim()) {
      setSuggestion(null);
      return;
    }

    const lowerInput = inputValue.toLowerCase().trim();

    // 1. Expense Regex: $Amount Merchant/Category
    const expenseMatch = inputValue.match(/^\$(\d+(\.\d{1,2})?)\s+(.+)$/);
    if (expenseMatch) {
      const amount = parseFloat(expenseMatch[1]);
      const description = expenseMatch[3].trim();

      // Try to match bucket/category
      const matchedBucket = buckets.find(b =>
        b.name.toLowerCase() === description.toLowerCase() ||
        description.toLowerCase().includes(b.name.toLowerCase())
      );

      const category = matchedBucket ? matchedBucket.name : 'Uncategorized';
      const merchant = description;

      setSuggestion({
        type: 'transaction',
        label: `Log $${amount.toFixed(2)} to ${category}`,
        confidence: 0.9,
        data: { amount, merchant, category }
      });
      return;
    }

    // 2. Shopping Regex: "Buy/Add Item"
    const shoppingMatch = lowerInput.match(/^(buy|add)\s+(.+)$/);
    if (shoppingMatch) {
      const item = shoppingMatch[2].trim();
      // Try to guess category from simple list or default
      const guessCategory = GROCERY_CATEGORIES.find(c => c.toLowerCase() === item.toLowerCase()) || 'Uncategorized';

      setSuggestion({
        type: 'shopping',
        label: `Add "${item}" to Shopping List`,
        confidence: 0.8,
        data: { name: item, category: guessCategory }
      });
      return;
    }

    // 3. Todo Regex: "Todo/Remind Item"
    const todoMatch = lowerInput.match(/^(todo|remind)\s+(.+)$/);
    if (todoMatch) {
      const task = todoMatch[2].trim();
      setSuggestion({
        type: 'todo',
        label: `Remind me: "${task}"`,
        confidence: 0.8,
        data: { text: task }
      });
      return;
    }

    // 4. Habit Match: Partial Title Match
    const matchedHabit = habits.find(h => h.title.toLowerCase().includes(lowerInput));
    if (matchedHabit) {
      setSuggestion({
        type: 'habit',
        label: `Toggle Habit: ${matchedHabit.title}`,
        confidence: 0.7, // Lower confidence for partial match
        data: { id: matchedHabit.id, direction: 'up' }
      });
      return;
    }

    // Default: AI Fallback
    setSuggestion({
      type: 'ai',
      label: 'Ask Horizon...',
      confidence: 0.5
    });

  }, [inputValue, buckets, habits]);

  const handleExecute = async () => {
    if (!inputValue.trim() || isLoading) return;
    if (!householdId) {
        toast.error('Household not found');
        return;
    }

    setIsLoading(true);
    const action = suggestion || { type: 'ai', label: 'Ask Horizon...', confidence: 0 };

    try {
      if (action.type === 'transaction') {
        const { amount, merchant, category } = action.data;
        await addTransaction({
          id: crypto.randomUUID(),
          amount,
          merchant,
          category,
          date: new Date().toISOString().split('T')[0],
          status: 'verified',
          source: 'manual',
          isRecurring: false,
          autoCategorized: true
        });
        toast.success(`Logged $${amount}`);
      }
      else if (action.type === 'shopping') {
        await addShoppingItem({
          name: action.data.name,
          category: action.data.category,
          quantity: '1',
          isPurchased: false
        });
        toast.success('Added to list');
      }
      else if (action.type === 'todo') {
        await addToDo({
          text: action.data.text,
          completeByDate: new Date().toISOString().split('T')[0],
          assignedTo: '', // Unassigned
          isCompleted: false
        });
        toast.success('Task added');
      }
      else if (action.type === 'habit') {
        await toggleHabit(action.data.id, 'up');
        // Toast is handled by toggleHabit
      }
      else if (action.type === 'ai') {
        // Dynamic Import for Gemini
        const { parseMagicAction } = await import('../../services/geminiService');
        const context = {
            categories: buckets.map(b => b.name),
            groceryCategories: GROCERY_CATEGORIES,
            todayDate: new Date().toISOString().split('T')[0]
        };

        const result = await parseMagicAction(householdId, inputValue, context);

        if (result.type === 'transaction') {
           const { amount, merchant, category, date } = result.data;
           if (amount && merchant) {
             await addTransaction({
               id: crypto.randomUUID(),
               amount,
               merchant,
               category: category || 'Uncategorized',
               date: date || new Date().toISOString().split('T')[0],
               status: 'verified',
               source: 'manual',
               isRecurring: false,
               autoCategorized: true
             });
             toast.success(`Logged $${amount} at ${merchant}`);
           } else {
             toast.error('Could not understand transaction details');
           }
        }
        else if (result.type === 'shopping') {
           const { item, quantity, category } = result.data;
           if (item) {
             await addShoppingItem({
               name: item,
               quantity: quantity || '1',
               category: category || 'Uncategorized',
               isPurchased: false
             });
             toast.success('Added to list');
           } else {
              toast.error('Could not identify item');
           }
        }
        else if (result.type === 'todo') {
           const { text, completeByDate } = result.data;
           if (text) {
             await addToDo({
                text,
                completeByDate: completeByDate || new Date().toISOString().split('T')[0],
                assignedTo: '',
                isCompleted: false
             });
             toast.success('Task added');
           } else {
              toast.error('Could not identify task');
           }
        } else {
           toast.error("I'm not sure what you mean. Try 'Spent $20' or 'Buy Milk'.");
        }
      }

      setInputValue('');
      setSuggestion(null);
      inputRef.current?.blur();

    } catch (error) {
      console.error(error);
      toast.error('Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleExecute();
    }
  };

  // Helper to render icon based on suggestion type
  const renderIcon = () => {
    if (!suggestion) return <Zap size={12} className="text-yellow-400 fill-yellow-400" />;
    switch (suggestion.type) {
        case 'transaction': return <Wallet size={12} className="text-emerald-400" />;
        case 'shopping': return <ShoppingBag size={12} className="text-blue-400" />;
        case 'todo': return <CheckSquare size={12} className="text-orange-400" />;
        case 'habit': return <Activity size={12} className="text-rose-400" />;
        default: return <Sparkles size={12} className="text-violet-400" />;
    }
  };

  return (
    <div className={`
      relative transition-all duration-300 ease-out z-20
      ${isFocused ? 'scale-[1.02]' : 'scale-100'}
    `}>
      {/* Main Bar */}
      <div
        className={`
          flex items-center gap-3 px-4 py-3.5
          bg-white rounded-2xl shadow-sm border
          transition-colors duration-200
          ${isFocused ? 'border-violet-500 shadow-md ring-2 ring-violet-100' : 'border-brand-100'}
        `}
      >
        {/* Leading Icon */}
        <div className={`
          shrink-0 transition-colors duration-300
          ${inputValue ? 'text-violet-600' : 'text-brand-400'}
        `}>
          {isLoading ? (
            <Loader2 size={20} className="animate-spin text-violet-600" />
          ) : inputValue ? (
            <Sparkles size={20} className="animate-pulse" />
          ) : (
            <Search size={20} />
          )}
        </div>

        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)} // Delay blur to allow click on suggestion
          placeholder="Ask Horizon or type '$20 Pizza'..."
          disabled={isLoading}
          className="flex-1 bg-transparent outline-none text-brand-800 placeholder:text-brand-400 font-medium"
        />

        {/* Trailing Action */}
        <button
          onClick={handleExecute}
          disabled={isLoading || !inputValue}
          className={`
            shrink-0 p-1.5 rounded-lg transition-all duration-200
            ${inputValue
              ? 'bg-violet-100 text-violet-700 opacity-100 translate-x-0 hover:bg-violet-200'
              : 'opacity-0 translate-x-2 pointer-events-none'}
          `}
          aria-label="Execute command"
        >
          <ArrowRight size={18} />
        </button>
      </div>

      {/* Suggestion / Context Pill */}
      <div className={`
        absolute left-4 right-4 -bottom-10
        transition-all duration-300 ease-out z-10
        ${(isFocused || inputValue) && suggestion ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}
      `}>
        <button
            onClick={handleExecute}
            className="w-full text-left bg-slate-800/90 backdrop-blur-md text-white text-xs font-medium px-3 py-2 rounded-xl shadow-lg flex items-center gap-2 hover:bg-slate-700 transition-colors"
        >
           {renderIcon()}
           <span>{suggestion?.label || 'Thinking...'}</span>
           <span className="ml-auto text-slate-400 text-[10px] uppercase tracking-wider font-bold">
               {suggestion?.type === 'ai' ? 'Enter' : 'Tap to Confirm'}
           </span>
        </button>
      </div>
    </div>
  );
};
