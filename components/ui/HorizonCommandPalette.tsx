import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Sparkles, ArrowRight, Command,
  CreditCard, CheckSquare, ShoppingCart,
  LayoutDashboard, Activity, Utensils, Settings,
  Loader2, Wallet
} from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { parseMagicAction } from '../../services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';

interface HorizonCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandOption {
  id: string;
  title: string;
  description?: string;
  icon: React.ElementType;
  action: () => void;
  type: 'navigation' | 'action';
  keywords: string[];
}

const HorizonCommandPalette: React.FC<HorizonCommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const {
    householdId,
    buckets,
    addTransaction,
    addToDo,
    addShoppingItem,
    currentUser
  } = useHousehold();

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setIsProcessing(false);
      // Focus input after a short delay to allow animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Define Static Commands
  const commands: CommandOption[] = [
    // Navigation
    {
      id: 'nav-home',
      title: 'Go to Dashboard',
      description: 'View insights and action queue',
      icon: LayoutDashboard,
      action: () => navigate('/'),
      type: 'navigation',
      keywords: ['home', 'dashboard', 'main', 'index']
    },
    {
      id: 'nav-budget',
      title: 'Go to Budget',
      description: 'Check spending and buckets',
      icon: Wallet,
      action: () => navigate('/budget'),
      type: 'navigation',
      keywords: ['budget', 'spending', 'money', 'finance']
    },
    {
      id: 'nav-habits',
      title: 'Go to Habits',
      description: 'Track your streaks',
      icon: Activity,
      action: () => navigate('/habits'),
      type: 'navigation',
      keywords: ['habits', 'streaks', 'goals', 'tracker']
    },
    {
      id: 'nav-meals',
      title: 'Go to Meals',
      description: 'Meal planning and pantry',
      icon: Utensils,
      action: () => navigate('/meals'),
      type: 'navigation',
      keywords: ['meals', 'food', 'pantry', 'cooking', 'recipes']
    },
    {
      id: 'nav-shopping',
      title: 'Go to Shopping List',
      description: 'View grocery list',
      icon: ShoppingCart,
      action: () => navigate('/shopping'),
      type: 'navigation',
      keywords: ['shopping', 'groceries', 'list', 'buy']
    },
    {
      id: 'nav-todos',
      title: 'Go to To-Dos',
      description: 'View tasks',
      icon: CheckSquare,
      action: () => navigate('/todos'),
      type: 'navigation',
      keywords: ['todo', 'tasks', 'reminders']
    },
    {
      id: 'nav-settings',
      title: 'Go to Settings',
      description: 'App preferences',
      icon: Settings,
      action: () => navigate('/settings'),
      type: 'navigation',
      keywords: ['settings', 'config', 'profile', 'account']
    },
  ];

  // Filter commands based on query
  const filteredCommands = commands.filter(cmd => {
    if (!query) return true;
    const search = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(search) ||
      cmd.description?.toLowerCase().includes(search) ||
      cmd.keywords.some(k => k.includes(search))
    );
  });

  // Determine if we should show "Ask AI" option
  // Show if query is long enough and doesn't exactly match a command
  const showMagicOption = query.length > 3;

  const handleMagicAction = async () => {
    if (!householdId || !query.trim()) return;

    setIsProcessing(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const categoryNames = buckets.map(b => b.name);

      const result = await parseMagicAction(householdId, query, {
        categories: [...categoryNames, 'Uncategorized'],
        groceryCategories: GROCERY_CATEGORIES,
        todayDate: today
      });

      if (result.type === 'transaction') {
        await addTransaction({
          id: crypto.randomUUID(),
          amount: result.data.amount || 0,
          merchant: result.data.merchant || 'Unknown Merchant',
          category: result.data.category || 'Uncategorized',
          date: result.data.date || today,
          status: 'pending_review',
          isRecurring: false,
          source: 'horizon-ai',
          autoCategorized: true
        });
        toast.success("Transaction added to Queue!");
      } else if (result.type === 'todo') {
        await addToDo({
          text: result.data.text || query,
          completeByDate: result.data.completeByDate || today,
          assignedTo: currentUser?.uid || '',
          isCompleted: false
        });
        toast.success("Task added!");
      } else if (result.type === 'shopping') {
        await addShoppingItem({
          name: result.data.item || query,
          category: result.data.category || 'Uncategorized',
          quantity: result.data.quantity,
          store: result.data.store,
          isPurchased: false
        });
        toast.success("Added to Shopping List!");
      } else {
        toast.error("Couldn't understand that action.");
      }

      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Horizon encountered an error.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev =>
        prev < (filteredCommands.length + (showMagicOption ? 0 : -1)) ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => prev > 0 ? prev - 1 : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();

      // If Magic Option is shown and selected (it's always first if no exact matches,
      // or we can treat "index 0" as magic if query exists and no perfect match?)
      // Let's simplify: Magic Option is a distinct item in the list logic?
      // Actually, let's treat "Enter" on text input as "Execute Magic" if no command is highlighted?
      // Or make Magic Action the *first* item in the list if query is complex?

      // Current Logic:
      // If query is present, index 0 is the "Ask AI" option if we inject it?
      // Let's inject "Ask AI" as the first item in filteredCommands if applicable.

      const effectiveCommands = getEffectiveOptions();
      const selected = effectiveCommands[selectedIndex];

      if (selected?.id === 'magic-ai') {
        handleMagicAction();
      } else if (selected) {
        selected.action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const getEffectiveOptions = () => {
    const options: any[] = [...filteredCommands];
    if (showMagicOption) {
      // Add Magic Option at the top
      options.unshift({
        id: 'magic-ai',
        title: `Ask Horizon: "${query}"`,
        description: 'Create transaction, task, or shopping item...',
        icon: Sparkles,
        action: handleMagicAction,
        type: 'action',
        isMagic: true
      });
    }
    return options;
  };

  const effectiveOptions = getEffectiveOptions();

  // Adjust selected index if it goes out of bounds when list changes
  useEffect(() => {
    if (selectedIndex >= effectiveOptions.length) {
      setSelectedIndex(Math.max(0, effectiveOptions.length - 1));
    }
  }, [effectiveOptions.length, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 ring-1 ring-black/5">

        {/* Search Input */}
        <div className="flex items-center px-4 py-4 border-b border-gray-100 bg-white">
          <Search className="w-5 h-5 text-gray-400 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Where to? or 'Spent $50 on gas'..."
            className="flex-1 text-lg font-medium text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            {isProcessing && <Loader2 className="w-5 h-5 text-brand-600 animate-spin" />}
            <div className="hidden sm:flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs font-bold text-gray-500">
              <span className="text-[10px]">ESC</span>
            </div>
          </div>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto py-2 scroll-smooth"
        >
          {effectiveOptions.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400">
              <Command className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No commands found</p>
            </div>
          ) : (
            effectiveOptions.map((option, index) => {
              const isSelected = index === selectedIndex;
              const Icon = option.icon;
              const isMagic = option.isMagic;

              return (
                <div
                  key={option.id}
                  onClick={() => {
                     if (option.id === 'magic-ai') handleMagicAction();
                     else { option.action(); onClose(); }
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`mx-2 px-3 py-3 rounded-xl flex items-center gap-3 cursor-pointer transition-colors ${
                    isSelected
                      ? isMagic ? 'bg-indigo-50 text-indigo-900' : 'bg-brand-50 text-brand-900'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${
                    isSelected
                      ? isMagic ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-brand-600 shadow-sm'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold flex items-center gap-2">
                      {option.title}
                      {isMagic && <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">AI</span>}
                    </div>
                    {option.description && (
                      <div className={`text-sm truncate ${isSelected ? 'text-opacity-80' : 'text-gray-400'}`}>
                        {option.description}
                      </div>
                    )}
                  </div>

                  {isSelected && (
                    <ArrowRight className={`w-4 h-4 ${isMagic ? 'text-indigo-400' : 'text-brand-400'}`} />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 font-medium">
          <span>Horizon Command</span>
          <div className="flex gap-3">
             <span className="flex items-center gap-1">
                <span className="w-4 h-4 flex items-center justify-center bg-white border border-gray-200 rounded">↵</span>
                to select
             </span>
             <span className="flex items-center gap-1">
                <span className="w-4 h-4 flex items-center justify-center bg-white border border-gray-200 rounded">↑↓</span>
                to navigate
             </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HorizonCommandPalette;
