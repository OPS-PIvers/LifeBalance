import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Search, ArrowRight, Sparkles, Clock,
  LayoutDashboard, Wallet, Activity, Utensils,
  ShoppingCart, CheckSquare, Settings as SettingsIcon, Loader2
} from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { parseMagicAction, MagicActionResponse } from '../../services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { clsx } from 'clsx';

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  action: () => void;
  group: 'suggestion' | 'navigation' | 'magic';
}

export const CommandPalette: React.FC = () => {
  const { isCommandPaletteOpen, closeCommandPalette, toggleCommandPalette, openCaptureModal } = useUI();
  const { householdId, buckets } = useHousehold();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Magic Parsing State
  const [isParsing, setIsParsing] = useState(false);
  const [magicResult, setMagicResult] = useState<MagicActionResponse | null>(null);

  // Navigation Items
  const navItems = useMemo<CommandItem[]>(() => [
    {
      id: 'nav-dashboard',
      title: 'Dashboard',
      subtitle: 'Overview',
      icon: LayoutDashboard,
      action: () => navigate('/'),
      group: 'navigation'
    },
    {
      id: 'nav-budget',
      title: 'Budget',
      subtitle: 'Manage buckets & transactions',
      icon: Wallet,
      action: () => navigate('/budget'),
      group: 'navigation'
    },
    {
      id: 'nav-habits',
      title: 'Habits',
      subtitle: 'Track your routines',
      icon: Activity,
      action: () => navigate('/habits'),
      group: 'navigation'
    },
    {
      id: 'nav-todos',
      title: 'To-Dos',
      subtitle: 'Tasks & Reminders',
      icon: CheckSquare,
      action: () => navigate('/todos'),
      group: 'navigation'
    },
    {
      id: 'nav-shopping',
      title: 'Shopping List',
      subtitle: 'Groceries & items',
      icon: ShoppingCart,
      action: () => navigate('/shopping'),
      group: 'navigation'
    },
    {
      id: 'nav-meals',
      title: 'Meals',
      subtitle: 'Meal planning',
      icon: Utensils,
      action: () => navigate('/meals'),
      group: 'navigation'
    },
    {
      id: 'nav-settings',
      title: 'Settings',
      subtitle: 'Preferences & Config',
      icon: SettingsIcon,
      action: () => navigate('/settings'),
      group: 'navigation'
    },
  ], [navigate]);

  // Predictive Suggestions based on time
  const suggestions = useMemo<CommandItem[]>(() => {
    const hour = new Date().getHours();
    const list: CommandItem[] = [];

    // Morning (5-11)
    if (hour >= 5 && hour < 11) {
      list.push({
        id: 'sugg-morning-coffee',
        title: 'Log Morning Coffee',
        subtitle: 'Quick add expense',
        icon: Clock,
        action: () => openCaptureModal({ initialTab: 'transaction', initialData: { category: 'Dining', merchant: 'Coffee' } }),
        group: 'suggestion'
      });
    }

    // Lunch (11-14)
    if (hour >= 11 && hour < 14) {
      list.push({
        id: 'sugg-lunch',
        title: 'Log Lunch',
        subtitle: 'Quick add expense',
        icon: Utensils,
        action: () => openCaptureModal({ initialTab: 'transaction', initialData: { category: 'Dining' } }),
        group: 'suggestion'
      });
    }

    // Evening (17-21)
    if (hour >= 17 && hour < 21) {
      list.push({
        id: 'sugg-dinner',
        title: 'Log Dinner',
        subtitle: 'Quick add expense',
        icon: Utensils,
        action: () => openCaptureModal({ initialTab: 'transaction', initialData: { category: 'Dining' } }),
        group: 'suggestion'
      });
    }

    // General
    list.push({
      id: 'sugg-add-todo',
      title: 'Add a Task',
      subtitle: 'Create a new to-do',
      icon: CheckSquare,
      action: () => openCaptureModal({ initialTab: 'todo' }),
      group: 'suggestion'
    });

    return list;
  }, [openCaptureModal]);

  // Magic Action Parsing
  useEffect(() => {
    if (!query || query.length < 3) {
      setMagicResult(null);
      return;
    }

    // Only parse if it looks like natural language (contains spaces, numbers)
    // and isn't just matching a nav item
    const isNavMatch = navItems.some(item => item.title.toLowerCase().includes(query.toLowerCase()));
    if (isNavMatch && query.length < 10) return;

    const timer = setTimeout(async () => {
      setIsParsing(true);
      try {
        if (!householdId) return;

        const context = {
          categories: buckets.map(b => b.name),
          groceryCategories: GROCERY_CATEGORIES,
          todayDate: new Date().toISOString().split('T')[0]
        };

        const result = await parseMagicAction(householdId, query, context);
        if (result.type !== 'unknown' && result.confidence > 0.6) {
          setMagicResult(result);
        } else {
          setMagicResult(null);
        }
      } catch (err) {
        console.error("Magic Parse Error", err);
      } finally {
        setIsParsing(false);
      }
    }, 600); // 600ms debounce

    return () => clearTimeout(timer);
  }, [query, householdId, buckets, navItems]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    let items: CommandItem[] = [];

    // 1. Magic Result (Top Priority)
    if (magicResult && query) {
      let title = '';
      let subtitle = '';
      let icon = Sparkles;
      let action = () => {};

      if (magicResult.type === 'transaction') {
        title = `Log Expense: ${magicResult.data.amount ? `$${magicResult.data.amount}` : ''} ${magicResult.data.merchant || ''}`;
        subtitle = `Category: ${magicResult.data.category || 'Uncategorized'}`;
        icon = Wallet;
        action = () => openCaptureModal({
          initialTab: 'transaction',
          initialData: {
            amount: magicResult.data.amount?.toString(),
            merchant: magicResult.data.merchant,
            category: magicResult.data.category,
            date: magicResult.data.date
          }
        });
      } else if (magicResult.type === 'todo') {
        title = `Create Task: ${magicResult.data.text}`;
        subtitle = `Due: ${magicResult.data.completeByDate || 'Today'}`;
        icon = CheckSquare;
        action = () => openCaptureModal({
          initialTab: 'todo',
          initialTodoData: {
            text: magicResult.data.text,
            completeByDate: magicResult.data.completeByDate
          }
        });
      } else if (magicResult.type === 'shopping') {
        title = `Add Item: ${magicResult.data.item}`;
        subtitle = `Qty: ${magicResult.data.quantity || '1'} • ${magicResult.data.store || 'Any Store'}`;
        icon = ShoppingCart;
        action = () => openCaptureModal({
          initialTab: 'shopping',
          initialShoppingData: {
            name: magicResult.data.item,
            quantity: magicResult.data.quantity,
            category: magicResult.data.category,
            store: magicResult.data.store
          }
        });
      }

      items.push({
        id: 'magic-result',
        title,
        subtitle,
        icon,
        action,
        group: 'magic'
      });
    }

    // 2. Navigation Matches
    if (query) {
      const matches = navItems.filter(item =>
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.subtitle?.toLowerCase().includes(query.toLowerCase())
      );
      items = [...items, ...matches];
    } else {
      // 3. Default Suggestions (Empty State)
      items = [...suggestions];
    }

    return items;
  }, [query, magicResult, navItems, suggestions, openCaptureModal]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  // Global Keyboard Listener for Open/Close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
      if (e.key === 'Escape' && isCommandPaletteOpen) {
        closeCommandPalette();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, closeCommandPalette, toggleCommandPalette]);

  // Local Keyboard Listener for Navigation
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        closeCommandPalette();
      }
    }
  };

  // Focus input on open
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery(''); // Reset query
      setMagicResult(null);
    }
  }, [isCommandPaletteOpen]);

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCommandPalette}
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
          />

          {/* Palette Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative w-full max-w-xl bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col"
          >
            {/* Input Area */}
            <div className="flex items-center px-4 py-4 border-b border-slate-200/60">
              {isParsing ? (
                <Loader2 className="w-5 h-5 text-indigo-500 animate-spin mr-3" />
              ) : (
                <Search className="w-5 h-5 text-slate-400 mr-3" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Type a command or ask..."
                className="flex-1 bg-transparent text-lg text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-500">
                  <span className="text-[10px]">⌘</span>K
                </div>
              </div>
            </div>

            {/* Results Area */}
            <div className="max-h-[60vh] overflow-y-auto p-2">
               {filteredItems.length === 0 && query && !isParsing && (
                 <div className="text-center py-8 text-slate-400 text-sm">
                   No results found.
                 </div>
               )}

               {filteredItems.map((item, index) => (
                 <button
                   key={item.id}
                   onClick={() => {
                     item.action();
                     closeCommandPalette();
                   }}
                   onMouseEnter={() => setSelectedIndex(index)}
                   className={clsx(
                     "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors group relative",
                     index === selectedIndex ? "bg-indigo-50/80" : "hover:bg-slate-100/80"
                   )}
                 >
                    {/* Active Indicator */}
                    {index === selectedIndex && (
                      <motion.div
                        layoutId="active-indicator"
                        className="absolute left-0 w-1 h-6 bg-indigo-500 rounded-r-full"
                      />
                    )}

                    <div className={clsx(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                      item.group === 'magic' ? "bg-violet-100 text-violet-600" :
                      index === selectedIndex ? "bg-white text-indigo-600 shadow-sm" : "bg-slate-100 text-slate-500"
                    )}>
                      {item.group === 'magic' ? <Sparkles size={16} /> : <item.icon size={16} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className={clsx(
                        "font-medium block truncate",
                        item.group === 'magic' ? "text-violet-900" : "text-slate-700"
                      )}>
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="text-xs text-slate-500 truncate block">
                          {item.subtitle}
                        </span>
                      )}
                    </div>

                    {item.group === 'magic' && (
                      <span className="text-xxs font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
                        AI
                      </span>
                    )}

                    <ArrowRight size={14} className={clsx(
                      "transition-opacity",
                      index === selectedIndex ? "opacity-100 text-indigo-400" : "opacity-0 text-slate-300"
                    )} />
                 </button>
               ))}
            </div>

            {/* Footer */}
            <div className="bg-slate-50/50 px-4 py-2 border-t border-slate-200/60 flex justify-between items-center text-xs text-slate-400">
               <span>
                 <span className="font-medium text-slate-500">Horizon</span> Command Center
               </span>
               <div className="flex gap-3">
                 <span>Use arrow keys to navigate</span>
                 <span>Enter to select</span>
               </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
